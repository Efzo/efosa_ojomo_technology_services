import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, mocks) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', js)((name) => name in mocks ? mocks[name] : require(name), exports);
  return exports;
}
function harness() {
  const entries = new Map();
  const paths = [];
  let options;
  const cache = load('src/lib/public-cache.ts', { 'next/cache': {
    unstable_cache: (read, key, config) => async () => {
      options = config;
      const id = JSON.stringify(key);
      if (!entries.has(id)) entries.set(id, JSON.stringify(await read()));
      return JSON.parse(entries.get(id));
    },
    updateTag: (tag) => {
      assert.equal(tag, cache.PUBLIC_CONTENT_TAG);
      entries.clear();
    },
    revalidatePath: (...args) => paths.push(args),
  } });
  return { cache, paths, options: () => options };
}

test('public reads survive repeat requests and refresh immediately after a CMS change', async () => {
  const h = harness();
  let value = 'Published A';
  let reads = 0;
  const read = () => h.cache.publicRead('homepage', async () => { reads++; return { title: value }; });
  assert.equal((await read()).title, value);
  value = 'Published B';
  assert.equal((await read()).title, 'Published A');
  assert.equal(reads, 1);
  assert.equal(h.options().revalidate, false);
  h.cache.revalidatePublicPath('/', 'layout');
  assert.equal((await read()).title, value);
  assert.equal(reads, 2);
  assert.deepEqual(h.paths, [['/', 'layout']]);
});

test('database failures are retried and independent cache keys never share data', async () => {
  const { cache } = harness();
  await assert.rejects(cache.publicRead('page:about', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await cache.publicRead('page:about', async () => 'About'), 'About');
  assert.equal(await cache.publicRead('page:contact', async () => 'Contact'), 'Contact');
});

test('authenticated homepage previews bypass the published cache without changing public content', async () => {
  const { cache } = harness();
  let preview = false;
  let publishedReads = 0;
  let draftReads = 0;
  let published = { title: 'Published' };
  const homeSchema = { safeParse: (data) => ({ success: Boolean(data?.title), data }) };
  const { getHomePageContent } = load('src/lib/homepage.ts', {
    '@/lib/public-cache': cache,
    '@/lib/managed-pages': { canPreviewPages: async () => preview },
    '@/lib/home-content': { homeDefaults: { title: 'Fallback' }, homeSchema },
    '@/lib/site-settings': { isSiteSettingsDatabaseReady: () => true },
    '@/lib/prisma': { prisma: {
      siteSetting: { findUnique: async () => { publishedReads++; return { value: published }; } },
      page: { findUnique: async () => { draftReads++; return { content: { title: 'Private draft' } }; } },
    } },
  });
  assert.equal((await getHomePageContent()).title, 'Published');
  preview = true;
  assert.equal((await getHomePageContent()).title, 'Private draft');
  preview = false;
  published = { title: 'Changed but not invalidated' };
  assert.equal((await getHomePageContent()).title, 'Published');
  assert.equal(publishedReads, 1);
  assert.equal(draftReads, 1);
});

test('cached blog timestamps are restored after JSON serialization', async () => {
  const { cache } = harness();
  const date = new Date('2026-11-09T12:00:00Z');
  let reads = 0;
  const reader = load('src/lib/content.ts', {
    '@/lib/public-cache': cache,
    '@/data/blog': { blogPosts: [] },
    '@/lib/blog-options': { blogOptionsKey: (id) => `blog.${id}`, readBlogOptions: () => ({ tags: [] }) },
    '@/lib/prisma': { prisma: {
      blogPost: { findMany: async () => { reads++; return [{ id: '1', slug: 'post', title: 'Published', content: '<p>Hello</p>', publishedAt: date, createdAt: date, updatedAt: date }]; } },
      siteSetting: { findMany: async () => [] },
    } },
  });
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test.invalid/db';
  try {
    for (let i = 0; i < 2; i++) {
      const [post] = await reader.getPublicBlogPosts();
      assert.equal(post.updatedAt, date.toISOString());
      assert.equal(post.publishedAt, '2026-11-09');
    }
    assert.equal(reads, 1);
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  }
});
