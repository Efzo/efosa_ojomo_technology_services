import { publicCacheMock } from "./helpers/public-cache.mjs";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', js)((name) => name in mocks ? mocks[name] : name === '@/lib/public-cache' ? publicCacheMock(mocks) : require(name), exports);
  return exports;
}
const defaults = JSON.parse(readFileSync(new URL('../src/data/page-defaults.json', import.meta.url)));
const schemas = load('src/lib/page-content-schema.ts', { '@/data/page-defaults.json': defaults });
const ManagedPageCTA = load("src/components/ManagedPageCTA.tsx", { "next/link": ({ children, ...props }) => require("react").createElement("a", props, children) }).default;
function harness() {
  let state = { pages: [], versions: [], settings: new Map(), audit: [] };
  let user = { id: 'owner', role: 'OWNER' };
  let preview = false;
  const copy = (value) => value === undefined ? value : structuredClone(value);
  const prisma = {
    page: {
      findUnique: async ({ where, include }) => {
        const page = state.pages.find((page) => where.slug ? page.slug === where.slug : page.id === where.id);
        if (!page) return null;
        const versions = state.versions.filter((version) => version.pageId === page.id).sort((a, b) => b.version - a.version);
        return copy({ ...page, ...(include?.versions ? { versions: versions.slice(0, include.versions.take) } : {}) });
      },
      create: async ({ data }) => { const page = { id: `page-${state.pages.length + 1}`, ...copy(data) }; state.pages.push(page); return copy(page); },
      update: async ({ where, data }) => { const page = state.pages.find((page) => page.id === where.id); Object.assign(page, copy(data)); return copy(page); },
    },
    pageVersion: {
      create: async ({ data }) => { const version = { id: `version-${state.versions.length + 1}`, ...copy(data) }; state.versions.push(version); return copy(version); },
      findUnique: async ({ where }) => copy(state.versions.find((version) => version.id === where.id) ?? null),
    },
    siteSetting: {
      findUnique: async ({ where }) => copy(state.settings.get(where.key) ?? null),
      upsert: async ({ where, create, update }) => { const value = state.settings.has(where.key) ? { ...state.settings.get(where.key), ...copy(update) } : copy(create); state.settings.set(where.key, value); return value; },
    },
    auditEvent: { create: async ({ data }) => { state.audit.push(copy(data)); return data; } },
    $transaction: async (fn) => { const backup = copy(state); try { return await fn(prisma); } catch (error) { state = backup; throw error; } },
  };
  const mocks = { '@/lib/prisma': { prisma }, '@/lib/auth': { authOptions: {} }, 'next-auth': { getServerSession: async () => user ? { user } : null }, '@/lib/site-settings': { isSiteSettingsDatabaseReady: () => true }, '@/lib/page-content-schema': schemas, 'next/cache': { revalidatePath() {} }, 'next/headers': { draftMode: async () => ({ isEnabled: preview }) }, '@/lib/seo': { pageMetadata: (title, description, path) => ({ title, description, path }) } };
  const actions = load('src/app/actions/page-content.ts', mocks);
  const reader = load('src/lib/managed-pages.ts', mocks);
  const save = (slug, content, revision = 0, metadata = {}) => actions.saveManagedPageDraft({ slug, content, baseRevision: revision, metaTitle: '', metaDescription: '', ...metadata });
  return { actions, reader, save, prisma, state: () => state, setUser: (next) => { user = next; }, setPreview: (next) => { preview = next; } };
}

for (const slug of Object.keys(defaults)) {
  test(`${slug}: existing content validates and can be saved, previewed, and published`, async () => {
    const h = harness();
    const content = schemas.getPageDefaults(slug);
    assert.equal(schemas.parsePageContent(slug, content).success, true);
    const saved = await h.save(slug, content);
    assert.equal(saved.success, true, saved.message);
    assert.equal(saved.revision, 1);
    assert.equal(h.state().pages[0].status, 'DRAFT');
    h.setPreview(true);
    assert.deepEqual((await h.reader.getManagedPage(slug)).content, content);
    h.setPreview(false);
    const published = await h.actions.publishManagedPage(slug, saved.revision);
    assert.equal(published.success, true, published.message);
    assert.deepEqual((await h.reader.getManagedPage(slug)).content, content);
    assert.ok(h.state().settings.has(`page.${slug}.published`));
  });
}

test('About edits flow through save, publish, public rendering, and private draft preview', async () => {
  const h = harness();
  const about = { ...schemas.getPageDefaults('about'), headline: 'PublishedAbout', bio: ['Published biography from the editor.'], education: [{ qualification: 'Test qualification', institution: 'Test institution', period: '2020–2022', details: 'A fixture education entry.' }] };
  const saved = await h.save('about', about, 0, { metaTitle: 'Published SEO title' });
  assert.equal((await h.reader.getManagedPage('about')).content.headline, defaults.about.headline);
  assert.equal((await h.actions.publishManagedPage('about', saved.revision)).success, true);
  const portraits = load('src/lib/portraits.ts', { '@/data/page-defaults.json': defaults });
  const page = load('src/app/about/page.tsx', { '@/lib/portraits': portraits, '@/lib/managed-pages': h.reader, '@/components/admin/PagePreviewBanner': () => null, '@/components/ManagedPageCTA': ManagedPageCTA, 'next/image': () => null });
  const html = renderToStaticMarkup(await page.default());
  assert.ok(html.includes('PublishedAbout'));
  assert.ok(html.includes('Published biography from the editor.'));
  assert.ok(html.includes('Test qualification'));
  assert.ok(html.includes('Test institution'));
  assert.ok(html.includes('2020–2022'));
  assert.ok(html.includes('<ol'));
  assert.ok(html.includes('Book a Discovery Call'));
  assert.ok(html.includes('href="/book"'));
  const draft = await h.save('about', { ...about, headline: 'PrivateDraft', bio: ['Private draft biography.'], education: [] }, 1, { metaTitle: 'Private SEO' });
  assert.equal(draft.success, true);
  assert.equal((await h.reader.getManagedPage('about')).content.headline, 'PublishedAbout');
  assert.equal((await h.reader.getManagedPage('about')).content.education[0].institution, 'Test institution');
  assert.equal((await h.reader.managedPageMetadata('about')).title, 'Published SEO title');
  h.setPreview(true);
  assert.equal((await h.reader.getManagedPage('about')).content.headline, 'PrivateDraft');
  assert.equal((await h.reader.managedPageMetadata('about')).title, 'Private SEO');
  h.setUser(null);
  assert.equal((await h.reader.getManagedPage('about')).content.headline, 'PublishedAbout');
  h.setUser({ role: 'VIEWER' });
  assert.equal((await h.reader.getManagedPage('about')).content.headline, 'PublishedAbout');
});

test('legacy published About is preserved when its first draft is saved', async () => {
  const h = harness();
  h.state().pages.push({ id: 'legacy', slug: 'about', content: { headline: 'Legacy biography', bio: ['Original content'], expertise: [], pedigree: [], certs: [] }, status: 'PUBLISHED', isPublished: true, metaTitle: 'Original title' });
  const result = await h.save('about', { ...schemas.getPageDefaults('about'), headline: 'New private draft' });
  assert.equal(result.success, true, result.message);
  assert.equal((await h.reader.getManagedPage('about')).content.headline, 'Legacy biography');
});

test('stale edits cannot overwrite a newer draft or publish an unseen revision', async () => {
  const h = harness();
  await h.save('about', schemas.getPageDefaults('about'));
  assert.equal((await h.save('about', { ...schemas.getPageDefaults('about'), headline: 'Stale change' }, 0)).success, false);
  await h.save('about', { ...schemas.getPageDefaults('about'), headline: 'Latest draft' }, 1);
  assert.equal((await h.actions.publishManagedPage('about', 1)).success, false);
  assert.equal(h.state().settings.has('page.about.published'), false);
});

test('revision restore creates a new draft and cannot cross page boundaries', async () => {
  const h = harness();
  const first = { ...schemas.getPageDefaults('about'), headline: 'First version' };
  await h.save('about', first);
  await h.actions.publishManagedPage('about', 1);
  await h.save('about', { ...first, headline: 'Published second version' }, 1);
  await h.actions.publishManagedPage('about', 2);
  assert.equal((await h.actions.restoreManagedPageVersion('about', 'version-1', 2)).success, true);
  assert.equal((await h.reader.getManagedPage('about')).content.headline, 'Published second version');
  h.setPreview(true);
  assert.equal((await h.reader.getManagedPage('about')).content.headline, 'First version');
  await h.save('privacy', schemas.getPageDefaults('privacy'));
  assert.equal((await h.actions.restoreManagedPageVersion('privacy', 'version-1', 1)).success, false);
});

test('invalid content, unsafe links, unauthorized users, and viewers cannot save or publish', async () => {
  const h = harness();
  const about = schemas.getPageDefaults('about');
  assert.equal((await h.save('about', { ...about, bio: [] })).success, false);
  assert.equal((await h.save('about', { ...about, imageUrl: 'javascript:alert(1)', imageAlt: 'test' })).success, false);
  assert.equal((await h.save('about', { ...about, imageUrl: '/profile.jpg', imageAlt: '' })).success, false);
  assert.equal((await h.save('../about', about)).success, false);
  for (const user of [null, { role: 'VIEWER' }]) {
    h.setUser(user);
    await assert.rejects(h.save('about', about), /Unauthorized/);
    await assert.rejects(h.actions.publishManagedPage('about', 1), /Unauthorized/);
  }
  assert.equal(h.state().pages.length, 0);
});

test('publishing is atomic when the audit/database transaction fails', async () => {
  const h = harness();
  await h.save('about', schemas.getPageDefaults('about'));
  await h.actions.publishManagedPage('about', 1);
  await h.save('about', { ...schemas.getPageDefaults('about'), headline: 'Must not go public' }, 1);
  h.prisma.auditEvent.create = async () => { throw new Error('Database failure'); };
  assert.equal((await h.actions.publishManagedPage('about', 2)).success, false);
  assert.equal((await h.reader.getManagedPage('about')).content.headline, defaults.about.headline);
});

test('draft preview endpoint checks roles and only redirects to known website pages', async () => {
  let user = null;
  let enabled = false;
  const route = load('src/app/api/admin/preview/route.ts', {
    'next-auth': { getServerSession: async () => user ? { user } : null },
    '@/lib/auth': { authOptions: {} },
    '@/lib/page-content-schema': schemas,
    'next/headers': { draftMode: async () => ({ enable() { enabled = true; }, disable() { enabled = false; } }) },
  });
  assert.equal((await route.GET(new Request('https://test/api/admin/preview?slug=about'))).status, 401);
  user = { role: 'VIEWER' };
  assert.equal((await route.GET(new Request('https://test/api/admin/preview?slug=about'))).status, 401);
  user = { role: 'EDITOR' };
  assert.equal((await route.GET(new Request('https://test/api/admin/preview?slug=https://evil.test'))).status, 400);
  assert.equal(enabled, false);
  const preview = await route.GET(new Request('https://test/api/admin/preview?slug=about'));
  assert.equal(preview.headers.get('location'), 'https://test/about');
  assert.equal(enabled, true);
  await route.GET(new Request('https://test/api/admin/preview?slug=about&disable=1'));
  assert.equal(enabled, false);
});

test('About images are public only while referenced by the published About content', async () => {
  let imageUrl = '/api/media/profile';
  let aboutImageUrl = '';
  const route = load('src/app/api/media/[id]/route.ts', {
    '@vercel/blob': { get: async () => ({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }) }) },
    '@/lib/prisma': { prisma: {
      caseStudy: { findFirst: async () => null }, blogPost: { findFirst: async () => null },
      siteSetting: { findUnique: async () => ({ value: { content: { imageUrl, aboutImageUrl } } }) },
      mediaAsset: { findUnique: async () => ({ mimeType: 'image/png', storageKey: 'profile' }) },
    } },
  });
  const request = () => route.GET(new Request('https://test/api/media/profile'), { params: Promise.resolve({ id: 'profile' }) });
  assert.equal((await request()).status, 200);
  imageUrl = '/api/media/new-profile';
  assert.equal((await request()).status, 404);
  aboutImageUrl = '/api/media/profile';
  assert.equal((await request()).status, 200);
  aboutImageUrl = '';
  assert.equal((await request()).status, 404);
});


test('About education is optional for legacy content and empty sections stay hidden', async () => {
  const legacy = structuredClone(defaults.about); delete legacy.education; delete legacy.educationHeading; delete legacy.cta;
  const parsed = schemas.parsePageContent('about', legacy);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.education, defaults.about.education);
  assert.equal(parsed.data.educationHeading, 'Education');
  assert.equal(parsed.data.cta.primaryUrl, '/book');
  assert.equal(schemas.parsePageContent('about', { ...legacy, cta: { ...defaults.about.cta, primaryUrl: 'javascript:alert(1)' } }).success, false);
  assert.equal(schemas.parsePageContent('about', { ...legacy, education: [{ qualification: '', institution: '', period: '', details: '' }] }).success, false);
  const h = harness();
  const saved = await h.save('about', { ...schemas.getPageDefaults('about'), education: [] });
  assert.equal((await h.actions.publishManagedPage('about', saved.revision)).success, true);
  const portraits = load('src/lib/portraits.ts', { '@/data/page-defaults.json': defaults });
  const page = load('src/app/about/page.tsx', { '@/lib/portraits': portraits, '@/lib/managed-pages': h.reader, '@/components/admin/PagePreviewBanner': () => null, '@/components/ManagedPageCTA': ManagedPageCTA, 'next/image': () => null });
  const html = renderToStaticMarkup(await page.default());
  assert.ok(!html.includes('id="education-heading"'));
});


test('business About sections save and publish together, with the company before the founder', async () => {
  const h = harness();
  const content = schemas.getPageDefaults('about');
  content.audiences.cards[0].body = ['A tailored business audience message.'];
  content.capabilities.cards[0].description = 'A custom website service description from the CMS.';
  const saved = await h.save('about', content);
  assert.equal(saved.success, true);
  assert.equal((await h.actions.publishManagedPage('about', saved.revision)).success, true);
  const portraits = load('src/lib/portraits.ts', { '@/data/page-defaults.json': defaults });
  const page = load('src/app/about/page.tsx', { '@/lib/portraits': portraits, '@/lib/managed-pages': h.reader, '@/components/admin/PagePreviewBanner': () => null, '@/components/ManagedPageCTA': ManagedPageCTA, 'next/image': () => null });
  const html = renderToStaticMarkup(await page.default());
  for (const text of ['About Efosa Ojomo Technology Services', 'Your Vision. Our Expertise.', 'Meet the Founder', 'Who We Help', 'What We Do', 'Why Work With Us?', 'Our Approach', 'Eastern Illinois University, USA', 'Gdańsk University of Technology, Poland', 'Ambrose Alli University, Nigeria', 'A tailored business audience message.', 'A custom website service description from the CMS.']) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf('id="about-heading"') < html.indexOf('id="founder-heading"'));
  assert.ok(html.indexOf('id="founder-heading"') < html.indexOf('id="audiences-heading"'));
  assert.ok(html.includes('href="/book"'));
  assert.ok(html.includes('href="/services"'));
  const next = structuredClone(content);
  next.capabilities.cards = [];
  next.audiences.cards = [];
  const draft = await h.save('about', next, saved.revision);
  assert.equal(draft.success, true);
  assert.ok((await h.reader.getManagedPageContent('about')).audiences.cards.length > 0);
  h.setPreview(true);
  const preview = renderToStaticMarkup(await page.default());
  assert.ok(!preview.includes('id="audiences-heading"'));
  assert.ok(!preview.includes('id="capabilities-heading"'));
});
