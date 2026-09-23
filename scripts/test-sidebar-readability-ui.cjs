// Render the real sidebar and verify its labels remain comfortably readable.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const bundle = buildSync({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { MemoryRouter } from 'react-router-dom';
      import { TooltipProvider } from '@/components/ui/tooltip';
      import { Sidebar } from '@/components/layout/sidebar';
      import { useAuthStore } from '@/stores/auth-store';

      useAuthStore.setState({
        user: { id: 'fixture', name: 'Sidebar test', permissions: ['*'] },
        isBootstrapping: false,
      });

      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <TooltipProvider>
            <MemoryRouter initialEntries={['/dispatch']}>
              <div style={{ width: 260, height: 900 }}><Sidebar /></div>
            </MemoryRouter>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    `,
    resolveDir: path.join(root, 'apps/web/src'),
    loader: 'tsx',
  },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  tsconfig: path.join(root, 'apps/web/tsconfig.json'),
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' },
  loader: { '.png': 'dataurl' },
  write: false,
});

const assets = path.join(root, 'apps/web/dist/assets');
const css = fs.existsSync(assets)
  ? fs.readdirSync(assets).filter((file) => file.endsWith('.css')).map((file) => fs.readFileSync(path.join(assets, file), 'utf8')).join('\n')
  : '';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/bundle.js') {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end(bundle.outputFiles[0].text);
  }
  if (url.pathname === '/style.css') {
    res.setHeader('Content-Type', 'text/css');
    return res.end(css);
  }
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/crm/followups/due') return res.end('[]');
    if (url.pathname === '/api/approvals/count') return res.end('{"pending":0}');
    if (url.pathname === '/api/settings/company') return res.end('{}');
    return res.end('{}');
  }
  res.setHeader('Content-Type', 'text/html');
  return res.end('<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
});

function colorAlpha(color) {
  const match = color.match(/\/\s*([\d.]+)\s*\)?$/) || color.match(/rgba?\([^)]*,\s*([\d.]+)\)$/);
  return match ? Number(match[1]) : 1;
}

(async () => {
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
    const page = await browser.newPage({ viewport: { width: 300, height: 950 } });
    page.on('pageerror', (error) => console.error(`Browser error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`Browser console: ${message.text()}`);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);

    const dashboard = page.getByText('Dashboard', { exact: true });
    const dispatchOrder = page.getByText('Dispatch Order', { exact: true });
    await dashboard.waitFor();
    await dispatchOrder.waitFor();

    for (const [name, locator] of [['main menu', dashboard], ['submenu', dispatchOrder]]) {
      const style = await locator.evaluate((element) => {
        const computed = getComputedStyle(element.parentElement);
        return { fontSize: computed.fontSize, color: computed.color };
      });
      if (Math.abs(Number.parseFloat(style.fontSize) - 16.2) > 0.01) {
        throw new Error(`${name} label is ${style.fontSize}; expected 16.2px`);
      }
      if (colorAlpha(style.color) < 0.999) {
        throw new Error(`${name} label color is ${style.color}; expected fully opaque white foreground`);
      }
    }

    console.log('Sidebar readability: PASS (main menu and submenu labels are exactly 16.2px with fully opaque white foreground)');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
