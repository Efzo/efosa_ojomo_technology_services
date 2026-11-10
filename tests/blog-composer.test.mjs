import { publicCacheMock } from "./helpers/public-cache.mjs";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const js = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', js)((name) => name in mocks ? mocks[name] : name === '@/lib/public-cache' ? publicCacheMock(mocks) : require(name), exports);
  return exports;
}
const blogOptions = load('src/lib/blog-options.ts');
const richText = load('src/lib/rich-text.ts');
const options = blogOptions.blogOptionsSchema.parse({ seoTitle: 'A useful search title', seoDescription: 'An accurate search description explaining what the reader will learn from this article.', tags: ['Customer support'], answerSummary: 'Start by identifying the customer workflow and its constraints.', faqs: [{ question: 'Where should we start?', answer: 'Start with the workflow and an agreed measure of success.' }], images: [{ url: '/api/media/first', alt: 'Customer workspace', caption: 'A workspace overview.' }, { url: '/api/media/second', alt: 'Support queue', caption: 'The support queue.' }] });
const input = { slug: 'workflow-guide', title: 'Workflow guide', excerpt: 'A practical guide for customer workflows.', category: 'Technology Services', content: '<h2>Start with the workflow</h2><p>Map the workflow before selecting a tool.</p><figure><img src="/api/media/first" alt="Customer workspace" /><figcaption>A workspace overview.</figcaption></figure><p>Review the support queue next.</p><figure><img src="/api/media/second" alt="Support queue" /></figure>', featuredImage: '/api/media/first', options };

function cms(db, getRole = () => 'OWNER', revalidated = []) {
  return load('src/app/actions/cms.ts', {
    'next-auth': { getServerSession: async () => ({ user: { email: 'owner@example.com', role: getRole() } }) },
    '@/lib/password-reset': {}, '@/lib/auth': {}, '@/lib/prisma': { prisma: db }, '@/lib/demo-password': {}, '@/lib/site-settings': {},
    '@/lib/rich-text': richText, 'next/cache': { revalidatePath: (path) => revalidated.push(path) },
    '@/lib/home-content': { homeSchema: require('zod').z.object({}) }, '@/lib/case-details': {}, '@/lib/page-content-schema': {},
    '@/lib/blog-options': blogOptions, '@/data/consulting.json': {}, '@/data/services': {}, '@/data/pricing': {},
  });
}

test('blog image sanitizer retains managed figures and rejects active or private markup', () => {
  const html = richText.sanitizeRichText(`${input.content}<img src="javascript:alert(1)" onerror="alert(1)"><img src="/api/admin/media/private"><img src="https://example.com/tracker"><script>alert(1)</script>`);
  assert.equal((html.match(/<img /g) || []).length, 2);
  assert.match(html, /<figcaption>A workspace overview\.<\/figcaption>/);
  assert.doesNotMatch(html, /onerror|javascript|api\/admin|tracker|script/);
  const escaped = richText.sanitizeRichText('<img src="/api/media/first" alt="A &amp; B &quot;view&quot;">');
  assert.equal(richText.sanitizeRichText(escaped), escaped);
  assert.equal(blogOptions.blogOptionsSchema.safeParse({ seoDescription: 'x'.repeat(161) }).success, false);
  assert.equal(blogOptions.blogOptionsSchema.safeParse({ faqs: [{ question: 'Why?', answer: '' }] }).success, false);
});

test('draft save, publication, re-editing, rollback, and roles preserve article media settings', async () => {
  const env = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: 'postgresql://test', DEMO_MODE: 'false' });
  let post; let setting; let role = 'OWNER'; let fail = false;
  const paths = [];
  const db = {
    user: { findUnique: async () => ({ role }) }, auditEvent: { create: async () => ({}) },
    blogPost: { findUnique: async () => post, update: async ({ data }) => (post = { ...post, ...data }) },
    $transaction: async (callback) => {
      let nextPost; let nextSetting;
      const save = async ({ data }) => (nextPost = { ...post, ...data, id: 'article', versions: [{ version: 1 }], createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-11-05') });
      const result = await callback({ blogPost: { findUnique: async () => post, create: save, update: save }, siteSetting: { upsert: async ({ create }) => { if (fail) throw new Error('storage failed'); nextSetting = create; } } });
      post = nextPost; setting = nextSetting; return result;
    },
  };
  const actions = cms(db, () => role, paths);
  try {
    assert.equal((await actions.saveBlogPostDraft(input)).success, true);
    assert.equal(post.status, 'DRAFT');
    assert.equal(setting.key, 'blog.article.options');
    assert.deepEqual(setting.value, options);
    assert.match(post.content, /loading="lazy"/);
    assert.equal((await actions.publishBlogPost('article')).success, true);
    assert.equal(post.status, 'PUBLISHED');
    const firstPublished = post.publishedAt;
    const previous = post;
    fail = true;
    assert.equal((await actions.saveBlogPostDraft({ ...input, id: 'article', title: 'Failed draft' })).success, false);
    assert.equal(post, previous);
    fail = false;
    assert.equal((await actions.saveBlogPostDraft({ ...input, id: 'article' })).success, true);
    assert.equal(post.status, 'DRAFT');
    assert.equal((await actions.publishBlogPost('article')).success, true);
    assert.equal(post.publishedAt, firstPublished);
    assert.ok(paths.includes('/sitemap.xml'));
    assert.equal((await actions.saveBlogPostDraft({ ...input, featuredImage: '/api/media/not-attached' })).success, false);
    role = 'VIEWER';
    await assert.rejects(() => actions.saveBlogPostDraft(input), /Unauthorized/);
    await assert.rejects(() => actions.publishBlogPost('article'), /Unauthorized/);
  } finally { process.env = env; }
});

test('public article reader, metadata and JSON-LD use the saved SEO and visible answer content', async () => {
  const env = { ...process.env }; Object.assign(process.env, { DATABASE_URL: 'postgresql://test', DEMO_MODE: 'false' });
  const stored = { ...input, id: 'article', status: 'PUBLISHED', content: richText.sanitizeRichText(input.content), createdAt: new Date('2026-01-01'), publishedAt: new Date('2026-01-02'), updatedAt: new Date('2026-11-05') };
  const reader = load('src/lib/content.ts', {
    '@/data/blog': { blogPosts: [] }, '@/lib/blog-options': blogOptions,
    '@/lib/prisma': { prisma: { blogPost: { findMany: async ({ where }) => where.status === stored.status ? [stored] : [] }, siteSetting: { findMany: async () => [{ key: 'blog.article.options', value: options }] } } },
  });
  try {
    const post = await reader.getPublicBlogPost(input.slug);
    const seo = load('src/lib/blog-seo.ts', { '@/lib/blog-options': blogOptions });
    const metadata = seo.blogMetadata(post);
    assert.equal(metadata.description, options.seoDescription);
    assert.equal(metadata.title, `${options.seoTitle} | Efosa Ojomo`);
    assert.equal(metadata.alternates.canonical, `https://www.ojomoefosa.com/blog/${input.slug}`);
    assert.equal(metadata.openGraph.images[0].url, 'https://www.ojomoefosa.com/api/media/first');
    const schema = seo.blogStructuredData(post);
    assert.equal(schema['@graph'][0]['@type'], 'BlogPosting');
    assert.equal(schema['@graph'][0].image.length, 2);
    assert.equal(schema['@graph'][0].abstract, options.answerSummary);
    assert.doesNotMatch(blogOptions.serializeJsonLd({ text: '</script><script>alert(1)</script>' }), /<\/script>/);
    const page = load('src/app/blog/[slug]/page.tsx', {
      'next/image': (props) => { const imageProps = { ...props }; delete imageProps.unoptimized; return require('react').createElement('img', imageProps); },
      'next/link': ({ children, ...props }) => require('react').createElement('a', props, children),
      'next/navigation': { notFound: () => { throw new Error('not found'); } }, '@/data/blog': { blogPosts: [] },
      '@/lib/content': reader, '@/lib/rich-text': richText, '@/lib/blog-options': blogOptions, '@/lib/blog-seo': seo,
    });
    const html = renderToStaticMarkup(await page.default({ params: Promise.resolve({ slug: input.slug }) }));
    assert.match(html, /At a glance/); assert.match(html, /Where should we start\?/); assert.match(html, /Customer workspace/);
    assert.match(html, /application\/ld\+json/); assert.match(html, /By Efosa Ojomo/);
    stored.status = 'DRAFT';
    assert.equal(await reader.getPublicBlogPost(input.slug), undefined);
  } finally { process.env = env; }
});

test('blog media is public only while used as a published cover or inline image', async () => {
  let published = false; let attached = true; let reads = 0; let query;
  const route = load('src/app/api/media/[id]/route.ts', {
    '@vercel/blob': { get: async () => { reads++; return { statusCode: 200, stream: new ReadableStream({ start(controller) { controller.close(); } }) }; } },
    '@/lib/prisma': { prisma: {
      caseStudy: { findFirst: async () => null }, blogPost: { findFirst: async ({ where }) => { query = where; return published && attached ? { id: 'article' } : null; } },
      siteSetting: { findUnique: async () => ({ value: null }) },
      mediaAsset: { findUnique: async () => ({ mimeType: 'image/png', storageKey: 'image' }) },
    } },
  });
  const request = () => route.GET(new Request('https://test/api/media/first'), { params: Promise.resolve({ id: 'first' }) });
  assert.equal((await request()).status, 404); assert.equal(reads, 0);
  published = true;
  const response = await request(); assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Robots-Tag'), 'index, follow, max-image-preview:large');
  assert.equal(query.status, 'PUBLISHED'); assert.equal(query.OR[0].featuredImage, '/api/media/first');
  assert.equal(query.OR[1].content.contains, '<img src="/api/media/first"');
  attached = false; assert.equal((await request()).status, 404);
  assert.equal(reads, 1);
});
