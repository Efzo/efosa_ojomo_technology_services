import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const js = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {}; new Function('require', 'exports', js)(name => name in mocks ? mocks[name] : require(name), exports); return exports;
}
const config = load('src/lib/business/config.ts');
const helpers = load('src/lib/business/document-files.ts', { './config': config });
const today = config.todayInAustin();
const metadata = { documentId: 'doc1', filename: 'Acme proposal.pdf', revisionNote: 'Initial proposal sent externally', status: 'SHARED', sentDate: today, signedDate: '' };
const pathname = 'business-documents/doc1/owner/12345678-1234-1234-1234-123456789abc/acme-proposal-random.pdf';
function request(body, origin = 'https://example.test') { return new Request('https://example.test/api/admin/business/document-upload', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) }); }

test('document paths are bound to document and owner; file types and dated status are validated', () => {
  assert.equal(helpers.documentFilePathAllowed(pathname, 'doc1', 'owner'), true);
  for (const path of [pathname.replace('/doc1/', '/doc2/'), pathname.replace('/owner/', '/editor/'), 'media/invoice.pdf', pathname + '/extra']) assert.equal(helpers.documentFilePathAllowed(path, 'doc1', 'owner'), false);
  assert.equal(helpers.documentFileType('AGREEMENT.PDF'), 'application/pdf');
  for (const name of ['file.exe', 'file.html', 'file.pdf.js', 'file.__proto__', 'file.constructor']) assert.equal(helpers.documentFileType(name), undefined);
  assert.equal(helpers.documentUploadMetadata.safeParse(metadata).success, true);
  for (const changes of [{ sentDate: '' }, { filename: 'unsafe\n.pdf' }, { filename: 'script.html' }, { status: 'SIGNED', signedDate: '' }, { sentDate: '2026-02-30' }]) assert.equal(helpers.documentUploadMetadata.safeParse({ ...metadata, ...changes }).success, false);
  assert.equal(config.schemas.document.safeParse({ clientId: 'acme', engagementId: '', title: 'Agreement', kind: 'AGREEMENT', status: 'DRAFT', body: '', externalUrl: '' }).success, true, 'upload-only document does not require invented text');
});

test('upload tokens are owner-only, scoped to an existing document, size/type bounded, and cannot overwrite', async () => {
  const env = { ...process.env }; process.env.BLOB_READ_WRITE_TOKEN = 'configured-test';
  let ownerId = 'owner', exists = true, grant, complete;
  const route = load('src/app/api/admin/business/document-upload/route.ts', {
    '@/lib/prisma': { prisma: { businessDocument: { findUnique: async () => exists ? { id: 'doc1' } : null } } },
    '@/lib/business/access': { businessDatabaseReady: () => true, requireBusinessOwner: async () => { if (!ownerId) throw new Error('denied'); return ownerId; } },
    '@/lib/business/document-files': helpers,
    '@/lib/business/register-document-file': { registerDocumentFile: async () => {} },
    '@vercel/blob/client': { handleUpload: async options => { if (options.body.type === 'blob.upload-completed') throw new Error('Invalid signature'); grant = await options.onBeforeGenerateToken(options.body.payload.pathname, JSON.stringify(metadata)); complete = options.onUploadCompleted; return { clientToken: 'test-token' }; } },
  });
  const body = path => ({ type: 'blob.generate-client-token', payload: { pathname: path, multipart: true } });
  try {
    assert.equal((await route.POST(request(body(pathname)))).status, 200);
    assert.deepEqual(grant.allowedContentTypes, ['application/pdf']); assert.equal(grant.maximumSizeInBytes, 20 * 1024 * 1024); assert.equal(grant.allowOverwrite, false); assert.equal(grant.addRandomSuffix, true); assert.equal(JSON.parse(grant.tokenPayload).ownerId, 'owner'); assert.equal(typeof complete, 'function');
    assert.equal((await route.POST(request(body(pathname.replace('/doc1/', '/other/'))))).status, 400);
    exists = false; assert.equal((await route.POST(request(body(pathname)))).status, 400); exists = true;
    assert.equal((await route.POST(request(body(pathname), 'https://foreign.test'))).status, 403);
    ownerId = null; assert.equal((await route.POST(request(body(pathname)))).status, 403);
    assert.equal((await route.POST(request({ type: 'blob.upload-completed', payload: {} }))).status, 500, 'forged callback is not accepted');
  } finally { process.env = env; }
});

test('completion rejects foreign paths before storage and returns current document version', async () => {
  let calls = 0;
  const route = load('src/app/api/admin/business/document-upload/complete/route.ts', {
    '@/lib/business/access': { requireBusinessOwner: async () => 'owner', businessDatabaseReady: () => true }, '@/lib/business/document-files': helpers,
    '@/lib/business/register-document-file': { registerDocumentFile: async () => { calls++; return { file: { id: 'file1', revision: 1 }, document: { id: 'doc1', version: 3, body: 'Latest concurrent notes', status: 'SHARED' } }; } }, 'next/cache': { revalidatePath() {} },
  });
  assert.equal((await route.POST(request({ ...metadata, pathname: 'media/private.pdf' }))).status, 400); assert.equal(calls, 0);
  const response = await route.POST(request({ ...metadata, pathname }));
  assert.equal(response.status, 200); assert.equal((await response.json()).document.body, 'Latest concurrent notes');
});

test('registration verifies private head metadata and preserves immutable version records on retry', async () => {
  const records = new Map(); let blob = { pathname, url: `https://store.private.blob.vercel-storage.com/${pathname}`, contentType: 'application/pdf', size: 1000 }, role = 'OWNER', versions = 0;
  const tx = { user: { findUnique: async () => ({ role }) }, businessDocument: { findUnique: async () => ({ id: 'doc1', version: versions }), update: async ({ data }) => { versions++; return { id: 'doc1', version: versions, ...data }; } }, businessDocumentFile: { findUnique: async ({ where }) => records.get(where.storageKey), findFirst: async () => records.size ? { revision: records.size } : null, create: async ({ data }) => { const file = { id: `file${records.size + 1}`, ...data }; records.set(data.storageKey, file); return file; } }, auditEvent: { create: async () => ({}) } };
  const { registerDocumentFile } = load('src/lib/business/register-document-file.ts', { '@vercel/blob': { head: async () => blob }, '@/lib/prisma': { prisma: { $transaction: async fn => fn(tx) } }, './document-files': helpers });
  const input = { ...metadata, pathname, ownerId: 'owner' };
  assert.equal((await registerDocumentFile(input)).file.revision, 1); assert.equal((await registerDocumentFile(input)).file.revision, 1); assert.equal(records.size, 1); assert.equal(versions, 1);
  for (const patch of [{ url: 'https://store.public.blob.vercel-storage.com/file' }, { size: 21 * 1024 * 1024 }, { size: 0 }, { contentType: 'text/html' }, { pathname: 'media/other.pdf' }]) { const original = blob; blob = { ...blob, ...patch }; await assert.rejects(registerDocumentFile(input), /Invalid private/); blob = original; }
  role = 'EDITOR'; await assert.rejects(registerDocumentFile(input), /Owner access/);
});

test('downloads deny non-owners before reading storage and return files as private attachments', async () => {
  const env = { ...process.env }; process.env.BLOB_READ_WRITE_TOKEN = 'configured-test';
  let permitted = false, storageReads = 0;
  const route = load('src/app/api/admin/business/files/[id]/route.ts', {
    '@/lib/business/access': { businessDatabaseReady: () => true, requireBusinessOwner: async () => { if (!permitted) throw new Error('denied'); return 'owner'; } },
    '@/lib/prisma': { prisma: { businessDocumentFile: { findUnique: async () => ({ storageKey: pathname, filename: 'Acme signed agreement.pdf', mimeType: 'application/pdf' }) } } },
    '@vercel/blob': { get: async () => { storageReads++; return { statusCode: 200, stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } }), blob: { size: 3 } }; } },
  });
  const context = { params: Promise.resolve({ id: 'file1' }) };
  try {
    assert.equal((await route.GET(new Request('https://example.test'), context)).status, 403); assert.equal(storageReads, 0);
    permitted = true;
    const response = await route.GET(new Request('https://example.test'), context);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition'), /^attachment;/); assert.match(response.headers.get('cache-control'), /private, no-store/); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.match(response.headers.get('content-security-policy'), /sandbox/);
    assert.equal((await response.arrayBuffer()).byteLength, 3);
  } finally { process.env = env; }
});

function uploader(mocks) {
  const state = [], refs = []; let cursor = 0, refCursor = 0;
  const react = { ...require('react'), useEffect() {}, useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }]; }, useRef(initial) { const index = refCursor++; return refs[index] ||= { current: initial }; } };
  let attached;
  const Component = load('src/components/admin/business/DocumentFiles.tsx', { react, '@/lib/business/config': config, '@/lib/business/document-files': helpers, ...mocks }).default;
  return { get attached() { return attached; }, render() { cursor = refCursor = 0; const tree = Component({ documentId: 'doc1', disabled: false, onBusy() {}, onAttached: value => { attached = value; } }); const nodes = []; const visit = n => { if (!n?.props) return; nodes.push(n); for (const child of [n.props.children].flat(Infinity)) visit(child); }; visit(tree); return { file: nodes.find(n => n.props.type === 'file'), note: nodes.find(n => n.props.maxLength === 1000), button: nodes.find(n => n.type === 'button' && n.props.onClick?.name === 'send') }; } };
}
test('large client documents upload directly and a failed attachment retries without resending bytes', async () => {
  let uploads = 0, requests = 0; const originalFetch = globalThis.fetch;
  const ui = uploader({ 'next-auth/react': { getSession: async () => ({ user: { id: 'owner', role: 'OWNER' } }) }, '@vercel/blob/client': { upload: async (path, file, options) => { uploads++; assert.equal(options.access, 'private'); assert.equal(options.multipart, true); assert.equal(file.size, 7 * 1024 * 1024); assert.ok(path.startsWith('business-documents/doc1/owner/')); return { pathname }; } } });
  globalThis.fetch = async (_url, options) => { requests++; assert.ok(options.body.length < 2000, 'only metadata reaches the function'); return requests === 1 ? new Response('Unavailable', { status: 503 }) : Response.json({ file: { id: 'file1', revision: 1 }, document: { version: 1, status: 'DRAFT', sentDate: '', signedDate: '' } }); };
  try {
    const file = new File([new Uint8Array(7 * 1024 * 1024)], 'proposal.pdf', { type: 'application/pdf' });
    ui.render().file.props.onChange({ target: { files: [file], value: 'proposal.pdf' } }); ui.render().note.props.onChange({ target: { value: 'Initial Acme proposal' } });
    await ui.render().button.props.onClick(); assert.equal(uploads, 1); assert.equal(ui.attached, undefined);
    await ui.render().button.props.onClick(); assert.equal(uploads, 1); assert.equal(requests, 2); assert.equal(ui.attached.version, 1);
  } finally { globalThis.fetch = originalFetch; }
});
