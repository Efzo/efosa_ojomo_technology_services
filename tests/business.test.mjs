import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', js)(name => name in mocks ? mocks[name] : require(name), exports);
  return exports;
}
const config = load('src/lib/business/config.ts');
const businessFields = load('src/lib/business/fields.ts', { './config': config });
const { parseMoney, calendarDate, invoiceState, netPayments, engagementProblem, todayInAustin, schemas } = config;

test('USD input uses exact integer cents and rejects invalid / oversized amounts', () => {
  for (const [input, cents] of [['0', 0], ['0.01', 1], ['12.3', 1230], ['1000.99', 100099]]) assert.equal(parseMoney(input), cents);
  for (const value of ['-1', '1.001', '1e4', 'NaN', '10,000', '10000000', '']) assert.throws(() => parseMoney(value));
});
test('dates reject impossible days without throwing and retain Austin calendar boundaries', () => {
  for (const value of ['2026-02-29', '2026-13-01', '2026-00-01', '2026-01-00', '2026-04-31', 'bad']) assert.equal(calendarDate.safeParse(value).success, false);
  assert.equal(calendarDate.safeParse('2028-02-29').success, true);
  assert.equal(todayInAustin(new Date('2026-11-08T02:00:00Z')), '2026-11-07');
});
test('invoice state derives partial, paid, overdue, refunded, draft and void balances', () => {
  const inv = { status: 'ISSUED', subtotalCents: 10000, taxCents: 800, dueDate: '2026-11-10', payments: [] };
  assert.deepEqual(invoiceState(inv, '2026-11-07'), { total: 10800, paid: 0, balance: 10800, state: 'ISSUED' });
  const payments = [{ kind: 'PAYMENT', amountCents: 10800 }, { kind: 'REFUND', amountCents: 800 }];
  assert.equal(netPayments(payments), 10000);
  assert.equal(invoiceState({ ...inv, payments }, '2026-11-07').state, 'PARTIAL');
  assert.equal(invoiceState({ ...inv, payments }, '2026-11-11').state, 'OVERDUE');
  assert.equal(invoiceState({ ...inv, payments: payments.slice(0, 1) }, '2026-11-11').state, 'PAID');
  assert.equal(invoiceState({ ...inv, status: 'DRAFT' }, '2026-11-11').state, 'DRAFT');
  assert.equal(invoiceState({ ...inv, status: 'VOID' }, '2026-11-11').balance, 0);
});
test('kickoff and completion require agreement, payment evidence, checks, and care boundaries', () => {
  const data = { status: 'ACTIVE', kind: 'PROJECT', signedDate: '', agreementUrl: '', initialPaymentReference: '', acceptance: '', acceptedDate: '', monthlyMinutes: 0, coverage: '', serviceHours: '', responseTarget: '', rolloverTerms: '', cancellationTerms: '', startDate: '', dueDate: '' };
  assert.match(engagementProblem(data), /Before delivery/);
  const ready = { ...data, signedDate: '2026-11-01', agreementUrl: 'https://example.test/agreement', initialPaymentReference: 'BANK-1', acceptance: 'Form delivers the inquiry.' };
  assert.equal(engagementProblem(ready), null);
  assert.match(engagementProblem({ ...ready, status: 'COMPLETE' }), /acceptance date/);
  assert.match(engagementProblem({ ...ready, kind: 'RETAINER' }), /Monthly care/);
  assert.equal(engagementProblem({ ...ready, kind: 'RETAINER', monthlyMinutes: 240, coverage: 'Named website', serviceHours: 'Weekdays, Central', responseTarget: 'Next business day acknowledgment', rolloverTerms: 'No rollover; approve overage', cancellationTerms: '30 days notice' }), null);
  assert.match(engagementProblem({ ...ready, startDate: '2026-12-01', dueDate: '2026-11-01' }), /before the start/);
});
test('schemas strip unknown fields, validate relationships, URLs, integer minutes, and status', () => {
  const task = { title: 'Review scope', engagementId: '', status: 'TODO', category: 'DELIVERY', priority: 'NORMAL', dueDate: '', owner: 'Efosa', notes: '', seedKey: 'unauthorized-key' };
  const parsed = schemas.task.parse(task);
  assert.equal(parsed.seedKey, undefined);
  assert.equal(schemas.task.safeParse({ ...task, status: 'made-up' }).success, false);
  assert.equal(schemas.time.safeParse({ engagementId: 'e', date: '2026-11-07', minutes: '0', description: 'Work' }).success, false);
  assert.equal(schemas.document.safeParse({ clientId: 'c', engagementId: '', title: 'Scope', kind: 'SOW', status: 'DRAFT', body: 'Scoped work', externalUrl: 'javascript:alert(1)' }).success, false);
});
test('business access uses current database role and fails closed for missing accounts / sessions', async () => {
  const env = { ...process.env }; Object.assign(process.env, { DEMO_MODE: 'false', DATABASE_URL: 'postgresql://test' });
  let user = { id: 'owner', role: 'OWNER' }, session = { user: { email: 'owner@example.test', role: 'OWNER' } };
  const access = load('src/lib/business/access.ts', { 'next-auth': { getServerSession: async () => session }, '@/lib/auth': { authOptions: {} }, '@/lib/prisma': { prisma: { user: { findUnique: async () => user } } } });
  try {
    assert.equal(await access.requireBusinessOwner(), 'owner');
    for (const role of ['EDITOR', 'VIEWER']) { user = { id: 'owner', role }; await assert.rejects(access.requireBusinessOwner(), /restricted/); }
    user = null; await assert.rejects(access.requireBusinessOwner(), /restricted/);
    session = null; await assert.rejects(access.requireBusinessOwner(), /Sign in/);
  } finally { process.env = env; }
});
test('unauthorized actions never reach persistence; demo saves are refused', async () => {
  let transactions = 0;
  const baseMocks = { '@prisma/client': require('@prisma/client'), 'next/cache': { revalidatePath() {} }, '@/lib/prisma': { prisma: { $transaction: () => { transactions++; } } }, '@/lib/business/config': config, '@/lib/business/fields': businessFields };
  const denied = load('src/app/actions/business.ts', { ...baseMocks, '@/lib/business/access': { requireBusinessOwner: async () => { throw new Error('Business operations is restricted to the owner.'); }, businessDatabaseReady: () => true } });
  assert.equal((await denied.saveBusinessRecord('client', {})).success, false);
  assert.equal((await denied.recordBusinessPayment({})).success, false);
  assert.equal((await denied.importBusinessLead('lead')).success, false);
  const demo = load('src/app/actions/business.ts', { ...baseMocks, '@/lib/business/access': { requireBusinessOwner: async () => null, businessDatabaseReady: () => false } });
  assert.equal((await demo.saveBusinessRecord('task', {})).success, false);
  assert.equal((await demo.initializeBusinessChecklist()).success, false);
  assert.equal(transactions, 0);
});
test('CSV quotes cells and neutralizes formula injection including leading whitespace', () => {
  const { csvCell } = load('src/lib/business/csv.ts');
  assert.equal(csvCell('A "quote", here'), '"A ""quote"", here"');
  for (const input of ['=SUM(A1)', '+cmd', '-cmd', '@cmd', '  =cmd', '\tcmd']) assert.ok(csvCell(input).startsWith('"\''));
});

test('workspace errors distinguish missing schema from connectivity without exposing provider details', () => {
  const { businessWorkspaceIssue } = load('src/lib/business/availability.ts');
  for (const code of ['P2021', 'P2022']) {
    const issue = businessWorkspaceIssue({ code, message: 'secret-connection-string' });
    assert.match(issue.title, /database update required/); assert.match(issue.message, /database is reachable/); assert.ok(!JSON.stringify(issue).includes('secret-connection'));
  }
  for (const code of ['P1000', 'P1001', 'P1002', 'P1008', 'P1017', 'P2024']) assert.match(businessWorkspaceIssue({ errorCode: code }).title, /connection unavailable/);
  const unknown = businessWorkspaceIssue({ code: 'secret-url', message: 'sensitive value' });
  assert.equal(unknown.code, 'unknown'); assert.match(unknown.title, /temporarily unavailable/); assert.ok(!JSON.stringify(unknown).includes('sensitive value'));
});
test('missing business tables produce a migration-specific state instead of claiming storage is disconnected', async () => {
  const availability = load('src/lib/business/availability.ts');
  const originalError = console.error; const logged = []; console.error = (...args) => logged.push(args);
  const data = load('src/lib/business/data.ts', { './availability': availability, './config': config, './access': { requireBusinessOwner: async () => 'owner', businessDatabaseReady: () => true }, '@/lib/prisma': { prisma: { businessClient: { findMany: async () => { throw { code: 'P2021', message: 'private-password' }; } }, businessEngagement: { findMany: async () => [] }, siteSetting: { findUnique: async () => null } } } });
  try {
    const result = await data.getBusinessWorkspace('overview', '', 1, '');
    assert.equal(result.available, false); assert.equal(result.issue.title, 'Workspace database update required');
    assert.match(result.message, /database is reachable/); assert.ok(!JSON.stringify(result).includes('private-password'));
    assert.deepEqual(logged, [['[business] workspace_read_failed', 'P2021']]);
  } finally { console.error = originalError; }
});
