import { existsSync, readFileSync } from 'node:fs';
import { Agent } from 'node:http';
import { homedir, networkInterfaces } from 'node:os';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import compression from 'compression';
import { defineConfig, type Plugin } from 'vite';
import mkcert from 'vite-plugin-mkcert';

// Auto-detect every IPv4 address on this machine (Wi-Fi, Ethernet, VPN adapters)
// so the mkcert HTTPS certificate is always valid for any IP, even if the network
// changes or a VPN adapter is added/removed. No more stale hardcoded IPs.
function getAllLocalIPs(): string[] {
  const ips = new Set<string>(['localhost', '127.0.0.1']);
  const ifaces = networkInterfaces();
  for (const adapters of Object.values(ifaces)) {
    if (!adapters) continue;
    for (const a of adapters) {
      if (a.family === 'IPv4' && !a.internal) ips.add(a.address);
    }
  }
  return [...ips];
}

// The boot-time autostart task runs this server as SYSTEM, whose home dir is
// C:\Windows\system32\config\systemprofile. In that context vite-plugin-mkcert
// finds no cached cert and tries `mkcert -install`, which SYSTEM cannot do
// ("The request is not supported") - killing the whole preview server at boot.
// So when running as SYSTEM, skip the plugin entirely and serve HTTPS from a
// project-local copy of the certs (start.bat refreshes certs\ from the user's
// ~/.vite-plugin-mkcert on every user-run start).
const runningAsSystem = homedir().toLowerCase().includes('systemprofile');
const certsDir = path.resolve(import.meta.dirname, '..', '..', 'certs');

// Always load HTTPS certs for the preview (production) server. Try the user's
// mkcert cache first, then the project-local certs/ copy. This ensures `vite
// preview` always serves HTTPS with a valid cert on ALL interfaces (IPv4+IPv6),
// regardless of whether it's run as the user or as SYSTEM.
let previewHttps: { cert: Buffer; key: Buffer } | undefined;
const certCandidates = [
  // User's mkcert cache (preferred, always up-to-date)
  { cert: path.join(homedir(), '.vite-plugin-mkcert', 'cert.pem'), key: path.join(homedir(), '.vite-plugin-mkcert', 'dev.pem') },
  // Project-local copy (fallback for SYSTEM / autostart)
  { cert: path.join(certsDir, 'cert.pem'), key: path.join(certsDir, 'dev.pem') },
];
for (const c of certCandidates) {
  try {
    if (existsSync(c.cert) && existsSync(c.key)) {
      previewHttps = { cert: readFileSync(c.cert), key: readFileSync(c.key) };
      break;
    }
  } catch { /* try next */ }
}

// iOS only offers the "Install profile" flow when a downloaded CA arrives with
// a certificate MIME type. Vite's static server sends .crt files with no
// Content-Type, so phones fetching /oms-rootCA.crt from the dev URL just got a
// bare download and the CA was never actually installed — leaving the site
// "Not secure". Serve the route ourselves, straight from the live plugin CA
// (~/.vite-plugin-mkcert/rootCA.pem) so it also can't go stale if the CA is
// ever regenerated. Mirrors the same route on the Nest server (main.ts).
const sendRootCa = (_req: unknown, res: { setHeader: (k: string, v: string) => void; end: (body: string | Buffer) => void; statusCode: number }) => {
  // Try the live plugin CA first, then the project-local copy (the only one
  // available when running as SYSTEM via the boot-time autostart task).
  for (const caPath of [path.join(homedir(), '.vite-plugin-mkcert', 'rootCA.pem'), path.join(certsDir, 'rootCA.pem')]) {
    try {
      const ca = readFileSync(caPath);
      res.setHeader('Content-Type', 'application/x-x509-ca-cert');
      res.end(ca);
      return;
    } catch {
      // fall through to the next candidate
    }
  }
  res.statusCode = 404;
  res.end('root CA not found on this machine');
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

// Gzip the preview server's responses (the built JS/CSS chunks are 50-570 KB
// each uncompressed). Registered in configurePreviewServer so it wraps the
// static file serving; /api responses proxied from Nest arrive already
// compressed (Content-Encoding set), which this middleware detects and skips.
// This is what makes first-time page loads fast over slow links (OpenVPN).
const gzipPreview: Plugin = {
  name: 'oms-gzip-preview',
  configurePreviewServer(server) {
    server.middlewares.use(compression() as never);
  },
};

// Keep idle client connections open well past Node's 5s default. The phone
// talks to THIS server over the router's OpenVPN, where every new TCP+TLS
// setup costs whole seconds — letting the connection survive the gaps between
// a user's clicks avoids paying that handshake on every screen.
const tuneKeepAlive = (s: { keepAliveTimeout: number; headersTimeout: number } | null) => {
  if (!s) return;
  s.keepAliveTimeout = 65_000;
  s.headersTimeout = 66_000;
};
const keepAlive: Plugin = {
  name: 'oms-keep-alive',
  configureServer(server) {
    tuneKeepAlive(server.httpServer as never);
  },
  configurePreviewServer(server) {
    tuneKeepAlive(server.httpServer as never);
  },
};

// All /api calls are proxied to the Nest server so the browser only ever talks
// to this origin — this keeps HTTPS pages working (no mixed content / no TLS
// mismatch with the plain-HTTP API) both on localhost and from LAN devices.
// Reuse upstream sockets to the Nest API instead of opening one per request.
const apiAgent = new Agent({ keepAlive: true, maxSockets: 64 });

const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:4000',
    changeOrigin: true,
    agent: apiAgent,
    configure: (proxy: any) => {
      proxy.on('error', (err: any) => {
        console.warn('[vite proxy error /api]:', err.message);
      });
      // http-proxy stamps its hop-by-hop `connection: close` onto the response;
      // browsers honor that and drop their connection to THIS server after
      // every /api call — which over the router's OpenVPN means a fresh
      // TCP+TLS handshake per request. Rewrite it so clients keep the
      // connection open (the server-side keep-alive timeout is 65s).
      proxy.on('proxyRes', (proxyRes: any) => {
        proxyRes.headers.connection = 'keep-alive';
      });
    },
  },
  // Test-notification WebSocket (Socket.IO's default path) — same single-origin
  // reasoning as /api above, extended with `ws: true` for the upgrade.
  '/socket.io': {
    target: 'http://127.0.0.1:4000',
    changeOrigin: true,
    ws: true,
    configure: (proxy: any) => {
      proxy.on('error', (err: any) => {
        console.warn('[vite proxy error /socket.io]:', err.message);
      });
    },
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
    // As SYSTEM (boot autostart) the plugin would crash on `mkcert -install`;
    // the explicit `https` config below serves the project-local certs instead.
    // Hosts list is auto-detected from all active network interfaces (LAN, VPN, etc.)
    ...(runningAsSystem ? [] : [mkcert({ hosts: getAllLocalIPs() })]),
    serveRootCa,
    gzipPreview,
    keepAlive,
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
    strictPort: true,
    https: previewHttps ?? {},
    proxy: apiProxy,
  },
});
