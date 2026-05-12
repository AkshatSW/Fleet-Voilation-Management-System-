import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Table, Card, Select, Typography, Input, Tag, Row, Col, Badge, Space, Switch,
  Button, Modal, Form, message,
} from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import RiskBadge from '@/components/common/RiskBadge'
import { driverService, vehicleService } from '@/services'
import { usePermission } from '@/hooks/usePermission'
import { RISK_LEVELS } from '@/constants'
import useRealtimeUpdates from '@/hooks/useRealtimeUpdates'
import dayjs from 'dayjs'

const { Title, Text } = Typography
const { Search } = Input

export default function DriverList() {
  const [drivers, setDrivers] = useState([])
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [riskFilter, setRiskFilter] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const navigate = useNavigate()

  const { canEditDrivers } = usePermission()
  const [registerVisible, setRegisterVisible] = useState(false)
  const [registerLoading, setRegisterLoading] = useState(false)
  const [vehicleOptions, setVehicleOptions] = useState([])
  const [form] = Form.useForm()

  const fetchData = useCallback((showSpinner = false) => {
    if (showSpinner) setLoading(true)
    driverService.getList()
      .then((res) => {
        setDrivers(res.data)
        setLastUpdated(new Date())
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData(true) }, [fetchData])

  // Real-time updates via WebSocket
  useRealtimeUpdates(useCallback((eventType) => {
    if (eventType === 'violation:new' || eventType === 'driver:created' || eventType === 'driver:updated' || eventType === 'driver:deleted' || eventType === 'camera:created' || eventType === 'camera:deleted') {
      fetchData(false)
    }
  }, [fetchData]))

  useEffect(() => {
    if (canEditDrivers) {
      vehicleService.getList().then((res) => {
        setVehicleOptions(res.data.map((v) => ({
          label: `${v.plate_number} - ${v.model}`,
          value: v.id,
        })))
      }).catch(console.error)
    }
  }, [canEditDrivers])

  useEffect(() => {
    let result = drivers
    if (search) {
      result = result.filter((d) =>
        d.name.toLowerCase().includes(search.toLowerCase()) ||
        d.employee_id.toLowerCase().includes(search.toLowerCase())
      )
    }
    if (riskFilter) {
      result = result.filter((d) => d.risk_level === riskFilter)
    }
    setFiltered(result)
  }, [search, riskFilter, drivers])

  const handleRegisterDriver = async (values) => {
    setRegisterLoading(true)
    try {
      await driverService.create(values)
      message.success('Driver registered successfully')
      setRegisterVisible(false)
      form.resetFields()
      fetchData(true)
    } catch (err) {
      const detail = err.response?.data?.detail || 'Failed to register driver'
      message.error(detail)
    } finally {
      setRegisterLoading(false)
    }
  }

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
    { title: 'Employee ID', dataIndex: 'employee_id', key: 'eid', width: 120 },
    { title: 'Vehicle', dataIndex: 'vehicle_plate', key: 'vehicle', width: 140, render: (v) => v || '-' },
    {
      title: 'Safety Score',
      dataIndex: 'latest_score',
      key: 'score',
      width: 120,
      sorter: (a, b) => (a.latest_score || 0) - (b.latest_score || 0),
      render: (v) => {
        if (v === null || v === undefined) return '-'
        let color = '#52c41a'
        if (v < 60) color = '#f5222d'
        else if (v < 75) color = '#fa8c16'
        else if (v < 90) color = '#faad14'
        return <span style={{ color, fontWeight: 600 }}>{v}</span>
      },
    },
    {
      title: 'Risk Level',
      dataIndex: 'risk_level',
      key: 'risk',
      width: 110,
      render: (v) => v ? <RiskBadge riskLevel={v} /> : '-',
    },
    {
      title: 'Violations',
      dataIndex: 'violation_count',
      key: 'violations',
      width: 100,
      sorter: (a, b) => a.violation_count - b.violation_count,
    },
    {
      title: 'Status',
      dataIndex: 'active',
      key: 'status',
      width: 90,
      render: (v) => <Tag color={v ? 'green' : 'default'}>{v ? 'Active' : 'Inactive'}</Tag>,
    },
  ]

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', paddingBottom: 40, paddingTop: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 32, paddingBottom: 24, borderBottom: '1px solid #e2e8f0' }}>
        <Col>
          <Title level={3} style={{ margin: 0, color: '#0f172a', fontWeight: 700 }}>Driver Management</Title>
          <Text type="secondary" style={{ fontSize: 13, color: '#64748b' }}>Manage and monitor your driver fleet</Text>
        </Col>
        <Col>
          <Space size="large">
            {canEditDrivers && (
              <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setRegisterVisible(true)} style={{ borderRadius: 8, fontWeight: 600, background: '#1e3a8a', border: 'none' }}>
                Register Driver
              </Button>
            )}
            {lastUpdated && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#ffffff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }}></div>
                <Text type="secondary" style={{ fontSize: 12 }}>Updated {dayjs(lastUpdated).format('HH:mm:ss')}</Text>
              </div>
            )}
          </Space>
        </Col>
      </Row>

      <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)', borderRadius: 8, marginBottom: 24, background: '#ffffff' }} bodyStyle={{ padding: '20px' }}>
        <Text strong style={{ fontSize: 13, color: '#0f172a' }}>Filters & Search</Text>
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} sm={12} md={6}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input placeholder="Search by name or employee ID" allowClear onPressEnter={(e) => setSearch(e.target.value)} onChange={(e) => !e.target.value && setSearch('')} style={{ borderRadius: 8, height: 32, textAlign: 'center' }} size="small" />
              <Button type="primary" icon={<SearchOutlined />} onClick={() => {}} style={{ height: 32, width: 32, borderRadius: 8, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
            </div>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Select placeholder="Risk Level" allowClear style={{ width: '100%' }} options={Object.keys(RISK_LEVELS).map((k) => ({ label: k, value: k }))} onChange={setRiskFilter} size="small" />
          </Col>
          <Col xs={24} md={14} style={{ display: 'flex', alignItems: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Showing {filtered.length} of {drivers.length} drivers</Text>
          </Col>
        </Row>
      </Card>

      <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)', borderRadius: 8, overflow: 'hidden', background: '#ffffff' }} bodyStyle={{ padding: 0 }} title={<div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, fontWeight: 600, color: '#0f172a' }}><Text strong>Drivers</Text><Badge count={filtered.length} style={{ backgroundColor: '#1e3a8a', fontSize: 11, fontWeight: 700 }} /></div>} headStyle={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px' }}>
        <Table dataSource={filtered} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 15, showTotal: (t) => `${t} drivers`, position: ['bottomRight'] }} onRow={(record) => ({ onClick: () => navigate(`/drivers/${record.id}`), style: { cursor: 'pointer' }, onMouseEnter: (e) => e.currentTarget.style.backgroundColor = '#f1f5f9', onMouseLeave: (e) => e.currentTarget.style.backgroundColor = '' })} size="middle" scroll={{ x: 1000 }} />
      </Card>

      <Modal
        title="Register New Driver"
        open={registerVisible}
        onCancel={() => { setRegisterVisible(false); form.resetFields() }}
        footer={null}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleRegisterDriver}
          initialValues={{ active: true }}
        >
          <Form.Item
            name="name"
            label="Full Name"
            rules={[{ required: true, message: 'Please enter driver name' }]}
          >
            <Input placeholder="e.g. Ahmed Al-Mansouri" />
          </Form.Item>
          <Form.Item
            name="employee_id"
            label="Employee ID"
            rules={[{ required: true, message: 'Please enter employee ID' }]}
          >
            <Input placeholder="e.g. EMP-001" />
          </Form.Item>
          <Form.Item name="vehicle_id" label="Assigned Vehicle">
            <Select
              placeholder="Select vehicle (optional)"
              allowClear
              showSearch
              filterOption={(input, opt) => opt.label.toLowerCase().includes(input.toLowerCase())}
              options={vehicleOptions}
            />
          </Form.Item>
          <Form.Item name="country" label="Country">
            <Input placeholder="e.g. UAE" />
          </Form.Item>
          <Card size="small" title="Driver Login Account (Optional)" style={{ marginBottom: 16 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
              Create a login account so this driver can access the camera page directly.
            </Text>
            <Form.Item name="username" label="Username">
              <Input placeholder="e.g. driver1" />
            </Form.Item>
            <Form.Item name="password" label="Password">
              <Input.Password placeholder="e.g. driver123" />
            </Form.Item>
          </Card>
          <Form.Item name="active" label="Active" valuePropName="checked">
            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={registerLoading}>
                Register
              </Button>
              <Button onClick={() => { setRegisterVisible(false); form.resetFields() }}>
                Cancel
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
