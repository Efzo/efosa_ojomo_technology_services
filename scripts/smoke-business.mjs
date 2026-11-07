// Run only against a disposable local database containing the workspace migration.
// BUSINESS_TEST_DATABASE_URL=postgresql://.../portfolio_business_test node scripts/smoke-business.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import bcrypt from 'bcryptjs';
const require = createRequire(import.meta.url);
const url = process.env.BUSINESS_TEST_DATABASE_URL;
if (!url) throw new Error('Set BUSINESS_TEST_DATABASE_URL to a disposable local database. The configured application database is never used.');
const target = new URL(url);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('/portfolio_business_test')) throw new Error('Refusing to run outside the isolated local portfolio_business_test database.');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url } } });
function load(file, mocks = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', js)(name => name in mocks ? mocks[name] : require(name), exports);
  return exports;
}
const config = load('src/lib/business/config.ts');
const fields = load('src/lib/business/fields.ts', { './config': config }).fields;
const session = { user: { email: 'business-owner@example.test', role: 'OWNER' } };
const access = load('src/lib/business/access.ts', { 'next-auth': { getServerSession: async () => session }, '@/lib/auth': { authOptions: {} }, '@/lib/prisma': { prisma } });
const mocks = { '@/lib/prisma': { prisma }, '@/lib/business/access': access, '@/lib/business/config': config, '@/lib/business/fields': { fields }, 'next/cache': { revalidatePath() {} } };
const actions = load('src/app/actions/business.ts', mocks);
const dataModule = load('src/lib/business/data.ts', { '@/lib/prisma': { prisma }, './access': access, './config': config });
const original = { ...process.env };
Object.assign(process.env, { DEMO_MODE: 'false', DATABASE_URL: url });
const today = config.todayInAustin();
function input(entity, changes = {}) {
  const values = Object.fromEntries(fields[entity].map(f => [f.name, f.choices?.[0] ?? (f.type === 'date' ? today : f.type === 'money' ? '0.00' : '')]));
  if (entity === 'engagement') Object.assign(values, { monthlyMinutes: '0' });
  return { ...values, ...changes };
}
function formRow(entity, row) { return { ...Object.fromEntries(fields[entity].map(f => [f.name, f.type === 'money' ? (row[f.name] / 100).toFixed(2) : String(row[f.name] ?? '')])), id: row.id, version: row.version }; }
async function save(entity, item) { const result = await actions.saveBusinessRecord(entity, item); assert.equal(result.success, true, result.message); return result.id; }
try {
  await prisma.user.upsert({ where: { email: session.user.email }, update: { role: 'OWNER' }, create: { email: session.user.email, name: 'Local Test Owner', role: 'OWNER', password: await bcrypt.hash('Local-business-portal-2026!', 10) } });
  const unique = Date.now();
  const clientId = await save('client', input('client', { company: `Austin Demo Studio ${unique}`, contactName: 'Alex Demo', email: 'alex@example.test', status: 'ACTIVE', source: 'Local test', nextAction: 'Review the website proposal', followUpDate: today }));
  const otherClient = await save('client', input('client', { company: 'Second Demo Business', contactName: 'Sam Demo', email: 'sam@example.test' }));
  const proposalId = await save('engagement', input('engagement', { clientId, title: 'Business website delivery', service: 'website', feeCents: '1200.00', scope: 'Five pages and one inquiry form', acceptance: 'Form delivers the inquiry and pages display on mobile.', dueDate: today }));
  assert.equal(await prisma.businessTask.count({ where: { engagementId: proposalId } }), 6);
  let project = await prisma.businessEngagement.findUniqueOrThrow({ where: { id: proposalId } });
  assert.equal((await actions.saveBusinessRecord('engagement', { ...formRow('engagement', project), status: 'ACTIVE' })).success, false, 'missing agreement/payment blocks kickoff');
  await save('engagement', { ...formRow('engagement', project), status: 'ACTIVE', agreementUrl: 'https://example.test/private/agreement', signedDate: today, initialPaymentReference: 'Agreed split payment, local test' });
  assert.equal((await actions.saveBusinessRecord('engagement', { ...formRow('engagement', project), notes: 'stale' })).success, false, 'stale version is rejected');
  project = await prisma.businessEngagement.findUniqueOrThrow({ where: { id: proposalId } });
  assert.equal((await actions.saveBusinessRecord('engagement', { ...formRow('engagement', project), clientId: otherClient })).success, false, 'cannot move engagement to another client');
  const careId = await save('engagement', input('engagement', { clientId, title: 'Website monthly care', service: 'care', kind: 'RETAINER', feeCents: '350.00', scope: 'Named website maintenance', monthlyMinutes: '240', renewalDate: today }));
  await save('time', input('time', { engagementId: careId, minutes: '90', description: 'Backup and update review' }));
  await save('task', input('task', { title: 'Send Friday update', owner: 'Efosa Ojomo', engagementId: proposalId, dueDate: today }));
  const invoiceInput = input('invoice', { clientId, engagementId: proposalId, number: `INV-LOCAL-${unique}`, description: 'Website milestone', subtotalCents: '100.00', taxCents: '8.00', billedTo: 'Austin Demo Studio', billingEmail: 'alex@example.test' });
  assert.equal((await actions.saveBusinessRecord('invoice', { ...invoiceInput, status: 'ISSUED' })).success, false);
  assert.equal((await actions.saveBusinessRecord('invoice', { ...invoiceInput, clientId: otherClient })).success, false, 'invoice/client relationship validated');
  const invoiceId = await save('invoice', invoiceInput);
  let invoice = await prisma.businessInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  await save('invoice', { ...formRow('invoice', invoice), status: 'ISSUED' });
  invoice = await prisma.businessInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  assert.equal((await actions.saveBusinessRecord('invoice', { ...formRow('invoice', invoice), subtotalCents: '200.00' })).success, false, 'issued amount is immutable');
  const payment = { invoiceId, kind: 'PAYMENT', amountCents: '30.00', feeCents: '1.00', date: today, method: 'Bank', reference: `LOCAL-${unique}-1`, notes: 'Verified local fixture' };
  assert.equal((await actions.recordBusinessPayment(payment)).success, true);
  assert.equal((await actions.recordBusinessPayment(payment)).success, false, 'duplicate reference rejected');
  assert.equal((await actions.recordBusinessPayment({ ...payment, amountCents: '1000.00', reference: `LOCAL-${unique}-over` })).success, false);
  const concurrent = await Promise.all([1, 2].map(i => actions.recordBusinessPayment({ ...payment, amountCents: '50.00', feeCents: '0.00', reference: `LOCAL-${unique}-concurrent-${i}` })));
  assert.equal(concurrent.filter(r => r.success).length, 1, 'concurrent payments cannot overpay');
  assert.equal((await actions.recordBusinessPayment({ ...payment, kind: 'REFUND', amountCents: '10.00', feeCents: '0.00', reference: `LOCAL-${unique}-refund` })).success, true);
  assert.equal((await actions.recordBusinessPayment({ ...payment, kind: 'REFUND', amountCents: '100.00', feeCents: '0.00', reference: `LOCAL-${unique}-over-refund` })).success, false);
  invoice = await prisma.businessInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  assert.equal((await actions.saveBusinessRecord('invoice', { ...formRow('invoice', invoice), status: 'VOID' })).success, false, 'payment history prevents void');
  await save('expense', input('expense', { vendor: 'Demo hosting provider', description: 'Local test hosting expense', amountCents: '25.00' }));
  const documentId = await save('document', input('document', { clientId, engagementId: proposalId, title: 'Acme external proposal', folder: 'PROPOSALS', body: '' }));
  await save('document', input('document', { clientId: otherClient, title: 'Other client private record', folder: 'AGREEMENTS', body: '' }));
  const documentHelpers = load('src/lib/business/document-files.ts', { './config': config });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: session.user.email } });
  const storage = new Map();
  const { registerDocumentFile } = load('src/lib/business/register-document-file.ts', { '@/lib/prisma': { prisma }, './document-files': documentHelpers, '@vercel/blob': { head: async path => { assert.ok(storage.has(path)); return storage.get(path); } } });
  function fileInput(index, status = 'DRAFT') {
    const pathname = `business-documents/${documentId}/${owner.id}/12345678-1234-1234-1234-123456789abc/proposal-${unique}-${index}.pdf`;
    storage.set(pathname, { pathname, url: `https://test.private.blob.vercel-storage.com/${pathname}`, size: 1000 + index, contentType: 'application/pdf' });
    return { documentId, ownerId: owner.id, pathname, filename: `Acme proposal v${index}.pdf`, revisionNote: `External proposal revision ${index}`, status, sentDate: status === 'SHARED' ? today : '', signedDate: status === 'SIGNED' ? today : '' };
  }
  const firstFile = fileInput(1);
  const retried = await Promise.all([registerDocumentFile(firstFile), registerDocumentFile(firstFile)]);
  assert.equal(retried[0].file.id, retried[1].file.id, 'callback/completion race is idempotent');
  await registerDocumentFile(fileInput(2, 'SIGNED'));
  const files = await prisma.businessDocumentFile.findMany({ where: { documentId }, orderBy: { revision: 'asc' } });
  assert.deepEqual(files.map(f => f.revision), [1, 2]); assert.equal(files[0].filename, 'Acme proposal v1.pdf');
  const document = await prisma.businessDocument.findUniqueOrThrow({ where: { id: documentId } });
  assert.equal(document.status, 'SIGNED'); assert.equal(document.version, 2);
  assert.equal((await actions.saveBusinessRecord('document', { ...formRow('document', document), version: 0 })).success, false, 'file upload invalidates stale metadata edits');
  assert.equal((await actions.saveBusinessRecord('document', { ...formRow('document', document), clientId: otherClient })).success, false, 'file records cannot move to another client');
  await save('document', { ...formRow('document', document), body: 'Signed file retained for the client record' });
  const library = await dataModule.getBusinessWorkspace('documents', '', 1, '', '', { clientId, folder: 'PROPOSALS' });
  assert.equal(library.available, true); assert.ok(library.rows.every(r => r.clientId === clientId && r.folder === 'PROPOSALS')); assert.equal(library.rows.find(r => r.id === documentId).fileCount, 2);
  console.log('PASS: client-specific library, category filtering, immutable file versions, concurrent callback idempotency, signed-file evidence, and stale edit protection (real PostgreSQL; mocked Blob metadata).');
  assert.equal((await actions.initializeBusinessChecklist()).success, true);
  const setupCount = await prisma.businessTask.count({ where: { seedKey: { startsWith: 'business-setup-v1:' } } });
  assert.equal((await actions.initializeBusinessChecklist()).success, true);
  assert.equal(await prisma.businessTask.count({ where: { seedKey: { startsWith: 'business-setup-v1:' } } }), setupCount);
  const lead = await prisma.lead.create({ data: { name: 'Taylor Demo', email: 'taylor@example.test', company: 'Demo Local Services', serviceRequested: 'Business automation', challenge: 'We need to route new inquiries to the correct person.', timeline: 'short-term', consentAt: new Date() } });
  assert.equal((await actions.importBusinessLead(lead.id)).success, true);
  assert.equal((await actions.importBusinessLead(lead.id)).success, false);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, 'NEW');
  const invoices = await dataModule.getBusinessWorkspace('invoices', invoiceInput.number, 1, '');
  assert.equal(invoices.available, true); assert.equal(invoices.rows[0].balanceCents, 3800);
  const care = await dataModule.getBusinessWorkspace('retainers', 'Website monthly care', 1, '');
  assert.equal(care.rows.find(r => r.id === careId).usedMinutes, 90);
  const dashboard = await dataModule.getBusinessWorkspace('overview', '', 1, '');
  assert.equal(dashboard.available, true); assert.ok(dashboard.summary.monthlyCollectedCents >= 7000); assert.ok(dashboard.summary.outstandingCents >= 3800);
  assert.ok(dashboard.followUps.some(c => c.id === clientId));
  assert.ok(await prisma.auditEvent.count({ where: { action: { startsWith: 'business.' } } }) > 15);
  console.log('PASS: real PostgreSQL migration, contacts, inquiry import, service checklists, kickoff gates, stale edits, invoice immutability, partial payments, concurrent overpayment protection, refunds, expenses, time/capacity, documents, setup idempotency, dashboard and audit records.');
} finally { process.env = original; await prisma.$disconnect(); }
