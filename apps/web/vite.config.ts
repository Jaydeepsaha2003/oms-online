import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// All /api calls are proxied to the Nest server so the browser only ever talks
// to this origin — this keeps HTTPS pages working (no mixed content / no TLS
// mismatch with the plain-HTTP API) both on localhost and from LAN devices.
const apiProxy = {
  '/api': {
    target: 'http://localhost:4000',
    changeOrigin: true,
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  // basic-ssl generates a self-signed certificate so the dev server runs over
  // HTTPS — required for microphone access when the app is opened from phones
  // or other devices on the LAN (browsers block the mic on plain HTTP).
  // Each device shows a one-time "connection not private" warning: proceed once.
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // Bind to all interfaces (0.0.0.0) so the dev server is reachable from
    // phones and other devices on the same network, not just localhost.
    host: true,
    port: 6173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
});
