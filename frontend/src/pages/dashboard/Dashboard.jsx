import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Row, Col, Card, Table, Spin, Typography, Badge, Space, Divider } from 'antd'
import {
  WarningOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
  AlertOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import StatCard from '@/components/common/StatCard'
import RiskBadge from '@/components/common/RiskBadge'
import EventTypeTag from '@/components/common/EventTypeTag'
import SeverityTag from '@/components/common/SeverityTag'
import ViolationTrendChart from '@/components/charts/ViolationTrendChart'
import ViolationTypeChart from '@/components/charts/ViolationTypeChart'
import RiskDistributionChart from '@/components/charts/RiskDistributionChart'
import { dashboardService } from '@/services'
import useRealtimeUpdates from '@/hooks/useRealtimeUpdates'
import dayjs from 'dayjs'

const { Title, Text, Paragraph } = Typography

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const navigate = useNavigate()

  const fetchData = useCallback((showSpinner = false) => {
    if (showSpinner) setLoading(true)
    dashboardService.getData()
      .then((res) => {
        const rawData = res.data
        // Filter to only show data from drivers with cameras assigned (active drivers)
        if (rawData.recent_violations) {
          rawData.recent_violations = rawData.recent_violations.filter((v) => v.driver_name && v.vehicle_plate)
        }
        if (rawData.top_violators) {
          rawData.top_violators = rawData.top_violators.filter((v) => v.driver_name && v.driver_name.trim())
        }
        setData(rawData)
        setLastUpdated(new Date())
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Initial load
  useEffect(() => {
    fetchData(true)
  }, [fetchData])

  // Real-time updates via WebSocket
  useRealtimeUpdates(useCallback((eventType) => {
    if (eventType === 'violation:new' || eventType === 'driver:created' || eventType === 'driver:updated' || eventType === 'driver:deleted' || eventType === 'camera:created' || eventType === 'camera:deleted') {
      fetchData(false)
    }
  }, [fetchData]))

  if (loading && !data) {
    return <div style={{ textAlign: 'center', paddingTop: 100 }}><Spin size="large" /></div>
  }

  if (!data) return null

  const { overview, violation_trend, violations_by_type, risk_distribution, top_violators, recent_violations } = data

  const topViolatorColumns = [
    {
      title: 'Driver',
      dataIndex: 'driver_name',
      key: 'name',
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: 'Violations',
      dataIndex: 'violation_count',
      key: 'count',
      sorter: (a, b) => a.violation_count - b.violation_count,
      render: (count) => <Badge count={count} style={{ backgroundColor: '#ff7a00' }} />,
    },
    {
      title: 'Safety Score',
      dataIndex: 'safety_score',
      key: 'score',
      render: (score) => {
        let color = '#10b981'
        if (score < 50) color = '#ef4444'
        else if (score < 75) color = '#f59e0b'
        return <Text strong style={{ color }}>{score}</Text>
      },
    },
    {
      title: 'Risk Level',
      dataIndex: 'risk_level',
      key: 'risk',
      render: (v) => <RiskBadge riskLevel={v} />,
    },
  ]

  const recentColumns = [
    {
      title: 'Time',
      dataIndex: 'timestamp',
      key: 'time',
      render: (v) => <Text type="secondary">{dayjs(v).format('MMM DD, HH:mm:ss')}</Text>,
      width: 150,
    },
    {
      title: 'Driver',
      dataIndex: 'driver_name',
      key: 'driver',
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: 'Type',
      dataIndex: 'event_type',
      key: 'type',
      render: (v) => <EventTypeTag eventType={v} />,
    },
    {
      title: 'Severity',
      dataIndex: 'severity',
      key: 'severity',
      render: (v) => <SeverityTag severity={v} />,
    },
    {
      title: 'Points',
      dataIndex: 'penalty_points',
      key: 'points',
      width: 70,
      render: (points) => <Badge count={points} style={{ backgroundColor: '#dc2626' }} />,
    },
  ]

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', paddingBottom: 40, paddingTop: 24 }}>
      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 32, paddingBottom: 24, borderBottom: '1px solid #e2e8f0' }}>
        <Col>
          <Title level={3} style={{ margin: 0, color: '#0f172a', fontWeight: 700, letterSpacing: '0.3px' }}>Fleet Dashboard</Title>
          <Text type="secondary" style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>Real-time monitoring and analytics</Text>
        </Col>
        <Col>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8, 
            padding: '10px 16px', 
            background: '#ffffff', 
            borderRadius: 6, 
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)',
            transition: 'all 0.3s ease',
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px rgba(16, 185, 129, 0.5)' }}></div>
            <Text style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>Live Monitoring</Text>
          </div>
        </Col>
      </Row>

      {/* KPI Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="Violations This Month" value={overview.total_violations_this_month} icon={<WarningOutlined />} color="#1677ff" trend={overview.violations_change_pct} trendLabel="vs last month" />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="Active Drivers" value={overview.active_drivers} icon={<TeamOutlined />} color="#1677ff" />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="Fleet Safety Score" value={overview.average_fleet_score} suffix="/100" icon={<SafetyCertificateOutlined />} color="#52c41a" />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="Critical Risk Drivers" value={overview.critical_risk_drivers} icon={<AlertOutlined />} color="#f5222d" />
        </Col>
      </Row>

      {/* Charts Section */}
      <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
        <Col xs={24} lg={16}>
          <Card style={{ border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)', borderRadius: 8, background: '#ffffff', transition: 'all 0.3s ease' }} title={<Text strong style={{ fontSize: 15, color: '#0f172a', fontWeight: 700 }}>Violation Trend (Last 30 Days)</Text>} headStyle={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', borderBottom: '1px solid #e2e8f0', padding: '16px 24px' }} bodyStyle={{ padding: 24 }}>
            <div style={{ height: 300, borderRadius: 8 }}><ViolationTrendChart data={violation_trend} /></div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card style={{ border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)', borderRadius: 8, background: '#ffffff', transition: 'all 0.3s ease' }} title={<Text strong style={{ fontSize: 15, color: '#0f172a', fontWeight: 700 }}>Violations by Type</Text>} headStyle={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', borderBottom: '1px solid #e2e8f0', padding: '16px 24px' }} bodyStyle={{ padding: 24 }}>
            <div style={{ height: 300, borderRadius: 8 }}><ViolationTypeChart data={violations_by_type} /></div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
        <Col xs={24} lg={12}>
          <Card style={{ border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)', borderRadius: 8, background: '#ffffff', transition: 'all 0.3s ease' }} title={<Text strong style={{ fontSize: 15, color: '#0f172a', fontWeight: 700 }}>Risk Distribution</Text>} headStyle={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', borderBottom: '1px solid #e2e8f0', padding: '16px 24px' }} bodyStyle={{ padding: 24 }}>
            <div style={{ height: 300, borderRadius: 8 }}><RiskDistributionChart data={risk_distribution} /></div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card style={{ border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)', borderRadius: 8, background: '#ffffff', transition: 'all 0.3s ease' }} title={<Text strong style={{ fontSize: 15, color: '#0f172a', fontWeight: 700 }}>Top Violators</Text>} headStyle={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', borderBottom: '1px solid #e2e8f0', padding: '16px 24px' }} bodyStyle={{ padding: 24 }}>
            <Table dataSource={top_violators} columns={topViolatorColumns} rowKey="driver_id" pagination={false} size="middle" onRow={(record) => ({ onClick: () => navigate(`/drivers/${record.driver_id}`), style: { cursor: 'pointer' }, onMouseEnter: (e) => e.currentTarget.style.backgroundColor = '#f8fafc', onMouseLeave: (e) => e.currentTarget.style.backgroundColor = '' })} />
          </Card>
        </Col>
      </Row>

      {/* Recent Violations */}
      <Card style={{ border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)', borderRadius: 8, background: '#ffffff', transition: 'all 0.3s ease' }} title={<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Text strong style={{ fontSize: 15, color: '#0f172a', fontWeight: 700 }}>Recent Violations</Text><Badge count={recent_violations.length} style={{ backgroundColor: '#1e3a8a', fontSize: 11, fontWeight: 700 }} /></div>} headStyle={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', borderBottom: '1px solid #e2e8f0', padding: '16px 24px' }} bodyStyle={{ padding: 0 }}>
        <Table dataSource={recent_violations} columns={recentColumns} rowKey="id" pagination={{ pageSize: 10, showTotal: (t) => `${t} total` }} size="middle" onRow={(record) => ({ onClick: () => navigate(`/violations/${record.id}`), style: { cursor: 'pointer' }, onMouseEnter: (e) => e.currentTarget.style.backgroundColor = '#f8fafc', onMouseLeave: (e) => e.currentTarget.style.backgroundColor = '' })} />
      </Card>
    </div>
  )
}
