import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'path'

// HTTPS is required for mobile browsers to grant geolocation/camera/mic
// permission to anything other than localhost. The phone-GPS pairing flow
// loads the dashboard from the laptop's LAN IP (e.g. 10.x.x.x:5176), which
// is treated as an "insecure origin" without TLS — so we serve a self-
// signed cert via @vitejs/plugin-basic-ssl. Phones will warn the user
// once; tap "advanced -> proceed" and the cert is trusted for the session.
export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Force a single React instance so libraries that ship their own
    // don't crash with hook-state errors like "Cannot read properties of
    // null (reading 'useMemo')".
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5176,
    strictPort: true,
    host: true,
    proxy: {
      '/api/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
      },
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
