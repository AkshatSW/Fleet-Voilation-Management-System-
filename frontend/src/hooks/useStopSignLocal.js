/**
 * In-browser stop-sign detection with YOLOv8n via ONNX Runtime Web.
 *
 * Runs the same YOLOv8n model as the backend, but in the user's browser —
 * no network round-trip, no JPEG encode, WebGPU/WebGL GPU-accelerated.
 * Typical latency: 20-60ms per frame end-to-end on modern laptops.
 *
 * The ONNX file lives at /models/yolov8n-640.onnx (served by Vite from public/).
 * ORT's WASM binaries are loaded from the jsDelivr CDN on first use.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import * as ort from 'onnxruntime-web'

// Point ORT at a CDN for its WASM binaries. Alternatives: ship them in public/
// via a Vite copy plugin. CDN is the lowest-friction option and works for both
// dev and prod without special bundler config.
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/'

const MODEL_URL = '/models/yolov8n-640.onnx'
const INPUT_SIZE = 640
const STOP_SIGN_CLASS_ID = 11   // COCO class for "stop sign"
const CONFIDENCE_THRESHOLD = 0.15   // lowered — small/distant signs score lower even when correct
const IOU_THRESHOLD = 0.45
const DETECTION_INTERVAL = 80   // ~12.5Hz attempts; actual throughput gated by inFlight guard
// Zoom pass: crops the upper 55% of the frame and runs a 2nd inference.
// Distant road signs typically sit in the upper portion of a dashcam view, and
// the crop effectively 2x-zooms them — turning a 15px sign into 30px pixels in
// the model input, where YOLOv8n detects reliably. ~2x inference cost.
const ZOOM_PASS_ENABLED = true
const ZOOM_REGION = { x: 0.0, y: 0.0, w: 1.0, h: 0.55 }

function iou(a, b) {
  const [ax, ay, aw, ah] = a
  const [bx, by, bw, bh] = b
  const x1 = Math.max(ax, bx)
  const y1 = Math.max(ay, by)
  const x2 = Math.min(ax + aw, bx + bw)
  const y2 = Math.min(ay + ah, by + bh)
  const iw = Math.max(0, x2 - x1)
  const ih = Math.max(0, y2 - y1)
  const inter = iw * ih
  const union = aw * ah + bw * bh - inter
  return union > 0 ? inter / union : 0
}

let _sessionPromise = null
let _activeProvider = null
async function getSession() {
  if (_sessionPromise) return _sessionPromise
  _sessionPromise = (async () => {
    console.log('[StopSignLocal] loading ONNX model…')
    // Try WebGPU (~15-25ms inference) first; fall back to WASM (~60-100ms).
    // Try each provider individually so we know which one succeeded.
    for (const provider of ['webgpu', 'wasm']) {
      try {
        const session = await ort.InferenceSession.create(MODEL_URL, {
          executionProviders: [provider],
          graphOptimizationLevel: 'all',
        })
        _activeProvider = provider
        console.log(
          `[StopSignLocal] model loaded with provider=${provider}. ` +
          `input=${session.inputNames} output=${session.outputNames}`
        )
        return session
      } catch (err) {
        console.warn(`[StopSignLocal] provider=${provider} failed:`, err.message || err)
      }
    }
    throw new Error('No ONNX execution provider could load the model')
  })()
  return _sessionPromise
}

export default function useStopSignLocal(videoRef, onDetect, onLost, bboxOverlayRef) {
  const sessionRef = useRef(null)
  const canvasRef = useRef(null)        // offscreen canvas for frame capture + letterbox
  const intervalRef = useRef(null)
  const isDetectingRef = useRef(false)
  const inFlightRef = useRef(false)
  const lastDetectionRef = useRef(null)
  const [isModelReady, setIsModelReady] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsModelLoading(true)
    getSession()
      .then((s) => {
        if (cancelled) return
        sessionRef.current = s
        setIsModelReady(true)
      })
      .catch((err) => console.error('[StopSignLocal] model load failed:', err))
      .finally(() => { if (!cancelled) setIsModelLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Preprocess: draw a region of the video into a 640x640 letterboxed canvas,
  // normalize to [0,1], CHW layout. Returns the input tensor + the transform
  // needed to undo scaling + translate back to original-video coordinates.
  //
  // `region` (optional): { x, y, w, h } in fractional video coords (0..1).
  //   Defaults to the whole frame. Use a region to implement a zoom pass.
  const preprocess = useCallback((region = null) => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return null
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return null

    const regionX = region ? region.x * vw : 0
    const regionY = region ? region.y * vh : 0
    const regionW = region ? region.w * vw : vw
    const regionH = region ? region.h * vh : vh

    const scale = Math.min(INPUT_SIZE / regionW, INPUT_SIZE / regionH)
    const nw = Math.round(regionW * scale)
    const nh = Math.round(regionH * scale)
    const padX = Math.floor((INPUT_SIZE - nw) / 2)
    const padY = Math.floor((INPUT_SIZE - nh) / 2)

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas')
      canvasRef.current.width = INPUT_SIZE
      canvasRef.current.height = INPUT_SIZE
    }
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = 'rgb(114, 114, 114)'
    ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
    // Draw the specified source region of the video into the letterboxed input.
    ctx.drawImage(video, regionX, regionY, regionW, regionH, padX, padY, nw, nh)

    const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE)
    const hw = INPUT_SIZE * INPUT_SIZE
    const tensorData = new Float32Array(3 * hw)
    for (let i = 0; i < hw; i++) {
      const p = i * 4
      tensorData[i] = data[p] / 255
      tensorData[hw + i] = data[p + 1] / 255
      tensorData[hw * 2 + i] = data[p + 2] / 255
    }
    return {
      tensor: new ort.Tensor('float32', tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]),
      scale, padX, padY,
      regionX, regionY,   // origin of the cropped region in original-video coords
    }
  }, [videoRef])

  // Postprocess: [1, 84, 8400] output -> stop-sign detections in ORIGINAL video coords.
  // Only scans the stop-sign class column (saves ~79x work vs all 80 classes).
  // Does NOT apply NMS here — NMS runs once after merging all passes.
  const decodeDetections = useCallback((output, prep) => {
    const data = output.data
    const nBoxes = output.dims[2]
    const results = []

    for (let i = 0; i < nBoxes; i++) {
      const score = data[(4 + STOP_SIGN_CLASS_ID) * nBoxes + i]
      if (score < CONFIDENCE_THRESHOLD) continue

      const cx = data[0 * nBoxes + i]
      const cy = data[1 * nBoxes + i]
      const w = data[2 * nBoxes + i]
      const h = data[3 * nBoxes + i]

      // Undo letterbox -> coords within the source REGION, then translate to ORIGINAL video coords.
      const x = (cx - w / 2 - prep.padX) / prep.scale + prep.regionX
      const y = (cy - h / 2 - prep.padY) / prep.scale + prep.regionY
      const ow = w / prep.scale
      const oh = h / prep.scale

      results.push({ confidence: score, bbox: [x, y, ow, oh] })
    }
    return results
  }, [])

  const runNMS = useCallback((detections) => {
    detections.sort((a, b) => b.confidence - a.confidence)
    const kept = []
    for (const d of detections) {
      if (kept.every((k) => iou(d.bbox, k.bbox) <= IOU_THRESHOLD)) kept.push(d)
    }
    return kept
  }, [])

  const runInference = useCallback(async (prep) => {
    const results = await sessionRef.current.run({
      [sessionRef.current.inputNames[0]]: prep.tensor,
    })
    return results[sessionRef.current.outputNames[0]]
  }, [])

  const detectFrame = useCallback(async () => {
    if (!isDetectingRef.current || inFlightRef.current) return
    if (!sessionRef.current) return

    inFlightRef.current = true
    const t0 = performance.now()
    try {
      // Pass 1: full frame
      const prepFull = preprocess()
      if (!prepFull) return
      const outFull = await runInference(prepFull)
      let dets = decodeDetections(outFull, prepFull)
      const fullCount = dets.length

      // Pass 2: zoom into upper portion where distant signs typically appear.
      // Cheap recall boost for small/far signs; ~doubles inference cost.
      let zoomCount = 0
      if (ZOOM_PASS_ENABLED) {
        const prepZoom = preprocess(ZOOM_REGION)
        if (prepZoom) {
          const outZoom = await runInference(prepZoom)
          const zoomDets = decodeDetections(outZoom, prepZoom)
          zoomCount = zoomDets.length
          dets = dets.concat(zoomDets)
        }
      }

      dets = runNMS(dets)
      const ms = Math.round(performance.now() - t0)
      if (dets.length || Math.random() < 0.1) {
        console.log(
          `[StopSignLocal] ${dets.length} det in ${ms}ms ` +
          `(full=${fullCount} zoom=${zoomCount}) provider=${_activeProvider}`
        )
      }

      const best = dets[0]
      if (best) {
        if (bboxOverlayRef) {
          bboxOverlayRef.current = {
            bbox: best.bbox,
            label: `Stop ${best.confidence.toFixed(2)}`,
            confidence: best.confidence,
          }
        }
        const info = {
          type: 'STOP_SIGN',
          confidence: best.confidence,
          bbox: best.bbox,
          timestamp: Date.now(),
        }
        if (
          !lastDetectionRef.current ||
          Math.abs(lastDetectionRef.current.confidence - info.confidence) > 0.2
        ) {
          lastDetectionRef.current = info
          onDetect?.(info)
        }
      } else {
        if (bboxOverlayRef) bboxOverlayRef.current = null
        if (lastDetectionRef.current) onLost?.(lastDetectionRef.current)
        lastDetectionRef.current = null
      }
    } catch (err) {
      console.error('[StopSignLocal] inference failed:', err)
    } finally {
      inFlightRef.current = false
    }
  }, [preprocess, decodeDetections, runNMS, runInference, onDetect, onLost, bboxOverlayRef])

  const detectFrameRef = useRef(detectFrame)
  useEffect(() => { detectFrameRef.current = detectFrame }, [detectFrame])

  const startDetection = useCallback(() => {
    if (isDetectingRef.current) return
    isDetectingRef.current = true
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => detectFrameRef.current(), DETECTION_INTERVAL)
  }, [])

  const stopDetection = useCallback(() => {
    isDetectingRef.current = false
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
    isModelReady,
    isModelLoading,
    startDetection,
    stopDetection,
    isDetecting: isDetectingRef.current,
  }
}
