import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, Card, Typography, message, Space } from 'antd'
import { SafetyCertificateOutlined, UserOutlined, LockOutlined } from '@ant-design/icons'
import { useAuth } from '@/context/AuthContext'

const { Title, Text } = Typography

export default function Login() {
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { login } = useAuth()

  const onFinish = async (values) => {
    setLoading(true)
    try {
      const data = await login(values.username, values.password)
      message.success('Login successful')
      navigate(data.user.role === 'DRIVER' ? '/cameras/driver' : '/dashboard')
    } catch (err) {
      message.error(err.response?.data?.detail || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: '#f8fafc',
      position: 'relative',
    }}>
      <Card style={{
        width: '100%',
        maxWidth: 420,
        borderRadius: 12,
        border: '1px solid #e2e8f0',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)',
        background: '#ffffff',
        position: 'relative',
        zIndex: 10,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            background: '#1e3a8a',
            borderRadius: 10,
            marginBottom: 20,
            boxShadow: '0 4px 12px rgba(30, 58, 138, 0.15)',
          }}>
            <SafetyCertificateOutlined style={{ fontSize: 32, color: '#ffffff' }} />
          </div>
          <Title level={2} style={{ margin: 0, marginBottom: 8, color: '#0f172a', fontWeight: 700 }}>
            Fleet Violation Management
          </Title>
          <Text type="secondary" style={{ fontSize: 13, color: '#64748b' }}>
            Enterprise Monitoring System
          </Text>
        </div>

        <Form layout="vertical" onFinish={onFinish} size="large" style={{ marginBottom: 24 }}>
          <Form.Item
            name="username"
            rules={[{ required: true, message: 'Please enter your username' }]}
            style={{ marginBottom: 16 }}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
              placeholder="Username"
              style={{
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                fontSize: 14,
                padding: '10px 12px',
              }}
            />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Please enter your password' }]}
            style={{ marginBottom: 24 }}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
              placeholder="Password"
              style={{
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                fontSize: 14,
                padding: '10px 12px',
              }}
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
              style={{
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 14,
                height: 44,
                background: '#1e3a8a',
                border: 'none',
              }}
            >
              Sign In
            </Button>
          </Form.Item>
        </Form>

        <div style={{
          padding: 16,
          background: '#f1f5f9',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          marginBottom: 20,
        }}>
          <Text style={{ fontSize: 12, display: 'block', marginBottom: 8, fontWeight: 600, color: '#0f172a' }}>
            Demo Credentials
          </Text>
          <Space direction="vertical" size={6} style={{ fontSize: 11 }}>
            <Text type="secondary">Admin: <Text strong style={{ color: '#0f172a' }}>admin</Text> / admin123</Text>
            <Text type="secondary">Manager: <Text strong style={{ color: '#0f172a' }}>manager</Text> / manager123</Text>
            <Text type="secondary">Driver: <Text strong style={{ color: '#0f172a' }}>driver1</Text> / driver123</Text>
          </Space>
        </div>

        <div style={{
          textAlign: 'center',
          padding: 16,
          background: '#f8fafc',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
        }}>
          <Text style={{ fontSize: 11, color: '#64748b' }}>
            © 2026 Fleet Violation Management System. All rights reserved.
          </Text>
        </div>
      </Card>

      <style>{`
        .ant-card {
          animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .ant-input,
        .ant-input-password {
          border-radius: 8px !important;
          font-size: 14px !important;
        }

        .ant-input:hover,
        .ant-input-password:hover {
          border-color: #1e3a8a !important;
        }

        .ant-input-focused,
        .ant-input-password-focused {
          border-color: #1e3a8a !important;
          box-shadow: 0 0 0 2px rgba(30, 58, 138, 0.1) !important;
        }

        .ant-btn-primary {
          background: #1e3a8a !important;
        }

        .ant-btn-primary:hover {
          background: #163073 !important;
        }
      `}</style>
    </div>
  )
}
