import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Descriptions, Table, Spin, Button, Typography, Row, Col, Tag, Space, message } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import RiskBadge from '@/components/common/RiskBadge'
import EventTypeTag from '@/components/common/EventTypeTag'
import SeverityTag from '@/components/common/SeverityTag'
import ScoreTrendChart from '@/components/charts/ScoreTrendChart'
import StatCard from '@/components/common/StatCard'
import { driverService } from '@/services'
import { SafetyCertificateOutlined, WarningOutlined } from '@ant-design/icons'
import useRealtimeUpdates from '@/hooks/useRealtimeUpdates'
import dayjs from 'dayjs'

const { Title, Text } = Typography

export default function DriverDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [driver, setDriver] = useState(null)
  const [scores, setScores] = useState([])
  const [violations, setViolations] = useState([])
  const [violationTotal, setViolationTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const fetchDriver = useCallback(() => {
    return Promise.all([
      driverService.getById(id),
      driverService.getScores(id),
      driverService.getViolations(id, { page: 1, page_size: 10 }),
    ])
      .then(([driverRes, scoresRes, violationsRes]) => {
        setDriver(driverRes.data)
        setScores(scoresRes.data)
        setViolations(violationsRes.data.items)
        setViolationTotal(violationsRes.data.total)
        setPage(1)
      })
      .catch((err) => {
        console.error('Failed to fetch driver:', err)
        message.error('Failed to load driver data')
        throw err
      })
  }, [id])

  useEffect(() => {
    setLoading(true)
    fetchDriver()
      .finally(() => setLoading(false))
  }, [fetchDriver])

  const loadViolations = (p) => {
    setPage(p)
    driverService.getViolations(id, { page: p, page_size: 10 })
      .then((res) => {
        setViolations(res.data.items)
        setViolationTotal(res.data.total)
      })
  }

  // Real-time updates: refresh when driver is updated or navigate back if deleted
  useRealtimeUpdates(useCallback((eventType, eventData) => {
    if (eventType === 'driver:updated') {
      fetchDriver()
    } else if (eventType === 'driver:deleted' && eventData?.driver_id === parseInt(id)) {
      message.warning('This driver has been deleted')
      navigate('/drivers')
    }
  }, [id, fetchDriver, navigate]))

  if (loading) return <div style={{ textAlign: 'center', paddingTop: 100 }}><Spin size="large" /></div>
  if (!driver) return <Text>Driver not found</Text>

  const violationColumns = [
    { title: 'Time', dataIndex: 'timestamp', key: 'time', render: (v) => dayjs(v).format('MMM DD, HH:mm'), width: 130 },
    { title: 'Type', dataIndex: 'event_type', key: 'type', render: (v) => <EventTypeTag eventType={v} /> },
    { title: 'Severity', dataIndex: 'severity', key: 'severity', render: (v) => <SeverityTag severity={v} /> },
    { title: 'Points', dataIndex: 'penalty_points', key: 'points', width: 70 },
    { title: 'Speed', dataIndex: 'speed', key: 'speed', width: 90, render: (v) => v ? `${v} km/h` : '-' },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/drivers')}>Back</Button>
        <Title level={4} style={{ margin: 0 }}>{driver.name}</Title>
        <Tag color={driver.active ? 'green' : 'default'}>{driver.active ? 'Active' : 'Inactive'}</Tag>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="Safety Score"
            value={driver.latest_score ?? 'N/A'}
            icon={<SafetyCertificateOutlined />}
            color={driver.latest_score >= 75 ? '#52c41a' : '#f5222d'}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Text type="secondary">Risk Level</Text>
            <div style={{ marginTop: 8 }}>
              <RiskBadge riskLevel={driver.risk_level || 'N/A'} />
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="Total Violations"
            value={driver.violation_count}
            icon={<WarningOutlined />}
            color="#fa8c16"
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Employee ID">{driver.employee_id}</Descriptions.Item>
              <Descriptions.Item label="Vehicle">{driver.vehicle_plate || 'Unassigned'}</Descriptions.Item>
              <Descriptions.Item label="Country">{driver.country}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card title="Safety Score Trend">
            <div style={{ height: 300 }}>
              <ScoreTrendChart data={scores} />
            </div>
          </Card>
        </Col>
      </Row>

      <Row style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card title="Violation History">
            <Table
              dataSource={violations}
              columns={violationColumns}
              rowKey="id"
              pagination={{
                current: page,
                pageSize: 10,
                total: violationTotal,
                showTotal: (t) => `${t} violations`,
              }}
              onChange={(pagination) => loadViolations(pagination.current)}
              onRow={(record) => ({
                onClick: () => navigate(`/violations/${record.id}`),
                style: { cursor: 'pointer' },
              })}
              size="small"
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
