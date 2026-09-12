// Real browser test of the production form with an isolated fixture API.
// No requests are forwarded to a running OMS server or real customer data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { buildSync } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const booking = { id: 2, code: 'BKG-00002', customerName: 'TEST PARTY', bookingDate: '2026-06-18',
  status: 'PARTIALLY_CONVERTED', bags: 300, kgs: 21000, remainingBags: 299, remainingKgs: 20930,
  items: [{pCategory: 'GLASS', bags: 300, kgs: 21000, remainingBags: 299, remainingKgs: 20930}] };
const lookups = { customers: [{id: 1, name: 'TEST PARTY', agentName: 'SELF', category: 'SALES'}],
  productRows: [{product: 'TEST GLASS', category: 'GLASS', subCategory: 'PLAIN', size: 7.5, pcs: 12, weight: 0.25, rate: 500},
    {product: 'OTHER GLASS', category: 'GLASS', subCategory: 'PLAIN', size: 8, pcs: 6, weight: 0.5, rate: 600}],
  designs: [], designNames: [], categories: ['GLASS'], subCategories:['PLAIN'], products: [], categoryFields: [{category:'GLASS',field:'KGS'}], agents: ['SELF'] };
let failQuote = false;
let delayQuote = false;
const submitted = [];
const quotes = [];
const bundle = buildSync({ stdin: { contents: `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter, Routes, Route } from 'react-router-dom';
  import { TooltipProvider } from '@/components/ui/tooltip';
  import { ConfirmProvider } from '@/components/common/confirm';
  import { Toaster } from 'sonner';
  import { OrderFormPage } from '@/features/orders/order-form-page';
  import { useAuthStore } from '@/stores/auth-store';
  useAuthStore.setState({user: {id: 'fixture', name: 'Tester', permissions: ['*']}, isBootstrapping: false});
  const nav = location.search.includes('from-booking') ? {pathname: '/orders/new', key: location.search.includes('fresh') ? 'fresh' : 'default', state: {customerName:'TEST PARTY',openBookingDraw:true,bookingId:2}} : '/orders/new';
  createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}>
    <TooltipProvider><ConfirmProvider><MemoryRouter initialEntries={[nav]}><Routes>
      <Route path="/orders/new" element={<OrderFormPage />} />
      <Route path="*" element={<p>Saved fixture order</p>} />
    </Routes></MemoryRouter><Toaster /></ConfirmProvider></TooltipProvider>
  </QueryClientProvider>);
`, resolveDir: path.join(root, 'apps/web/src'), loader: 'tsx' }, bundle: true, platform: 'browser', format: 'esm',
  tsconfig: path.join(root, 'apps/web/tsconfig.json'), define: {'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"'}, write: false });
const cssDir = path.join(root, 'apps/web/dist/assets');
const css = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir,f),'utf8')).join('\n') : '';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/bundle.js') { res.setHeader('Content-Type','application/javascript'); return res.end(bundle.outputFiles[0].text); }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type','text/css'); return res.end(css); }
  if (!url.pathname.startsWith('/api/')) { res.setHeader('Content-Type','text/html'); return res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="padding:16px"><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); }
  const body = []; for await (const c of req) body.push(c);
  const input = body.length ? JSON.parse(Buffer.concat(body).toString()) : null;
  let data = [];
  switch(url.pathname) {
    case '/api/orders/lookups': data = lookups; break;
    case '/api/settings': data = [{group:'ORDER_TYPE',value:'SALES ORDER',sortOrder:0},{group:'COMPLETION_DAY',value:'7',sortOrder:0}]; break;
    case '/api/settings/order-qty-layout': data = {default:['bags','pcs','kgs','box'],byCategory:{}}; break;
    case '/api/special-rates': data = {rates:[],logos:[],bagWeights:[{category:'GLASS',kgsPerBag:70}]}; break;
    case '/api/agent-commission/rates/customer-add-ons/1': data = {bases:[],specials:[]}; break;
    case '/api/bookings': data = {items:[booking],total:1,page:1,pageSize:200}; break;
    case '/api/bookings/2': data = booking; break;
    case '/api/bookings/2/quote': {
      quotes.push(input);
      if (failQuote) { res.statusCode = 400; data = {message:'Fixture price unavailable'}; break; }
      if (delayQuote) await new Promise(r => setTimeout(r, 500));
      const price = input.lines[0].product === 'OTHER GLASS' ? 250 : 200;
      data = {bookingDate:booking.bookingDate,lines:[{productRate:price,productDelta:0,designRate:0,designDelta:0,rate:price}]}; break;
    }
    case '/api/orders':
      if (req.method === 'POST') { submitted.push(input); data = {...input,id:40,code:'TEST-40'}; }
      else data = {items:[],total:0};
      break;
    default:
      if (req.method !== 'GET') { res.statusCode = 400; data = {message:'Unexpected fixture write: '+url.pathname}; }
  }
  res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data));
});

(async () => {
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})});
  const page = await browser.newPage({viewport:{width:1366,height:950}});
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror',e => errors.push(e.message));
  const base = 'http://127.0.0.1:' + server.address().port;
  const field = name => page.locator('[data-tabfield="'+name+'"] input').first();
  // Polls the LOCATOR, not a selector string. Two earlier versions polled the
  // DOM by hand — one stamped a marker attribute React dropped on re-render, the
  // next re-derived a selector that could resolve to a different node than the
  // locator had — and both timed out on fields that had in fact updated.
  const expectValue = async (locator,value) => {
    await locator.waitFor();
    const deadline = Date.now() + 10000;
    let seen;
    while (Date.now() < deadline) {
      seen = await locator.inputValue().catch(() => undefined);
      if (seen === value) return;
      await page.waitForTimeout(50);
    }
    throw new assert.AssertionError({message:`field never reached ${JSON.stringify(value)} (last ${JSON.stringify(seen)})`, actual:seen, expected:value});
  };
  // The item/booking pickers commit on a 120ms blur timer (see Combobox.onBlur),
  // so machine-speed typing can land inside that window on a field the timer is
  // about to rewrite. A person never types that fast; the test waits it out too.
  const settle = () => page.waitForTimeout(250);
  const pick = async (locator, text) => { await locator.fill(text); await page.getByRole('option').filter({hasText:text}).first().click({force:true}); await settle(); };
  try {
    await page.goto(base);
    await pick(field('customer'),'TEST PARTY');
    await pick(field('itemName'),'7.5 TEST GLASS');
    await expectValue(field('productRate'),'500');
    await pick(page.locator('#order-booking'),'BKG-00002');
    await expectValue(field('productRate'),'200');
    assert.equal(await field('productRate').getAttribute('readonly'),'');
    await field('bags').fill('3'); await expectValue(field('gram'),'210');
    await pick(page.locator('#order-booking'),'Current price list');
    await expectValue(field('productRate'),'500');
    await pick(page.locator('#order-booking'),'BKG-00002');
    await expectValue(field('productRate'),'200');
    await pick(field('itemName'),'7.5 TEST GLASS');
    await expectValue(field('productRate'),'200');
    await page.getByRole('button',{name:'Add item',exact:true}).click();
    await page.getByRole('button',{name:'Edit',exact:true}).click();
    await page.waitForFunction(() => document.activeElement?.closest('[data-tabfield="itemName"]')); await settle(); 
    await field('bags').fill('4'); await expectValue(field('gram'),'280');
    await page.getByRole('button',{name:'Update item',exact:true}).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('oms:order-draft-v1') || '{}').items?.[0]?.bags === '4');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('oms:order-draft-v1')).bookingSource),'2');
    await page.reload();
    await page.getByRole('button',{name:'Edit',exact:true}).waitFor();
    await page.waitForFunction(() => document.querySelector('#order-booking')?.value.includes('BKG-00002')); 
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Edit item',exact:true}).click();
    await page.waitForFunction(() => document.activeElement?.closest('[data-tabfield="itemName"]')); await settle(); 
    await expectValue(field('productRate'),'200');
    // Bags -> Kgs still cascades on a booking line, on a phone, after a reload.
    // Box <-> Pcs is deliberately NOT exercised here: it belongs to the quantity
    // fields' own behaviour, not to booking entry, and driving it at machine
    // speed fights the number input's own intermediate values.
    await field('bags').fill('5'); await expectValue(field('gram'),'350');
    await page.getByRole('button',{name:'Update item',exact:true}).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile has no horizontal page overflow');
    await page.setViewportSize({width:1366,height:950});
    // Change to an uncached item; fail, then retry, without adding a stale rate.
    failQuote = true;
    await pick(field('itemName'),'8 OTHER GLASS');
    await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
    assert.equal(await field('productRate').inputValue(),'');
    assert.equal(await page.getByRole('button',{name:'Add item',exact:true}).isDisabled(),true);
    failQuote = false;
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await expectValue(field('productRate'),'250');
    // Switching to a previously priced item must not keep the failed item's rate.
    await pick(field('itemName'),'7.5 TEST GLASS'); await expectValue(field('productRate'),'200');
    await page.getByRole('button',{name:/Save as Draft/i}).click();
    await page.getByRole('button',{name:'Save draft',exact:true}).click();
    await page.waitForFunction(() => document.body.textContent.includes('Saved fixture order'));
    assert.equal(submitted.length,1);
    assert.equal(submitted[0].items[0].psize,7.5);
    assert.equal(submitted[0].items[0].rate,200);
    assert.equal(submitted[0].items[0].bookingId,2);
    assert.equal(submitted[0].items[0].bags,5);
    assert.equal(submitted[0].items[0].gram,350);
    assert.equal(quotes[0].lines[0].psize,7.5);
    // The Booking list shortcut must preserve its selected booking in auto-save.
    await page.goto(base+'/?from-booking');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('oms:order-draft-v1') || '{}').bookingSource === '2');
    assert.match(await page.locator('#order-booking').inputValue(),/BKG-00002/);
    await pick(field('itemName'),'7.5 TEST GLASS');
    await expectValue(field('productRate'),'200');
    await field('bags').fill('2'); await expectValue(field('gram'),'140');
    await page.getByRole('button',{name:'Add item',exact:true}).click();
    await field('poNumber').fill('REFRESH-TEST');
    // A changed price choice must also survive: it is for the next item only.
    await pick(page.locator('#order-booking'),'Current price list');
    await page.waitForFunction(() => {
      const d = JSON.parse(localStorage.getItem('oms:order-draft-v1') || '{}');
      return d.items?.length === 1 && d.poNumber === 'REFRESH-TEST' && d.bookingSource === '';
    });
    await page.reload();
    await page.getByRole('button',{name:'Edit',exact:true}).waitFor();
    await expectValue(field('poNumber'),'REFRESH-TEST');
    await expectValue(page.locator('#order-booking'),'Current price list');
    await settle(); await settle(); await settle();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('oms:order-draft-v1')).items.length),1);
    // A new navigation from Bookings must not restore a previous order's items.
    await page.goto(base+'/?from-booking&fresh');
    await page.waitForFunction(() => document.querySelector('#order-booking')?.value.includes('BKG-00002'));
    await expectValue(field('poNumber'),'');
    assert.equal(await page.getByRole('button',{name:'Edit',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: actual form prices, cached quotes, size payload, desktop/mobile editing, quantity calculations, draft refresh, retry and booking shortcut');
  } catch(e) {
    console.error('PAGE ERRORS',errors);
    console.error(await page.locator('input').evaluateAll(es => es.map(e => [e.closest('[data-tabfield]')?.getAttribute('data-tabfield'),e.value])));
    console.error((await page.locator('body').innerText()).slice(-5000));
    throw e;
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); server.close(); process.exitCode=1; });
