"use server";

import { getServerSession } from "next-auth";
import { sendPasswordReset, applyPasswordReset } from "@/lib/password-reset";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeDemoResetToken, createDemoResetToken, setDemoPassword } from "@/lib/demo-password";
import { footerSettingDefaults, setDemoSiteSetting } from "@/lib/site-settings";
import { sanitizeRichText } from "@/lib/rich-text";
import { revalidatePublicPath as revalidatePath } from "@/lib/public-cache";
import { blogOptionsSchema, blogOptionsKey, blogImageUrlSchema } from "@/lib/blog-options";
import { homeSchema } from "@/lib/home-content";
import { caseDetailsSchema, screenshotUrlSchema } from "@/lib/case-details";
import { isManagedPageSlug } from "@/lib/page-content-schema";
import consulting from "@/data/consulting.json";
import { serviceAliases } from "@/data/services";
import { pricingPlansSchema, pricingCatalogKey } from "@/data/pricing";

const pageSchema = z.object({
  id: z.string().optional(),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(2).max(160),
  metaTitle: z.string().trim().max(160).optional(),
  metaDescription: z.string().trim().max(320).optional(),
  content: z.union([homeSchema, z.array(z.object({ id: z.string(), type: z.enum(["hero", "rich-text", "services", "cta"]), title: z.string(), visible: z.boolean() }))]),
});
const blogSchema = z.object({ id: z.string().optional(), slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), title: z.string().trim().min(2).max(180), excerpt: z.string().trim().min(10).max(500), content: z.string().trim().min(20).max(50000), category: z.string().trim().min(2).max(80), featuredImage: blogImageUrlSchema.or(z.literal("")).optional(), options: blogOptionsSchema.optional() });

async function requireRole(roles: Array<"OWNER" | "EDITOR" | "VIEWER"> = ["OWNER", "EDITOR"]) {
  const session = await getServerSession(authOptions);
  let role = (session?.user as { role?: "OWNER" | "EDITOR" | "VIEWER" } | undefined)?.role;
  if (dbReady()) {
    const user = session?.user?.email ? await prisma.user.findUnique({ where: { email: session.user.email } }) : null;
    role = user?.role;
  }
  if (!role || !roles.includes(role)) throw new Error("Unauthorized");
  return { session, role };
}

function dbReady() {
  return process.env.DEMO_MODE !== "true" && Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL?.includes("demo_");
}

async function audit(action: string, target: string, metadata?: Prisma.InputJsonValue) {
  if (!dbReady()) return;
  const session = await getServerSession(authOptions);
  const actorId = (session?.user as { id?: string } | undefined)?.id;
  await prisma.auditEvent.create({ data: { action, target, metadata, actorId: actorId || null } });
}

export async function savePageDraft(input: unknown) {
  await requireRole();
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL and disable demo mode before saving CMS content." };
  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "The page content is invalid." };
  const data = parsed.data;
  if (isManagedPageSlug(data.slug)) return { success: false, message: "Use the connected website page editor to save this page." };
  const content = data.content as Prisma.InputJsonValue;
  try {
    if (!data.id) {
      const page = await prisma.page.create({ data: { slug: data.slug, title: data.title, content, metaTitle: data.metaTitle || null, metaDescription: data.metaDescription || null, status: "DRAFT", isPublished: false, versions: { create: { version: 1, title: data.title, content, metaTitle: data.metaTitle || null, metaDescription: data.metaDescription || null } } } });
      await audit("page.created", page.id);
      return { success: true, id: page.id, message: "Draft created." };
    }
    const page = await prisma.page.findUnique({ where: { id: data.id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    if (!page) return { success: false, message: "Page not found." };
    const version = (page.versions[0]?.version ?? 0) + 1;
    await prisma.$transaction([
      prisma.page.update({ where: { id: data.id }, data: { slug: data.slug, title: data.title, content, metaTitle: data.metaTitle || null, metaDescription: data.metaDescription || null, status: "DRAFT", isPublished: false } }),
      prisma.pageVersion.create({ data: { pageId: data.id, version, title: data.title, content, metaTitle: data.metaTitle || null, metaDescription: data.metaDescription || null } }),
    ]);
    await audit("page.draft_saved", data.id, { version });
    return { success: true, id: data.id, message: "Draft saved." };
  } catch {
    return { success: false, message: "The draft could not be saved." };
  }
}

export async function publishPage(pageId: string) {
  await requireRole(["OWNER", "EDITOR"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before publishing." };
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) return { success: false, message: "Page not found." };
  if (isManagedPageSlug(page.slug)) return { success: false, message: "Publish this page from its connected page editor." };
  if (page.slug === "home") {
    const parsed = homeSchema.safeParse(page.content);
    if (!parsed.success) return { success: false, message: "Use the homepage editor to save complete homepage content before publishing." };
    await prisma.$transaction([
      prisma.siteSetting.upsert({ where: { key: "homepage.seo" }, create: { key: "homepage.seo", value: { title: page.metaTitle, description: page.metaDescription } }, update: { value: { title: page.metaTitle, description: page.metaDescription } } }),
      prisma.siteSetting.upsert({ where: { key: "homepage.published" }, create: { key: "homepage.published", value: parsed.data }, update: { value: parsed.data } }),
      prisma.page.update({ where: { id: pageId }, data: { status: "PUBLISHED", isPublished: true, publishedAt: new Date() } }),
    ]);
  } else {
    await prisma.page.update({ where: { id: pageId }, data: { status: "PUBLISHED", isPublished: true, publishedAt: new Date() } });
  }
  revalidatePath("/", "layout");
  await audit("page.published", pageId);
  return { success: true, message: "Page published." };
}

export async function restorePageVersion(pageId: string, versionId: string) {
  await requireRole(["OWNER", "EDITOR"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before restoring a version." };
  const [page, version] = await Promise.all([prisma.page.findUnique({ where: { id: pageId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } }), prisma.pageVersion.findUnique({ where: { id: versionId } })]);
  if (!page || !version || version.pageId !== page.id) return { success: false, message: "Version not found." };
  if (isManagedPageSlug(page.slug)) return { success: false, message: "Restore this page from its connected page editor." };
  const nextVersion = (page.versions[0]?.version ?? 0) + 1;
  const restoredContent = version.content as Prisma.InputJsonValue;
  await prisma.$transaction([prisma.page.update({ where: { id: pageId }, data: { title: version.title, content: restoredContent, metaTitle: version.metaTitle, metaDescription: version.metaDescription, status: "DRAFT", isPublished: false } }), prisma.pageVersion.create({ data: { pageId, version: nextVersion, title: version.title, content: restoredContent, metaTitle: version.metaTitle, metaDescription: version.metaDescription } })]);
  await audit("page.version_restored", pageId, { versionId });
  return { success: true, message: "Version restored as a new draft." };
}

function refreshServicePages(slug: string) {
  revalidatePath("/services");
  revalidatePath(`/services/${slug}`);
  revalidatePath("/");
  revalidatePath("/sitemap.xml");
  revalidatePath("/admin/services");
}

export async function updateService(input: unknown) {
  await requireRole(["OWNER", "EDITOR"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before editing services." };
  const parsed = z.object({ id: z.string(), title: z.string().min(2).max(160), shortDescription: z.string().min(10).max(500), fullDescription: z.string().min(10).max(4000), targetAudience: z.string().min(2).max(500), ctaText: z.string().min(2).max(80), price: z.string().max(80).nullable().optional(), isPublished: z.boolean(), problemsSolved: z.array(z.string().trim().max(300)).max(30).optional(), deliverables: z.array(z.string().trim().max(300)).max(30).optional(), engagementProcess: z.array(z.string().trim().max(300)).max(20).optional(), metaTitle: z.string().trim().max(160).nullable().optional(), metaDescription: z.string().trim().max(320).nullable().optional() }).safeParse(input);
  if (!parsed.success) return { success: false, message: "Service data is invalid." };
  const { id, ...serviceData } = parsed.data;
  const updated = await prisma.service.update({ where: { id }, data: serviceData });
  await audit("service.updated", id);
  refreshServicePages(updated.slug);
  return { success: true, message: Object.hasOwn(serviceAliases, updated.slug) ? "Historical service alias saved. It remains hidden from public listings; edit its current service for public changes." : updated.isPublished ? "Service saved and published. It is visible on /services." : "Service saved as a draft. It is hidden from the public website." };
}

const serviceCreateSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(2).max(160),
  shortDescription: z.string().trim().min(10).max(500),
  fullDescription: z.string().trim().min(10).max(4000),
  targetAudience: z.string().trim().min(2).max(500),
  ctaText: z.string().trim().min(2).max(80),
  price: z.string().trim().max(80).nullable().optional(),
  isPublished: z.boolean().default(false),
  problemsSolved: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  deliverables: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  engagementProcess: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
});

export async function createService(input: unknown) {
  await requireRole(["OWNER", "EDITOR"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before creating services." };
  const parsed = serviceCreateSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Service data is invalid." };
  if (Object.hasOwn(serviceAliases, parsed.data.slug)) return { success: false, message: "That slug is reserved for a historical service URL. Choose a different slug for your new service." };
  try {
    const service = await prisma.service.create({ data: { ...parsed.data, price: parsed.data.price || null } });
    await audit("service.created", service.id);
    refreshServicePages(service.slug);
    return { success: true, id: service.id, service, message: service.isPublished ? "Service created and published. It is visible on /services." : "Service created as a draft. Publish it below when it is ready to appear on the public website." };
  } catch {
    return { success: false, message: "The service could not be created. Slugs must be unique." };
  }
}

export async function deleteService(serviceId: string) {
  await requireRole(["OWNER"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before deleting services." };
  try {
    const service = await prisma.service.delete({ where: { id: serviceId } });
    await audit("service.deleted", serviceId, { slug: service.slug });
    refreshServicePages(service.slug);
    return { success: true, message: "Service deleted." };
  } catch {
    return { success: false, message: "The service could not be deleted." };
  }
}

export async function saveBlogPostDraft(input: unknown) {
  await requireRole();
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before saving articles." };
  const parsed = blogSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: `Check article fields: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}` };
  const { id, options, featuredImage, ...fields } = parsed.data;
  const content = sanitizeRichText(fields.content);
  if (content.replace(/<[^>]*>/g, "").trim().length < 20) return { success: false, message: "Article content must contain at least 20 readable characters." };
  if (featuredImage && options && !options.images.some((image) => image.url === featuredImage)) return { success: false, message: "Choose the cover from this article's uploaded images." };
  try {
    const post = await prisma.$transaction(async (tx) => {
      const previous = id ? await tx.blogPost.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } }) : null;
      if (id && !previous) throw new Error("Article not found");
      const version = (previous?.versions[0]?.version ?? 0) + 1;
      const data = { ...fields, content, status: "DRAFT" as const, ...(featuredImage !== undefined ? { featuredImage: featuredImage || null } : {}) };
      const versionData = { version, title: fields.title, excerpt: fields.excerpt, content, category: fields.category };
      const saved = id
        ? await tx.blogPost.update({ where: { id }, data: { ...data, versions: { create: versionData } } })
        : await tx.blogPost.create({ data: { ...data, versions: { create: versionData } } });
      if (options) await tx.siteSetting.upsert({ where: { key: blogOptionsKey(saved.id) }, create: { key: blogOptionsKey(saved.id), value: options }, update: { value: options } });
      return { ...saved, oldSlug: previous?.slug };
    });
    await audit(id ? "blog.draft_saved" : "blog.created", post.id);
    revalidatePath("/", "layout");
    revalidatePath("/sitemap.xml");
    if (post.oldSlug && post.oldSlug !== post.slug) revalidatePath(`/blog/${post.oldSlug}`);
    return { success: true, id: post.id, message: "Article draft saved privately, including images and search settings. Use Save & publish to make it public." };
  } catch { return { success: false, message: "The article draft could not be saved. Check that the slug is unique." }; }
}

export async function publishBlogPost(postId: string) {
  await requireRole(["OWNER", "EDITOR"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before publishing articles." };
  try {
    const previous = await prisma.blogPost.findUnique({ where: { id: postId } });
    if (!previous) return { success: false, message: "Article not found." };
    const post = await prisma.blogPost.update({ where: { id: postId }, data: { status: "PUBLISHED", publishedAt: previous.publishedAt ?? new Date() } });
    await audit("blog.published", postId);
    revalidatePath("/", "layout");
    revalidatePath(`/blog/${post.slug}`);
    revalidatePath("/sitemap.xml");
    return { success: true, message: "Article published with its images and search settings." };
  } catch { return { success: false, message: "The article could not be published. Your saved draft is retained." }; }
}

export async function updateSiteSetting(key: string, value: unknown) {
  await requireRole(["OWNER"]);
  const parsedValue = z.string().trim().max(2000).safeParse(value);
  if (!parsedValue.success) return { success: false, message: "Setting value is invalid." };
  const footerKey = key.startsWith("footer.") ? key.slice("footer.".length) : "";
  if (footerKey && !(footerKey in footerSettingDefaults)) return { success: false, message: "Footer setting is not supported." };
  if (footerKey) {
    const url = parsedValue.data;
    const isRelativePath = url.startsWith("/") && !url.startsWith("//");
    const isWebUrl = /^https?:\/\//i.test(url);
    const isContactUrl = /^(mailto:|tel:)/i.test(url);
    if (!isRelativePath && !isWebUrl && !isContactUrl) return { success: false, message: "Use an internal path or a valid web URL." };
  }
  if (!dbReady()) {
    setDemoSiteSetting(key, parsedValue.data);
    revalidatePath("/", "layout");
    return { success: true, message: "Setting updated for this running server." };
  }
  await prisma.siteSetting.upsert({ where: { key }, update: { value: parsedValue.data as Prisma.InputJsonValue }, create: { key: key, value: parsedValue.data as Prisma.InputJsonValue } });
  await audit("setting.updated", key);
  revalidatePath("/", "layout");
  return { success: true, message: "Setting updated." };
}

export async function updateSeoSettings(values: unknown) {
  await requireRole(["OWNER"]);
  const parsed = z.object({
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(320),
    ogImage: z.string().trim().url().or(z.string().trim().startsWith("/")),
  }).safeParse(values);
  if (!parsed.success) return { success: false, message: "SEO data is invalid." };

  if (!dbReady()) {
    setDemoSiteSetting("seo.settings", JSON.stringify(parsed.data));
    revalidatePath("/", "layout");
    return { success: true, message: "SEO settings updated for this running server." };
  }

  await prisma.siteSetting.upsert({
    where: { key: "seo.settings" },
    update: { value: parsed.data as Prisma.InputJsonValue },
    create: { key: "seo.settings", value: parsed.data as Prisma.InputJsonValue },
  });
  await audit("setting.updated", "seo.settings");
  revalidatePath("/", "layout");
  return { success: true, message: "SEO settings updated." };
}

export async function updateContactBudgetOptions(input: unknown) {
  await requireRole(["OWNER"]);
  const parsed = z.array(z.object({
    value: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    label: z.string().trim().min(1).max(120),
  })).min(1).max(20).safeParse(input);
  if (!parsed.success) return { success: false, message: "Add between 1 and 20 valid budget options." };

  const values = parsed.data.map((option) => option.value);
  if (new Set(values).size !== values.length || values.includes("custom")) {
    return { success: false, message: "Budget option values must be unique and cannot use the reserved custom value." };
  }

  if (!dbReady()) {
    setDemoSiteSetting("contact.budgetOptions", JSON.stringify(parsed.data));
    revalidatePath("/contact");
    return { success: true, message: "Budget options updated for this running server." };
  }

  await prisma.siteSetting.upsert({
    where: { key: "contact.budgetOptions" },
    update: { value: parsed.data as Prisma.InputJsonValue },
    create: { key: "contact.budgetOptions", value: parsed.data as Prisma.InputJsonValue },
  });
  await audit("setting.updated", "contact.budgetOptions");
  revalidatePath("/contact");
  return { success: true, message: "Budget options updated." };
}

export async function updateNavigationItems(input: unknown) {
  await requireRole(["OWNER"]);
  const parsed = z.array(z.object({ label: z.string().trim().min(1).max(60), href: z.string().trim().min(1).max(300) })).min(1).max(12).safeParse(input);
  if (!parsed.success || parsed.data.some((item) => !item.href.startsWith("/") && !/^https?:\/\//i.test(item.href))) return { success: false, message: "Navigation labels and internal or web URLs are required." };
  if (new Set(parsed.data.map((item) => item.href)).size !== parsed.data.length) return { success: false, message: "Navigation URLs must be unique." };
  const value = parsed.data;
  if (!dbReady()) setDemoSiteSetting("navigation.items", JSON.stringify(value));
  else await prisma.siteSetting.upsert({ where: { key: "navigation.items" }, update: { value: value as Prisma.InputJsonValue }, create: { key: "navigation.items", value: value as Prisma.InputJsonValue } });
  await audit("navigation.updated", "navigation.items");
  revalidatePath("/", "layout");
  return { success: true, message: "Navigation updated." };
}

export async function updatePricingPlans(input: unknown) {
  await requireRole(["OWNER", "EDITOR"]);
  const parsed = pricingPlansSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Each offer needs a unique slug ID, name, description, model, CTA, and valid deliverables. Visible prices cannot be blank." };
  const value = parsed.data;
  if (!dbReady()) setDemoSiteSetting(pricingCatalogKey, JSON.stringify(value));
  else await prisma.siteSetting.upsert({ where: { key: pricingCatalogKey }, update: { value: value as Prisma.InputJsonValue }, create: { key: pricingCatalogKey, value: value as Prisma.InputJsonValue } });
  await audit("pricing.updated", pricingCatalogKey);
  revalidatePath("/engagements");
  revalidatePath("/");
  revalidatePath("/pricing");
  revalidatePath("/contact");
  revalidatePath("/admin/packages");
  return { success: true, message: "Engagements & Pricing updated." };
}

export async function saveCaseStudy(input: unknown) {
  await requireRole(["OWNER", "EDITOR"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before saving case studies." };

  const parsed = z.object({
    id: z.string().optional(),
    slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(2).max(180),
    summary: z.string().trim().min(10).max(600),
    category: z.string().trim().min(2).max(80),
    details: caseDetailsSchema.optional(),
    businessProblem: z.string().trim().min(10).max(3000),
    role: z.string().trim().min(1).max(200),
    requirements: z.string().trim().min(1).max(2000),
    architecture: z.string().trim().min(1).max(2000),
    stack: z.array(z.string().trim().min(1).max(100)).max(50),
    implementation: z.string().trim().min(10).max(5000),
    challenges: z.string().trim().min(10).max(3000),
    outcomes: z.string().trim().min(10).max(2000),
    images: z.array(screenshotUrlSchema).max(20).refine((images) => new Set(images).size === images.length, "Do not repeat screenshot URLs."),
    relatedServices: z.array(z.string().trim()).max(10),
    isPublished: z.boolean(),
    status: z.enum(["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"]),
  }).safeParse(input);

  if (!parsed.success) return { success: false, message: `Check the case study fields: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "details"}: ${issue.message}`).join("; ")}` };

  const { details, id, ...fields } = parsed.data;
  const data = { ...fields, title: fields.title.replace(/clincddesk/ig, "ClinchDesk"), isPublished: fields.isPublished && fields.status === "PUBLISHED" };
  try {
    const study = await prisma.$transaction(async (tx) => {
      const saved = id ? await tx.caseStudy.update({ where: { id }, data }) : await tx.caseStudy.create({ data });
      if (details) {
        // Save media settings with the case study so partial updates cannot be published.
        const value = { ...details, screenshots: details.screenshots.filter((item) => data.images.includes(item.url)) };
        await tx.siteSetting.upsert({ where: { key: `caseStudy.${saved.id}.details` }, create: { key: `caseStudy.${saved.id}.details`, value }, update: { value } });
      }
      return saved;
    });
    await audit(id ? "case_study.updated" : "case_study.created", study.id);
    revalidatePath("/", "layout");
    return { success: true, id: study.id, message: study.isPublished ? "Case study saved and published, including screenshots and product links." : "Case study saved privately. Select Published and the Published status to show it on the website." };
  } catch {
    return { success: false, message: "Could not save case study. Check that the slug is unique and the media settings are valid." };
  }
}

export async function deleteCaseStudy(id: string) {
  await requireRole(["OWNER"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before deleting case studies." };
  try {
    await prisma.caseStudy.delete({ where: { id } });
    revalidatePath("/", "layout");
    await audit("case_study.deleted", id);
    return { success: true, message: "Case study deleted." };
  } catch {
    return { success: false, message: "Could not delete case study." };
  }
}

export async function saveEngagement(input: unknown) {
  await requireRole(["OWNER", "EDITOR"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before saving engagement models." };

  const parsed = z.object({
    id: z.string().optional(),
    slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().min(10).max(3000),
    price: z.string().trim().max(160),
    features: z.array(z.string().trim().min(1).max(160)).max(20),
    type: z.enum(["FIXED", "RETAINER", "HOURLY"]),
    ctaText: z.string().trim().min(2).max(80),
    isPublished: z.boolean(),
  }).safeParse(input);

  if (!parsed.success) return { success: false, message: "Engagement model data is invalid." };

  const data = parsed.data;
  try {
    if (!data.id) {
      const model = await prisma.engagementModel.create({ data });
      revalidatePath("/", "layout");
      await audit("engagement_model.created", model.id);
      return { success: true, id: model.id, message: "Engagement model created." };
    }
    const model = await prisma.engagementModel.update({ where: { id: data.id }, data });
    revalidatePath("/", "layout");
    await audit("engagement_model.updated", data.id);
    return { success: true, id: model.id, message: "Engagement model updated." };
  } catch {
    return { success: false, message: "Could not save engagement model. Ensure the slug is unique." };
  }
}

export async function deleteEngagement(id: string) {
  await requireRole(["OWNER"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before deleting engagement models." };
  try {
    await prisma.engagementModel.delete({ where: { id } });
    revalidatePath("/", "layout");
    await audit("engagement_model.deleted", id);
    return { success: true, message: "Engagement model deleted." };
  } catch {
    return { success: false, message: "Could not delete engagement model." };
  }
}

export async function updateTestimonials(input: unknown) {
  await requireRole(["OWNER", "EDITOR"]);
  const parsed = z.array(z.object({ id: z.string().trim().min(1).max(80), quote: z.string().trim().min(10).max(1000), name: z.string().trim().min(2).max(120), role: z.string().trim().min(2).max(120), company: z.string().trim().min(2).max(120), isPublished: z.boolean() })).max(30).safeParse(input);
  if (!parsed.success) return { success: false, message: "Case study data is invalid. Check slugs, summaries, outcomes, and metrics." };
  const value = parsed.data;
  if (!dbReady()) setDemoSiteSetting("testimonials.items", JSON.stringify(value));
  else await prisma.siteSetting.upsert({ where: { key: "testimonials.items" }, update: { value: value as Prisma.InputJsonValue }, create: { key: "testimonials.items", value: value as Prisma.InputJsonValue } });
  await audit("testimonials.updated", "testimonials.items");
  revalidatePath("/");
  return { success: true, message: "Testimonials updated." };
}

export async function updateLead(input: unknown) {
  await requireRole(["OWNER", "EDITOR"]);
  const parsed = z.object({ id: z.string().min(1), status: z.enum(["NEW", "QUALIFIED", "DISCOVERY_SCHEDULED", "PROPOSAL_SENT", "WON", "LOST"]), notes: z.string().max(5000) }).safeParse(input);
  if (!parsed.success || !dbReady()) return { success: false, message: parsed.success ? "Connect PostgreSQL before updating leads." : "Lead update is invalid." };
  await prisma.lead.update({ where: { id: parsed.data.id }, data: { status: parsed.data.status, notes: parsed.data.notes.trim() || null } });
  await audit("lead.updated", parsed.data.id);
  revalidatePath("/admin/leads");
  revalidatePath("/admin");
  return { success: true, message: "Lead updated." };
}

export async function updateUserRole(userId: string, role: "OWNER" | "EDITOR" | "VIEWER") {
  await requireRole(["OWNER"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before managing users." };
  if (!z.enum(["OWNER", "EDITOR", "VIEWER"]).safeParse(role).success || !userId) return { success: false, message: "Invalid user or role." };
  await prisma.user.update({ where: { id: userId }, data: { role } });
  await audit("user.role_updated", userId, { role });
  return { success: true, message: "Role updated." };
}

export async function requestPasswordReset(emailInput: string): Promise<{ success: boolean; message: string; resetUrl?: string }> {
  const email = emailInput.trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) return { success: false, message: "Enter a valid email address." };
  const configuredEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  const isConfiguredAccount = email === configuredEmail;
  if (process.env.DEMO_MODE === "true") {
    if (!isConfiguredAccount) return { success: true, message: "If that account exists, a reset email will be sent." };
    const token = createDemoResetToken();
    return { success: true, message: "Demo reset link created.", resetUrl: `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/admin/reset-password?token=${token}` };
  }
  if (!dbReady()) return { success: true, message: "If that account exists, a reset email will be sent. Check your inbox and spam folder." };
  return sendPasswordReset(email);
}

export async function requestAdminAccount(emailInput: string) {
  const email = emailInput.trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) return { success: false, message: "Enter a valid email address." };
  if (!dbReady()) return { success: false, message: "Account setup requires a configured database with demo mode disabled." };
  return sendPasswordReset(email, true);
}

export async function resetPassword(tokenInput: string, passwordInput: string) {
  const token = tokenInput.trim();
  const password = passwordInput;
  if (password.trim().length < 8 || Buffer.byteLength(password, "utf8") > 72) return { success: false, message: "Use at least 8 non-padding characters and at most 72 UTF-8 bytes." };
  if (process.env.DEMO_MODE === "true") {
    if (!consumeDemoResetToken(token)) return { success: false, message: "This reset link is invalid or has already been used." };
    setDemoPassword(password);
    return { success: true, message: "Demo password updated for this running server." };
  }
  if (!dbReady()) return { success: false, message: "Password reset is not configured." };
  return applyPasswordReset(token, password);
}

export async function initializeConsultingContent() {
  await requireRole(["OWNER"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL and disable demo mode before importing content." };
  await prisma.$transaction(async (tx) => {
    await tx.siteSetting.upsert({ where: { key: "consulting.initialized" }, create: { key: "consulting.initialized", value: true }, update: {} });
    for (const service of consulting.services) await tx.service.upsert({ where: { slug: service.slug }, update: {}, create: service });
    for (const model of consulting.engagements) await tx.engagementModel.upsert({ where: { slug: model.slug }, update: {}, create: { ...model, type: model.type as "FIXED" | "RETAINER" } });
    const existing = await tx.caseStudy.findFirst({ where: { OR: [{ slug: { contains: "clinch", mode: "insensitive" } }, { title: { contains: "clinc", mode: "insensitive" } }] } });
    if (!existing) await tx.caseStudy.create({ data: { ...consulting.caseStudy, status: "PUBLISHED" } });
    else if (/clincddesk/i.test(existing.title)) await tx.caseStudy.update({ where: { id: existing.id }, data: { title: existing.title.replace(/clincddesk/ig, "ClinchDesk") } });
  });
  await audit("consulting.initialized", "catalog");
  revalidatePath("/", "layout");
  return { success: true, message: "Missing consulting content added. Existing content and publication choices preserved." };
}

export async function archiveBlogPost(id: string) {
  await requireRole();
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before archiving articles." };
  await prisma.blogPost.update({ where: { id }, data: { status: "ARCHIVED" } });
  await audit("blog.archived", id);
  revalidatePath("/sitemap.xml");
  revalidatePath("/", "layout");
  return { success: true, message: "Article unpublished and archived." };
}
export async function deleteBlogPost(id: string) {
  await requireRole(["OWNER"]);
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before deleting articles." };
  await prisma.blogPost.delete({ where: { id } });
  await audit("blog.deleted", id);
  revalidatePath("/sitemap.xml");
  revalidatePath("/", "layout");
  return { success: true, message: "Article deleted." };
}

export async function updateContactDetails(input: unknown) {
  await requireRole(["OWNER"]);
  const parsed = z.object({ email: z.string().trim().email().or(z.literal("")), availability: z.string().trim().max(300) }).safeParse(input);
  if (!parsed.success) return { success: false, message: "Enter a valid contact email or leave it blank." };
  if (!dbReady()) return { success: false, message: "Connect PostgreSQL before saving contact details." };
  await prisma.siteSetting.upsert({ where: { key: "contact.details" }, create: { key: "contact.details", value: parsed.data }, update: { value: parsed.data } });
  await audit("contact_details.updated", "contact.details");
  revalidatePath("/contact");
  return { success: true, message: "Contact details updated. Notification delivery still uses the server email settings." };
}
