import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

/**
 * Companion page opened on the phone after scanning the QR code from the
 * Driver Camera dashboard. Reads navigator.geolocation (real GPS chip on
 * mobile) and POSTs each fix to /api/phone-gps/{sessionId}; the backend
 * fans those out over WebSocket to whatever laptop is subscribed.
 *
 * Public route — no auth, sessionId is the pairing secret.
 */
export default function PhoneGPSBridge() {
  const { sessionId } = useParams()
  const [status, setStatus] = useState('Requesting GPS permission…')
  const [lastFix, setLastFix] = useState(null)
  const [sentCount, setSentCount] = useState(0)
  const [errMsg, setErrMsg] = useState(null)
  const inflightRef = useRef(false)

  useEffect(() => {
    if (!sessionId) {
      setErrMsg('Missing session id in URL')
      return
    }
    if (!('geolocation' in navigator)) {
      setErrMsg('This browser does not support geolocation')
      return
    }

    const send = async (fix) => {
      // Skip if we're still sending the previous one — phone GPS can fire
      // 1Hz and slow networks would queue forever.
      if (inflightRef.current) return
      inflightRef.current = true
      try {
        const res = await fetch(`/api/phone-gps/${encodeURIComponent(sessionId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fix),
        })
        if (!res.ok) {
          setErrMsg(`Server rejected fix (HTTP ${res.status})`)
          return
        }
        setErrMsg(null)
        setSentCount((c) => c + 1)
      } catch (e) {
        setErrMsg(`Network error: ${e?.message || e}`)
      } finally {
        inflightRef.current = false
      }
    }

    const onSuccess = (pos) => {
      const fix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
      }
      setLastFix(fix)
      setStatus('Streaming GPS to laptop…')
      send(fix)
    }
    const onError = (err) => {
      const PERMISSION_DENIED = 1
      const msg = err.code === PERMISSION_DENIED
        ? 'Location permission denied. Enable it in your phone settings.'
        : `GPS error: ${err.message || err.code}`
      setErrMsg(msg)
    }

    const watchId = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    })
    return () => navigator.geolocation.clearWatch(watchId)
  }, [sessionId])

  const cardStyle = {
    padding: 16,
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    marginTop: 12,
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', padding: 16 }}>
      <div style={{ maxWidth: 480, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
        <h2 style={{ margin: '8px 0' }}>Phone GPS → Laptop</h2>
        <div style={{ fontSize: 12, color: '#888', wordBreak: 'break-all' }}>
          Session: <code>{sessionId}</code>
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 600 }}>{status}</div>
          {errMsg && (
            <div style={{ color: '#cf1322', marginTop: 8, fontSize: 13 }}>{errMsg}</div>
          )}
          {lastFix && (
            <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.5 }}>
              <div><strong>Lat:</strong> {lastFix.lat.toFixed(6)}</div>
              <div><strong>Lng:</strong> {lastFix.lng.toFixed(6)}</div>
              {lastFix.accuracy != null && (
                <div><strong>Accuracy:</strong> ±{Math.round(lastFix.accuracy)} m</div>
              )}
              {lastFix.speed != null && lastFix.speed >= 0 && (
                <div><strong>Speed:</strong> {(lastFix.speed * 3.6).toFixed(1)} km/h</div>
              )}
              <div style={{ marginTop: 8, color: '#52c41a' }}>
                Fixes sent: {sentCount}
              </div>
            </div>
          )}
        </div>

        <p style={{ fontSize: 12, color: '#666', marginTop: 16 }}>
          Keep this page open in the foreground. Locking the screen or
          switching apps may pause GPS on some phones. Close this tab when
          you're done — the laptop will revert to its own location.
        </p>
      </div>
    </div>
  )
}
