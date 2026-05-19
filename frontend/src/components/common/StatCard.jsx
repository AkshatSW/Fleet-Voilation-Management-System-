import { Card, Statistic, Space } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'

export default function StatCard({ title, value, prefix, suffix, trend, trendLabel, icon, color }) {
  const colorMap = {
    '#1677ff': '#1e3a8a',
    '#52c41a': '#166534',
    '#fa8c16': '#92400e',
    '#f5222d': '#7f1d1d',
  }

  const selectedColor = colorMap[color] || '#1e3a8a'

  return (
    <Card
      style={{
        border: '1px solid #e2e8f0',
        background: '#ffffff',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)',
        borderRadius: 8,
        overflow: 'hidden',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        cursor: 'default',
        position: 'relative',
      }}
      bodyStyle={{ padding: '12px 16px' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 12px 24px rgba(0, 0, 0, 0.15)'
        e.currentTarget.style.borderColor = '#cbd5e1'
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)'
        e.currentTarget.style.borderColor = '#e2e8f0'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      {/* Solid Top Border Accent */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: selectedColor,
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 2 }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: 6,
          }}>
            {title}
          </div>
          <Statistic
            value={value}
            prefix={prefix}
            suffix={suffix}
            valueStyle={{
              color: selectedColor,
              fontSize: 24,
              fontWeight: 700,
              lineHeight: '1.1',
            }}
          />
        </div>
        {icon && (
          <div style={{
            fontSize: 24,
            color: selectedColor,
            opacity: 0.8,
            marginRight: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            background: `${selectedColor}15`,
            borderRadius: 8,
          }}>
            {icon}
          </div>
        )}
      </div>

      {trend !== undefined && (
        <Space size={6} style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
          <span style={{
            color: trend >= 0 ? '#dc2626' : '#16a34a',
            fontSize: 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}>
            {trend >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            {Math.abs(trend)}%
          </span>
          <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 500 }}>{trendLabel || 'vs last month'}</span>
        </Space>
      )}
    </Card>
  )
}
