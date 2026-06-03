import { useState, useEffect } from 'react'
import { Table, Card, Select, Typography, Tag, Row, Col, Badge } from 'antd'
import { vehicleService } from '@/services'

const { Title, Text } = Typography

export default function VehicleList() {
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState(null)

  useEffect(() => {
    vehicleService.getList(statusFilter ? { status: statusFilter } : {})
      .then((res) => setVehicles(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [statusFilter])

  const columns = [
    { title: 'Plate Number', dataIndex: 'plate_number', key: 'plate', sorter: (a, b) => a.plate_number.localeCompare(b.plate_number) },
    { title: 'Model', dataIndex: 'model', key: 'model' },
    { title: 'Company', dataIndex: 'company_name', key: 'company' },
    { title: 'Driver', dataIndex: 'driver_name', key: 'driver', render: (v) => v || <Tag>Unassigned</Tag> },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v) => {
        const colors = { active: 'green', maintenance: 'orange', retired: 'default' }
        return <Tag color={colors[v] || 'default'}>{v}</Tag>
      },
    },
  ]

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', paddingBottom: 40, paddingTop: 24 }}>
      <div style={{ marginBottom: 32, paddingBottom: 24, borderBottom: '1px solid #e2e8f0' }}>
        <Title level={3} style={{ margin: 0, color: '#0f172a', fontWeight: 700 }}>Fleet Vehicles</Title>
        <Text type="secondary" style={{ fontSize: 13, color: '#64748b' }}>Monitor and manage all vehicles in your fleet</Text>
      </div>

      <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)', borderRadius: 8, marginBottom: 24, background: '#ffffff' }} bodyStyle={{ padding: '20px' }}>
        <Text strong style={{ fontSize: 13, color: '#0f172a' }}>Filter by Status</Text>
        <Row gutter={[16, 16]} align="middle" style={{ marginTop: 16 }}>
          <Col xs={24} sm={12} lg={6}>
            <Select placeholder="Select status" allowClear size="large" style={{ width: '100%' }} options={[{ label: 'Active', value: 'active' }, { label: 'Maintenance', value: 'maintenance' }, { label: 'Retired', value: 'retired' }]} onChange={setStatusFilter} />
          </Col>
          <Col xs={24} lg={18}>
            <Text type="secondary" style={{ fontSize: 12 }}>Total vehicles: {vehicles.length}</Text>
          </Col>
        </Row>
      </Card>

      <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)', borderRadius: 8, overflow: 'hidden', background: '#ffffff' }} bodyStyle={{ padding: 0 }} title={<div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, fontWeight: 600, color: '#0f172a' }}><Text strong>Vehicles</Text><Badge count={vehicles.length} style={{ backgroundColor: '#1e3a8a', fontSize: 11, fontWeight: 700 }} /></div>} headStyle={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px' }}>
        <Table dataSource={vehicles} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 15, showTotal: (t) => `${t} vehicles`, position: ['bottomRight'] }} size="middle" onRow={() => ({ style: { cursor: 'pointer', transition: 'all 0.2s ease' }, onMouseEnter: (e) => e.currentTarget.style.backgroundColor = '#f1f5f9', onMouseLeave: (e) => e.currentTarget.style.backgroundColor = '' })} scroll={{ x: 1000 }} />
      </Card>
    </div>
  )
}
