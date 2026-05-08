import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Descriptions, Spin, Button, Typography, Tag, Space, Row, Col, Image } from 'antd'
import { ArrowLeftOutlined, VideoCameraOutlined, EnvironmentOutlined, CameraOutlined } from '@ant-design/icons'
import EventTypeTag from '@/components/common/EventTypeTag'
import SeverityTag from '@/components/common/SeverityTag'
import ReviewWorkflow from '@/components/violations/ReviewWorkflow'
import { violationService } from '@/services'
import { REVIEW_STATUSES } from '@/constants'
import dayjs from 'dayjs'

const { Title, Text } = Typography

export default function ViolationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [violation, setViolation] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    violationService.getById(id)
      .then((res) => setViolation(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div style={{ textAlign: 'center', paddingTop: 100 }}><Spin size="large" /></div>
  if (!violation) return <Text>Violation not found</Text>

  const reviewStatus = REVIEW_STATUSES[violation.review_status] || REVIEW_STATUSES.pending

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/violations')}>Back</Button>
        <Title level={4} style={{ margin: 0 }}>Violation #{violation.id}</Title>
        <Tag color={reviewStatus.color}>{reviewStatus.label}</Tag>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title="Violation Details" style={{ marginBottom: 16 }}>
            <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
              <Descriptions.Item label="Event Type"><EventTypeTag eventType={violation.event_type} /></Descriptions.Item>
              <Descriptions.Item label="Severity"><SeverityTag severity={violation.severity} /></Descriptions.Item>
              <Descriptions.Item label="Penalty Points"><Text strong>{violation.penalty_points}</Text></Descriptions.Item>
              <Descriptions.Item label="Speed">{violation.speed ? `${violation.speed} km/h` : 'N/A'}</Descriptions.Item>
              <Descriptions.Item label="Timestamp">{dayjs(violation.timestamp).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
              <Descriptions.Item label="Created">{dayjs(violation.created_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
              <Descriptions.Item label="Driver">
                <a onClick={() => navigate(`/drivers/${violation.driver_id}`)}>{violation.driver_name}</a>
              </Descriptions.Item>
              <Descriptions.Item label="Vehicle">{violation.vehicle_plate}</Descriptions.Item>
              <Descriptions.Item label="Review Status">
                <Tag color={reviewStatus.color}>{reviewStatus.label}</Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Evidence Card */}
          <Card title={<><CameraOutlined /> Evidence</>} style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>Snapshot</Text>
                {violation.snapshot_url ? (
                  <Image
                    src={violation.snapshot_url}
                    alt="Violation snapshot"
                    style={{ borderRadius: 8, maxWidth: '100%' }}
                    fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                  />
                ) : (
                  <div style={{
                    padding: 32,
                    background: '#fafafa',
                    borderRadius: 8,
                    textAlign: 'center',
                    border: '1px dashed #d9d9d9',
                  }}>
                    <Text type="secondary">No snapshot available</Text>
                  </div>
                )}
              </Col>
              <Col xs={24} md={12}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>Video Clip</Text>
                {violation.clip_url ? (
                  <video
                    controls
                    style={{ width: '100%', borderRadius: 8, background: '#000' }}
                    src={violation.clip_url}
                  >
                    Your browser does not support video playback.
                  </video>
                ) : violation.video_url ? (
                  <Button type="link" href={violation.video_url} target="_blank" icon={<VideoCameraOutlined />}>
                    View Video Clip
                  </Button>
                ) : (
                  <div style={{
                    padding: 32,
                    background: '#fafafa',
                    borderRadius: 8,
                    textAlign: 'center',
                    border: '1px dashed #d9d9d9',
                  }}>
                    <Text type="secondary">No video clip available</Text>
                  </div>
                )}
              </Col>
            </Row>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          {/* Review Workflow */}
          <div style={{ marginBottom: 16 }}>
            <ReviewWorkflow
              violation={violation}
              onUpdate={(updated) => setViolation(updated)}
            />
          </div>

          <Card title={<><EnvironmentOutlined /> Location</>} style={{ marginBottom: 16 }}>
            {violation.latitude && violation.longitude ? (
              <div>
                <Text>Lat: {violation.latitude}</Text><br />
                <Text>Lng: {violation.longitude}</Text>
                <div style={{
                  marginTop: 12,
                  padding: 24,
                  background: '#f0f5ff',
                  borderRadius: 8,
                  textAlign: 'center',
                  color: '#999',
                }}>
                  Map view coming soon
                </div>
              </div>
            ) : (
              <Text type="secondary">Location data not available</Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
