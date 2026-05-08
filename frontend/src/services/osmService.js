/**
 * OSM Traffic Sign Data Service
 * Fetches traffic signs from OpenStreetMap via Overpass API
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// Traffic sign types to fetch
const TRAFFIC_SIGN_TYPES = {
  STOP: {
    query: 'node["highway"="stop"]; node["traffic_sign"="stop"];',
    type: 'stop_sign',
    label: 'Stop Sign',
  },
  YIELD: {
    query: 'node["highway"="give_way"]; node["traffic_sign"="yield"];',
    type: 'yield_sign',
    label: 'Yield Sign',
  },
  TRAFFIC_LIGHT: {
    query: 'node["highway"="traffic_signals"];',
    type: 'traffic_light',
    label: 'Traffic Light',
  },
  SPEED_LIMIT: {
    query: 'node["traffic_sign"="maxspeed"];',
    type: 'speed_limit',
    label: 'Speed Limit',
  },
}

// Cache for storing fetched signs
const signsCache = {
  data: [],
  timestamp: 0,
  location: null,
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
  CACHE_RADIUS: 10000, // 10km - reuse cache if within this radius
}

/**
 * Check if a location is within the cached area
 */
function isWithinCachedArea(lat, lng) {
  if (!signsCache.location) return false

  const R = 6371000
  const dLat = (lat - signsCache.location.lat) * Math.PI / 180
  const dLng = (lng - signsCache.location.lng) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(signsCache.location.lat * Math.PI / 180) *
    Math.cos(lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return distance < signsCache.CACHE_RADIUS
}

/**
 * Check if cache is still valid
 */
function isCacheValid() {
  return Date.now() - signsCache.timestamp < signsCache.CACHE_DURATION
}

/**
 * Parse Overpass API response into standardized format
 */
function parseOverpassResponse(data, signType) {
  if (!data || !data.elements) return []

  return data.elements.map((element) => ({
    id: `node_${element.id}`,
    lat: element.lat,
    lng: element.lon,
    type: signType.type,
    label: signType.label,
    tags: element.tags || {},
  }))
}

/**
 * Fetch traffic signs from Overpass API for a specific area
 * @param {number} lat - Center latitude
 * @param {number} lng - Center longitude
 * @param {number} radius - Search radius in meters (default: 2000)
 * @returns {Promise<Array>} Array of traffic signs
 */
export async function fetchTrafficSigns(lat, lng, radius = 5000) {
  // Check cache first
  if (isCacheValid() && isWithinCachedArea(lat, lng)) {
    console.log('[OSM] Using cached signs')
    return signsCache.data
  }

  // Calculate bounding box
  const latDelta = (radius / 111320) * (180 / Math.PI)
  const lngDelta = (radius / 111320) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180)

  const bbox = {
    south: lat - latDelta,
    west: lng - lngDelta,
    north: lat + latDelta,
    east: lng + lngDelta,
  }

  // Build Overpass query for all sign types
  const queries = Object.values(TRAFFIC_SIGN_TYPES)
    .map((signType) => {
      // Replace the semicolon-separated queries with bbox-filtered versions
      const parts = signType.query.split(';').filter(q => q.trim())
      return parts.map(q => {
        // Convert node[...] to node(lat,lng,right,bottom)[...]
        const match = q.match(/node\[(.*?)\]/)
        if (match) {
          return `node(${bbox.south},${bbox.west},${bbox.north},${bbox.east})[${match[1]}]`
        }
        return q
      }).join(';')
    })
    .join(';')

  const fullQuery = `[out:json];(${queries});out body;`

  try {
    console.log('[OSM] Fetching traffic signs from Overpass API...')
    const response = await fetch(`${OVERPASS_URL}?data=${encodeURIComponent(fullQuery)}`)

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`)
    }

    const data = await response.json()
    const allSigns = []

    // Parse results for each sign type
    Object.entries(TRAFFIC_SIGN_TYPES).forEach(([key, signType]) => {
      const signs = parseOverpassResponse(data, signType)
      allSigns.push(...signs)
    })

    // Update cache
    signsCache.data = allSigns
    signsCache.timestamp = Date.now()
    signsCache.location = { lat, lng }

    console.log(`[OSM] Fetched ${allSigns.length} traffic signs`)
    return allSigns
  } catch (error) {
    console.error('[OSM] Failed to fetch traffic signs:', error)

    // Return cached data if available, even if expired
    if (signsCache.data.length > 0) {
      console.log('[OSM] Returning stale cached data')
      return signsCache.data
    }

    return []
  }
}

/**
 * Get cached signs without fetching new data
 */
export function getCachedSigns() {
  return signsCache.data
}

/**
 * Clear the signs cache
 */
export function clearCache() {
  signsCache.data = []
  signsCache.timestamp = 0
  signsCache.location = null
}

/**
 * Pre-fetch signs for a route (useful for navigation)
 * @param {Array<{lat: number, lng: number}>} waypoints - Route waypoints
 * @param {number} radius - Search radius around each waypoint
 */
export async function prefetchRouteSigns(waypoints, radius = 3000) {
  const allSigns = new Map()

  for (const waypoint of waypoints) {
    const signs = await fetchTrafficSigns(waypoint.lat, waypoint.lng, radius)
    signs.forEach((sign) => {
      allSigns.set(sign.id, sign)
    })
  }

  return Array.from(allSigns.values())
}

// ─────────────── Speed-limit lookup (per-road) ───────────────
//
// Pipeline: GPS coordinate → Overpass "nearest highway way around 30m" →
//   1. read way's `maxspeed` tag if present
//   2. else infer from `highway` class using India defaults below
//
// Why these defaults (India): the maxspeed tag is sparsely populated on
// Indian OSM roads, but the highway class is reliable. Values are aligned
// with the Motor Vehicles (Driving) Regulations 2017 ranges for cars/LMVs:
// urban roads default 50, expressways 100, NH 80, residential/service slow.
const INDIA_DEFAULT_LIMIT_BY_HIGHWAY = {
  motorway: 100,
  motorway_link: 80,
  trunk: 80,             // national highway
  trunk_link: 60,
  primary: 70,           // state highway
  primary_link: 50,
  secondary: 60,         // major district road
  secondary_link: 50,
  tertiary: 50,
  tertiary_link: 40,
  unclassified: 40,
  residential: 40,
  living_street: 30,
  service: 20,
  road: 50,              // unmapped/unknown class — sane mid value
}

// Cache the most recent speed-limit lookup per roadId so we don't re-query
// while the driver stays on the same road segment. The "override stays
// until road ends or new road starts" rule is implemented at the caller
// using the roadId we return here.
const speedLimitCache = {
  byRoadId: new Map(),     // roadId -> { limit, source, roadName, roadType, ts }
  lastQuery: { lat: null, lng: null, ts: 0 },
  TTL_MS: 10 * 60 * 1000,  // 10 min — road tags don't change minute-to-minute
}

function parseMaxspeedTag(tag) {
  if (!tag) return null
  const s = String(tag).trim().toLowerCase()
  if (s === 'none' || s === 'signals' || s === 'walk') return null
  // "60", "60 mph", "60 km/h", "IN:urban" — pull the first number
  const m = s.match(/(\d+)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (s.includes('mph')) return Math.round(n * 1.60934)
  return n
}

/**
 * Look up the posted/inferred speed limit for the road nearest to (lat, lng).
 * Returns { limit, source, roadName, roadType, roadId } or null if Overpass
 * returns nothing usable. `source` is one of:
 *   - 'osm-tag'           — actual maxspeed tag on the way
 *   - 'osm-class-default' — inferred from highway class (India defaults)
 */
export async function fetchSpeedLimitForLocation(lat, lng) {
  // Overpass `around:50` — pull every highway way within 50m and we pick the
  // closest in JS. 50m gives us a buffer for noisy GPS fixes; the JS-side
  // closest-point check still anchors to the right road. We do NOT use
  // `out ... 1;` — that would limit Overpass to one arbitrary way, not the
  // closest one.
  const query =
    `[out:json][timeout:10];` +
    `way(around:50,${lat},${lng})[highway];` +
    `out tags geom;`

  try {
    console.log('[OSM speed] querying for', lat.toFixed(5), lng.toFixed(5))
    const resp = await fetch(`${OVERPASS_URL}?data=${encodeURIComponent(query)}`)
    if (!resp.ok) throw new Error(`Overpass ${resp.status}`)
    const data = await resp.json()
    const ways = (data && data.elements) || []
    console.log('[OSM speed] candidate ways:', ways.length)
    if (ways.length === 0) return null

    // Pick the closest way: minimum distance from (lat,lng) to any of the
    // way's geometry points. Overpass returns `geometry` as an array of
    // {lat, lon} when we ask `out geom`.
    let best = null
    let bestDist = Infinity
    for (const w of ways) {
      const geom = w.geometry || []
      for (const pt of geom) {
        const dLat = (pt.lat - lat) * 111320
        const dLng = (pt.lon - lng) * 111320 * Math.cos(lat * Math.PI / 180)
        const d = Math.hypot(dLat, dLng)
        if (d < bestDist) {
          bestDist = d
          best = w
        }
      }
    }
    if (!best) return null

    const tags = best.tags || {}
    const roadType = tags.highway || 'road'
    const roadName = tags.name || tags.ref || roadType
    const roadId = `way_${best.id}`

    let limit = parseMaxspeedTag(tags.maxspeed)
    let source = 'osm-tag'
    if (limit == null) {
      limit = INDIA_DEFAULT_LIMIT_BY_HIGHWAY[roadType] ?? INDIA_DEFAULT_LIMIT_BY_HIGHWAY.road
      source = 'osm-class-default'
    }

    const result = { limit, source, roadName, roadType, roadId }
    speedLimitCache.byRoadId.set(roadId, { ...result, ts: Date.now() })
    speedLimitCache.lastQuery = { lat, lng, ts: Date.now() }
    console.log('[OSM speed]', limit, 'km/h on', roadName, `(${roadType}, ${source})`)
    return result
  } catch (err) {
    console.warn('[OSM] speed-limit lookup failed:', err)
    return null
  }
}

export function getCachedSpeedLimit(roadId) {
  const hit = speedLimitCache.byRoadId.get(roadId)
  if (!hit) return null
  if (Date.now() - hit.ts > speedLimitCache.TTL_MS) {
    speedLimitCache.byRoadId.delete(roadId)
    return null
  }
  return hit
}

export default {
  fetchTrafficSigns,
  getCachedSigns,
  clearCache,
  prefetchRouteSigns,
  fetchSpeedLimitForLocation,
  getCachedSpeedLimit,
}
