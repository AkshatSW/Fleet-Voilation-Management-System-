/**
 * Posts JPEG frames to /api/detect/stop-sign and emits detections.
 */

import { useEffect, useRef, useCallback } from 'react'
import { detectionService } from '../services'

const CONFIG = {
  DETECTION_INTERVAL: 120,    // 8Hz. Lower if backend inference is fast enough.
  CONFIDENCE_THRESHOLD: 0.25,
  CONSECUTIVE_DETECTIONS: 1,
  JPEG_QUALITY: 0.6,          // very low quality — stop signs survive heavy compression
  FRAME_WIDTH: 480,           // match backend imgsz=320 closely (+margin for letterbox)
  FRAME_HEIGHT: 270,
}

export default function useStopSignServer(videoRef, onDetect, onLost, bboxOverlayRef) {
  const intervalRef = useRef(null)
  const isDetectingRef = useRef(false)
  const inFlightRef = useRef(false)
  const consecutiveRef = useRef(0)
  const lastDetectionRef = useRef(null)
  const canvasRef = useRef(null)

  const captureFrame = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return null

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
    const canvas = canvasRef.current
    canvas.width = CONFIG.FRAME_WIDTH
    canvas.height = CONFIG.FRAME_HEIGHT
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', CONFIG.JPEG_QUALITY)
    })
  }, [videoRef])

  const detectFrame = useCallback(async () => {
    if (!isDetectingRef.current || inFlightRef.current) return

    const blob = await captureFrame()
    if (!blob) return

    inFlightRef.current = true
    try {
      const result = await detectionService.detectStopSign(blob)
      if (!isDetectingRef.current) return

      const vw = videoRef.current?.videoWidth || 0
      const vh = videoRef.current?.videoHeight || 0
      const [sentW, sentH] = result.image_size || [CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT]
      const detections = result.detections || []
      console.log(
        `[StopSignServer] ${detections.length} det in ${result.inference_ms}ms` +
        (detections.length
          ? ` [${detections.map((d) => `${(d.confidence * 100).toFixed(0)}%`).join(', ')}]`
          : '')
      )

      const best = detections
        .filter((d) => d.confidence >= CONFIG.CONFIDENCE_THRESHOLD)
        .sort((a, b) => b.confidence - a.confidence)[0]

      if (best) {
        const sx = vw / sentW
        const sy = vh / sentH
        const [bx, by, bw, bh] = best.bbox
        const scaledBbox = [bx * sx, by * sy, bw * sx, bh * sy]

        if (bboxOverlayRef) {
          bboxOverlayRef.current = {
            bbox: scaledBbox,
            label: `Stop ${best.confidence.toFixed(2)}`,
            confidence: best.confidence,
          }
        }

        consecutiveRef.current++
        if (consecutiveRef.current >= CONFIG.CONSECUTIVE_DETECTIONS) {
          const info = {
            type: 'STOP_SIGN',
            confidence: best.confidence,
            bbox: scaledBbox,
            timestamp: Date.now(),
          }
          if (
            !lastDetectionRef.current ||
            Math.abs(lastDetectionRef.current.confidence - info.confidence) > 0.2
          ) {
            lastDetectionRef.current = info
            onDetect?.(info)
          }
        }
      } else {
        if (bboxOverlayRef) bboxOverlayRef.current = null
        if (consecutiveRef.current >= CONFIG.CONSECUTIVE_DETECTIONS) {
          onLost?.(lastDetectionRef.current)
        }
        consecutiveRef.current = 0
        lastDetectionRef.current = null
      }
    } catch (err) {
      console.error('[StopSignServer]', err)
    } finally {
      inFlightRef.current = false
    }
  }, [captureFrame, onDetect, onLost, bboxOverlayRef, videoRef])

  const detectFrameRef = useRef(detectFrame)
  useEffect(() => { detectFrameRef.current = detectFrame }, [detectFrame])

  const startDetection = useCallback(() => {
    if (isDetectingRef.current) return
    isDetectingRef.current = true
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => detectFrameRef.current(), CONFIG.DETECTION_INTERVAL)
  }, [])

  const stopDetection = useCallback(() => {
    isDetectingRef.current = false
    consecutiveRef.current = 0
    lastDetectionRef.current = null
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
  }, [])

  return {
    isModelReady: true,
    isModelLoading: false,
    startDetection,
    stopDetection,
    isDetecting: isDetectingRef.current,
  }
}
