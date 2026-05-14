import axios from 'axios'

const configuredBaseURL = (import.meta.env.VITE_API_BASE_URL || '').trim()
const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:'
const isInsecureAbsoluteApi = /^http:\/\//i.test(configuredBaseURL)

// When the app is served over HTTPS (Vite basic-ssl), browsers block calls to
// absolute HTTP API URLs as mixed content. Fall back to Vite proxy.
const baseURL = isHttpsPage && isInsecureAbsoluteApi
  ? '/api'
  : (configuredBaseURL || '/api')

const api = axios.create({
  baseURL,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
