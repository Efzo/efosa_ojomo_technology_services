import { publicCacheMock } from "./helpers/public-cache.mjs";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', js)((name) => name in mocks ? mocks[name] : name === '@/lib/public-cache' ? publicCacheMock(mocks) : require(name), exports);
  return exports;
}
const detailsModule = load('src/lib/case-details.ts');
const { caseDetailsSchema, screenshotUrlSchema } = detailsModule;
const catalog = JSON.parse(readFileSync(new URL('../src/data/consulting.json', import.meta.url)));
const details = caseDetailsSchema.parse({ productUrl: 'https://product.example/', embedUrl: 'https://product.example/demo', showEmbed: true, screenshots: [{ url: '/api/media/shot-1', alt: 'Customer dashboard', caption: 'The customer workspace.' }] });

test('legacy details get media defaults and unsafe media URLs are rejected', () => {
  const legacy = caseDetailsSchema.parse({ tradeoffs: 'Existing narrative' });
  assert.equal(legacy.productUrl, '');
  assert.equal(legacy.showEmbed, false);
  assert.deepEqual(legacy.screenshots, []);
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '//example.com/image.png', 'http://example.com/', 'https://user:pass@example.com/']) {
    assert.equal(screenshotUrlSchema.safeParse(url).success, false);
    assert.equal(caseDetailsSchema.safeParse({ productUrl: url }).success, false);
    assert.equal(caseDetailsSchema.safeParse({ embedUrl: url }).success, false);
  }
  assert.equal(caseDetailsSchema.safeParse({ showEmbed: true }).success, false);
  assert.equal(screenshotUrlSchema.safeParse('/api/admin/media/private').success, false);
  assert.equal(screenshotUrlSchema.safeParse('https://example.com/image.png').success, true);
});

test('public showcase renders captions and links without loading a third-party iframe', () => {
  const ProductPreview = load('src/components/ProductPreview.tsx').default;
  const Showcase = load('src/components/CaseStudyShowcase.tsx', {
    'next/image': (props) => { const imageProps = { ...props }; delete imageProps.unoptimized; return React.createElement('img', imageProps); },
    '@/components/ProductPreview': ProductPreview,
  }).default;
  const html = renderToStaticMarkup(React.createElement(Showcase, { title: 'Example', images: ['/api/media/shot-1'], details }));
  assert.match(html, /Customer dashboard/);
  assert.match(html, /The customer workspace\./);
  assert.match(html, /Visit product/);
  assert.match(html, /Load interactive preview/);
  assert.doesNotMatch(html, /<iframe/);
  const hidden = renderToStaticMarkup(React.createElement(Showcase, { title: 'Example', images: [], details: { ...details, showEmbed: false, productUrl: '' } }));
  assert.doesNotMatch(hidden, /product\.example/);
});

function actions(db) {
  return load('src/app/actions/cms.ts', {
    'next-auth': { getServerSession: async () => ({ user: { id: 'owner', email: 'owner@example.com' } }) },
    '@/lib/password-reset': {}, '@/lib/auth': {}, '@/lib/prisma': { prisma: db },
    '@/lib/demo-password': {}, '@/lib/site-settings': {}, '@/lib/rich-text': {},
    'next/cache': { revalidatePath() {} }, '@/lib/home-content': { homeSchema: require('zod').z.object({}) },
    '@/lib/blog-options': load('src/lib/blog-options.ts'), '@/lib/case-details': detailsModule, '@/lib/page-content-schema': {},
    '@/data/consulting.json': catalog, '@/data/services': {}, '@/data/pricing': {},
  });
}

test('case media saves atomically, respects publication, and reaches the public reader', async () => {
  const savedEnv = { ...process.env };
  Object.assign(process.env, { DEMO_MODE: 'false', DATABASE_URL: 'postgresql://test' });
  let row; let setting; let failSettings = false; let transactions = 0;
  const db = {
    user: { findUnique: async () => ({ role: 'OWNER' }) }, auditEvent: { create: async () => ({}) },
    $transaction: async (callback) => {
      transactions++;
      let nextRow; let nextSetting;
      const saveRow = async ({ data }) => (nextRow = { ...data, id: 'study' });
      const result = await callback({
        caseStudy: { create: saveRow, update: saveRow },
        siteSetting: { upsert: async ({ create }) => { if (failSettings) throw new Error('offline'); nextSetting = create; } },
      });
      row = nextRow; setting = nextSetting;
      return result;
    },
    caseStudy: { findMany: async () => [row] },
    siteSetting: { findUnique: async () => setting },
  };
  const { saveCaseStudy } = actions(db);
  const payload = { ...catalog.caseStudy, images: ['/api/media/shot-1'], details, status: 'PUBLISHED', isPublished: true };
  try {
    assert.equal((await saveCaseStudy(payload)).success, true);
    assert.equal(row.isPublished, true);
    assert.equal(setting.key, 'caseStudy.study.details');
    const reader = load('src/lib/case-studies.ts', { '@/lib/blog-options': load('src/lib/blog-options.ts'), '@/lib/case-details': detailsModule, '@/lib/prisma': { prisma: db }, '@/data/consulting.json': catalog, '@/lib/site-settings': { isSiteSettingsDatabaseReady: () => true } });
    assert.deepEqual((await reader.getCaseStudy(payload.slug)).details, details);
    const previous = row;
    failSettings = true;
    assert.equal((await saveCaseStudy({ ...payload, title: 'Failed update' })).success, false);
    assert.equal(row, previous);
    failSettings = false;
    assert.equal((await saveCaseStudy({ ...payload, status: 'DRAFT' })).success, true);
    assert.equal(row.isPublished, false);
    assert.equal(await reader.getCaseStudy(payload.slug), null);
    const beforeInvalid = transactions;
    assert.equal((await saveCaseStudy({ ...payload, details: { ...details, embedUrl: 'javascript:alert(1)' } })).success, false);
    assert.equal(transactions, beforeInvalid);
  } finally { process.env = savedEnv; }
});

test('case studies hide missing narrative sections without inventing project evidence', async () => {
  let study = { ...catalog.caseStudy, summary: 'Verified project summary.', role: '', requirements: '', architecture: '', businessProblem: '', implementation: '', challenges: '', outcomes: '', stack: [], images: [] };
  const page = load('src/app/case-studies/[slug]/page.tsx', {
    '@/lib/seo': {}, '@/components/CaseStudyShowcase': () => null,
    '@/lib/prisma': { prisma: {} }, '@/lib/case-studies': { getCaseStudy: async () => study },
    'next/navigation': { notFound: () => { throw new Error('not found'); } },
    'next/link': ({ href, children, ...props }) => React.createElement('a', { ...props, href }, children),
  });
  const render = async () => renderToStaticMarkup(await page.default({ params: Promise.resolve({ slug: study.slug }) }));
  const minimal = await render();
  assert.match(minimal, /Project Overview/);
  for (const heading of ['Product Objectives', 'My Role and Responsibilities', 'Technical Architecture', 'Business Problem', 'Implementation Approach', 'Technical Trade-offs', 'Challenges and Solutions', 'Outcomes and Lessons Learned', 'Project Details', 'Technology Stack']) assert.ok(!minimal.includes(heading), heading);
  assert.doesNotMatch(minimal, /pending verification/);
  study = { ...study, role: 'Engineering', details: { tradeoffs: 'Verified design decision.', features: ['Verified feature'], lessons: 'Documented lesson.' } };
  const populated = await render();
  for (const value of ['My Role and Responsibilities', 'Engineering', 'Technical Trade-offs', 'Verified design decision.', 'Product Features', 'Verified feature', 'Documented lesson.']) assert.ok(populated.includes(value), value);
});
