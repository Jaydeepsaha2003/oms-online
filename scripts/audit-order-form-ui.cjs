// Audit the actual New Order component with a local fixture API. No real OMS requests.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { buildSync } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const customers = [1, 2].map(id => ({ id, name: `AUDIT PARTY ${id}`, agentName: 'SELF', category: 'SALES' }));
const products = [
  { product: 'AUDIT GLASS', category: 'GLASS', subCategory: 'PLAIN', size: 7, pcs: 12, weight: 0.25, rate: 100 },
  { product: 'OTHER GLASS', category: 'GLASS', subCategory: 'PLAIN', size: 8, pcs: 6, weight: 0.5, rate: 200 },
];
let holdSpecial = false;
let pendingSpecial = [];
let missingUnit = false;
const submissions = [];
const observations = [];
observations.push = function (...rows) { rows.forEach(row => console.log(JSON.stringify(row))); return Array.prototype.push.apply(this, rows); };
const bundle = buildSync({ stdin: { contents: `
  import React from 'react'; import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter, Routes, Route } from 'react-router-dom';
  import { TooltipProvider } from '@/components/ui/tooltip';
  import { ConfirmProvider } from '@/components/common/confirm';
  import { Toaster } from 'sonner';
  import { OrderFormPage } from '@/features/orders/order-form-page';
  import { useAuthStore } from '@/stores/auth-store';
  useAuthStore.setState({user:{id:'fixture',name:'Audit',permissions:['*']},isBootstrapping:false});
  createRoot(document.getElementById('root')).render(
    <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}>
    <TooltipProvider><ConfirmProvider><MemoryRouter initialEntries={['/orders/new']}><Routes>
    <Route path='/orders/new' element={<OrderFormPage/>}/><Route path='*' element={<p>Fixture saved</p>}/>
    </Routes></MemoryRouter><Toaster/></ConfirmProvider></TooltipProvider></QueryClientProvider>);
`, resolveDir: path.join(root, 'apps/web/src'), loader: 'tsx' }, bundle: true, platform: 'browser', format: 'esm',
  tsconfig: path.join(root, 'apps/web/tsconfig.json'), define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, write: false });
const assets = path.join(root, 'apps/web/dist/assets');
const css = fs.existsSync(assets) ? fs.readdirSync(assets).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n') : '';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(bundle.outputFiles[0].text); }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (!url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><html><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
  let data = [];
  if (url.pathname === '/api/orders/lookups') data = { customers, productRows: products,
    designs: [{ category: 'GLASS', subCategory: 'PLAIN', designType: 'LOGO', designName: 'LOGO', rate: 5 }],
    designNames: [], categories: ['GLASS'], subCategories: ['PLAIN'], products: [], agents: ['SELF'],
    categoryFields: missingUnit ? [] : [{ category: 'GLASS', field: 'KGS' }] };
  else if (url.pathname === '/api/special-rates') {
    if (holdSpecial) await new Promise(resolve => pendingSpecial.push(resolve));
    const id = Number(url.searchParams.get('customerId'));
    data = { rates: [{ id, customerId: id, kind: 'PRODUCT', scope: 'CATEGORY', category: 'GLASS', subCategory: '', target: '', rate: id === 1 ? 10 : 50 }],
      logos: id === 2 ? [{ scope: 'CATEGORY', category: 'GLASS', subCategory: '' }] : [], bagWeights: [] };
  } else if (url.pathname.includes('/customer-add-ons/')) data = { bases: [], specials: [] };
  else if (url.pathname === '/api/bookings') data = { items: [], total: 0 };
  else if (url.pathname === '/api/settings') data = [{ group: 'ORDER_TYPE', value: 'SALES ORDER', sortOrder: 0 }, { group: 'COMPLETION_DAYS', value: '7', sortOrder: 0 }];
  else if (url.pathname === '/api/settings/order-qty-layout') data = { default: ['bags', 'pcs', 'kgs', 'box'], byCategory: {} };
  else if (url.pathname === '/api/orders' && req.method === 'POST') { submissions.push(body); data = { ...body, id: 100, code: 'AUDIT-100' }; }
  else if (req.method !== 'GET') { res.statusCode = 400; data = { message: 'Unexpected fixture request' }; }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data));
});
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    // Block all non-fixture traffic, including any accidentally introduced integration.
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const field = name => page.locator(`[data-tabfield="${name}"] input`).first();
    const pick = async (name, value) => { await field(name).fill(value); await page.getByRole('option', { name: value, exact: true }).click({ force: true }); await page.waitForTimeout(200); };
    const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('oms:order-draft-v1') || '{}'));
    const waitRows = count => page.waitForFunction(n => JSON.parse(localStorage.getItem('oms:order-draft-v1') || '{}').items?.length === n, count);
    const fresh = async () => {
      console.log('Opening fresh fixture');
      holdSpecial = false; pendingSpecial.splice(0).forEach(resolve => resolve());
      if (page.url() !== 'about:blank') { await page.evaluate(() => localStorage.clear()); }
      await page.goto(base);
      await pick('customer', 'AUDIT PARTY 1'); await pick('completionDay', '7');
      await pick('itemName', '7 AUDIT GLASS');
      await page.waitForFunction(() => document.querySelector('[data-tabfield="productRate"] input')?.value === '110');
    };
    const add = () => page.getByRole('button', { name: 'Add item', exact: true }).click();
    if (process.env.AUDIT_CASE === 'design-rate') {
      await fresh(); await pick('itemName', '7 AUDIT GLASS LOGO');
      const wasEnabled = await field('designRate').isEnabled();
      await field('designRate').fill('');
      observations.push({ name: 'Clearing design rate disables its input', wasEnabled, nowDisabled: await field('designRate').isDisabled(), value: await field('designRate').inputValue() });
      return;
    }
    await fresh(); await field('pcs').fill('12'); await field('productRate').fill(''); await add(); await waitRows(1);
    await page.getByRole('button', { name: /Create order/ }).click();
    await page.getByRole('button', { name: 'Save only', exact: true }).click();
    await page.waitForTimeout(1100);
    observations.push({ name: 'Blank product rate reaches order save', payload: submissions.at(-1) });
    await fresh(); await field('pcs').fill('12'); await field('productRate').fill('-5'); await add(); await waitRows(1);
    observations.push({ name: 'Negative product rate added through number input', row: (await draft()).items[0] });
    await fresh(); await field('pcs').fill('12'); await add(); await waitRows(1);
    await pick('customer', 'AUDIT PARTY 2'); await pick('itemName', '7 AUDIT GLASS');
    await page.waitForFunction(() => document.querySelector('[data-tabfield="productRate"] input')?.value === '150');
    await page.waitForTimeout(700);
    observations.push({ name: 'Changing customer retains added rows at old price', customer: (await draft()).customer,
      previousLineRate: (await draft()).items[0].productRate, newEntryRate: await field('productRate').inputValue() });
    await fresh(); await pick('itemName', '7 AUDIT GLASS LOGO'); await field('pcs').fill('12');
    await pick('customer', 'AUDIT PARTY 2');
    await page.waitForTimeout(500); await add(); await waitRows(1);
    observations.push({ name: 'Selected logo can be added after switching to blocked party', customer: (await draft()).customer, row: (await draft()).items[0] });
    await fresh(); await field('pcs').fill('12');
    const before = { pcs: await field('pcs').inputValue(), box: await field('box').inputValue(), kgs: await field('gram').inputValue() };
    await pick('itemName', '8 OTHER GLASS'); await add(); await waitRows(1);
    observations.push({ name: 'Changing item retains previous item quantities without recalculation', before, after: (await draft()).items[0] });
    await fresh(); holdSpecial = true; await pick('customer', 'AUDIT PARTY 2'); await pick('itemName', '7 AUDIT GLASS');
    await field('pcs').fill('12'); await add(); await waitRows(1);
    observations.push({ name: 'Add allowed while new customer price request pending', pendingRequests: pendingSpecial.length, row: (await draft()).items[0] });
    holdSpecial = false; pendingSpecial.splice(0).forEach(resolve => resolve()); await page.waitForTimeout(500);
    missingUnit = true; await fresh();
    await pick('itemName', '12 AUDIT GLASS'); await field('pcs').fill('12'); await add(); await waitRows(1);
    observations.push({ name: 'Missing category billing unit falls back to pieces display', row: (await draft()).items[0] });
    missingUnit = false; await fresh(); await field('pcs').fill('12'); await add(); await waitRows(1);
    await pick('itemName', '8 OTHER GLASS'); await field('pcs').fill('24');
    await page.getByRole('button', { name: /Create order/ }).click();
    observations.push({ name: 'Unadded second item does not prevent save dialog', saveDialogVisible: await page.getByRole('button', { name: 'Save only', exact: true }).isVisible(), addedCount: (await draft()).items.length });
    observations.push({ name: 'Browser runtime errors during scenarios', errors });
    console.log(JSON.stringify(observations, null, 2));
  } finally {
    holdSpecial = false; pendingSpecial.splice(0).forEach(resolve => resolve());
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
