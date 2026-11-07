// Authenticate synthetic accounts only against the isolated localhost preview.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { encode } from 'next-auth/jwt';
const db = new URL(process.env.BUSINESS_TEST_DATABASE_URL ?? '');
const base = new URL(process.env.BUSINESS_TEST_BASE_URL ?? 'http://localhost:3105');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(db.hostname) || db.pathname !== '/portfolio_business_test' || !['localhost', '127.0.0.1'].includes(base.hostname) || base.port !== '3105') throw new Error('Only the isolated localhost test database and preview on port 3105 are permitted.');
const prisma = new PrismaClient({ datasources: { db: { url: db.toString() } } });
async function cookie(user) {
  const token = await encode({ secret: 'local-business-workspace-test-only-2026', token: { sub: user.id, email: user.email, role: user.role, lastActivityAt: Date.now(), idleTimeoutMinutes: 60 } });
  return `next-auth.session-token=${token}`;
}
try {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'business-owner@example.test' } });
  const viewer = await prisma.user.upsert({ where: { email: 'business-viewer@example.test' }, update: { role: 'VIEWER' }, create: { email: 'business-viewer@example.test', role: 'VIEWER' } });
  const ownerCookie = await cookie(owner), viewerCookie = await cookie(viewer);
  for (const path of ['', '/clients', '/engagements', '/retainers', '/tasks', '/invoices', '/expenses', '/time', '/documents', '/setup']) {
    const unauth = await fetch(`${base}admin/business${path}`, { redirect: 'manual' });
    assert.equal(unauth.status, 307); assert.match(unauth.headers.get('location'), /admin\/login/);
    const response = await fetch(`${base}admin/business${path}`, { headers: { Cookie: ownerCookie } });
    assert.equal(response.status, 200, path); assert.match(response.headers.get('x-robots-tag'), /noindex/); assert.match(response.headers.get('cache-control'), /no-store/);
    const ownerHtml = (await response.text()).replaceAll('\\', '');
    assert.ok(ownerHtml.includes('"available":true'), `${path || 'overview'}: owner workspace data loaded`);
    const denied = await fetch(`${base}admin/business${path}`, { headers: { Cookie: viewerCookie } });
    const html = await denied.text(); assert.ok(html.includes('Owner access required')); assert.ok(!html.includes('alex@example.test'));
  }
  for (const entity of ['client', 'engagement', 'task', 'invoice', 'payment', 'expense', 'time', 'document']) {
    const response = await fetch(`${base}admin/business/export?entity=${entity}`, { headers: { Cookie: ownerCookie } });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/csv/); assert.match(response.headers.get('cache-control'), /no-store/);
    assert.ok((await response.text()).includes('"id"'), `${entity} export headers`);
    assert.equal((await fetch(`${base}admin/business/export?entity=${entity}`, { headers: { Cookie: viewerCookie } })).status, 403);
  }
  assert.equal((await fetch(`${base}admin/business/export?entity=__proto__`, { headers: { Cookie: ownerCookie } })).status, 400);
  const missing = await fetch(`${base}admin/business/not-a-section`, { headers: { Cookie: ownerCookie } });
  assert.ok((await missing.text()).includes('NEXT_HTTP_ERROR_FALLBACK;404'), 'unknown section uses Next not-found handling, including streamed responses');
  const document = await prisma.businessDocument.findFirstOrThrow({ where: { files: { some: {} } }, select: { id: true } });
  const file = await prisma.businessDocumentFile.findFirstOrThrow({ where: { documentId: document.id } });
  const historyUrl = `${base}api/admin/business/documents/${document.id}/files`;
  const historyResponse = await fetch(historyUrl, { headers: { Cookie: ownerCookie } });
  assert.equal(historyResponse.status, 200); assert.match(historyResponse.headers.get('cache-control'), /no-store/);
  const history = await historyResponse.json(); assert.ok(history.total >= 2); assert.ok(history.files[0].revision > history.files[1].revision); assert.equal(history.files[0].storageKey, undefined);
  for (const api of [historyUrl, `${base}api/admin/business/files/${file.id}`]) {
    assert.equal((await fetch(api)).status, 403);
    assert.equal((await fetch(api, { headers: { Cookie: viewerCookie } })).status, 403);
  }
  assert.equal((await fetch(`${base}api/admin/business/document-upload/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  console.log('PASS: owner-only document history and file downloads; unauthenticated/viewer API denial; private metadata excludes storage keys.');
  console.log('PASS: authenticated HTTP on all 10 business pages; unauthenticated redirects; viewer denial; private/noindex headers; all 8 owner-only CSV exports; invalid sections and export types.');
} finally { await prisma.$disconnect(); }
