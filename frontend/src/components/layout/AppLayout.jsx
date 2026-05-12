import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Avatar, Dropdown, Typography, Space, theme, Divider } from 'antd'
import {
  DashboardOutlined,
  WarningOutlined,
  TeamOutlined,
  CarOutlined,
  FileTextOutlined,
  LogoutOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  VideoCameraOutlined,
  EyeOutlined,
  BellOutlined,
} from '@ant-design/icons'
import { useAuth } from '@/context/AuthContext'
import { usePermission } from '@/hooks/usePermission'
import { ROUTES, ROLES } from '@/constants'

const { Header, Sider, Content, Footer } = Layout
const { Text } = Typography

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [openMenus, setOpenMenus] = useState([])
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const { canGenerateReports } = usePermission()
  const { token: themeToken } = theme.useToken()

  const isDriver = user?.role === ROLES.DRIVER

  const menuItems = isDriver
    ? [
        {
          key: ROUTES.DRIVER_CAMERA,
          icon: <VideoCameraOutlined style={{ fontSize: 16 }} />,
          label: 'My Camera',
        },
      ]
    : [
        {
          key: ROUTES.DASHBOARD,
          icon: <DashboardOutlined style={{ fontSize: 16 }} />,
          label: 'Dashboard',
        },
        {
          key: ROUTES.VIOLATIONS,
          icon: <WarningOutlined style={{ fontSize: 16 }} />,
          label: 'Violations',
        },
        {
          key: ROUTES.DRIVERS,
          icon: <TeamOutlined style={{ fontSize: 16 }} />,
          label: 'Drivers',
        },
        {
          key: ROUTES.VEHICLES,
          icon: <CarOutlined style={{ fontSize: 16 }} />,
          label: 'Vehicles',
        },
        {
          key: 'cameras',
          icon: <VideoCameraOutlined style={{ fontSize: 16 }} />,
          label: 'Cameras',
          children: [
            { key: ROUTES.CAMERAS, label: 'Manage Cameras' },
            { key: ROUTES.DRIVER_CAMERA, label: 'Driver Camera' },
          ],
        },
        ...(canGenerateReports
          ? [
              {
                key: ROUTES.MONITORING,
                icon: <EyeOutlined style={{ fontSize: 16 }} />,
                label: 'Live Monitoring',
              },
              {
                key: ROUTES.REPORTS,
                icon: <FileTextOutlined style={{ fontSize: 16 }} />,
                label: 'Reports',
              },
            ]
          : []),
      ]

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: `${user?.full_name || user?.username} (${user?.role})`,
      disabled: true,
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Logout',
      danger: true,
    },
  ]

  const handleMenuClick = ({ key }) => navigate(key)

  const handleUserMenuClick = ({ key }) => {
    if (key === 'logout') {
      logout()
      navigate('/login')
    }
  }

  const handleMenuOpen = (keys) => {
    setOpenMenus(keys)
  }

  const selectedKey = '/' + location.pathname.split('/').filter(Boolean).slice(0, 1).join('/')
  
  // Determine which submenu item is selected
  let finalSelectedKey = selectedKey
  if (location.pathname === ROUTES.CAMERAS) {
    finalSelectedKey = ROUTES.CAMERAS
  } else if (location.pathname === ROUTES.DRIVER_CAMERA) {
    finalSelectedKey = ROUTES.DRIVER_CAMERA
  }

  return (
    <Layout style={{ minHeight: '100vh', background: '#f3f4f6' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        style={{
          background: 'linear-gradient(180deg, #0f172a 0%, #1a202c 100%)',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 1000,
          boxShadow: '2px 0 12px rgba(0, 0, 0, 0.25)',
        }}
        width={220}
        collapsedWidth={80}
      >
        <div style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          background: 'linear-gradient(135deg, #0f172a 0%, #1a202c 100%)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
        }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #1e3a8a 0%, #163073 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(30, 58, 138, 0.3)',
          }}>
            <SafetyCertificateOutlined style={{ fontSize: 22, color: '#ffffff', fontWeight: 700 }} />
          </div>
          {!collapsed && (
            <span style={{ color: '#ffffff', fontSize: 14, fontWeight: 700, marginLeft: 14, letterSpacing: '0.8px' }}>
              Fleet System
            </span>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[finalSelectedKey]}
          openKeys={openMenus}
          onOpenChange={handleMenuOpen}
          items={menuItems}
          onClick={handleMenuClick}
          style={{
            borderRight: 0,
            background: '#0f172a',
          }}
          itemSelectedBackgroundColor="#1e40af"
          itemSelectedColor="#60a5fa"
        />
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 220, transition: 'margin 0.2s ease' }}>
        <Header style={{
          padding: '0 28px',
          background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
          height: 64,
          position: 'sticky',
          top: 0,
          zIndex: 100,
          borderBottom: '1px solid #e2e8f0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Text strong style={{ fontSize: 16, color: '#0f172a', letterSpacing: '0.3px' }}>
              Fleet Monitoring
            </Text>
            <Divider type="vertical" style={{ height: 24, background: '#e2e8f0' }} />
            <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>
              {user?.role || 'User'}
            </Text>
          </div>
          <Space size={24}>
            <BellOutlined style={{ fontSize: 18, color: '#64748b', cursor: 'pointer', transition: 'all 0.3s ease' }} onMouseEnter={(e) => e.currentTarget.style.color = '#1e3a8a'} onMouseLeave={(e) => e.currentTarget.style.color = '#64748b'} />
            <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenuClick }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar
                  style={{
                    background: 'linear-gradient(135deg, #1e3a8a 0%, #163073 100%)',
                    fontSize: 12,
                    fontWeight: 700,
                    boxShadow: '0 2px 8px rgba(30, 58, 138, 0.25)',
                  }}
                  icon={<UserOutlined />}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <Text strong style={{ fontSize: 13, color: '#0f172a', fontWeight: 700 }}>
                    {user?.full_name || user?.username}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11, fontWeight: 500 }}>
                    {user?.role}
                  </Text>
                </div>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{
          margin: '24px',
          padding: '24px',
          background: '#ffffff',
          minHeight: 'calc(100vh - 112px)',
          borderRadius: '12px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
        }}>
          <Outlet />
        </Content>
        <Footer style={{
          textAlign: 'center',
          color: '#6b7280',
          padding: '16px 24px',
          fontSize: 12,
          background: '#f9fafb',
          borderTop: '1px solid #e5e7eb',
        }}>
          Fleet Violation Monitoring System © 2026 | Powered by Advanced AI Detection
        </Footer>
      </Layout>
    </Layout>
  )
}
