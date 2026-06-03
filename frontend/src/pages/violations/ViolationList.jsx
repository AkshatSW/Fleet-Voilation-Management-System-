import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Card, Select, DatePicker, Typography, Button, Row, Col, Badge, Space, Tag, Tooltip, Input } from 'antd'
import {
  VideoCameraOutlined,
  CameraOutlined,
  SearchOutlined,
  FilterOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import EventTypeTag from '@/components/common/EventTypeTag'
import SeverityTag from '@/components/common/SeverityTag'
import { violationService } from '@/services'
import { EVENT_TYPES, REVIEW_STATUSES } from '@/constants'
import useRealtimeUpdates from '@/hooks/useRealtimeUpdates'
import dayjs from 'dayjs'

const { Title, Text, Paragraph } = Typography
const { RangePicker } = DatePicker

export default function ViolationList() {
  const [violations, setViolations] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [params, setParams] = useState({ page: 1, page_size: 20 })
  const [lastUpdated, setLastUpdated] = useState(null)
  const navigate = useNavigate()
  const paramsRef = useRef(params)

  useEffect(() => { paramsRef.current = params }, [params])

  const fetchData = useCallback((p, showSpinner = false) => {
    if (showSpinner) setLoading(true)
    const query = { ...(p || paramsRef.current) }
    if (query.date_range) {
      query.date_from = query.date_range[0].format('YYYY-MM-DD')
      query.date_to = query.date_range[1].format('YYYY-MM-DD')
      delete query.date_range
    }
    violationService.getList(query)
      .then((res) => {
        // Filter to only show violations from drivers with cameras assigned
        const filteredViolations = res.data.items.filter((v) => v.driver_name && v.vehicle_plate)
        setViolations(filteredViolations)
        setTotal(filteredViolations.length)
        setLastUpdated(new Date())
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData(params, true) }, [])

  // Real-time updates via WebSocket
  useRealtimeUpdates(useCallback((eventType) => {
    if (eventType === 'violation:new' || eventType === 'driver:created' || eventType === 'driver:updated' || eventType === 'driver:deleted' || eventType === 'camera:created' || eventType === 'camera:deleted') {
      fetchData(null, false)
    }
  }, [fetchData]))

  const handleFilter = (key, value) => {
    const next = { ...params, [key]: value || undefined, page: 1 }
    setParams(next)
    fetchData(next, true)
  }

  const handleTableChange = (pagination, _filters, sorter) => {
    const next = {
      ...params,
      page: pagination.current,
      page_size: pagination.pageSize,
      sort_by: sorter.field || 'timestamp',
      sort_order: sorter.order === 'ascend' ? 'asc' : 'desc',
    }
    setParams(next)
    fetchData(next, true)
  }

  const columns = [
    {
      title: 'Media',
      key: 'media',
      width: 100,
      render: (_, record) => (
        <Space size={8}>
          {record.snapshot_url ? (
            <Tooltip title="Click to view full detail">
              <div
                style={{
                  position: 'relative',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  borderRadius: '8px',
                  boxShadow: '0 4px 8px rgba(0, 0, 0, 0.15)',
                  transition: 'all 0.3s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)'
                  e.currentTarget.style.boxShadow = '0 8px 16px rgba(0, 0, 0, 0.25)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)'
                  e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.15)'
                }}
                onClick={() => navigate(`/violations/${record.id}`)}
              >
                <img
                  src={record.snapshot_url}
                  alt="snapshot"
                  style={{
                    width: 50,
                    height: 32,
                    objectFit: 'cover',
                    display: 'block',
                  }}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              </div>
            </Tooltip>
          ) : (
            <Tooltip title="No snapshot">
              <div style={{
                width: 50,
                height: 32,
                borderRadius: '8px',
                background: '#f0f0f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <CameraOutlined style={{ color: '#d9d9d9', fontSize: 16 }} />
              </div>
            </Tooltip>
          )}
          {record.clip_url ? (
            <Tooltip title="Video available">
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 8px rgba(59, 130, 246, 0.3)',
              }}>
                <VideoCameraOutlined style={{ color: '#fff', fontSize: 14 }} />
              </div>
            </Tooltip>
          ) : (
            <Tooltip title="No video">
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '8px',
                background: '#f0f0f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <VideoCameraOutlined style={{ color: '#d9d9d9', fontSize: 14 }} />
              </div>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Time',
      dataIndex: 'timestamp',
      key: 'timestamp',
      sorter: true,
      render: (v) => (
        <div>
          <Text strong style={{ color: '#0f172a' }}>
            {dayjs(v).format('HH:mm:ss')}
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {dayjs(v).format('MMM DD, YYYY')}
          </Text>
        </div>
      ),
      width: 140,
    },
    {
      title: 'Driver',
      dataIndex: 'driver_name',
      key: 'driver',
      render: (text) => <Text strong style={{ color: '#0f172a' }}>{text}</Text>,
    },
    {
      title: 'Vehicle',
      dataIndex: 'vehicle_plate',
      key: 'vehicle',
      render: (plate) => (
        <Tag color="#1677ff" style={{ fontSize: 12, fontWeight: 600 }}>
          {plate}
        </Tag>
      ),
      width: 120,
    },
    {
      title: 'Event',
      dataIndex: 'event_type',
      key: 'type',
      render: (v) => <EventTypeTag eventType={v} />,
    },
    {
      title: 'Severity',
      dataIndex: 'severity',
      key: 'severity',
      render: (v) => <SeverityTag severity={v} />,
      sorter: true,
    },
    {
      title: 'Points',
      dataIndex: 'penalty_points',
      key: 'points',
      render: (points) => (
        <Badge
          count={points}
          style={{
            backgroundColor: points >= 12 ? '#dc2626' : points >= 6 ? '#f59e0b' : '#10b981',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.15)',
            fontWeight: 600,
          }}
        />
      ),
      width: 70,
      sorter: true,
    },
    {
      title: 'Speed',
      dataIndex: 'speed',
      key: 'speed',
      render: (v) => v ? (
        <div>
          <Text strong style={{ color: '#ef4444' }}>{v}</Text>
          <Text type="secondary" style={{ marginLeft: 4 }}>km/h</Text>
        </div>
      ) : '-',
      width: 90,
    },
    {
      title: 'Status',
      dataIndex: 'review_status',
      key: 'review_status',
      width: 120,
      render: (v) => {
        const rs = REVIEW_STATUSES[v] || REVIEW_STATUSES.pending
        return (
          <Tag
            color={rs.color}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 12px',
              borderRadius: '16px',
            }}
          >
            {rs.label}
          </Tag>
        )
      },
    },
  ]

  const eventTypeOptions = Object.entries(EVENT_TYPES).map(([key, val]) => ({
    label: val.label,
    value: key,
  }))

  const hasFilters = params.event_type || params.severity || params.review_status || params.date_range

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', paddingBottom: 40, paddingTop: 24 }}>
      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 32, paddingBottom: 24, borderBottom: '1px solid #e2e8f0' }}>
        <Col>
          <Title level={3} style={{ margin: 0, color: '#0f172a', fontWeight: 700 }}>Violation Events</Title>
          <Text type="secondary" style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Track and review all detected violations</Text>
        </Col>
        <Col>
          <Space>
            {lastUpdated && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                background: '#ffffff',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
              }}>
                <ReloadOutlined style={{ fontSize: 14, color: '#64748b' }} />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {dayjs(lastUpdated).format('HH:mm:ss')}
                </Text>
              </div>
            )}
            <Badge status="success" text={<Text style={{ fontSize: 12, color: '#64748b' }}>Live</Text>} />
          </Space>
        </Col>
      </Row>

      {/* Filters Card */}
      <Card
        style={{
          border: 'none',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          borderRadius: 8,
          marginBottom: 24,
          background: '#ffffff',
        }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FilterOutlined style={{ color: '#64748b', fontSize: 16 }} />
            <Text strong style={{ fontSize: 14, color: '#0f172a' }}>Filters</Text>
            {hasFilters && (
              <Badge count={Object.keys(params).filter(k => params[k] && k !== 'page' && k !== 'page_size').length} style={{ backgroundColor: '#1e3a8a' }} />
            )}
          </div>
        }
        bodyStyle={{ padding: '20px' }}
        headStyle={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px' }}
      >
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} sm={12} lg={4}>
            <Select placeholder="Event Type" allowClear size="large" options={eventTypeOptions} onChange={(v) => handleFilter('event_type', v)} style={{ borderRadius: 8 }} />
          </Col>
          <Col xs={24} sm={12} lg={4}>
            <Select placeholder="Severity" allowClear size="large" options={[{ label: 'Low', value: 'low' }, { label: 'Medium', value: 'medium' }, { label: 'High', value: 'high' }, { label: 'Critical', value: 'critical' }]} onChange={(v) => handleFilter('severity', v)} style={{ borderRadius: 8 }} />
          </Col>
          <Col xs={24} sm={12} lg={4}>
            <Select placeholder="Review Status" allowClear size="large" options={Object.entries(REVIEW_STATUSES).map(([key, val]) => ({ label: val.label, value: key }))} onChange={(v) => handleFilter('review_status', v)} style={{ borderRadius: 8 }} />
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <RangePicker style={{ width: '100%', borderRadius: 8 }} onChange={(dates) => handleFilter('date_range', dates)} />
          </Col>
          <Col xs={24} sm={12} lg={4} style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button block size="large" onClick={() => { const r = { page: 1, page_size: 20 }; setParams(r); fetchData(r, true); }} style={{ borderRadius: 8 }}>
              Clear
            </Button>
          </Col>
        </Row>
      </Card>

      {/* Data Summary */}
      {total > 0 && (
        <Row style={{ marginBottom: 16 }}>
          <Col>
            <div style={{ padding: '12px 16px', background: '#f1f5f9', borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text strong style={{ color: '#0f172a' }}>{total}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>violations in system</Text>
            </div>
          </Col>
        </Row>
      )}

      {/* Data Table */}
      <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)', borderRadius: 8, background: '#ffffff' }} bodyStyle={{ padding: 0 }} title={<div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, fontWeight: 600, color: '#0f172a' }}><Text strong>Violations</Text><Badge count={violations.length} style={{ backgroundColor: '#1e3a8a', fontSize: 11, fontWeight: 700 }} /></div>} headStyle={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px' }}>
        <Table
          dataSource={violations}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: params.page,
            pageSize: params.page_size,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            showTotal: (t, range) => `${range[0]}-${range[1]} of ${t}`,
            style: { marginRight: 16, marginBottom: 16 },
          }}
          onChange={handleTableChange}
          onRow={(record) => ({
            onClick: () => navigate(`/violations/${record.id}`),
            style: {
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            },
            onMouseEnter: (e) => {
              e.currentTarget.style.backgroundColor = '#f1f5f9'
            },
            onMouseLeave: (e) => {
              e.currentTarget.style.backgroundColor = ''
            },
          })}
          size="middle"
          scroll={{ x: 1200 }}
        />
      </Card>
    </div>
  )
}
