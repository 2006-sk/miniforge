import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:3000',
        changeOrigin: true,
        // Keep SSE streams open (scan agent workflow)
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const ct = proxyRes.headers['content-type'] || '';
            if (ct.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['connection'] = 'keep-alive';
            }
          });
        },
      },
    },
  },
});
