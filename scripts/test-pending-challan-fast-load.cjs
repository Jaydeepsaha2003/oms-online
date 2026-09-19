// Real-browser regression: Pending Challan paints its saved snapshot immediately,
// but cannot act on it until the fresh server response has arrived.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
let slow = false;
const line = (id, productName) => ({
  dispatchId: id,
  dispatchDate: '2026-09-18T08:00:00.000Z',
  orderId: 10,
  orderCode: 'ORD-10',
  customerId: 1,
  customerName: 'TEST PARTY',
  productName,
  design: 'NA',
  bags: 1,
  kgs: 70,
  pcs: null,
  box: null,
  unit: 'KGS',
  rate: 200,
  pCategory: 'GLASS',
  gstRate: 18,
  freightRate: 1,
  packingRate: 1,
  lockedByName: null,
});

const bundle = buildSync({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
      import { MemoryRouter } from 'react-router-dom';
      import { TooltipProvider } from '@/components/ui/tooltip';
      import { ConfirmProvider } from '@/components/common/confirm';
      import { queryClient, queryPersistOptions } from '@/lib/query';
      import { useAuthStore } from '@/stores/auth-store';
      import { PendingChallanPage } from '@/features/challans/pending-challan-page';
      useAuthStore.setState({ user: { id: 'fixture', name: 'Tester', roles: ['super_admin'], permissions: ['*'] }, isBootstrapping: false });
      createRoot(document.getElementById('root')).render(
        <PersistQueryClientProvider client={queryClient} persistOptions={queryPersistOptions}>
          <TooltipProvider><ConfirmProvider><MemoryRouter><PendingChallanPage /></MemoryRouter></ConfirmProvider></TooltipProvider>
        </PersistQueryClientProvider>,
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
  write: false,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/bundle.js') {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end(bundle.outputFiles[0].text);
  }
  if (url.pathname === '/control/slow') {
    slow = true;
    return res.end('ok');
  }
  if (url.pathname === '/api/challans/pending-filters') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ customers: ['TEST PARTY'], products: ['OLD PRODUCT', 'FRESH PRODUCT'], designs: ['NA'] }));
  }
  if (url.pathname === '/api/challans/pending') {
    if (slow) await new Promise((resolve) => setTimeout(resolve, 1500));
    const item = slow ? line(2, 'FRESH PRODUCT') : line(1, 'OLD PRODUCT');
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ items: [item], total: 1, page: 1, pageSize: 50, totalPages: 1 }));
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.goto(base);
    await page.getByText('OLD PRODUCT', { exact: true }).waitFor();
    // The persister batches writes for two seconds.
    await page.waitForTimeout(2300);
    await fetch(`${base}/control/slow`);
    await page.reload();

    // A cold network response takes 1.5s, so seeing this within 500ms proves the
    // successful previous result was restored rather than fetched again.
    await page.getByText('OLD PRODUCT', { exact: true }).waitFor({ timeout: 500 });
    await page.getByText('OLD PRODUCT', { exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Create Challan' }).isDisabled(), true);

    await page.getByText('FRESH PRODUCT', { exact: true }).waitFor({ timeout: 3000 });
    assert.equal(await page.getByText('OLD PRODUCT', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: cached Pending Challan rows paint immediately and fresh data replaces them safely');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
