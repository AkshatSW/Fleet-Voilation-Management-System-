import { createBrowserRouter, Navigate } from 'react-router-dom'
import AppLayout from '@/components/layout/AppLayout'
import ProtectedRoute from '@/components/common/ProtectedRoute'
import Login from '@/pages/auth/Login'
import Dashboard from '@/pages/dashboard/Dashboard'
import ViolationList from '@/pages/violations/ViolationList'
import ViolationDetail from '@/pages/violations/ViolationDetail'
import DriverList from '@/pages/drivers/DriverList'
import DriverDetail from '@/pages/drivers/DriverDetail'
import VehicleList from '@/pages/vehicles/VehicleList'
import CameraList from '@/pages/cameras/CameraList'
import DriverCamera from '@/pages/cameras/DriverCamera'
import ManagerMonitoring from '@/pages/monitoring/ManagerMonitoring'
import Reports from '@/pages/reports/Reports'
import StopSignSimulation from '@/pages/dev/StopSignSimulation'
import { ROLES } from '@/constants'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/login" replace />,
  },
  {
    path: '/login',
    element: <Login />,
  },
  {
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        path: '/dashboard',
        element: (
          <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.MANAGER, ROLES.VIEWER]}>
            <Dashboard />
          </ProtectedRoute>
        ),
      },
      {
        path: '/violations',
        element: (
          <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.MANAGER, ROLES.VIEWER]}>
            <ViolationList />
          </ProtectedRoute>
        ),
      },
      {
        path: '/violations/:id',
        element: (
          <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.MANAGER, ROLES.VIEWER]}>
            <ViolationDetail />
          </ProtectedRoute>
        ),
      },
      {
        path: '/drivers',
        element: (
          <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.MANAGER, ROLES.VIEWER]}>
            <DriverList />
          </ProtectedRoute>
        ),
      },
      {
        path: '/drivers/:id',
        element: (
          <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.MANAGER, ROLES.VIEWER]}>
            <DriverDetail />
          </ProtectedRoute>
        ),
      },
      {
        path: '/vehicles',
        element: (
          <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.MANAGER, ROLES.VIEWER]}>
            <VehicleList />
          </ProtectedRoute>
        ),
      },
      {
        path: '/cameras',
        element: (
          <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.MANAGER, ROLES.VIEWER]}>
            <CameraList />
          </ProtectedRoute>
        ),
      },
      { path: '/cameras/driver', element: <DriverCamera /> },
      {
        path: '/monitoring',
        element: (
          <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.MANAGER]}>
            <ManagerMonitoring />
          </ProtectedRoute>
        ),
      },
      {
        path: '/reports',
        element: (
          <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.MANAGER]}>
            <Reports />
          </ProtectedRoute>
        ),
      },
      {
        path: '/dev/stop-sign-simulation',
        element: (
          <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.MANAGER, ROLES.VIEWER, ROLES.DRIVER]}>
            <StopSignSimulation />
          </ProtectedRoute>
        ),
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/login" replace />,
  },
])
