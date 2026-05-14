import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Card, Row, Col, Typography, Select, Button, Tag, List, Badge, Space,
  Alert, Switch, message, Statistic, Progress, Modal, Input,
} from 'antd'
import {
  PlayCircleOutlined, PauseCircleOutlined, WarningOutlined,
  DashboardOutlined, ThunderboltOutlined, SafetyOutlined,
  MobileOutlined,
} from '@ant-design/icons'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { driverService, vehicleService, uploadService, cameraService, authService, detectionService } from '@/services'
import { useAuth } from '@/context/AuthContext'
import { EVENT_TYPES, SEVERITY_COLORS, ROLES, DEMO_WEBCAM_KEY } from '@/constants'
import useMediaRecorderBuffer from '@/hooks/useMediaRecorderBuffer'
import useViolationAlerts from '@/hooks/useViolationAlerts'
import useWebRTCPublisher from '@/hooks/useWebRTCPublisher'
import useStopSignLocal from '@/hooks/useStopSignLocal'
import useStopSignFusion from '@/hooks/useStopSignFusion'
import usePhoneGPSPairing from '@/hooks/usePhoneGPSPairing'
import osmService from '@/services/osmService'
import { getDistance } from '@/utils/geo'
import { subscribeStopSignSimulation } from '@/services/stopSignSimulationBus'
import DriverMiniMap from '@/components/DriverMiniMap'
import dayjs from 'dayjs'

const { Title, Text } = Typography

// Drowsiness/yawning: MediaPipe eyeBlink* and jawOpen blendshapes
// (0 = open/closed, 1 = fully closed/wide open).
// Window: last N frames kept; fire if HITS_NEEDED of them exceed threshold.
// Majority-vote (not all-N-consecutive) tolerates single-frame MediaPipe
// noise which was causing "almost fired" yawns to reset forever.
const EAR_THRESHOLD = 0.40
const EAR_WINDOW = 10
const EAR_HITS_NEEDED = 7        // 7 of last 10 = ~70% closed
// Normal speech jawOpen ~0.10-0.25; yawn peaks 0.5-0.9. Threshold 0.28
// catches the onset of a yawn; window 10 frames ≈ 300-700ms depending on
// MediaPipe throughput (slower on CPU with YOLO running alongside).
const MAR_THRESHOLD = 0.28
const MAR_WINDOW = 10
const MAR_HITS_NEEDED = 6        // 6 of last 10 = ~60% open
const VIOLATION_COOLDOWN = 10000
const FACE_NOT_VISIBLE_CONSEC = 45

// 3-point seatbelt detection — backend two-stage pipeline:
//   1. YOLOv5 (custom, 'seatbelt' class) finds the candidate region
//   2. Keras MobileNetV2 classifies it as Worn / Not Worn
// Frontend posts a JPEG every SEATBELT_INTERVAL_MS; the result includes a
// bbox we draw on the canvas plus a worn/not-worn verdict.
const SEATBELT_INTERVAL_MS = 2500             // detection cadence
const SEATBELT_WINDOW = 8                     // last N decisions
const SEATBELT_HITS_NEEDED_NO_STRAP = 6       // 6 of 8 = sustained absence (~15s)
const SEATBELT_GRACE_MS = 30000               // 30s dwell — gives time to position
                                              // the camera and test, no spurious alerts
const SEATBELT_VIOLATION_INTERVAL_MS = 5 * 60 * 1000  // 5min cooldown between CV violations
const SEATBELT_JPEG_QUALITY = 0.8
const SEATBELT_FRAME_WIDTH = 720

// Per-violation clip duration in seconds. Each violation captures a fresh
// recording of this length starting from the event moment. Longer clips for
// sustained behaviors (drowsiness, phone use); shorter for brief events
// (harsh braking). Any eventType not listed here falls back to DEFAULT.
const CLIP_SECONDS_BY_TYPE = {
  drowsiness: 8,            // sustained closed eyes — need to show duration
  phone_usage: 8,           // sustained behavior
  stop_sign_violation: 8,   // show vehicle NOT stopping past the sign
  overspeed: 6,             // show sustained speeding
  distracted: 6,            // face missing — need context
  stop_sign_detected: 6,    // show sign + driver response
  yawning: 5,               // typical yawn is 3-5s
  no_seatbelt: 5,           // static visual check
  harsh_braking: 4,         // instantaneous event
  sudden_acceleration: 4,   // instantaneous event
}
const CLIP_SECONDS_DEFAULT = 5

const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
const RIGHT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
const MOUTH = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]

export default function DriverCamera() {
  // Siren audio ref
  const sirenAudioRef = useRef(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [faceLandmarkerReady, setFaceLandmarkerReady] = useState(false)
  const [modelLoading, setModelLoading] = useState(false)

  const [selectedDriver, setSelectedDriver] = useState(null)
  const [selectedVehicle, setSelectedVehicle] = useState(null)
  const [drivers, setDrivers] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [cameraDbId, setCameraDbId] = useState(null)

  const { user } = useAuth()
  const isDriverRole = user?.role === ROLES.DRIVER

  const [metrics, setMetrics] = useState({ ear: null, mar: null })
  const [alerts, setAlerts] = useState({ drowsy: false, yawning: false })
  const [violationLog, setViolationLog] = useState([])
  const [detectionEnabled, setDetectionEnabled] = useState(true)
  const [violationCount, setViolationCount] = useState(0)

  // Seatbelt detection — backend YOLOv5 + Keras pipeline.
  // State that re-renders on update (status tag) + refs that don't (bbox draw,
  // history, in-flight guard).
  const [seatbeltDetected, setSeatbeltDetected] = useState(false)
  const [seatbeltRatio, setSeatbeltRatio] = useState(null)   // last classifier confidence, shown in UI
  const seatbeltHistoryRef = useRef([])
  const seatbeltCanvasRef = useRef(null)     // offscreen canvas for frame capture
  const seatbeltStartTimeRef = useRef(0)
  const lastSeatbeltViolationRef = useRef(0)
  const seatbeltIntervalRef = useRef(null)   // polling timer
  const seatbeltInFlightRef = useRef(false)  // in-flight guard
  const seatbeltBboxRef = useRef(null)       // { bbox, worn, label } for canvas draw
  // sendViolation is defined further down; seatbelt detector calls it via ref
  // to avoid a hook-order cycle.
  const sendViolationRef = useRef(null)

  // Stop sign detection state
  const [trafficSigns, setTrafficSigns] = useState([])
  const [stopSignAlerts, setStopSignAlerts] = useState([])
  const [gpsEnabled, setGpsEnabled] = useState(false)
  const [cameraStopSignEnabled, setCameraStopSignEnabled] = useState(true)
  const [currentLocation, setCurrentLocation] = useState(null)
  const [currentHeading, setCurrentHeading] = useState(0)
  // Manual location override. Desktop browser geolocation falls back to
  // Wi-Fi/IP positioning which can be off by tens of km, so the user can
  // paste real coordinates and we'll use those for everything downstream
  // (map, speed-limit lookup, OSM sign lookup). When set, this takes
  // priority over GPS until cleared.
  const [manualLocation, setManualLocation] = useState(null)
  const [manualLocationInput, setManualLocationInput] = useState('')

  // Simulated sensors
  const [speed, setSpeed] = useState(60)
  const [isBraking, setIsBraking] = useState(false)
  const [isAccelerating, setIsAccelerating] = useState(false)

  // Speed-limit context for the current road segment.
  //   - default*: from OSM (posted maxspeed tag, or India road-class default)
  //   - signOverride: a higher-priority value from camera-detected speed-limit
  //     signs cross-checked with OSM. Cleared whenever roadId changes (i.e.
  //     "override stays until road ends or new road starts").
  // The effective limit is signOverride ?? default.
  const [speedLimitInfo, setSpeedLimitInfo] = useState({
    defaultLimit: null,
    source: null,           // 'osm-tag' | 'osm-class-default'
    roadName: null,
    roadType: null,
    roadId: null,
    signOverride: null,     // verified posted limit, when both sign+map agree
  })
  const speedLimitInfoRef = useRef(speedLimitInfo)
  const lastLimitFetchRef = useRef({ lat: null, lng: null, ts: 0 })

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const roadVideoRef = useRef(null)
  const roadCanvasRef = useRef(null)
  const stopSignVideoRef = useRef(null)
  const streamRef = useRef(null)
  const roadStreamRef = useRef(null)
  const animationRef = useRef(null)
  const faceLandmarkerRef = useRef(null)
  const lastViolationTimeRef = useRef({})
  const earHistoryRef = useRef([])
  const marHistoryRef = useRef([])
  const alertsRef = useRef({ drowsy: false, yawning: false })
  const detectionEnabledRef = useRef(true)
  const selectedDriverRef = useRef(null)
  const selectedVehicleRef = useRef(null)
  const speedRef = useRef(60)
  const sensorIntervalRef = useRef(null)
  const heartbeatIntervalRef = useRef(null)
  const faceNotVisibleFramesRef = useRef(0)
  const cameraActiveRef = useRef(false)

  const { triggerAlert, isAlerting, triggerVoiceAlert } = useViolationAlerts()
  const mediaBuffer = useMediaRecorderBuffer()
  const { publish, unpublish, isPublishing, peerCount } = useWebRTCPublisher(cameraDbId)

  // Stop sign refs (locationRef must exist for fusion getLocation — was missing and broke camera alerts)
  const locationRef = useRef(null)
  const headingRef = useRef(0)
  const gpsIntervalRef = useRef(null)
  const stopSignBboxRef = useRef(null)
  const lastTrafficSignsFetchRef = useRef({ lat: null, lng: null, timestamp: 0 })

  useEffect(() => { detectionEnabledRef.current = detectionEnabled }, [detectionEnabled])
  useEffect(() => { selectedDriverRef.current = selectedDriver }, [selectedDriver])
  useEffect(() => { selectedVehicleRef.current = selectedVehicle }, [selectedVehicle])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { cameraActiveRef.current = cameraActive }, [cameraActive])
  useEffect(() => { speedLimitInfoRef.current = speedLimitInfo }, [speedLimitInfo])

  // Look up the speed limit for the road nearest to (lat, lng).
  // Throttled: only refetch if the driver moved >50m or 30s elapsed —
  // Overpass is shared infrastructure and shouldn't be hit per-tick.
  // When the resolved roadId changes we drop any sign-verified override
  // (per spec: override stays until road ends / new road starts).
  const refreshSpeedLimit = useCallback(async (lat, lng) => {
    const last = lastLimitFetchRef.current
    if (last.lat != null) {
      const dLat = (lat - last.lat) * 111320
      const dLng = (lng - last.lng) * 111320 * Math.cos(lat * Math.PI / 180)
      const moved = Math.hypot(dLat, dLng)
      const aged = Date.now() - last.ts
      if (moved < 50 && aged < 30000) return
    }
    lastLimitFetchRef.current = { lat, lng, ts: Date.now() }

    const info = await osmService.fetchSpeedLimitForLocation(lat, lng)
    if (!info) return

    setSpeedLimitInfo((prev) => {
      const roadChanged = prev.roadId !== info.roadId
      return {
        defaultLimit: info.limit,
        source: info.source,
        roadName: info.roadName,
        roadType: info.roadType,
        roadId: info.roadId,
        // Drop the sign override on road change; otherwise keep whatever
        // was previously verified so the override survives a re-query on
        // the same road.
        signOverride: roadChanged ? null : prev.signOverride,
      }
    })
  }, [])

  // manualLocation overrides GPS for the map, fusion engine, OSM lookups,
  // and speed-limit refresh. When cleared, falls back to live GPS.
  const effectiveLocation = manualLocation ?? currentLocation

  useEffect(() => {
    if (!effectiveLocation) return
    locationRef.current = effectiveLocation
    refreshSpeedLimit(effectiveLocation.lat, effectiveLocation.lng)
  }, [effectiveLocation, refreshSpeedLimit])

  const handleApplyManualLocation = useCallback(() => {
    const m = manualLocationInput.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (!m) {
      message.error('Format: latitude, longitude (e.g. 25.2048, 55.2708)')
      return
    }
    const lat = parseFloat(m[1])
    const lng = parseFloat(m[2])
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      message.error('Coordinates out of range')
      return
    }
    setManualLocation({ lat, lng, accuracy: 0 })
    message.success(`Location set to ${lat}, ${lng}`)
  }, [manualLocationInput])

  const handleClearManualLocation = useCallback(() => {
    setManualLocation(null)
    setManualLocationInput('')
  }, [])

  // Phone-as-GPS pairing. When a phone is paired and streams fixes, every
  // new fix flows into manualLocation so the map / fusion / speed-limit
  // pipeline all use the phone's GPS chip instead of the laptop's stale
  // Wi-Fi positioning.
  const phoneGPS = usePhoneGPSPairing()
  const [pairModalOpen, setPairModalOpen] = useState(false)

  useEffect(() => {
    if (!phoneGPS.lastPhoneFix) return
    setManualLocation({
      lat: phoneGPS.lastPhoneFix.lat,
      lng: phoneGPS.lastPhoneFix.lng,
      accuracy: phoneGPS.lastPhoneFix.accuracy ?? 0,
    })
    if (phoneGPS.lastPhoneFix.heading != null) {
      headingRef.current = phoneGPS.lastPhoneFix.heading
      setCurrentHeading(phoneGPS.lastPhoneFix.heading)
    }
  }, [phoneGPS.lastPhoneFix])

  const handleStartPairing = useCallback(() => {
    phoneGPS.start()
    setPairModalOpen(true)
  }, [phoneGPS])

  const handleStopPairing = useCallback(() => {
    phoneGPS.stop()
    setPairModalOpen(false)
  }, [phoneGPS])

  useEffect(() => {
    // For DRIVER role, fetch their linked driver profile and auto-select
    if (isDriverRole) {
      authService.getMyDriver().then((res) => {
        setSelectedDriver(res.data.id)
        setDrivers([res.data])
      }).catch(console.error)
    } else {
      driverService.getList().then((res) => setDrivers(res.data)).catch(console.error)
    }
    vehicleService.getList().then((res) => setVehicles(res.data)).catch(console.error)
    cameraService.getList().then((res) => {
      const webcam = res.data.find((c) => c.camera_type === 'webcam')
      if (webcam) setCameraDbId(String(webcam.id))
    }).catch(console.error)
  }, [])

  // Sensor simulation
  useEffect(() => {
    if (!cameraActive) return
    sensorIntervalRef.current = setInterval(() => {
      setSpeed((prev) => {
        const delta = (Math.random() - 0.5) * 10
        return Math.max(0, Math.min(180, Math.round(prev + delta)))
      })

      // Random harsh braking ~every 60 seconds (1/30 chance per 2s interval)
      if (Math.random() < 1 / 30) {
        setIsBraking(true)
        setSpeed((prev) => Math.max(0, prev - 40))
        setTimeout(() => setIsBraking(false), 3000)
        sendViolation('harsh_braking', 'medium', Math.max(0, speedRef.current - 40))
      }

      // Random sudden acceleration ~every 90 seconds
      if (Math.random() < 1 / 45) {
        setIsAccelerating(true)
        setSpeed((prev) => Math.min(180, prev + 35))
        setTimeout(() => setIsAccelerating(false), 3000)
        sendViolation('sudden_acceleration', 'medium', Math.min(180, speedRef.current + 35))
      }

      // Overspeed check
      if (speedRef.current > 120) {
        sendViolation('overspeed', 'high', speedRef.current)
      }
    }, 2000)

    return () => clearInterval(sensorIntervalRef.current)
  }, [cameraActive])

  const initFaceLandmarker = useCallback(async () => {
    if (faceLandmarkerRef.current) return
    setModelLoading(true)
    try {
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      )
      const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        outputFaceBlendshapes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      })
      faceLandmarkerRef.current = landmarker
      setFaceLandmarkerReady(true)
    } catch (err) {
      message.error('Failed to load face detection model')
    } finally {
      setModelLoading(false)
    }
  }, [])

  // Handle stop sign violation — captures snapshot + clip like every other
  // violation type, so the reviewer has visual evidence attached.
  const handleStopSignViolation = useCallback(async (violationType, data) => {
    console.log('[StopSign] Violation triggered:', violationType, data)

    const eventType = violationType === 'STOP_SIGN_VIOLATION' ? 'stop_sign_violation' : 'stop_sign_detected'

    // Trigger voice alert for stop signs
    const voiceMessage = data.signLabel === 'Stop Sign'
      ? 'Stop sign ahead. Prepare to stop.'
      : data.signLabel === 'Traffic Light'
        ? 'Traffic light ahead.'
        : 'Traffic sign ahead.'
    triggerVoiceAlert(voiceMessage, 'high')

    if (sirenAudioRef.current) {
      sirenAudioRef.current.currentTime = 0
      sirenAudioRef.current.play().catch((e) => console.warn('Siren audio play failed:', e))
    }

    const now = Date.now()
    const lastTime = lastViolationTimeRef.current[eventType] || 0
    if (now - lastTime < VIOLATION_COOLDOWN) return

    const driverId = selectedDriverRef.current
    const vehicleId = selectedVehicleRef.current
    if (!driverId || !vehicleId) return

    lastViolationTimeRef.current[eventType] = now

    // Fire all three async tasks in parallel — violation hits the UI in ~50ms.
    const clipSeconds = CLIP_SECONDS_BY_TYPE[eventType] ?? CLIP_SECONDS_DEFAULT
    const clipPromise = mediaBuffer.captureClip(clipSeconds)
    const snapshotPromise = (async () => {
      try {
        const blob = await mediaBuffer.captureSnapshot(videoRef.current)
        if (!blob) return null
        const r = await uploadService.uploadSnapshot(blob, DEMO_WEBCAM_KEY)
        return r.url
      } catch (err) {
        console.error('[StopSign] snapshot failed:', err)
        return null
      }
    })()

    let violationId = null
    try {
      const response = await fetch('/api/webhook/violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': DEMO_WEBCAM_KEY },
        body: JSON.stringify({
          driver_id: driverId,
          vehicle_id: vehicleId,
          event_type: eventType,
          severity: 'high',
          timestamp: new Date().toISOString(),
          speed: data.speed,
          latitude: data.latitude,
          longitude: data.longitude,
          snapshot_url: null,
          clip_url: null,
        }),
      })
      if (!response.ok) throw new Error(`webhook ${response.status}`)
      const result = await response.json()
      violationId = result.id
      setViolationLog((prev) => [{
        id: violationId,
        event_type: eventType,
        severity: 'high',
        speed: data.speed,
        timestamp: new Date(),
        isStopSign: true,
      }, ...prev].slice(0, 50))
      setViolationCount((c) => c + 1)
    } catch (err) {
      console.error('[StopSign] violation POST failed:', err)
      return
    }

    snapshotPromise.then((url) => {
      if (!url || !violationId) return
      fetch(`/api/violations/${violationId}/snapshot`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': DEMO_WEBCAM_KEY },
        body: JSON.stringify({ snapshot_url: url }),
      }).catch((err) => console.error('[StopSign] snapshot PATCH failed:', err))
    })

    clipPromise.then(async (clipBlob) => {
      if (!clipBlob || !violationId) return
      try {
        const uploadResult = await uploadService.uploadClip(clipBlob, DEMO_WEBCAM_KEY)
        await fetch(`/api/violations/${violationId}/clip`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': DEMO_WEBCAM_KEY },
          body: JSON.stringify({ clip_url: uploadResult.url }),
        })
      } catch (err) {
        console.error('[StopSign] clip upload/patch failed:', err)
      }
    })
  }, [triggerVoiceAlert, mediaBuffer])

  const handleSimulatedStopSignSignal = useCallback((event) => {
    if (!event || event.source !== 'simulation') return

    const alert = {
      type: event.kind === 'approach' ? 'CAMERA_ONLY' : 'GPS',
      priority: event.detected ? 3 : 1,
      distance: event.distance ?? null,
      speed: event.speedKmh ?? speedRef.current,
      message: event.message || 'Simulated stop sign signal',
      timestamp: Date.now(),
      stopSign: event.stopSign,
    }

    setStopSignAlerts((prev) => [alert, ...prev].slice(0, 5))
    setViolationLog((prev) => [{
      id: event.id || `sim-${Date.now()}`,
      event_type: 'stop_sign_detected',
      severity: event.detected ? 'high' : 'medium',
      speed: event.speedKmh ?? speedRef.current,
      timestamp: new Date(),
      isStopSign: true,
      source: 'simulation',
      message: event.message || 'Simulated stop sign signal',
    }, ...prev].slice(0, 50))
    setViolationCount((count) => count + 1)

    if (event.shouldRecord && selectedDriverRef.current && selectedVehicleRef.current) {
      handleStopSignViolation('STOP_SIGN_DETECTED', {
        speed: event.speedKmh ?? speedRef.current,
        latitude: event.location?.lat ?? locationRef.current?.lat ?? null,
        longitude: event.location?.lng ?? locationRef.current?.lng ?? null,
      })
    }
  }, [handleStopSignViolation])

  // Initialize fusion engine
  const fusion = useStopSignFusion({
    getLocation: () => locationRef.current,
    getSpeed: () => speedRef.current,
    triggerViolation: handleStopSignViolation,
    trafficSigns,
  })

  useEffect(() => {
    const unsubscribe = subscribeStopSignSimulation(handleSimulatedStopSignSignal)
    return () => unsubscribe()
  }, [handleSimulatedStopSignSignal])

  // Stop sign camera detection
  const handleCameraDetection = useCallback((detection) => {
    console.log('[StopSign] Camera detection received:', detection)
    if (!cameraStopSignEnabled) {
      console.log('[StopSign] Detection ignored - cameraStopSignEnabled is false')
      return
    }
    const alert = fusion.processCameraDetection(detection)
    console.log('[StopSign] Fusion result:', alert)
    if (alert) {
      setStopSignAlerts((prev) => [alert, ...prev].slice(0, 5))
    }
  }, [fusion, cameraStopSignEnabled])

  const handleCameraLost = useCallback((detection) => {
    console.log('[StopSign] Lost detection:', detection)
  }, [])

  // In-browser YOLOv8n via ONNX Runtime Web — no server round-trip, GPU accelerated.
  // See hooks/useStopSignLocal.js.
  const {
    startDetection: startStopSignDetection,
    stopDetection: stopStopSignDetection,
    isModelReady: isStopSignModelReady,
  } = useStopSignLocal(videoRef, handleCameraDetection, handleCameraLost, stopSignBboxRef)

  // Fetch OSM traffic signs when location is available
  useEffect(() => {
    if (!gpsEnabled || !locationRef.current) return

    const fetchSigns = async () => {
      const loc = locationRef.current
      console.log('[StopSign] Fetching signs near:', loc)
      const signs = await osmService.fetchTrafficSigns(loc.lat, loc.lng, 5000)
      setTrafficSigns(signs)
      lastTrafficSignsFetchRef.current = {
        lat: loc.lat,
        lng: loc.lng,
        timestamp: Date.now(),
      }
    }

    fetchSigns()
  }, [gpsEnabled])

  // GPS tracking for stop sign alerts
  useEffect(() => {
    if (!gpsEnabled) {
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current)
        gpsIntervalRef.current = null
      }
      setCurrentLocation(null)
      return undefined
      setSpeedLimitInfo({
        defaultLimit: null, source: null, roadName: null,
        roadType: null, roadId: null, signOverride: null,
      })
      lastLimitFetchRef.current = { lat: null, lng: null, ts: 0 }
      return
    }

    if (!('geolocation' in navigator)) {
      console.warn('[StopSign] Geolocation not supported')
      setGpsEnabled(false)
      return undefined
    }

    // High-accuracy position tracking. locationRef and the speed-limit
    // refresh are driven by the effectiveLocation effect, not here, so the
    // manual-override path stays in sync without racing this callback.
    const successCallback = (position) => {
      const newLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }

      locationRef.current = newLocation
      setCurrentLocation(newLocation)

      const lastFetch = lastTrafficSignsFetchRef.current
      const hasRecentFetch = Date.now() - lastFetch.timestamp < 60000
      const movedMeters = lastFetch.lat === null || lastFetch.lng === null
        ? Infinity
        : getDistance(lastFetch.lat, lastFetch.lng, newLocation.lat, newLocation.lng)

      if (cameraActiveRef.current && (!hasRecentFetch || movedMeters >= 1000)) {
        osmService.fetchTrafficSigns(newLocation.lat, newLocation.lng, 5000)
          .then((signs) => {
            setTrafficSigns(signs)
            lastTrafficSignsFetchRef.current = {
              lat: newLocation.lat,
              lng: newLocation.lng,
              timestamp: Date.now(),
            }
          })
          .catch((error) => console.error('[StopSign] Refetch signs failed:', error))
      }

      if (position.coords.heading !== null) {
        headingRef.current = position.coords.heading
        setCurrentHeading(position.coords.heading)
      }

      if (cameraActiveRef.current && detectionEnabledRef.current) {
        const alerts = fusion.processGPS()
        if (alerts && alerts.length > 0) {
          setStopSignAlerts(alerts.slice(0, 3))
        }
      }
    }

    // Only disable GPS when the user actually revoked permission. TIMEOUT
    // and POSITION_UNAVAILABLE are routine on desktops that geolocate via
    // Wi-Fi/IP — they fire intermittently and the next fix usually
    // succeeds, so flipping the toggle off on those would tear the watcher
    // down for no good reason. (Previous behavior: any error disabled GPS,
    // which caused the toggle to flip off within seconds of being enabled.)
    const errorCallback = (error) => {
      const code = error?.code
      const PERMISSION_DENIED = 1
      const POSITION_UNAVAILABLE = 2
      const TIMEOUT = 3
      const label = code === PERMISSION_DENIED ? 'PERMISSION_DENIED'
        : code === POSITION_UNAVAILABLE ? 'POSITION_UNAVAILABLE'
        : code === TIMEOUT ? 'TIMEOUT' : 'UNKNOWN'
      console.warn(`[GPS] ${label}:`, error?.message)
      if (code === PERMISSION_DENIED) {
        message.error('Location permission denied. Enable it in your browser to use GPS features.')
        setGpsEnabled(false)
      }
      // Else: ignore — watchPosition keeps trying on its own.
    }

    // Initial fix: high-accuracy + maximumAge=0 forces the OS to re-acquire
    // instead of handing back a cached Wi-Fi/IP fix (which on laptops can be
    // a stale "last network" location, e.g. your previous office/college).
    // If the high-accuracy path times out, the manual-location override
    // gives the user a fallback (see input under the live map).
    navigator.geolocation.getCurrentPosition(successCallback, errorCallback, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    })

    // Continuous tracking. maximumAge=0 prevents the browser from replaying
    // a stale cached fix; we'd rather wait for a fresh one than show an old
    // location. timeout=20s gives the GPS chip time to lock indoors.
    const watchId = navigator.geolocation.watchPosition(successCallback, errorCallback, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    })

    gpsIntervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(successCallback, errorCallback, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 1000,
      })
    }, 2000)

    return () => {
      navigator.geolocation.clearWatch(watchId)
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current)
        gpsIntervalRef.current = null
      }
    }
  }, [gpsEnabled, fusion])

  // ─────────── Seatbelt detection (backend two-stage YOLOv5 + Keras) ───────────
  // Captures a JPEG from the live video and posts it to /api/detect/seatbelt.
  // The backend runs YOLOv5 to find the seatbelt candidate region, then a
  // Keras MobileNetV2 to classify worn vs not-worn. We require BOTH a
  // candidate AND high-confidence "Worn" before reporting the belt as
  // detected — otherwise reported as not detected.
  const captureSeatbeltFrame = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return null
    const vw = video.videoWidth, vh = video.videoHeight
    if (!vw || !vh) return null
    if (!seatbeltCanvasRef.current) seatbeltCanvasRef.current = document.createElement('canvas')
    const c = seatbeltCanvasRef.current
    const targetW = SEATBELT_FRAME_WIDTH
    const targetH = Math.round(vh * (targetW / vw))
    c.width = targetW
    c.height = targetH
    c.getContext('2d').drawImage(video, 0, 0, targetW, targetH)
    return new Promise((resolve) => {
      c.toBlob((b) => resolve(b), 'image/jpeg', SEATBELT_JPEG_QUALITY)
    })
  }, [])

  const runSeatbeltCheck = useCallback(async () => {
    if (seatbeltInFlightRef.current) return
    const blob = await captureSeatbeltFrame()
    if (!blob) return
    seatbeltInFlightRef.current = true
    try {
      const result = await detectionService.detectSeatbelt(blob)
      const sentW = result.image_size?.[0] || 1
      const sentH = result.image_size?.[1] || 1
      const vw = videoRef.current?.videoWidth || sentW
      const vh = videoRef.current?.videoHeight || sentH
      const sx = vw / sentW
      const sy = vh / sentH

      // STRICT fail-safe: belt is "worn" only if at least one candidate
      // passed all backend gates (YOLOv5 + geometry + Keras + Hough).
      const worn = result.seatbelt_worn === true

      // Render exactly ONE box per frame — never multiple. A real driver
      // wears one belt, so multi-box overlays over face/shoulder/background
      // read as a confidently-wrong system.
      //   - Green box: a candidate passed every backend gate (worn).
      //   - Orange box: YOLO found a candidate region but it was rejected
      //                 (low confidence / off-center / no dark strap band /
      //                 etc). Useful visual feedback so the driver can see
      //                 that detection is alive even before a "worn"
      //                 verdict — same as the stop-sign overlay always
      //                 drawing on detection.
      const cands = Array.isArray(result.candidates) ? result.candidates : []
      const wornCands = cands.filter((c) => c.seatbelt_worn === true)
      const bestWorn = wornCands.reduce(
        (acc, c) => (acc == null || c.confidence > acc.confidence ? c : acc),
        null,
      )
      let overlay = null
      if (bestWorn) {
        const [bx, by, bw, bh] = bestWorn.bbox
        overlay = {
          bbox: [bx * sx, by * sy, bw * sx, bh * sy],
          worn: true,
          label: `Seatbelt Worn ${(bestWorn.confidence * 100).toFixed(0)}%`,
        }
      } else if (result.detected && Array.isArray(result.bbox)) {
        const [bx, by, bw, bh] = result.bbox
        const conf = (result.yolo_confidence ?? 0) * 100
        overlay = {
          bbox: [bx * sx, by * sy, bw * sx, bh * sy],
          worn: false,
          label: `${result.class_name || 'Seatbelt?'} ${conf.toFixed(0)}%`,
        }
      }
      seatbeltBboxRef.current = {
        candidates: overlay ? [overlay] : [],
        timestamp: Date.now(),
      }

      // Window vote on worn/not-worn → drives status + violation
      seatbeltHistoryRef.current = [
        ...seatbeltHistoryRef.current,
        worn,
      ].slice(-SEATBELT_WINDOW)
      const noStrapHits = seatbeltHistoryRef.current.filter((p) => !p).length
      const detected = noStrapHits < SEATBELT_HITS_NEEDED_NO_STRAP
      setSeatbeltDetected(detected)
      setSeatbeltRatio(result.confidence ?? null)

      const now = Date.now()
      const inGrace = now - seatbeltStartTimeRef.current < SEATBELT_GRACE_MS
      const sinceLastViolation = now - lastSeatbeltViolationRef.current
      if (
        !inGrace &&
        seatbeltHistoryRef.current.length >= SEATBELT_WINDOW &&
        noStrapHits >= SEATBELT_HITS_NEEDED_NO_STRAP &&
        sinceLastViolation > SEATBELT_VIOLATION_INTERVAL_MS
      ) {
        lastSeatbeltViolationRef.current = now
        sendViolationRef.current?.('no_seatbelt', 'high')
      }
    } catch (err) {
      console.error('[seatbelt] detect failed:', err)
    } finally {
      seatbeltInFlightRef.current = false
    }
  }, [captureSeatbeltFrame])

  const sendViolation = useCallback(async (eventType, severity, eventSpeed) => {
    const now = Date.now()
    const lastTime = lastViolationTimeRef.current[eventType] || 0
    if (now - lastTime < VIOLATION_COOLDOWN) return

    const driverId = selectedDriverRef.current
    const vehicleId = selectedVehicleRef.current
    if (!driverId || !vehicleId) return

    lastViolationTimeRef.current[eventType] = now
    triggerAlert(severity)

    // Kick off all three async tasks IN PARALLEL — the UI violation entry
    // appears as soon as the webhook POST returns (~50ms), not after 200-500ms
    // of snapshot upload.
    const clipSeconds = CLIP_SECONDS_BY_TYPE[eventType] ?? CLIP_SECONDS_DEFAULT
    const clipPromise = mediaBuffer.captureClip(clipSeconds)
    const snapshotPromise = (async () => {
      try {
        const blob = await mediaBuffer.captureSnapshot(videoRef.current)
        if (!blob) return null
        const r = await uploadService.uploadSnapshot(blob, DEMO_WEBCAM_KEY)
        return r.url
      } catch (err) {
        console.error('[violation] snapshot failed:', err)
        return null
      }
    })()

    let violationId = null
    try {
      const response = await fetch('/api/webhook/violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': DEMO_WEBCAM_KEY },
        body: JSON.stringify({
          driver_id: driverId,
          vehicle_id: vehicleId,
          event_type: eventType,
          severity,
          timestamp: new Date().toISOString(),
          speed: eventSpeed ?? speedRef.current,
          snapshot_url: null,    // patched in as soon as snapshot upload finishes
          clip_url: null,        // patched in once clip recording + upload finishes
        }),
      })
      if (!response.ok) throw new Error(`webhook ${response.status}`)
      const result = await response.json()
      violationId = result.id
      setViolationLog((prev) => [{
        id: violationId,
        event_type: eventType,
        severity,
        speed: eventSpeed ?? speedRef.current,
        timestamp: new Date(),
      }, ...prev].slice(0, 50))
      setViolationCount((c) => c + 1)
    } catch (err) {
      console.error('[violation] webhook POST failed:', err)
      return
    }

    // Snapshot PATCH — fires as soon as upload completes, independent of clip.
    snapshotPromise.then((url) => {
      if (!url || !violationId) return
      fetch(`/api/violations/${violationId}/snapshot`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': DEMO_WEBCAM_KEY },
        body: JSON.stringify({ snapshot_url: url }),
      }).catch((err) => console.error('[violation] snapshot PATCH failed:', err))
    })

    // Clip PATCH — fires after recording finishes (clipSeconds later) + upload.
    clipPromise.then(async (clipBlob) => {
      if (!clipBlob || !violationId) return
      try {
        const uploadResult = await uploadService.uploadClip(clipBlob, DEMO_WEBCAM_KEY)
        await fetch(`/api/violations/${violationId}/clip`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': DEMO_WEBCAM_KEY },
          body: JSON.stringify({ clip_url: uploadResult.url }),
        })
      } catch (err) {
        console.error('[violation] clip upload/patch failed:', err)
      }
    })
  }, [triggerAlert, mediaBuffer])

  // Keep the ref updated so seatbelt callbacks can fire violations without
  // a circular hook dependency.
  useEffect(() => { sendViolationRef.current = sendViolation }, [sendViolation])

  const drawContour = (ctx, landmarks, indices, canvas) => {
    ctx.beginPath()
    indices.forEach((idx, i) => {
      const x = landmarks[idx].x * canvas.width
      const y = landmarks[idx].y * canvas.height
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.stroke()
  }

  const detectFrame = useCallback(() => {
    if (!videoRef.current || !faceLandmarkerRef.current || !canvasRef.current) return
    if (videoRef.current.readyState < 2) {
      animationRef.current = requestAnimationFrame(detectFrame)
      return
    }

    const startTimeMs = performance.now()
    const result = faceLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs)

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const video = videoRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    let currentEar = null
    let currentMar = null

    if (result.faceLandmarks && result.faceLandmarks.length > 0) {
      faceNotVisibleFramesRef.current = 0
      const landmarks = result.faceLandmarks[0]
      const isDrowsy = alertsRef.current.drowsy
      const isYawning = alertsRef.current.yawning

      ctx.strokeStyle = isDrowsy ? '#ff4d4f' : '#52c41a'
      ctx.lineWidth = 2
      drawContour(ctx, landmarks, LEFT_EYE, canvas)
      drawContour(ctx, landmarks, RIGHT_EYE, canvas)
      ctx.strokeStyle = isYawning ? '#fa8c16' : '#52c41a'
      drawContour(ctx, landmarks, MOUTH, canvas)


      if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
        const blendshapes = result.faceBlendshapes[0].categories
        const findScore = (name) => {
          const item = blendshapes.find((b) => b.categoryName === name)
          return item ? item.score : 0
        }

        const eyeBlinkLeft = findScore('eyeBlinkLeft')
        const eyeBlinkRight = findScore('eyeBlinkRight')
        currentEar = (eyeBlinkLeft + eyeBlinkRight) / 2
        currentMar = findScore('jawOpen')

        setMetrics({ ear: currentEar, mar: currentMar })

        if (detectionEnabledRef.current) {
          earHistoryRef.current = [...earHistoryRef.current, currentEar].slice(-EAR_WINDOW)
          marHistoryRef.current = [...marHistoryRef.current, currentMar].slice(-MAR_WINDOW)

          // Majority-of-window rule: tolerates MediaPipe blendshape noise
          // where one bad frame would reset an all-consecutive counter.
          const drowsyHits = earHistoryRef.current.filter((v) => v > EAR_THRESHOLD).length
          const newDrowsy = drowsyHits >= EAR_HITS_NEEDED

          const yawnHits = marHistoryRef.current.filter((v) => v > MAR_THRESHOLD).length
          const newYawning = yawnHits >= MAR_HITS_NEEDED

          if (newDrowsy && !alertsRef.current.drowsy) sendViolation('drowsiness', 'high')
          if (newYawning && !alertsRef.current.yawning) sendViolation('yawning', 'medium')

          alertsRef.current = { drowsy: newDrowsy, yawning: newYawning }
          setAlerts({ drowsy: newDrowsy, yawning: newYawning })
        }
      }
    } else {
      // Face not detected — driver may be looking away or face obscured
      if (detectionEnabledRef.current && selectedDriverRef.current) {
        faceNotVisibleFramesRef.current++
        if (faceNotVisibleFramesRef.current >= FACE_NOT_VISIBLE_CONSEC) {
          sendViolation('distracted', 'medium')
          faceNotVisibleFramesRef.current = 0
        }
      }
      // Draw warning on canvas
      ctx.fillStyle = '#ff4d4f'
      ctx.font = 'bold 18px monospace'
      ctx.shadowColor = '#000'
      ctx.shadowBlur = 4
      ctx.fillText('\u26A0 FACE NOT DETECTED', 10, canvas.height - 20)
      ctx.shadowBlur = 0
    }

    ctx.font = '14px monospace'
    ctx.fillStyle = '#fff'
    ctx.shadowColor = '#000'
    ctx.shadowBlur = 3
    if (currentEar !== null) {
      ctx.fillText(`EAR: ${currentEar.toFixed(2)}`, 10, 22)
      ctx.fillText(`MAR: ${currentMar.toFixed(2)}`, 10, 40)
    }
    ctx.fillText(`Speed: ${speedRef.current} km/h`, 10, 58)
    ctx.shadowBlur = 0

    // Stop-sign bbox overlay — styled like a YOLO detection annotation:
    // green box, label pill with text on top-left corner of the box.
    const ss = stopSignBboxRef.current
    if (ss?.bbox) {
      const [bx, by, bw, bh] = ss.bbox
      const label = ss.label || 'Stop'
      ctx.strokeStyle = '#16c47f'
      ctx.lineWidth = 3
      ctx.strokeRect(bx, by, bw, bh)

      ctx.font = 'bold 16px sans-serif'
      const pad = 6
      const textW = ctx.measureText(label).width
      const labelH = 22
      const labelY = Math.max(0, by - labelH)
      ctx.fillStyle = '#16c47f'
      ctx.fillRect(bx, labelY, textW + pad * 2, labelH)
      ctx.fillStyle = '#000'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, bx + pad, labelY + labelH / 2)
      ctx.textBaseline = 'alphabetic'
    }

    // Seatbelt overlay. Always exactly ONE box per frame:
    //   green = worn (passed every gate)
    //   orange = YOLO found a candidate region but it was rejected
    const sb = seatbeltBboxRef.current
    if (sb && (!sb.timestamp || Date.now() - sb.timestamp < 6000)) {
      const list = Array.isArray(sb.candidates) ? sb.candidates : []
      ctx.font = 'bold 16px sans-serif'
      ctx.lineWidth = 3
      for (const c of list) {
        if (!c.bbox) continue
        const [bx, by, bw, bh] = c.bbox
        const color = c.worn ? '#16c47f' : '#ff7a00'
        ctx.strokeStyle = color
        ctx.strokeRect(bx, by, bw, bh)

        const label = c.label || (c.worn ? 'Seatbelt Worn' : 'Seatbelt?')
        const pad = 6
        const textW = ctx.measureText(label).width
        const labelH = 22
        const labelY = Math.max(0, by - labelH)
        ctx.fillStyle = color
        ctx.fillRect(bx, labelY, textW + pad * 2, labelH)
        ctx.fillStyle = '#fff'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, bx + pad, labelY + labelH / 2)
        ctx.textBaseline = 'alphabetic'
      }
    }

    animationRef.current = requestAnimationFrame(detectFrame)
  }, [sendViolation])

  const drawRoadOverlay = useCallback(() => {
    const roadVideo = roadVideoRef.current
    const roadCanvas = roadCanvasRef.current
    if (!roadVideo || !roadCanvas) return
    if (roadVideo.readyState < 2) return

    roadCanvas.width = roadVideo.videoWidth
    roadCanvas.height = roadVideo.videoHeight
    const ctx = roadCanvas.getContext('2d')
    ctx.clearRect(0, 0, roadCanvas.width, roadCanvas.height)

    const ss = stopSignBboxRef.current
    if (!ss?.bbox) return

    const [bx, by, bw, bh] = ss.bbox
    ctx.strokeStyle = '#ff4d4f'
    ctx.lineWidth = 3
    ctx.strokeRect(bx, by, bw, bh)
    ctx.fillStyle = 'rgba(255, 77, 79, 0.9)'
    ctx.font = 'bold 14px sans-serif'
    ctx.fillText(ss.label || 'STOP SIGN', bx, Math.max(16, by - 6))
  }, [])

  useEffect(() => {
    if (!cameraActive) return undefined

    const id = setInterval(() => {
      drawRoadOverlay()
    }, 60)

    return () => clearInterval(id)
  }, [cameraActive, drawRoadOverlay])

  // Attaches a MediaStream to the <video> and wires up everything downstream
  // (face detection loop, stop-sign detection, recording buffer, RTC publish,
  // heartbeats). Used by both startCamera (webcam) and startScreenShare (display).
  const attachStream = (stream) => {
    if (!videoRef.current) return
    videoRef.current.srcObject = stream
    streamRef.current = stream
    videoRef.current.addEventListener('loadeddata', () => {
      setCameraActive(true)
      animationRef.current = requestAnimationFrame(detectFrame)
      mediaBuffer.start(stream)
      publish(stream)
      startStopSignDetection()
      cameraService.heartbeat(DEMO_WEBCAM_KEY, selectedDriverRef.current, selectedVehicleRef.current).catch(console.error)
      heartbeatIntervalRef.current = setInterval(() => {
        cameraService.heartbeat(DEMO_WEBCAM_KEY, selectedDriverRef.current, selectedVehicleRef.current).catch(console.error)
      }, 15000)
      // Reset seatbelt detector state and start polling the backend.
      // Grace period applies before any violation can fire.
      seatbeltHistoryRef.current = []
      seatbeltStartTimeRef.current = Date.now()
      lastSeatbeltViolationRef.current = 0
      seatbeltBboxRef.current = null
      setSeatbeltDetected(false)
      setSeatbeltRatio(null)
      if (seatbeltIntervalRef.current) clearInterval(seatbeltIntervalRef.current)
      // Fire the first check ~1s in (gives MediaRecorder/decode time to settle),
      // then every SEATBELT_INTERVAL_MS.
      setTimeout(runSeatbeltCheck, 1000)
      seatbeltIntervalRef.current = setInterval(runSeatbeltCheck, SEATBELT_INTERVAL_MS)
    }, { once: true })
    // Browser "Stop sharing" button or user revoking the screen share ends
    // the video track — clean up our state when that happens.
    stream.getVideoTracks().forEach((t) => {
      t.addEventListener('ended', () => stopCamera?.())
    })
  }

  const startScreenShare = async () => {
    if (!faceLandmarkerRef.current) await initFaceLandmarker()
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15 } },
        audio: false,
      })
      console.log('[DriverCamera] started screen share')
      attachStream(stream)
    } catch (err) {
      console.error('getDisplayMedia failed:', err)
      if (err.name !== 'NotAllowedError') {
        // NotAllowedError here means the user cancelled the picker — no error toast needed.
        message.error(`Screen share failed: ${err.name} — ${err.message}`, 8)
      }
    }
  }

  const startCamera = async () => {
    if (!faceLandmarkerRef.current) await initFaceLandmarker()

    try {
      const mainStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      })

      if (videoRef.current) {
        videoRef.current.srcObject = mainStream
        streamRef.current = mainStream
        stopSignVideoRef.current = videoRef.current
        videoRef.current.addEventListener('loadeddata', () => {
          setCameraActive(true)
          animationRef.current = requestAnimationFrame(detectFrame)
          mediaBuffer.start(mainStream)
          publish(mainStream)

          startStopSignDetection()

          // Send initial heartbeat and start periodic heartbeat
          cameraService.heartbeat(DEMO_WEBCAM_KEY, selectedDriverRef.current, selectedVehicleRef.current).catch(console.error)
          heartbeatIntervalRef.current = setInterval(() => {
            cameraService.heartbeat(DEMO_WEBCAM_KEY, selectedDriverRef.current, selectedVehicleRef.current).catch(console.error)
          }, 15000)
        }, { once: true })
      }

      try {
        const roadStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
            facingMode: { ideal: 'environment' },
          },
          audio: false,
        })
        roadStreamRef.current = roadStream
        if (roadVideoRef.current) {
          roadVideoRef.current.srcObject = roadStream
          stopSignVideoRef.current = roadVideoRef.current
        }
      } catch (roadError) {
        console.warn('Road camera unavailable, using main camera for stop sign detection:', roadError)
      }
      // Ask for camera permission FIRST. Chrome's enumerateDevices() returns
      // an empty array until permission is granted, so checking device count
      // before calling getUserMedia creates a chicken-and-egg that blocks the
      // permission prompt from ever appearing.
      // Try the preferred resolution first; fall back to `video: true` if
      // Chrome can't satisfy the ideal constraints — that's the most
      // permissive request possible and will use whatever the default cam is.
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
      } catch (innerErr) {
        console.warn('[DriverCamera] 1280x720 getUserMedia failed, retrying with video: true:', innerErr.name)
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }
      // After permission is granted, devices are enumerable — log for debug.
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        console.log('[DriverCamera] videoinput devices:', devices.filter((d) => d.kind === 'videoinput'))
      } catch {}
      attachStream(stream)
    } catch (err) {
      console.error('getUserMedia failed:', err)
      const origin = window.location.origin
      const isSecure = window.isSecureContext
      const hint =
        err.name === 'NotAllowedError'
          ? 'Camera blocked by browser. Click the camera icon in the address bar and allow access, then retry. If that doesn\'t work, check Windows Settings > Privacy & security > Camera.'
          : err.name === 'NotFoundError' || err.name === 'OverconstrainedError'
          ? 'No camera detected. On Windows, open Settings > Privacy & security > Camera and enable: (1) "Camera access", (2) "Let apps access your camera", (3) "Let desktop apps access your camera". Then fully close Chrome (all windows) and reopen.'
          : err.name === 'NotReadableError'
          ? 'Camera is already in use by another app (Teams, Zoom, OBS, another browser tab). Close it and retry.'
          : err.name === 'SecurityError' || !isSecure
          ? `Browser blocked camera (insecure origin: ${origin}). Open http://localhost:5176 — not a LAN IP or http://0.0.0.0.`
          : `Unable to access camera: ${err.name} — ${err.message}`
      message.error(hint, 15)
    }
  }

  const stopCamera = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
    }
    if (roadStreamRef.current) {
      roadStreamRef.current.getTracks().forEach((track) => track.stop())
      roadStreamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    if (roadVideoRef.current) roadVideoRef.current.srcObject = null
    stopSignVideoRef.current = null
    mediaBuffer.stop()
    unpublish()
    stopStopSignDetection() // Stop stop sign camera detection
    stopSignBboxRef.current = null
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = null
    }
    if (seatbeltIntervalRef.current) {
      clearInterval(seatbeltIntervalRef.current)
      seatbeltIntervalRef.current = null
    }
    seatbeltHistoryRef.current = []
    seatbeltStartTimeRef.current = 0
    seatbeltBboxRef.current = null
    setSeatbeltDetected(false)
    setSeatbeltRatio(null)
    setCameraActive(false)
    setMetrics({ ear: null, mar: null })
    setAlerts({ drowsy: false, yawning: false })
    alertsRef.current = { drowsy: false, yawning: false }
    earHistoryRef.current = []
    marHistoryRef.current = []
    faceNotVisibleFramesRef.current = 0
  }, [mediaBuffer, unpublish, stopStopSignDetection])

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      if (roadStreamRef.current) roadStreamRef.current.getTracks().forEach((t) => t.stop())
      if (faceLandmarkerRef.current) faceLandmarkerRef.current.close()
      if (sensorIntervalRef.current) clearInterval(sensorIntervalRef.current)
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current)
      if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current)
      if (seatbeltIntervalRef.current) clearInterval(seatbeltIntervalRef.current)
    }
  }, [])

  // Effective limit = sign-verified override (when present) else OSM default.
  // If we have no GPS/limit yet we fall back to a generic 120 ceiling so the
  // existing static colour ramp keeps working out of the box.
  const effectiveLimit =
    speedLimitInfo.signOverride ?? speedLimitInfo.defaultLimit ?? 120
  const overLimit = speed > effectiveLimit
  const nearLimit = !overLimit && speed > effectiveLimit * 0.9
  const speedColor = overLimit ? '#f5222d' : nearLimit ? '#fa8c16' : '#52c41a'

  return (
    <div>
      {/* Siren audio element (hidden) */}
      <audio ref={sirenAudioRef} src="/siren.mp3" preload="auto" style={{ display: 'none' }} />
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>Driver Camera</Title>
        </Col>
        <Col>
          <Space>
            {isPublishing && (
              <Tag color="green">STREAMING ({peerCount} viewer{peerCount !== 1 ? 's' : ''})</Tag>
            )}
              <Tag color={isStopSignModelReady ? 'green' : 'orange'}>
                COCO-SSD: {isStopSignModelReady ? 'READY' : 'LOADING'}
              </Tag>
            <Badge
              status={cameraActive ? 'success' : 'default'}
              text={cameraActive ? 'Camera Active' : 'Camera Off'}
            />
          </Space>
        </Col>
      </Row>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col span={7}>
            {isDriverRole ? (
              <Text strong>
                {drivers.length > 0 ? `${drivers[0].name} (${drivers[0].employee_id})` : 'Loading...'}
              </Text>
            ) : (
              <Select
                placeholder="Select Driver"
                style={{ width: '100%' }}
                showSearch
                filterOption={(input, opt) => opt.label.toLowerCase().includes(input.toLowerCase())}
                options={drivers.map((d) => ({ label: `${d.name} (${d.employee_id})`, value: d.id }))}
                onChange={setSelectedDriver}
              />
            )}
          </Col>
          <Col span={7}>
            <Select
              placeholder="Select Vehicle"
              style={{ width: '100%' }}
              showSearch
              filterOption={(input, opt) => opt.label.toLowerCase().includes(input.toLowerCase())}
              options={vehicles.map((v) => ({ label: `${v.plate_number} - ${v.model}`, value: v.id }))}
              onChange={setSelectedVehicle}
            />
          </Col>
          <Col span={10}>
            <Space wrap>
              <Button
                type="primary"
                icon={cameraActive ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                onClick={cameraActive ? stopCamera : startCamera}
                loading={modelLoading}
                disabled={!selectedDriver || !selectedVehicle}
              >
                {modelLoading ? 'Loading AI Model...' : cameraActive ? 'Stop Camera' : 'Start Camera'}
              </Button>
              {!cameraActive && (
                <Button
                  icon={<PlayCircleOutlined />}
                  onClick={startScreenShare}
                  loading={modelLoading}
                  disabled={!selectedDriver || !selectedVehicle}
                >
                  Share Screen
                </Button>
              )}
              <Switch
                checked={detectionEnabled}
                onChange={setDetectionEnabled}
                checkedChildren="Face Detection ON"
                unCheckedChildren="Face Detection OFF"
                size="small"
              />
              <Switch
                checked={gpsEnabled}
                onChange={setGpsEnabled}
                checkedChildren="GPS ON"
                unCheckedChildren="GPS OFF"
                size="small"
              />
              <Switch
                checked={cameraStopSignEnabled}
                onChange={setCameraStopSignEnabled}
                checkedChildren="Stop Sign Detection ON"
                unCheckedChildren="Stop Sign Detection OFF"
                size="small"
              />
            </Space>
          </Col>
        </Row>
      </Card>

      {(!selectedDriver || !selectedVehicle) && (
        <Alert
          message="Select a driver and vehicle to begin detection"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Row gutter={16}>
        <Col xs={24} lg={16}>
          <Card title="Camera Feed" size="small" style={{ marginBottom: 16 }}>
            <div style={{
              position: 'relative',
              background: '#000',
              borderRadius: 8,
              overflow: 'hidden',
              aspectRatio: '4/3',
            }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: cameraActive ? 'block' : 'none',
                }}
              />
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                }}
              />
              {isAlerting && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(255, 0, 0, 0.15)',
                  pointerEvents: 'none',
                  animation: 'flashPulse 0.5s ease-in-out infinite',
                }} />
              )}
              {/* Prominent banner across the top of the feed when seatbelt is
                  not detected — only shown after the grace period so it doesn't
                  flash on camera start before the first check returns. */}
              {cameraActive && !seatbeltDetected
                && Date.now() - seatbeltStartTimeRef.current > SEATBELT_GRACE_MS && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  background: 'rgba(255, 77, 79, 0.95)',
                  color: '#fff',
                  padding: '10px 16px',
                  fontWeight: 700,
                  fontSize: 16,
                  textAlign: 'center',
                  letterSpacing: 1,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  pointerEvents: 'none',
                  animation: 'flashPulse 1s ease-in-out infinite',
                }}>
                  <SafetyOutlined style={{ marginRight: 8 }} />
                  NO SEATBELT DETECTED — FASTEN YOUR BELT
                </div>
              )}
              {!cameraActive && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  minHeight: 300,
                  color: '#666',
                }}>
                  <Text type="secondary" style={{ fontSize: 16 }}>
                    Camera is off. Select driver & vehicle, then click Start Camera.
                  </Text>
                </div>
              )}
              {cameraActive && (
                <div style={{ position: 'absolute', bottom: 10, left: 10, right: 10 }}>
                  <Space wrap>
                    <Tag color={alerts.drowsy ? 'red' : 'green'}>
                      Eyes: {metrics.ear !== null ? metrics.ear.toFixed(2) : '--'}
                    </Tag>
                    <Tag color={alerts.yawning ? 'orange' : 'green'}>
                      Mouth: {metrics.mar !== null ? metrics.mar.toFixed(2) : '--'}
                    </Tag>
                    <Tag
                      color={seatbeltDetected ? 'green' : 'red'}
                      icon={<SafetyOutlined />}
                    >
                      Seatbelt: {seatbeltDetected ? 'detected' : 'not detected'}
                      {seatbeltRatio !== null && ` (${seatbeltRatio.toFixed(2)})`}
                    </Tag>
                    {alerts.drowsy && (
                      <Tag color="red" icon={<WarningOutlined />}>DROWSINESS DETECTED</Tag>
                    )}
                    {alerts.yawning && (
                      <Tag color="orange" icon={<WarningOutlined />}>YAWNING DETECTED</Tag>
                    )}
                  </Space>
                </div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                Road Camera (used for COCO-SSD stop-sign detection)
              </Text>
              <div style={{
                position: 'relative',
                background: '#000',
                borderRadius: 8,
                overflow: 'hidden',
                aspectRatio: '4/3',
                maxWidth: 360,
              }}>
                <video
                  ref={roadVideoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: cameraActive ? 'block' : 'none',
                  }}
                />
                <canvas
                  ref={roadCanvasRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                  }}
                />
                {!cameraActive && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    minHeight: 180,
                    color: '#666',
                  }}>
                    <Text type="secondary">Road camera preview appears after Start Camera</Text>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Sensor Dashboard */}
          <Card title="Vehicle Sensors" size="small" style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={8}>
                <Statistic
                  title="Speed"
                  value={cameraActive ? speed : '--'}
                  suffix={cameraActive ? 'km/h' : ''}
                  valueStyle={{ color: cameraActive ? speedColor : '#999' }}
                  prefix={<DashboardOutlined />}
                />
                {cameraActive && (
                  <Progress
                    percent={Math.round((speed / 180) * 100)}
                    showInfo={false}
                    strokeColor={speedColor}
                    size="small"
                    style={{ marginTop: 4 }}
                  />
                )}
              </Col>
              <Col span={8}>
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <ThunderboltOutlined style={{
                    fontSize: 28,
                    color: isBraking ? '#f5222d' : '#d9d9d9',
                  }} />
                  <div style={{ marginTop: 4 }}>
                    <Tag color={isBraking ? 'red' : 'default'}>
                      {isBraking ? 'HARSH BRAKING' : 'Braking: Normal'}
                    </Tag>
                  </div>
                </div>
              </Col>
              <Col span={8}>
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <ThunderboltOutlined style={{
                    fontSize: 28,
                    color: isAccelerating ? '#fa8c16' : '#d9d9d9',
                    transform: 'rotate(180deg)',
                  }} />
                  <div style={{ marginTop: 4 }}>
                    <Tag color={isAccelerating ? 'orange' : 'default'}>
                      {isAccelerating ? 'SUDDEN ACCEL' : 'Accel: Normal'}
                    </Tag>
                  </div>
                </div>
              </Col>
            </Row>
            {gpsEnabled && currentLocation && (
              <div style={{ marginTop: 12, fontSize: 12 }}>
                <Tag icon={<DashboardOutlined />} color="blue">
                  GPS: {currentLocation.lat.toFixed(4)}, {currentLocation.lng.toFixed(4)}
                </Tag>
                {currentHeading !== 0 && (
                  <Tag style={{ marginLeft: 4 }} color="cyan">
                    Heading: {Math.round(currentHeading)}°
                  </Tag>
                )}
              </div>
            )}

            {/* Speed limit for the current road. Defaults come from OSM
                (posted maxspeed tag, or India road-class fallback). When a
                speed-limit sign is camera-detected and matches the map, it
                becomes the override and lives until the road changes. */}
            {cameraActive && speedLimitInfo.defaultLimit != null && (
              <div
                style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: overLimit ? '#fff1f0' : '#f6ffed',
                  border: `1px solid ${overLimit ? '#ffa39e' : '#b7eb8f'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Speed Limit
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 600, color: overLimit ? '#cf1322' : '#389e0d' }}>
                    {effectiveLimit} km/h
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, color: '#555' }}>
                  <div title={speedLimitInfo.roadName}>
                    {speedLimitInfo.roadName?.length > 28
                      ? `${speedLimitInfo.roadName.slice(0, 28)}…`
                      : speedLimitInfo.roadName}
                  </div>
                  <Space size={4} style={{ marginTop: 4 }}>
                    <Tag color="default" style={{ margin: 0 }}>
                      {speedLimitInfo.roadType}
                    </Tag>
                    {speedLimitInfo.signOverride != null ? (
                      <Tag color="green" style={{ margin: 0 }}>sign-verified</Tag>
                    ) : speedLimitInfo.source === 'osm-tag' ? (
                      <Tag color="blue" style={{ margin: 0 }}>posted</Tag>
                    ) : (
                      <Tag color="orange" style={{ margin: 0 }}>area default</Tag>
                    )}
                    {overLimit && <Tag color="red" style={{ margin: 0 }}>OVER LIMIT</Tag>}
                  </Space>
                </div>
              </div>
            )}
            {cameraActive && !gpsEnabled && (
              <div style={{ marginTop: 12, fontSize: 12, color: '#888' }}>
                Enable GPS to detect the speed limit for this road.
              </div>
            )}
          </Card>

          {/* Manual Triggers */}
          <Card title="Manual Triggers" size="small">
            <Space>
              <Button danger onClick={() => sendViolation('phone_usage', 'high')} disabled={!cameraActive}>
                Report Phone Usage
              </Button>
              <Button onClick={() => sendViolation('no_seatbelt', 'medium')} disabled={!cameraActive}>
                Report No Seatbelt
              </Button>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic title="Violations" value={violationCount} />
              </Col>
              <Col span={12}>
                <Statistic
                  title="Speed"
                  value={cameraActive ? speed : '--'}
                  suffix={cameraActive ? 'km/h' : ''}
                  valueStyle={{ color: speedColor }}
                />
              </Col>
            </Row>
          </Card>

          {/* Live driver mini-map (Uber/Ola style) — directly under the
              Violations/Speed card so a glance gives location + speed +
              limit context together. Renders a placeholder if the Google
              Maps API key isn't set (see .env.example). */}
          <Card size="small" title="Live Location" style={{ marginBottom: 16 }} styles={{ body: { padding: 8 } }}>
            <DriverMiniMap
              lat={effectiveLocation?.lat}
              lng={effectiveLocation?.lng}
              heading={currentHeading}
              speed={cameraActive ? speed : null}
              speedLimit={effectiveLimit}
              overLimit={overLimit}
              height={220}
            />
            <Space.Compact style={{ width: '100%', marginTop: 8 }}>
              <Input
                size="small"
                placeholder="Override: lat, lng (e.g. 25.2048, 55.2708)"
                value={manualLocationInput}
                onChange={(e) => setManualLocationInput(e.target.value)}
                onPressEnter={handleApplyManualLocation}
              />
              <Button size="small" onClick={handleApplyManualLocation}>Set</Button>
              {manualLocation && (
                <Button size="small" danger onClick={handleClearManualLocation}>Clear</Button>
              )}
            </Space.Compact>
            {manualLocation && (
              <Text type="warning" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                {phoneGPS.phoneConnected ? 'Phone GPS active' : 'Manual override active'}
                {' — '}
                {manualLocation.lat.toFixed(4)}, {manualLocation.lng.toFixed(4)}
              </Text>
            )}
            <Button
              size="small"
              icon={<MobileOutlined />}
              onClick={handleStartPairing}
              style={{ width: '100%', marginTop: 8 }}
              type={phoneGPS.phoneConnected ? 'primary' : 'default'}
            >
              {phoneGPS.phoneConnected ? 'Phone GPS connected' : 'Use phone GPS'}
            </Button>
          </Card>

          {/* Active Alerts */}
          {(alerts.drowsy || alerts.yawning || isBraking || isAccelerating || stopSignAlerts.length > 0
            || (cameraActive && !seatbeltDetected && Date.now() - seatbeltStartTimeRef.current > SEATBELT_GRACE_MS)) && (
            <Card
              size="small"
              style={{
                marginBottom: 16,
                borderColor: '#ff4d4f',
                background: '#fff1f0',
              }}
            >
              <Title level={5} style={{ color: '#cf1322', margin: 0, marginBottom: 8 }}>
                <WarningOutlined /> Active Alerts
              </Title>
              <Space direction="vertical" size={4}>
                {alerts.drowsy && <Tag color="red">Drowsiness Detected</Tag>}
                {alerts.yawning && <Tag color="orange">Yawning Detected</Tag>}
                {cameraActive && !seatbeltDetected
                  && Date.now() - seatbeltStartTimeRef.current > SEATBELT_GRACE_MS && (
                  <Tag color="red" icon={<SafetyOutlined />}>No Seatbelt</Tag>
                )}
                {isBraking && <Tag color="red">Harsh Braking</Tag>}
                {isAccelerating && <Tag color="orange">Sudden Acceleration</Tag>}
                {stopSignAlerts.map((alert, idx) => (
                  <Tag key={idx} color="red" style={{ fontSize: 12 }}>
                    {alert.priority >= 3 ? '\u26A0 URGENT: ' : '\u26A0 '}
                    {alert.message}
                    {alert.distance && ` (${Math.round(alert.distance)}m)`}
                  </Tag>
                ))}
              </Space>
            </Card>
          )}

          {/* Traffic Signs Info */}
          {gpsEnabled && (
            <Card
              size="small"
              title="Traffic Signs (OSM)"
              style={{ marginBottom: 16 }}
            >
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div style={{ fontSize: 12, color: '#666' }}>
                  <Text>Loaded: {trafficSigns.length} signs</Text>
                </div>
                {trafficSigns.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {currentLocation ? 'No traffic signs nearby' : 'Waiting for GPS...'}
                  </Text>
                ) : (
                  <div style={{ maxHeight: 150, overflow: 'auto' }}>
                    {trafficSigns.slice(0, 10).map((sign, idx) => (
                      <Tag key={idx} color="blue" style={{ marginBottom: 4 }}>
                        {sign.label} ({Math.round(sign.distance)}m)
                      </Tag>
                    ))}
                  </div>
                )}
              </Space>
            </Card>
          )}

          <Card
            title={`Detection Log (${violationLog.length})`}
            size="small"
            style={{ maxHeight: 520, overflow: 'auto' }}
          >
            <List
              dataSource={violationLog}
              size="small"
              renderItem={(item) => (
                <List.Item>
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <Space>
                      <Tag color={EVENT_TYPES[item.event_type]?.color}>
                        {EVENT_TYPES[item.event_type]?.label || item.event_type}
                      </Tag>
                      <Tag color={SEVERITY_COLORS[item.severity]}>{item.severity}</Tag>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(item.timestamp).format('HH:mm:ss')} | {item.speed ? `${item.speed} km/h` : ''} | ID: {item.id}
                    </Text>
                  </Space>
                </List.Item>
              )}
              locale={{ emptyText: 'No violations detected yet' }}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        title="Pair phone GPS"
        open={pairModalOpen}
        onCancel={() => setPairModalOpen(false)}
        footer={[
          <Button key="stop" danger onClick={handleStopPairing}>
            Stop pairing
          </Button>,
          <Button key="close" onClick={() => setPairModalOpen(false)}>
            Close
          </Button>,
        ]}
        destroyOnClose={false}
      >
        {phoneGPS.sessionId && (() => {
          const phoneUrl = phoneGPS.phoneUrl
          return (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Text>
                Scan the QR with your phone (or open the URL below). Allow
                location access on the phone — its GPS will stream into the
                dashboard's live location.
              </Text>
              <div style={{ display: 'flex', justifyContent: 'center', padding: 12, background: '#fff', minHeight: 220 }}>
                {phoneUrl ? (
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(phoneUrl)}`}
                    alt="Phone pairing QR code"
                    width={220}
                    height={220}
                  />
                ) : (
                  <Text type="secondary">Resolving network address…</Text>
                )}
              </div>
              <Input.TextArea value={phoneUrl || 'Resolving…'} readOnly autoSize style={{ fontSize: 12 }} />
              <div>
                <Tag color={phoneGPS.pairingActive ? 'green' : 'default'}>
                  {phoneGPS.pairingActive ? 'Listening' : 'Connecting…'}
                </Tag>
                <Tag color={phoneGPS.phoneConnected ? 'green' : 'default'}>
                  {phoneGPS.phoneConnected ? 'Phone connected' : 'Waiting for phone'}
                </Tag>
              </div>
              {phoneGPS.lastPhoneFix && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Latest fix: {phoneGPS.lastPhoneFix.lat.toFixed(6)},{' '}
                  {phoneGPS.lastPhoneFix.lng.toFixed(6)}
                  {phoneGPS.lastPhoneFix.accuracy != null
                    && ` (±${Math.round(phoneGPS.lastPhoneFix.accuracy)}m)`}
                </Text>
              )}
              {phoneGPS.pairingError && (
                <Alert type="error" showIcon message={phoneGPS.pairingError} />
              )}
              {window.location.protocol !== 'https:'
                && window.location.hostname !== 'localhost'
                && window.location.hostname !== '127.0.0.1' && (
                <Alert
                  type="warning"
                  showIcon
                  message="HTTPS required for mobile GPS"
                  description="Phones refuse to share GPS over plain http:// unless the host is localhost. Run the dev server with HTTPS or expose it via a tunnel (e.g. ngrok) so the phone can grant location permission."
                />
              )}
            </Space>
          )
        })()}
      </Modal>

    </div>
  )
}
