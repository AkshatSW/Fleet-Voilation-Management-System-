import { useRef, useCallback } from 'react'

/**
 * Per-violation MediaRecorder. Each captureClip() call spawns a fresh
 * MediaRecorder on the current stream, records for `seconds`, stops, and
 * returns a complete WebM blob. Because MediaRecorder.stop() flushes the
 * EBML container properly, every clip has a valid Duration header and plays
 * without the "0:00" bug.
 *
 * Trade-off: no pre-event buffer — the clip shows what happened AFTER the
 * violation fires, for `seconds` seconds. Simpler than a rolling buffer and
 * reliable under concurrent violations (each gets its own recorder instance).
 *
 *   start(stream)     — store the stream reference
 *   captureClip(sec)  — start a new recording on the stored stream, returns
 *                       Promise<Blob|null> that resolves when the recording
 *                       stops (`sec` seconds later)
 *   captureSnapshot   — grab a single JPEG frame from a video element
 *   stop()            — clear the stream reference (stops future captureClip
 *                       calls from being able to run)
 *
 * The hook-exported API is unchanged so callers (DriverCamera.jsx) don't
 * need to adapt.
 */
const CLIP_SECONDS = 5

export default function useMediaRecorderBuffer() {
  const streamRef = useRef(null)
  const mimeTypeRef = useRef(null)

  const start = useCallback((stream) => {
    streamRef.current = stream
    mimeTypeRef.current = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'
  }, [])

  const stop = useCallback(() => {
    streamRef.current = null
  }, [])

  const captureClip = useCallback((seconds = CLIP_SECONDS) => {
    return new Promise((resolve) => {
      const stream = streamRef.current
      if (!stream) {
        resolve(null)
        return
      }
      const mimeType = mimeTypeRef.current || 'video/webm'
      let recorder
      try {
        recorder = new MediaRecorder(stream, { mimeType })
      } catch (err) {
        console.error('[mediaBuffer] MediaRecorder ctor failed:', err)
        resolve(null)
        return
      }

      const chunks = []
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = () => {
        if (!chunks.length) {
          resolve(null)
          return
        }
        // Because stop() flushed a proper EBML footer, this blob has real
        // duration metadata — no 0:00 bug, no post-processing needed.
        resolve(new Blob(chunks, { type: mimeType }))
      }
      recorder.onerror = (e) => {
        console.error('[mediaBuffer] recorder error:', e)
        resolve(null)
      }

      recorder.start()
      // Stop after `seconds` — use setTimeout rather than relying on the
      // timeslice argument of start(), so the onstop event fires exactly
      // once with all accumulated data.
      setTimeout(() => {
        try {
          if (recorder.state !== 'inactive') recorder.stop()
        } catch (err) {
          console.error('[mediaBuffer] recorder.stop() failed:', err)
          resolve(null)
        }
      }, seconds * 1000)
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
