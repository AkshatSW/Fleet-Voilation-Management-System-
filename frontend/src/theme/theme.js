// Professional, modern theme for Fleet Violation Management System
export const appTheme = {
  token: {
    colorPrimary: '#0051ba', // Professional blue
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#1890ff',
    colorTextBase: '#1f2937',
    colorBgBase: '#ffffff',
    
    // Typography
    fontSize: 14,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontWeightStrong: 600,
    
    // Spacing
    margin: 16,
    marginXS: 8,
    marginSM: 12,
    marginLG: 24,
    marginXL: 32,
    
    // Border radius for modern look
    borderRadius: 8,
    borderRadiusLG: 12,
    
    // Shadows
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
    boxShadowSecondary: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      headerHeight: 64,
      headerPadding: '0 24px',
      headerColor: '#1f2937',
      siderBg: '#f8fafc',
      bodyBg: '#f3f4f6',
      footerBg: '#f8fafc',
      footerBorderColor: '#e5e7eb',
    },
    Card: {
      borderRadiusLG: 12,
      boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
      colorBgContainer: '#ffffff',
      colorBorder: '#e5e7eb',
    },
    Button: {
      borderRadius: 8,
      fontWeight: 500,
    },
    Table: {
      borderRadius: 8,
      colorBgContainer: '#ffffff',
      headerBg: '#f8fafc',
      headerColor: '#1f2937',
      rowHoverBg: '#f3f4f6',
    },
    Select: {
      borderRadius: 8,
    },
    Input: {
      borderRadius: 8,
    },
    Menu: {
      colorBgContainer: '#f8fafc',
      colorBgElevated: '#f8fafc',
    },
  },
}

// Professional color palette for charts and badges
export const colors = {
  primary: '#0051ba',
  secondary: '#6b7280',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  critical: '#dc2626',
  info: '#3b82f6',
  
  // Gradients
  gradients: {
    primary: 'linear-gradient(135deg, #0051ba 0%, #0066d6 100%)',
    success: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    warning: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    danger: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
    info: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  },
  
  // Background colors
  backgrounds: {
    light: '#f9fafb',
    lighter: '#f3f4f6',
    lightest: '#fffbeb',
  },
}
