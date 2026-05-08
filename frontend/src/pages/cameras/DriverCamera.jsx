import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Card, Row, Col, Typography, Select, Button, Tag, List, Badge, Space,
  Alert, Switch, message, Statistic, Progress,
} from 'antd'
import {
  PlayCircleOutlined, PauseCircleOutlined, WarningOutlined,
  DashboardOutlined, ThunderboltOutlined,
} from '@ant-design/icons'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { driverService, vehicleService, uploadService, cameraService, authService } from '@/services'
import { useAuth } from '@/context/AuthContext'
import { EVENT_TYPES, SEVERITY_COLORS, ROLES, DEMO_WEBCAM_KEY } from '@/constants'
import useMediaRecorderBuffer from '@/hooks/useMediaRecorderBuffer'
import useViolationAlerts from '@/hooks/useViolationAlerts'
import useWebRTCPublisher from '@/hooks/useWebRTCPublisher'
import useStopSignCamera from '@/hooks/useStopSignCamera'
import useStopSignFusion from '@/hooks/useStopSignFusion'
import osmService from '@/services/osmService'
import { getDistance } from '@/utils/geo'
import { subscribeStopSignSimulation } from '@/services/stopSignSimulationBus'
import dayjs from 'dayjs'

const { Title, Text } = Typography

const EAR_THRESHOLD = 0.55
const EAR_CONSEC_FRAMES = 15
const MAR_THRESHOLD = 0.6
const MAR_CONSEC_FRAMES = 30
const VIOLATION_COOLDOWN = 10000
const FACE_NOT_VISIBLE_CONSEC = 45

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

  // Stop sign detection state
  const [trafficSigns, setTrafficSigns] = useState([])
  const [stopSignAlerts, setStopSignAlerts] = useState([])
  const [gpsEnabled, setGpsEnabled] = useState(false)
  const [cameraStopSignEnabled, setCameraStopSignEnabled] = useState(true)
  const [currentLocation, setCurrentLocation] = useState(null)
  const [currentHeading, setCurrentHeading] = useState(0)

  // Simulated sensors
  const [speed, setSpeed] = useState(60)
  const [isBraking, setIsBraking] = useState(false)
  const [isAccelerating, setIsAccelerating] = useState(false)

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

  // Handle stop sign violation
  const handleStopSignViolation = useCallback((violationType, data) => {
    console.log('[StopSign] Violation triggered:', violationType, data)

    // For stop signs, we send violation directly with special event type
    const eventType = violationType === 'STOP_SIGN_VIOLATION' ? 'stop_sign_violation' : 'stop_sign_detected'

    // Trigger voice alert for stop signs
    const voiceMessage = 'Stop sign ahead. Prepare to stop.'

    triggerVoiceAlert(voiceMessage, 'high')

    // Play siren sound
    if (sirenAudioRef.current) {
      sirenAudioRef.current.currentTime = 0
      sirenAudioRef.current.play().catch((e) => {
        // Some browsers require user interaction before playing audio
        console.warn('Siren audio play failed:', e)
      })
    }

    // Send to backend
    const now = Date.now()
    const lastTime = lastViolationTimeRef.current[eventType] || 0
    if (now - lastTime < VIOLATION_COOLDOWN) return

    const driverId = selectedDriverRef.current
    const vehicleId = selectedVehicleRef.current
    if (!driverId || !vehicleId) return

    lastViolationTimeRef.current[eventType] = now

    const payload = {
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
    }

    fetch('/api/webhook/violation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': DEMO_WEBCAM_KEY,
      },
      body: JSON.stringify(payload),
    })
      .then((res) => res.json())
      .then((result) => {
        setViolationLog((prev) => [{
          id: result.id,
          event_type: eventType,
          severity: 'high',
          speed: data.speed,
          timestamp: new Date(),
          isStopSign: true,
        }, ...prev].slice(0, 50))
        setViolationCount((c) => c + 1)
      })
      .catch(console.error)
  }, [triggerVoiceAlert])

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

  // Prefer road-facing stream for stop sign detection, fallback to main stream.
  const {
    startDetection: startStopSignDetection,
    stopDetection: stopStopSignDetection,
    isModelReady: isStopSignModelReady,
  } = useStopSignCamera(
    stopSignVideoRef,
    handleCameraDetection,
    handleCameraLost,
    stopSignBboxRef,
  )

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
    }

    if (!('geolocation' in navigator)) {
      console.warn('[StopSign] Geolocation not supported')
      setGpsEnabled(false)
      return undefined
    }

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

    const errorCallback = (error) => {
      console.error('[StopSign] GPS error:', error)
      setGpsEnabled(false)
    }

    navigator.geolocation.getCurrentPosition(successCallback, errorCallback, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 1000,
    })

    const watchId = navigator.geolocation.watchPosition(successCallback, errorCallback, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 1000,
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

  const sendViolation = useCallback(async (eventType, severity, eventSpeed) => {
    const now = Date.now()
    const lastTime = lastViolationTimeRef.current[eventType] || 0
    if (now - lastTime < VIOLATION_COOLDOWN) return

    const driverId = selectedDriverRef.current
    const vehicleId = selectedVehicleRef.current
    if (!driverId || !vehicleId) return

    lastViolationTimeRef.current[eventType] = now

    // Trigger alert
    triggerAlert(severity)

    // Capture evidence
    let snapshotUrl = null

    try {
      const snapshotBlob = await mediaBuffer.captureSnapshot(videoRef.current)
      if (snapshotBlob) {
        const result = await uploadService.uploadSnapshot(snapshotBlob, DEMO_WEBCAM_KEY)
        snapshotUrl = result.url
      }
    } catch (err) {
      console.error('Snapshot capture failed:', err)
    }

    // Start clip capture (async — will PATCH the violation once uploaded)
    const clipPromise = mediaBuffer.captureClip(5, 10)

    const payload = {
      driver_id: driverId,
      vehicle_id: vehicleId,
      event_type: eventType,
      severity,
      timestamp: new Date().toISOString(),
      speed: eventSpeed ?? speedRef.current,
      snapshot_url: snapshotUrl,
      clip_url: null,
    }

    try {
      const response = await fetch('/api/webhook/violation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': DEMO_WEBCAM_KEY,
        },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        const result = await response.json()
        setViolationLog((prev) => [{
          id: result.id,
          event_type: eventType,
          severity,
          speed: eventSpeed ?? speedRef.current,
          timestamp: new Date(),
        }, ...prev].slice(0, 50))
        setViolationCount((c) => c + 1)

        // Async: upload clip then PATCH the violation record
        clipPromise.then(async (clipBlob) => {
          if (clipBlob) {
            try {
              const uploadResult = await uploadService.uploadClip(clipBlob, DEMO_WEBCAM_KEY)
              await fetch(`/api/violations/${result.id}/clip`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'X-API-Key': DEMO_WEBCAM_KEY,
                },
                body: JSON.stringify({ clip_url: uploadResult.url }),
              })
            } catch (err) {
              console.error('Clip upload/patch failed:', err)
            }
          }
        })
      }
    } catch (err) {
      console.error('Failed to send violation:', err)
    }
  }, [triggerAlert, mediaBuffer])

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
          earHistoryRef.current = [...earHistoryRef.current, currentEar].slice(-EAR_CONSEC_FRAMES)
          marHistoryRef.current = [...marHistoryRef.current, currentMar].slice(-MAR_CONSEC_FRAMES)

          const drowsyFrames = earHistoryRef.current.filter((v) => v > EAR_THRESHOLD).length
          const newDrowsy = drowsyFrames >= EAR_CONSEC_FRAMES

          const yawnFrames = marHistoryRef.current.filter((v) => v > MAR_THRESHOLD).length
          const newYawning = yawnFrames >= MAR_CONSEC_FRAMES

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
    } catch (err) {
      message.error('Unable to access camera. Check permissions.')
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
    }
  }, [])

  const speedColor = speed > 120 ? '#f5222d' : speed > 80 ? '#fa8c16' : '#52c41a'

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
                  transform: 'scaleX(-1)',
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
                  transform: 'scaleX(-1)',
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

          {/* Active Alerts */}
          {(alerts.drowsy || alerts.yawning || isBraking || isAccelerating || stopSignAlerts.length > 0) && (
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
    </div>
  )
}
