import { useState, useEffect } from 'react'
import {
  Table, Card, Button, Modal, Form, Input, Select, Typography, Tag,
  Row, Col, Space, message, Tooltip, Badge, Descriptions, Popconfirm,
} from 'antd'
import {
  PlusOutlined, CopyOutlined, DeleteOutlined,
  ReloadOutlined, VideoCameraOutlined,
} from '@ant-design/icons'
import { cameraService, vehicleService } from '@/services'
import { CAMERA_TYPES, CAMERA_STATUSES, DEMO_WEBCAM_KEY } from '@/constants'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const { Title, Text, Paragraph } = Typography

function ConnectionInfo({ camera }) {
  const webhookUrl = `${window.location.origin}/api/webhook/violation`

  const curlSnippet = `curl -X POST ${webhookUrl} \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${camera.api_key}" \\
  -d '{
    "driver_id": 1,
    "vehicle_id": 1,
    "event_type": "overspeed",
    "severity": "high",
    "timestamp": "${new Date().toISOString().slice(0, 19)}",
    "camera_id": ${camera.id},
    "speed": 140
  }'`

  const pythonSnippet = `import requests

response = requests.post(
    "${webhookUrl}",
    json={
        "driver_id": 1,
        "vehicle_id": 1,
        "event_type": "overspeed",
        "severity": "high",
        "timestamp": "${new Date().toISOString().slice(0, 19)}",
        "camera_id": ${camera.id},
        "speed": 140,
    },
    headers={
        "X-API-Key": "${camera.api_key}",
        "Content-Type": "application/json",
    },
)
print(response.json())`

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text)
    message.success(`${label} copied to clipboard`)
  }

  return (
    <div style={{ padding: '8px 0' }}>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="Camera ID">{camera.id}</Descriptions.Item>
        <Descriptions.Item label="API Key">
          <Space>
            <Text code copyable style={{ fontSize: 12 }}>{camera.api_key}</Text>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="Webhook URL">
          <Text code copyable>{webhookUrl}</Text>
        </Descriptions.Item>
      </Descriptions>

      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col span={12}>
          <Card size="small" title="cURL Example" extra={
            <Button size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(curlSnippet, 'cURL command')}>Copy</Button>
          }>
            <pre style={{ fontSize: 11, margin: 0, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
              {curlSnippet}
            </pre>
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="Python Example" extra={
            <Button size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(pythonSnippet, 'Python code')}>Copy</Button>
          }>
            <pre style={{ fontSize: 11, margin: 0, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
              {pythonSnippet}
            </pre>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default function CameraList() {
  const [cameras, setCameras] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()

  const fetchCameras = () => {
    setLoading(true)
    cameraService.getList()
      .then((res) => setCameras(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchCameras()
    vehicleService.getList().then((res) => setVehicles(res.data)).catch(console.error)
  }, [])

  const handleCreate = () => {
    form.validateFields().then((values) => {
      cameraService.create(values)
        .then((res) => {
          message.success('Camera registered successfully')
          setModalOpen(false)
          form.resetFields()
          fetchCameras()
          Modal.info({
            title: 'Camera API Key',
            content: (
              <div>
                <Paragraph>Save this API key. You will need it to connect this camera.</Paragraph>
                <Text code copyable>{res.data.api_key}</Text>
              </div>
            ),
            width: 520,
          })
        })
        .catch(() => message.error('Failed to register camera'))
    })
  }

  const handleDelete = (id) => {
    cameraService.delete(id)
      .then(() => { message.success('Camera deleted'); fetchCameras() })
      .catch(() => message.error('Failed to delete camera'))
  }

  // Filter to only show cameras assigned to drivers (include all past records for audit trail)
  const assignedCameras = cameras.filter((c) => c.current_driver_name && c.current_vehicle_plate)

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v, record) => (
        <Space>
          <VideoCameraOutlined />
          <Text strong>{v}</Text>
        </Space>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'camera_type',
      key: 'type',
      width: 130,
      render: (v) => {
        const ct = CAMERA_TYPES[v]
        return ct ? <Tag color={ct.color}>{ct.label}</Tag> : v
      },
    },
    {
      title: 'Vehicle',
      dataIndex: 'vehicle_plate',
      key: 'vehicle',
      width: 140,
      render: (v) => v || <Text type="secondary">None</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v, record) => {
        const isStale = record.last_heartbeat && dayjs().diff(dayjs(record.last_heartbeat), 'minute') > 5
        const effectiveStatus = v === 'online' && isStale ? 'offline' : v
        const effectiveCs = CAMERA_STATUSES[effectiveStatus] || CAMERA_STATUSES.offline
        return <Badge status={effectiveCs.color === 'green' ? 'success' : effectiveCs.color === 'red' ? 'error' : 'default'} text={effectiveCs.label} />
      },
    },
    {
      title: 'Last Heartbeat',
      dataIndex: 'last_heartbeat',
      key: 'heartbeat',
      width: 150,
      render: (v) => v ? dayjs(v).fromNow() : <Text type="secondary">Never</Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Space>
          <Tooltip title="Copy API Key">
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(record.api_key)
                message.success('API key copied')
              }}
            />
          </Tooltip>
          <Popconfirm title="Delete this camera?" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', paddingBottom: 40, paddingTop: 24 }}>
      {/* Page Header */}
      <div style={{ 
        background: '#1e3a8a', 
        borderRadius: 12, 
        padding: '16px 24px',
        marginBottom: 24,
        marginLeft: 24,
        marginRight: 24
      }}>
        <Title level={3} style={{ margin: 0, color: '#ffffff', fontWeight: 700 }}>Camera Management</Title>
        <Text style={{ fontSize: 13, color: '#e0e7ff' }}>Configure and monitor your fleet cameras</Text>
      </div>

      <div style={{ paddingLeft: 24, paddingRight: 24 }}>
        <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
          <Col>
            <Space size="large">
              <Button icon={<ReloadOutlined />} size="large" onClick={fetchCameras} style={{ borderRadius: 8, fontWeight: 600 }}>Refresh</Button>
              <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setModalOpen(true)} style={{ borderRadius: 8, fontWeight: 600, background: '#1e3a8a', border: 'none' }}>Register Camera</Button>
            </Space>
          </Col>
        </Row>

      <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)', borderRadius: 8, overflow: 'hidden', background: '#ffffff' }} bodyStyle={{ padding: 0 }} title={<div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, fontWeight: 600, color: '#0f172a' }}><Text strong>Cameras</Text><Badge count={assignedCameras.length} style={{ backgroundColor: '#1e3a8a', fontSize: 11, fontWeight: 700 }} /></div>} headStyle={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px' }}>
        <Table
          dataSource={assignedCameras}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 12, showTotal: (t) => `${t} cameras`, position: ['bottomRight'] }}
          expandable={{
            expandedRowRender: (record) => <div style={{ background: '#ffffff', padding: 16 }}><ConnectionInfo camera={record} /></div>,
          }}
          size="middle"
          onRow={() => ({
            style: { cursor: 'pointer', transition: 'all 0.2s ease' },
            onMouseEnter: (e) => e.currentTarget.style.backgroundColor = '#f1f5f9',
            onMouseLeave: (e) => e.currentTarget.style.backgroundColor = '',
          })}
          scroll={{ x: 1200 }}
        />
      </Card>

      <Modal
        title="Register New Camera"
        open={modalOpen}
        onOk={handleCreate}
        onCancel={() => { setModalOpen(false); form.resetFields() }}
        okText="Register"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Camera Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. DXB-A Front Dashcam" />
          </Form.Item>
          <Form.Item name="camera_type" label="Camera Type" rules={[{ required: true }]}>
            <Select
              placeholder="Select type"
              options={Object.entries(CAMERA_TYPES).map(([k, v]) => ({ label: v.label, value: k }))}
            />
          </Form.Item>
          <Form.Item name="location" label="Location">
            <Input placeholder="e.g. Front windshield, Vehicle DXB-A-10000" />
          </Form.Item>
          <Form.Item name="vehicle_id" label="Vehicle">
            <Select
              placeholder="Select vehicle (optional)"
              allowClear
              showSearch
              filterOption={(input, opt) => opt.label.toLowerCase().includes(input.toLowerCase())}
              options={vehicles.map((v) => ({ label: `${v.plate_number} - ${v.model}`, value: v.id }))}
            />
          </Form.Item>
          <Form.Item name="stream_url" label="Stream URL">
            <Input placeholder="rtsp://... (optional)" />
          </Form.Item>
        </Form>
      </Modal>
      </div>
    </div>
  )
}
