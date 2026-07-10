import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import mkcert from 'vite-plugin-mkcert';

// iOS only offers the "Install profile" flow when a downloaded CA arrives with
// a certificate MIME type. Vite's static server sends .crt files with no
// Content-Type, so phones fetching /oms-rootCA.crt from the dev URL just got a
// bare download and the CA was never actually installed — leaving the site
// "Not secure". Serve the route ourselves, straight from the live plugin CA
// (~/.vite-plugin-mkcert/rootCA.pem) so it also can't go stale if the CA is
// ever regenerated. Mirrors the same route on the Nest server (main.ts).
const sendRootCa = (_req: unknown, res: { setHeader: (k: string, v: string) => void; end: (body: string | Buffer) => void; statusCode: number }) => {
  try {
    const ca = readFileSync(path.join(homedir(), '.vite-plugin-mkcert', 'rootCA.pem'));
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.end(ca);
  } catch {
    res.statusCode = 404;
    res.end('root CA not found on this machine');
  }
};

const serveRootCa: Plugin = {
  name: 'oms-serve-root-ca',
  configureServer(server) {
    server.middlewares.use('/oms-rootCA.crt', sendRootCa);
  },
  configurePreviewServer(server) {
    server.middlewares.use('/oms-rootCA.crt', sendRootCa);
  },
};

// All /api calls are proxied to the Nest server so the browser only ever talks
// to this origin — this keeps HTTPS pages working (no mixed content / no TLS
// mismatch with the plain-HTTP API) both on localhost and from LAN devices.
const apiProxy = {
  '/api': {
    target: 'http://localhost:4000',
    changeOrigin: true,
  },
  // Test-notification WebSocket (Socket.IO's default path) — same single-origin
  // reasoning as /api above, extended with `ws: true` for the upgrade.
  '/socket.io': {
    target: 'http://localhost:4000',
    changeOrigin: true,
    ws: true,
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  // mkcert generates a *locally-trusted* certificate (backed by a real local CA)
  // instead of a random self-signed one — required for microphone access from
  // phones/other devices on the LAN (browsers block the mic on plain HTTP, and
  // iOS Safari treats a merely self-signed cert as still insecure even after you
  // click through the warning, so getUserMedia silently never prompts there).
  // The CA is installed into this machine's trust store automatically (no more
  // "Not secure" on desktop). For phones, the same root CA file (rootCA.pem,
  // under the mkcert cache dir) needs installing as a trusted certificate too.
  plugins: [
    react(),
    tailwindcss(),
    mkcert({ hosts: ['localhost', '127.0.0.1', '192.168.31.19', '192.168.0.236', '26.142.63.68'] }),
    serveRootCa,
  ],
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
    // HMR is turned OFF on purpose. Over self-signed HTTPS on a phone the
    // hot-reload websocket can't stay connected, so Vite kept reconnecting and
    // reloading the page ("keeps refreshing") — which also interrupted voice
    // recording before the note could save. With HMR off the page stays put;
    // to see code changes, refresh the browser manually.
    hmr: false,
    // Don't let OneDrive's background file-touching trigger needless rebuilds.
    watch: { ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**'] },
  },
  preview: {
    host: true,
    port: 6173,
    https: {},
    proxy: apiProxy,
  },
});
