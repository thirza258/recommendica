import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8000'
  const apiPath = '/api'

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      proxy: {
        [apiPath]: {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
