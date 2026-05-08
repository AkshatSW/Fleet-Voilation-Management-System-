import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Card, Select, DatePicker, Typography, Button, Row, Col, Badge, Space, Tag } from 'antd'
import EventTypeTag from '@/components/common/EventTypeTag'
import SeverityTag from '@/components/common/SeverityTag'
import { violationService } from '@/services'
import { EVENT_TYPES, REVIEW_STATUSES } from '@/constants'
import useRealtimeUpdates from '@/hooks/useRealtimeUpdates'
import dayjs from 'dayjs'

const { Title, Text } = Typography
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
        setViolations(res.data.items)
        setTotal(res.data.total)
        setLastUpdated(new Date())
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData(params, true) }, [])

  // Real-time updates via WebSocket
  useRealtimeUpdates(useCallback((eventType) => {
    if (eventType === 'violation:new') {
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
      title: 'Timestamp',
      dataIndex: 'timestamp',
      key: 'timestamp',
      sorter: true,
      render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
      width: 175,
    },
    { title: 'Driver', dataIndex: 'driver_name', key: 'driver' },
    { title: 'Vehicle', dataIndex: 'vehicle_plate', key: 'vehicle', width: 130 },
    { title: 'Event Type', dataIndex: 'event_type', key: 'type', render: (v) => <EventTypeTag eventType={v} /> },
    { title: 'Severity', dataIndex: 'severity', key: 'severity', render: (v) => <SeverityTag severity={v} />, sorter: true },
    { title: 'Points', dataIndex: 'penalty_points', key: 'points', width: 80, sorter: true },
    {
      title: 'Speed',
      dataIndex: 'speed',
      key: 'speed',
      width: 90,
      render: (v) => v ? `${v} km/h` : '-',
    },
    {
      title: 'Review',
      dataIndex: 'review_status',
      key: 'review_status',
      width: 130,
      render: (v) => {
        const rs = REVIEW_STATUSES[v] || REVIEW_STATUSES.pending
        return <Tag color={rs.color}>{rs.label}</Tag>
      },
    },
  ]

  const eventTypeOptions = Object.entries(EVENT_TYPES).map(([key, val]) => ({
    label: val.label,
    value: key,
  }))

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>Violations</Title>
        </Col>
        <Col>
          <Space>
            {lastUpdated && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Updated {dayjs(lastUpdated).format('HH:mm:ss')}
              </Text>
            )}
            <Badge status="success" text={<Text style={{ fontSize: 12 }}>Live</Text>} />
          </Space>
        </Col>
      </Row>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]}>
          <Col>
            <Select
              placeholder="Event Type"
              allowClear
              style={{ width: 160 }}
              options={eventTypeOptions}
              onChange={(v) => handleFilter('event_type', v)}
            />
          </Col>
          <Col>
            <Select
              placeholder="Severity"
              allowClear
              style={{ width: 130 }}
              options={[
                { label: 'Low', value: 'low' },
                { label: 'Medium', value: 'medium' },
                { label: 'High', value: 'high' },
                { label: 'Critical', value: 'critical' },
              ]}
              onChange={(v) => handleFilter('severity', v)}
            />
          </Col>
          <Col>
            <Select
              placeholder="Review Status"
              allowClear
              style={{ width: 150 }}
              options={Object.entries(REVIEW_STATUSES).map(([key, val]) => ({
                label: val.label,
                value: key,
              }))}
              onChange={(v) => handleFilter('review_status', v)}
            />
          </Col>
          <Col>
            <RangePicker
              onChange={(dates) => handleFilter('date_range', dates)}
            />
          </Col>
          <Col>
            <Button onClick={() => { const r = { page: 1, page_size: 20 }; setParams(r); fetchData(r, true) }}>
              Clear Filters
            </Button>
          </Col>
        </Row>
      </Card>
      <Card>
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
            showTotal: (t) => `${t} violations`,
          }}
          onChange={handleTableChange}
          onRow={(record) => ({
            onClick: () => navigate(`/violations/${record.id}`),
            style: { cursor: 'pointer' },
          })}
          size="middle"
        />
      </Card>
    </div>
  )
}
