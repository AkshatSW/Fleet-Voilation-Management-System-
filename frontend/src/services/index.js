import api from './api'

export const authService = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  getMe: () => api.get('/auth/me'),
  getMyDriver: () => api.get('/auth/me/driver'),
}

export const dashboardService = {
  getData: () => api.get('/dashboard'),
  getOverview: () => api.get('/dashboard/overview'),
}

export const violationService = {
  getList: (params) => api.get('/violations', { params }),
  getById: (id) => api.get(`/violations/${id}`),
  getStats: () => api.get('/violations/stats'),
  updateReview: (id, data) => api.patch(`/violations/${id}/review`, data),
}

export const driverService = {
  getList: (params) => api.get('/drivers', { params }),
  getById: (id) => api.get(`/drivers/${id}`),
  getViolations: (id, params) => api.get(`/drivers/${id}/violations`, { params }),
  getScores: (id) => api.get(`/drivers/${id}/scores`),
  update: (id, data) => api.put(`/drivers/${id}`, data),
  create: (data) => api.post('/drivers', data),
}

export const vehicleService = {
  getList: (params) => api.get('/vehicles', { params }),
  getById: (id) => api.get(`/vehicles/${id}`),
}

export const reportService = {
  generate: (data) => api.post('/reports/generate', data),
  getWeekly: () => api.get('/reports/weekly'),
  getMonthly: () => api.get('/reports/monthly'),
}

export const safetyScoreService = {
  getList: (params) => api.get('/safety-scores', { params }),
  getFleetAverage: (month) => api.get('/safety-scores/fleet-average', { params: { month } }),
  getLatest: (driverId) => api.get(`/safety-scores/${driverId}/latest`),
}

export const cameraService = {
  getList: (params) => api.get('/cameras', { params }),
  getById: (id) => api.get(`/cameras/${id}`),
  create: (data) => api.post('/cameras', data),
  update: (id, data) => api.put(`/cameras/${id}`, data),
  delete: (id) => api.delete(`/cameras/${id}`),
  regenerateKey: (id) => api.post(`/cameras/${id}/regenerate-key`),
  heartbeat: (apiKey, driverId, vehicleId) => {
    const params = new URLSearchParams()
    if (driverId) params.append('driver_id', driverId)
    if (vehicleId) params.append('vehicle_id', vehicleId)
    const qs = params.toString()
    return fetch(`/api/cameras/heartbeat${qs ? '?' + qs : ''}`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
    }).then((r) => r.json())
  },
}

export const uploadService = {
  uploadSnapshot: (file, apiKey) => {
    const formData = new FormData()
    formData.append('file', file, 'snapshot.jpg')
    return fetch('/api/uploads/snapshot', {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
      body: formData,
    }).then((r) => r.json())
  },
  uploadClip: (file, apiKey) => {
    const formData = new FormData()
    formData.append('file', file, 'clip.webm')
    return fetch('/api/uploads/clip', {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
      body: formData,
    }).then((r) => r.json())
  },
}
