import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Phone-as-GPS pairing client.
 *
 * Generates a sessionId on `start()`, opens a WebSocket to
 * /api/ws/phone-gps/{sessionId}, and exposes the most recent fix the phone
 * has POSTed to /api/phone-gps/{sessionId}. The companion phone page is at
 * /phone-gps/{sessionId} (public route, no auth).
 *
 * State:
 *   sessionId          — null until start() generates one
 *   pairingActive      — WS open and accepted
 *   phoneConnected     — at least one fix has been received
 *   lastPhoneFix       — most recent { lat, lng, accuracy, heading, speed, ts }
 *   pairingError       — last connection error message, if any
 *   phoneUrl           — URL to encode in the QR. When the laptop is loaded
 *                        via localhost we ask the backend for a LAN IP so
 *                        the phone can actually reach the dashboard.
 *
 * Actions:
 *   start()  — generate sessionId, open WS, resolve phoneUrl
 *   stop()   — close WS, reset all state
 */
export default function usePhoneGPSPairing() {
  const [sessionId, setSessionId] = useState(null)
  const [pairingActive, setPairingActive] = useState(false)
  const [phoneConnected, setPhoneConnected] = useState(false)
  const [lastPhoneFix, setLastPhoneFix] = useState(null)
  const [pairingError, setPairingError] = useState(null)
  const [phoneUrl, setPhoneUrl] = useState(null)
  const wsRef = useRef(null)

  const stop = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.close() } catch { /* ignore */ }
      wsRef.current = null
    }
    setSessionId(null)
    setPairingActive(false)
    setPhoneConnected(false)
    setLastPhoneFix(null)
    setPairingError(null)
    setPhoneUrl(null)
  }, [])

  // Builds the URL the phone will load. If the dashboard is being viewed
  // on localhost, the laptop's loopback address is useless to the phone —
  // we ask the backend for a LAN IP and substitute it. Falls back to
  // window.location.origin if the backend lookup fails or returns nothing.
  const resolvePhoneUrl = useCallback(async (sid) => {
    const origin = window.location.origin
    const fallback = `${origin}/phone-gps/${encodeURIComponent(sid)}`
    const host = window.location.hostname
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    if (!isLoopback) return fallback
    try {
      const res = await fetch('/api/phone-gps/host-info')
      if (!res.ok) return fallback
      const data = await res.json()
      const ip = Array.isArray(data?.ips) && data.ips.length > 0 ? data.ips[0] : null
      if (!ip) return fallback
      const port = window.location.port
        ? `:${window.location.port}`
        : ''
      return `${window.location.protocol}//${ip}${port}/phone-gps/${encodeURIComponent(sid)}`
    } catch {
      return fallback
    }
  }, [])

  const start = useCallback(() => {
    // Cryptographically random sessionId — UUID has 122 bits of entropy,
    // plenty for an unguessable pairing token.
    const sid = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2)

    // Tear down any prior session before starting a new one.
    if (wsRef.current) {
      try { wsRef.current.close() } catch { /* ignore */ }
      wsRef.current = null
    }
    setLastPhoneFix(null)
    setPhoneConnected(false)
    setPairingError(null)
    setSessionId(sid)
    setPhoneUrl(null)
    resolvePhoneUrl(sid).then(setPhoneUrl)

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${window.location.host}/api/ws/phone-gps/${encodeURIComponent(sid)}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => setPairingActive(true)
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'phone_gps_fix' && msg.data) {
          setPhoneConnected(true)
          setLastPhoneFix(msg.data)
        }
      } catch {
        // ignore malformed frames
      }
    }
    ws.onerror = () => {
      setPairingError('WebSocket error — is the backend running?')
    }
    ws.onclose = () => {
      setPairingActive(false)
      if (wsRef.current === ws) wsRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        try { wsRef.current.close() } catch { /* ignore */ }
        wsRef.current = null
      }
    }
  }, [])

  return { sessionId, pairingActive, phoneConnected, lastPhoneFix, pairingError, phoneUrl, start, stop }
}
