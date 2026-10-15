import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ command, mode }) => {
  // A production build without VITE_API_BASE silently falls back to the TEST
  // backend (lib/apiBase.ts) or to same-origin "" (admin/settings pages), i.e.
  // the test database / Stripe test mode. Fail the build instead (audit P1-7).
  if (command === 'build' && mode === 'production') {
    const env = loadEnv(mode, process.cwd(), '')
    if (!String(env.VITE_API_BASE || '').trim()) {
      throw new Error(
        'VITE_API_BASE is not set. Set it to the backend URL for this deploy (e.g. https://api.example.com) before building.'
      )
    }
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: "http://127.0.0.1:5137",
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
