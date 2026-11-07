import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  const js = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', js)(name => name in mocks ? mocks[name] : require(name), exports);
  return exports;
}
const config = load('src/lib/business/config.ts');
const definitions = load('src/lib/business/fields.ts', { './config': config });
const baseData = () => ({ available: true, message: '', rows: [], total: 0, page: 1, pages: 1, clients: [{ id: 'c1', label: 'First Business · Alex', email: 'alex@example.test', address: 'First address' }, { id: 'c2', label: 'Second Business · Sam', email: 'sam@example.test', address: 'Second address' }], engagements: [{ id: 'e1', label: 'First website', clientId: 'c1' }, { id: 'e2', label: 'Second website', clientId: 'c2' }], optionsLimited: false, leads: [], payments: {}, profile: { name: config.BUSINESS_NAME, email: 'owner@example.test', address: 'Austin, Texas', paymentInstructions: '', weeklyHours: 20 }, summary: {}, followUps: [], dueTasks: [], renewals: [] });
async function mount(section, data, options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `http://localhost/admin/business/${section}` });
  const previous = { window: globalThis.window, document: globalThis.document, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), flag: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator }); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const params = new URLSearchParams(options.search ?? "");
  const Component = load('src/components/admin/business/BusinessWorkspace.tsx', { './business.css': {}, './DocumentFiles': { __esModule: true, default: () => null }, 'next/link': { __esModule: true, default: ({ children, ...props }) => createElement('a', props, children) }, 'next/navigation': { useRouter: () => ({ refresh() {} }), useSearchParams: () => params }, '@/lib/business/config': config, '@/lib/business/fields': definitions, '@/app/actions/business': {} }).default;
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(createElement(Component, { section, data, query: '', status: '', clientId: options.clientId ?? '', folder: options.folder ?? '' })));
  return { dom, async close() { await act(async () => root.unmount()); dom.window.close(); globalThis.window = previous.window; globalThis.document = previous.document; if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator); globalThis.IS_REACT_ACT_ENVIRONMENT = previous.flag; } };
}
async function click(text) { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text); assert.ok(button, `Button: ${text}`); await act(async () => button.click()); }
function control(label) { const el = [...document.querySelectorAll('dialog label')].find(l => l.querySelector('span')?.textContent.startsWith(label)); assert.ok(el, label); return el.querySelector('input,select,textarea'); }

test('invoice form copies billing identity and limits engagement options to the selected client', async () => {
  const mounted = await mount('invoices', baseData());
  try {
    await click('Add invoice');
    const client = control('Client');
    await act(async () => { client.value = 'c1'; client.dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert.equal(control('Bill to:').value, 'First Business'); assert.equal(control('Billing email').value, 'alex@example.test');
    assert.ok([...control('Engagement').options].some(o => o.value === 'e1')); assert.ok(![...control('Engagement').options].some(o => o.value === 'e2'));
    await act(async () => { client.value = 'c2'; client.dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert.equal(control('Billing email').value, 'sam@example.test'); assert.equal(control('Billing address').value, 'Second address');
    assert.ok(![...control('Engagement').options].some(o => o.value === 'e1'));
  } finally { await mounted.close(); }
});
test('printable invoice lives outside the admin layout and escapes stored text', async () => {
  const data = baseData(); data.rows = [{ id: 'i1', version: 0, clientId: 'c1', number: 'INV-TEST', status: 'ISSUED', displayStatus: 'PARTIAL', description: '<script>alert(1)</script>', subtotalCents: 10000, taxCents: 800, totalCents: 10800, netPaidCents: 7000, balanceCents: 3800, billedTo: 'First Business', billingEmail: 'alex@example.test', billingAddress: 'Austin', issueDate: '2026-11-07', dueDate: '2026-11-10', notes: '', paymentUrl: '' }]; data.total = 1;
  const mounted = await mount('invoices', data);
  try {
    await click('Preview / print');
    const print = document.querySelector('body > .business-print-root');
    assert.ok(print, 'print content has an independent document-level container');
    assert.ok(print.textContent.includes('$38.00')); assert.ok(print.textContent.includes('<script>alert(1)</script>'));
    assert.equal(print.querySelector('script'), null); assert.ok(!print.textContent.includes('Website inquiries'));
    await act(async () => document.querySelector('[aria-label="Close record"]').click());
    assert.equal(document.querySelector('.business-print-root'), null);
  } finally { await mounted.close(); }
});

test('client records open a dedicated library and new upload records keep the selected client', async () => {
  const data = baseData(); data.rows = [{ id: 'c1', version: 0, company: 'Acme', contactName: 'Alex', email: 'alex@example.test', phone: '', billingAddress: '', source: '', nextAction: '', followUpDate: '', notes: '', status: 'ACTIVE', documentCount: 2 }]; data.total = 1;
  let mounted = await mount('clients', data);
  try {
    await click('Acme');
    const links = [...document.querySelectorAll('dialog a')];
    assert.ok(links.some(a => a.getAttribute('href') === '/admin/business/documents?client=c1'));
    assert.ok(links.some(a => a.getAttribute('href') === '/admin/business/documents?client=c1&new=1'));
  } finally { await mounted.close(); }
  mounted = await mount('documents', baseData(), { search: 'client=c1&new=1', clientId: 'c1' });
  try {
    assert.ok(document.querySelector('dialog[open]'));
    assert.equal(control('Client').value, 'c1');
    assert.equal(control('Notes / document text').required, false);
    assert.ok([...control('Document type').options].some(o => o.value === 'AGREEMENT'));
    assert.ok(document.querySelector('dialog').textContent.includes('Save this document record first'));
  } finally { await mounted.close(); }
});
