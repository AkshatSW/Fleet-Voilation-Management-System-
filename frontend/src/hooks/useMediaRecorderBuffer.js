import { useRef, useCallback } from 'react'

export default function useMediaRecorderBuffer({ bufferSeconds = 20 } = {}) {
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const isRecordingRef = useRef(false)
  const pendingClipRef = useRef(null)
  const streamRef = useRef(null)

  const start = useCallback((stream) => {
    if (!stream || isRecordingRef.current) return
    streamRef.current = stream
    chunksRef.current = []

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'

    const recorder = new MediaRecorder(stream, { mimeType })
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push({ blob: e.data, time: Date.now() })
        // Keep only bufferSeconds worth of chunks
        const cutoff = Date.now() - bufferSeconds * 1000
        chunksRef.current = chunksRef.current.filter((c) => c.time >= cutoff)

        // If we have a pending clip capture, check if enough post-event time has passed
        if (pendingClipRef.current) {
          const { resolveClip, eventTime, postSeconds } = pendingClipRef.current
          if (Date.now() - eventTime >= postSeconds * 1000) {
            const allChunks = chunksRef.current.map((c) => c.blob)
            resolveClip(new Blob(allChunks, { type: mimeType }))
            pendingClipRef.current = null
          }
        }
      }
    }

    recorder.start(1000) // 1-second chunks
    isRecordingRef.current = true
  }, [bufferSeconds])

  const stop = useCallback(() => {
    if (recorderRef.current && isRecordingRef.current) {
      recorderRef.current.stop()
      isRecordingRef.current = false
      chunksRef.current = []
      streamRef.current = null
      if (pendingClipRef.current) {
        pendingClipRef.current.resolveClip(null)
        pendingClipRef.current = null
      }
    }
  }, [])

  const captureClip = useCallback((preSeconds = 5, postSeconds = 10) => {
    return new Promise((resolve) => {
      if (!isRecordingRef.current) {
        resolve(null)
        return
      }
      // Store the resolve so ondataavailable can fulfill it after postSeconds
      pendingClipRef.current = {
        resolveClip: resolve,
        eventTime: Date.now(),
        postSeconds,
      }
    })
  }, [])

  const captureSnapshot = useCallback((videoElement) => {
    if (!videoElement) return null
    const canvas = document.createElement('canvas')
    canvas.width = videoElement.videoWidth || 640
    canvas.height = videoElement.videoHeight || 480
    const ctx = canvas.getContext('2d')
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85)
    })
  }, [])

  return { start, stop, captureClip, captureSnapshot }
}
