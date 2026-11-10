import { publicCacheMock } from "./helpers/public-cache.mjs";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
// Load the actual server modules with isolated dependencies. No database or email is contacted.
function load(file, mocks = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', js)((name) => name in mocks ? mocks[name] : name === '@/lib/public-cache' ? publicCacheMock(mocks) : name === '@/lib/admin-session-settings' ? { getAdminIdleTimeoutMinutes: async () => 60 } : name === '@/lib/admin-session' ? load('src/lib/admin-session.ts') : require(name), exports);
  return exports;
}
const catalog = JSON.parse(readFileSync(new URL('../src/data/consulting.json', import.meta.url)));
const dbMocks = { '@/data/consulting.json': catalog, '@/lib/site-settings': { isSiteSettingsDatabaseReady: () => true } };

test('engagement defaults cover all models; unpublished records stay unpublished', async () => {
  const empty = load('src/lib/engagements.ts', { ...dbMocks, '@/lib/prisma': { prisma: { engagementModel: { findMany: async () => [] }, siteSetting: { findUnique: async () => null } } } });
  assert.equal((await empty.getEngagementModels()).length, 3);
  const unpublished = load('src/lib/engagements.ts', { ...dbMocks, '@/lib/prisma': { prisma: { engagementModel: { findMany: async () => [{ slug: 'private', isPublished: false }] } } } });
  assert.deepEqual(await unpublished.getEngagementModels(), []);
  assert.equal(await unpublished.getEngagementModel('private'), null);
});

test('case study detail never returns a draft; title typo is corrected', async () => {
  const rows = [{ slug: 'draft', isPublished: true, status: 'DRAFT', title: 'Private' }, { id: 'x', slug: 'clinchdesk', isPublished: true, status: 'PUBLISHED', title: 'ClincDdesk' }];
  const { caseDetailsSchema } = load('src/lib/case-details.ts');
  const cases = load('src/lib/case-studies.ts', { ...dbMocks, '@/lib/case-details': { caseDetailsSchema }, '@/lib/prisma': { prisma: { caseStudy: { findMany: async () => rows }, siteSetting: { findUnique: async () => null } } } });
  assert.equal(await cases.getCaseStudy('draft'), null);
  assert.equal((await cases.getCaseStudy('clinchdesk')).title, 'ClinchDesk');
  assert.equal((await cases.getCaseStudies()).length, 1);
});

function inquiry(overrides = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: 'Test Person', email: 'test@example.com', company: 'Test Company', website: 'example.com', service: 'software-engineering', challenge: 'We need a new customer portal for our team.', timeline: 'short-term', budget: 'undetermined', consent: 'on', 'bot-field': '', ...overrides })) form.set(key, value);
  return form;
}
test('contact rejects bots, missing consent, and invalid URLs before persistence', async () => {
  let writes = 0;
  const action = load('src/app/actions/contact.ts', { '@/lib/prisma': { prisma: { lead: { create: async () => { writes++; } } } } });
  for (const form of [inquiry({ 'bot-field': 'spam' }), inquiry({ consent: '' }), inquiry({ website: 'javascript:alert(1)' }), inquiry({ challenge: 'short' })]) assert.equal((await action.submitInquiry(form)).success, false);
  assert.equal(writes, 0);
});

test('valid contact persists normalized website, sends plain text, and suppresses repeated submissions', async () => {
  const saved = { ...process.env }; const originalFetch = globalThis.fetch;
  Object.assign(process.env, { DEMO_MODE: 'false', DATABASE_URL: 'postgresql://test', RESEND_API_KEY: 'test', BUSINESS_EMAIL: 'owner@example.com', RESEND_FROM_EMAIL: 'hello@example.com' });
  const payloads = []; let writes = 0; let stored;
  globalThis.fetch = async (_url, options) => { payloads.push(JSON.parse(options.body)); return { ok: true }; };
  const action = load('src/app/actions/contact.ts', { '@/lib/prisma': { prisma: { lead: { findFirst: async () => null, create: async ({ data }) => { writes++; stored = data; return { id: 'test' }; } }, auditEvent: { create: async () => ({}) } } } });
  try {
    assert.equal((await action.submitInquiry(inquiry({ name: '<b>Test</b>' }))).success, true);
    assert.equal(stored.website, 'https://example.com');
    assert.equal(payloads.length, 2);
    assert.equal(payloads[0].html, undefined);
    assert.ok(payloads[0].text.includes('<b>Test</b>'));
    assert.equal((await action.submitInquiry(inquiry())).success, false);
    assert.equal(writes, 1);
  } finally { process.env = saved; globalThis.fetch = originalFetch; }
});

test('database outage cannot authenticate using an environment password', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { DEMO_MODE: 'false', DATABASE_URL: 'postgresql://test', ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'test-secret' });
  const { authOptions } = load('src/lib/auth.ts', { 'next-auth/providers/credentials': (options) => options, '@/lib/demo-password': { getDemoPassword: () => 'test-secret' }, '@/lib/prisma': { prisma: { user: { findFirst: async () => { throw new Error('offline'); } } } } });
  try { assert.equal(await authOptions.providers[0].authorize({ email: 'owner@example.com', password: 'test-secret' }), null); }
  finally { process.env = saved; }
});

test('homepage validation requires unique sections and safe internal CTA paths', () => {
  const defaults = JSON.parse(readFileSync(new URL('../src/data/homepage.json', import.meta.url)));
  const { homeSchema } = load('src/lib/home-content.ts', { '@/data/homepage.json': defaults });
  assert.equal(homeSchema.safeParse(defaults).success, true);
  assert.equal(homeSchema.safeParse({ ...defaults, sections: ['hero', 'hero'] }).success, false);
  assert.equal(homeSchema.safeParse({ ...defaults, hero: { ...defaults.hero, primaryHref: '//evil.test' } }).success, false);
});

test('public media checks publication and refuses unreferenced private assets', async () => {
  let storageRead = false;
  const route = load('src/app/api/media/[id]/route.ts', { '@vercel/blob': { get: async () => { storageRead = true; } }, '@/lib/prisma': { prisma: { caseStudy: { findFirst: async () => null }, blogPost: { findFirst: async () => null }, siteSetting: { findUnique: async () => null }, page: { findFirst: async () => null } } } });
  const response = await route.GET(new Request('https://test/api/media/private'), { params: Promise.resolve({ id: 'private' }) });
  assert.equal(response.status, 404);
  assert.equal(storageRead, false);
});

test('published homepage snapshot takes precedence over a newer draft', async () => {
  const defaults = JSON.parse(readFileSync(new URL('../src/data/homepage.json', import.meta.url)));
  const home = load('src/lib/home-content.ts', { '@/data/homepage.json': defaults });
  const published = { ...defaults, hero: { ...defaults.hero, title: 'Published homepage' } };
  let draftRead = false;
  const homepage = load('src/lib/homepage.ts', { '@/lib/home-content': home, '@/lib/managed-pages': { canPreviewPages: async () => false }, '@/lib/site-settings': dbMocks['@/lib/site-settings'], '@/lib/prisma': { prisma: { siteSetting: { findUnique: async () => ({ value: published }) }, page: { findUnique: async () => { draftRead = true; return { status: 'DRAFT', content: defaults }; } } } } });
  assert.equal((await homepage.getHomePageContent()).hero.title, 'Published homepage');
  assert.equal(draftRead, false);
});

test('deleting all initialized engagement records does not restore fallback models', async () => {
  const models = load('src/lib/engagements.ts', { ...dbMocks, '@/lib/prisma': { prisma: { engagementModel: { findMany: async () => [] }, siteSetting: { findUnique: async () => ({ value: true }) } } } });
  assert.deepEqual(await models.getEngagementModels(), []);
});

test('media endpoint refuses non-image attachments even when referenced publicly', async () => {
  let storageRead = false;
  const route = load('src/app/api/media/[id]/route.ts', { '@vercel/blob': { get: async () => { storageRead = true; } }, '@/lib/prisma': { prisma: { caseStudy: { findFirst: async () => ({ id: 'study' }) }, mediaAsset: { findUnique: async () => ({ mimeType: 'application/pdf', storageKey: 'private-document' }) } } } });
  const response = await route.GET(new Request('https://test/api/media/private'), { params: Promise.resolve({ id: 'private' }) });
  assert.equal(response.status, 404);
  assert.equal(storageRead, false);
});

test('a stale JWT cannot open admin pages after its database user is removed', async () => {
  const saved = { ...process.env };
  process.env.DEMO_MODE = 'false';
  const { proxy } = load('src/proxy.ts', { 'next-auth/jwt': { getToken: async () => ({ email: 'removed@example.com', lastActivityAt: Date.now() }) }, '@/lib/prisma': { prisma: { user: { findUnique: async () => null } } } });
  try {
    const response = await proxy({ nextUrl: { pathname: '/admin/leads' }, url: 'https://example.com/admin/leads' });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), 'https://example.com/admin/login');
  } finally { process.env = saved; }
});
