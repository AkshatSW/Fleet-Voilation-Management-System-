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

export default {
  fetchTrafficSigns,
  getCachedSigns,
  clearCache,
  prefetchRouteSigns,
}
