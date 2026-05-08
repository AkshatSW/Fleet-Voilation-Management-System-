import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Card, Row, Col, Typography, Button, Tag, List, Badge, Space, Empty,
} from 'antd'
import {
  VideoCameraOutlined, LinkOutlined, DisconnectOutlined,
  WarningOutlined, ReloadOutlined,
} from '@ant-design/icons'
import { cameraService, violationService } from '@/services'
import { EVENT_TYPES, SEVERITY_COLORS, CAMERA_STATUSES, REVIEW_STATUSES } from '@/constants'
import useWebRTCViewer from '@/hooks/useWebRTCViewer'
import useRealtimeUpdates from '@/hooks/useRealtimeUpdates'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const { Title, Text } = Typography
const HEARTBEAT_STALE_SECONDS = 60

function CameraFeed({ camera, onClose }) {
  const { connect, disconnect, remoteStream, isConnected } = useWebRTCViewer(String(camera.id))
  const videoRef = useRef(null)
  const [timedOut, setTimedOut] = useState(false)
  const connectRef = useRef(connect)
  const disconnectRef = useRef(disconnect)

  useEffect(() => { connectRef.current = connect }, [connect])
  useEffect(() => { disconnectRef.current = disconnect }, [disconnect])

  useEffect(() => {
    connectRef.current()
    return () => disconnectRef.current()
  }, [camera.id])

  useEffect(() => {
    if (isConnected) {
      setTimedOut(false)
      return
    }
    const timer = setTimeout(() => setTimedOut(true), 10000)
    return () => clearTimeout(timer)
  }, [isConnected])

  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  return (
    <Card
      title={
        <Space>
          <VideoCameraOutlined />
          {camera.name}
          <Badge status={isConnected ? 'success' : 'processing'} text={isConnected ? 'Connected' : 'Connecting...'} />
        </Space>
      }
      extra={
        <Button size="small" icon={<DisconnectOutlined />} onClick={() => { disconnectRef.current(); onClose() }}>
          Disconnect
        </Button>
      }
      size="small"
      style={{ marginBottom: 16 }}
    >
      <div style={{
        background: '#000',
        borderRadius: 8,
        overflow: 'hidden',
        aspectRatio: '16/9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {isConnected ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : timedOut ? (
          <Text type="secondary" style={{ color: '#999' }}>
            No active stream from this camera. Make sure the driver camera is running.
          </Text>
        ) : (
          <Text type="secondary" style={{ color: '#666' }}>Waiting for driver stream...</Text>
        )}
      </div>
    </Card>
  )
}

export default function ManagerMonitoring() {
  const [cameras, setCameras] = useState([])
  const [loading, setLoading] = useState(true)
  const [violations, setViolations] = useState([])
  const [activeFeed, setActiveFeed] = useState(null)

  const fetchCameras = useCallback(() => {
    cameraService.getList()
      .then((res) => setCameras(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const fetchViolations = useCallback(() => {
    violationService.getList({ page_size: 20, sort_by: 'timestamp', sort_order: 'desc' })
      .then((res) => setViolations(res.data.items))
      .catch(console.error)
  }, [])

  // Initial load
  useEffect(() => {
    fetchCameras()
    fetchViolations()
  }, [fetchCameras, fetchViolations])

  // Real-time updates via WebSocket
  useRealtimeUpdates(useCallback((eventType) => {
    if (eventType === 'violation:new') {
      fetchViolations()
    }
    if (eventType === 'camera:heartbeat') {
      fetchCameras()
    }
  }, [fetchCameras, fetchViolations]))

  const getCameraEffectiveStatus = (camera) => {
    if (camera.status !== 'online') return 'offline'
    if (!camera.last_heartbeat) return 'offline'
    const secondsAgo = dayjs().diff(dayjs(camera.last_heartbeat), 'second')
    if (secondsAgo > HEARTBEAT_STALE_SECONDS) return 'stale'
    return 'online'
  }

  const onlineCameras = cameras.filter((c) => getCameraEffectiveStatus(c) === 'online')
  const otherCameras = cameras.filter((c) => getCameraEffectiveStatus(c) !== 'online')

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>Live Monitoring</Title>
        </Col>
        <Col>
          <Space>
            <Tag color="green">{onlineCameras.length} Online</Tag>
            <Tag>{otherCameras.length} Offline</Tag>
            <Button icon={<ReloadOutlined />} onClick={fetchCameras} size="small">Refresh</Button>
          </Space>
        </Col>
      </Row>

      {/* Active Feed */}
      {activeFeed && (
        <CameraFeed
          camera={activeFeed}
          onClose={() => setActiveFeed(null)}
        />
      )}

      <Row gutter={16}>
        {/* Camera Grid */}
        <Col xs={24} lg={16}>
          <Card title="Camera Grid" size="small" style={{ marginBottom: 16 }}>
            {cameras.length === 0 && !loading && (
              <Empty description="No cameras registered" />
            )}
            <Row gutter={[12, 12]}>
              {cameras.map((camera) => {
                const effectiveStatus = getCameraEffectiveStatus(camera)
                const isOnline = effectiveStatus === 'online'
                const isStale = effectiveStatus === 'stale'
                let badgeStatus = 'default'
                let statusLabel = 'Offline'
                if (isOnline) { badgeStatus = 'success'; statusLabel = 'Online' }
                else if (isStale) { badgeStatus = 'warning'; statusLabel = 'Stale' }
                return (
                  <Col xs={12} sm={8} md={6} key={camera.id}>
                    <Card
                      size="small"
                      hoverable
                      style={{
                        borderColor: isOnline ? '#52c41a' : isStale ? '#faad14' : '#d9d9d9',
                        opacity: isOnline ? 1 : isStale ? 0.8 : 0.6,
                      }}
                    >
                      <div style={{ textAlign: 'center' }}>
                        <VideoCameraOutlined style={{
                          fontSize: 32,
                          color: isOnline ? '#52c41a' : isStale ? '#faad14' : '#d9d9d9',
                          display: 'block',
                          marginBottom: 8,
                        }} />
                        <Text strong style={{ fontSize: 12, display: 'block' }}>
                          {camera.name}
                        </Text>
                        {camera.current_driver_name && (
                          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                            Driver: {camera.current_driver_name}
                          </Text>
                        )}
                        {camera.current_vehicle_plate && (
                          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                            Vehicle: {camera.current_vehicle_plate}
                          </Text>
                        )}
                        {!camera.current_driver_name && camera.vehicle_plate && (
                          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                            {camera.vehicle_plate}
                          </Text>
                        )}
                        <Badge
                          status={badgeStatus}
                          text={<Text style={{ fontSize: 11 }}>{statusLabel}</Text>}
                        />
                        {camera.last_heartbeat && (
                          <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
                            {dayjs(camera.last_heartbeat).fromNow()}
                          </Text>
                        )}
                        <Button
                          size="small"
                          type={isOnline ? 'primary' : 'default'}
                          icon={<LinkOutlined />}
                          disabled={!isOnline}
                          onClick={() => setActiveFeed(camera)}
                          style={{ marginTop: 8 }}
                          block
                        >
                          Connect
                        </Button>
                      </div>
                    </Card>
                  </Col>
                )
              })}
            </Row>
          </Card>
        </Col>

        {/* Recent Violations */}
        <Col xs={24} lg={8}>
          <Card
            title={
              <Space>
                <WarningOutlined />
                Recent Violations
              </Space>
            }
            size="small"
            style={{ maxHeight: 600, overflow: 'auto' }}
          >
            <List
              dataSource={violations}
              size="small"
              loading={loading}
              renderItem={(item) => (
                <List.Item>
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <Space size={4} wrap>
                      <Tag color={EVENT_TYPES[item.event_type]?.color} style={{ fontSize: 11 }}>
                        {EVENT_TYPES[item.event_type]?.label || item.event_type}
                      </Tag>
                      <Tag color={SEVERITY_COLORS[item.severity]} style={{ fontSize: 11 }}>
                        {item.severity}
                      </Tag>
                      {item.review_status && (
                        <Tag color={REVIEW_STATUSES[item.review_status]?.color} style={{ fontSize: 10 }}>
                          {REVIEW_STATUSES[item.review_status]?.label || item.review_status}
                        </Tag>
                      )}
                    </Space>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {item.driver_name} | {item.vehicle_plate}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 10 }}>
                      {dayjs(item.timestamp).format('MMM DD HH:mm:ss')}
                      {item.speed ? ` | ${item.speed} km/h` : ''}
                      {item.snapshot_url ? ' | Has snapshot' : ''}
                    </Text>
                  </Space>
                </List.Item>
              )}
              locale={{ emptyText: 'No violations yet' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
