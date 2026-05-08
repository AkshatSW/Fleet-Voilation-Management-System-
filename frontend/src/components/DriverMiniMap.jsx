import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'

const TRAIL_MAX_POINTS = 80   // ~2-3 minutes of fixes at 1Hz

// Tile provider. OSM's standard tiles are fine for development; the OSM
// Foundation's tile-usage policy discourages heavy production traffic, so
// for a deployed app you'd swap this for Carto, Stadia, or MapTiler tiles
// (those have free tiers but require an account or API key).
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// Custom DivIcon that rotates with heading. Using a DivIcon (HTML overlay)
// lets us spin the arrow via a CSS transform — the built-in Leaflet marker
// icons can't be rotated without a plugin.
function makeArrowIcon(heading, overLimit) {
  const color = overLimit ? '#cf1322' : '#1677ff'
  const html = `
    <div style="width:28px;height:28px;transform:rotate(${heading || 0}deg);transform-origin:center;">
      <svg viewBox="0 0 24 24" width="28" height="28">
        <circle cx="12" cy="12" r="11" fill="#fff" stroke="${color}" stroke-width="2" />
        <path d="M12 4 L17 18 L12 15 L7 18 Z" fill="${color}" />
      </svg>
    </div>
  `
  return L.divIcon({
    html,
    className: 'driver-mini-arrow',  // strip default leaflet styles
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

// Auto-pan + size sanity. Two responsibilities:
//   - On every fix update, recenter if the marker drifts beyond 25% of the
//     viewport from the map center (avoids yanking the view every tick).
//   - On first mount, call `invalidateSize()` after the parent layout has
//     settled. Leaflet measures its container size at mount time; if the
//     surrounding Card body grew after that (which it does here while the
//     speed-limit panel populates), the tile grid stays sized to the old
//     dimensions and the map looks blank/cropped until the user pans.
function FollowDriver({ lat, lng }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    // Run once shortly after mount, then again after a beat in case the
    // parent layout shifted twice (e.g., after speed limit data loads).
    const t1 = setTimeout(() => map.invalidateSize(), 100)
    const t2 = setTimeout(() => map.invalidateSize(), 600)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [map])

  useEffect(() => {
    if (!map || lat == null || lng == null) return
    const center = map.getCenter()
    if (!center) {
      map.setView([lat, lng], map.getZoom())
      return
    }
    const bounds = map.getBounds()
    const ne = bounds.getNorthEast()
    const sw = bounds.getSouthWest()
    const latSpan = Math.abs(ne.lat - sw.lat)
    const lngSpan = Math.abs(ne.lng - sw.lng)
    const dLat = Math.abs(lat - center.lat)
    const dLng = Math.abs(lng - center.lng)
    if (dLat > latSpan * 0.25 || dLng > lngSpan * 0.25) {
      map.panTo([lat, lng])
    }
  }, [map, lat, lng])
  return null
}

/**
 * Live driver mini-map (Uber/Ola style):
 *   - OSM tiles, no API key required
 *   - Driver marker rotated by heading
 *   - Trailing polyline of recent positions
 *   - Speed + speed-limit overlay pills in the corner
 */
export default function DriverMiniMap({
  lat, lng, heading = 0, speed = null,
  speedLimit = null, overLimit = false, height = 240,
}) {
  const [trail, setTrail] = useState([])

  // Append every new fix to the trail, capped at TRAIL_MAX_POINTS. We only
  // store fixes that moved more than ~5m from the last one so the trail
  // doesn't bunch up while parked.
  useEffect(() => {
    if (lat == null || lng == null) return
    setTrail((prev) => {
      const last = prev[prev.length - 1]
      if (last) {
        const dLat = (lat - last.lat) * 111320
        const dLng = (lng - last.lng) * 111320 * Math.cos(lat * Math.PI / 180)
        if (Math.hypot(dLat, dLng) < 5) return prev
      }
      const next = [...prev, { lat, lng, t: Date.now() }]
      if (next.length > TRAIL_MAX_POINTS) next.shift()
      return next
    })
  }, [lat, lng])

  const arrowIcon = useMemo(() => makeArrowIcon(heading, overLimit), [heading, overLimit])
  const trailPositions = useMemo(() => trail.map((p) => [p.lat, p.lng]), [trail])

  if (lat == null || lng == null) {
    return (
      <div
        style={{
          height, borderRadius: 8, background: '#f0f2f5',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, color: '#888',
        }}
      >
        Waiting for GPS fix…
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', height, borderRadius: 8, overflow: 'hidden' }}>
      <MapContainer
        center={[lat, lng]}
        zoom={16}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
        attributionControl={true}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        {trailPositions.length > 1 && (
          <Polyline positions={trailPositions} pathOptions={{ color: '#1677ff', weight: 4, opacity: 0.9 }} />
        )}
        <Marker position={[lat, lng]} icon={arrowIcon} />
        <FollowDriver lat={lat} lng={lng} />
      </MapContainer>

      {/* Speed + limit pills, Uber-style — bottom-left overlay so they don't
          obscure the marker which is centered. pointer-events:none so they
          don't block map drag. */}
      <div
        style={{
          position: 'absolute', left: 8, bottom: 8, display: 'flex',
          gap: 6, pointerEvents: 'none', zIndex: 1000,
        }}
      >
        {speed != null && (
          <div
            style={{
              background: overLimit ? '#cf1322' : 'rgba(0,0,0,0.75)',
              color: '#fff', borderRadius: 16, padding: '4px 10px',
              fontSize: 12, fontWeight: 600,
            }}
          >
            {Math.round(speed)} km/h
          </div>
        )}
        {speedLimit != null && (
          <div
            style={{
              background: '#fff', color: '#cf1322', borderRadius: '50%',
              width: 32, height: 32, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 11, fontWeight: 700,
              border: '3px solid #cf1322',
            }}
            title="Speed limit"
          >
            {speedLimit}
          </div>
        )}
      </div>
    </div>
  )
}
