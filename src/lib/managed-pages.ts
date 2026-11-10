import { publicRead } from "@/lib/public-cache";
import { prisma } from "@/lib/prisma";
import { isSiteSettingsDatabaseReady } from "@/lib/site-settings";
import { getPageDefaults, parsePageContent, pagePath, type ManagedPageSlug, type ManagedPageContent } from "@/lib/page-content-schema";
import { pageMetadata } from "@/lib/seo";
import { draftMode } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function canPreviewPages() {
  if (!(await draftMode()).isEnabled) return false;
  const session = await getServerSession(authOptions);
  return ["OWNER", "EDITOR"].includes((session?.user as { role?: string })?.role ?? "");
}
export async function getManagedPage<K extends ManagedPageSlug>(slug: K, preview = true): Promise<{ content: ManagedPageContent<K>; metaTitle?: string; metaDescription?: string }> {
  const fallback = { content: getPageDefaults(slug) };
  if (!isSiteSettingsDatabaseReady()) return fallback;
  try {
    if (preview && await canPreviewPages()) {
      const page = await prisma.page.findUnique({ where: { slug } });
      const parsed = parsePageContent(slug, page?.content);
      if (page && parsed.success) return { content: parsed.data as ManagedPageContent<K>, metaTitle: page.metaTitle ?? undefined, metaDescription: page.metaDescription ?? undefined };
    }
    const snapshot = await publicRead(`page:${slug}`, () => prisma.siteSetting.findUnique({ where: { key: `page.${slug}.published` } }));
    if (snapshot?.value && typeof snapshot.value === "object" && !Array.isArray(snapshot.value)) {
      const value = snapshot.value as { content?: unknown; metaTitle?: string; metaDescription?: string; unpublished?: boolean };
      if (value.unpublished) return fallback;
      const parsed = parsePageContent(slug, value.content);
      if (parsed.success) return { content: parsed.data as ManagedPageContent<K>, metaTitle: typeof value.metaTitle === "string" ? value.metaTitle : undefined, metaDescription: typeof value.metaDescription === "string" ? value.metaDescription : undefined };
    }
    const page = await publicRead(`page-legacy:${slug}`, () => prisma.page.findUnique({ where: { slug, isPublished: true, status: "PUBLISHED" } }));
    const parsed = parsePageContent(slug, page?.content);
    if (page?.isPublished && page.status === "PUBLISHED" && parsed.success) return { content: parsed.data as ManagedPageContent<K>, metaTitle: page.metaTitle ?? undefined, metaDescription: page.metaDescription ?? undefined };
  } catch { /* Existing page content stays available during setup/outages. */ }
  return fallback;
}
export async function getManagedPageContent<K extends ManagedPageSlug>(slug: K) { return (await getManagedPage(slug)).content; }
export async function managedPageMetadata(slug: ManagedPageSlug) {
  const page = await getManagedPage(slug);
  const content = page.content;
  const title = "headline" in content ? content.headline : content.title;
  const description = "description" in content ? content.description : "bio" in content ? content.bio[0] : "introduction" in content ? content.introduction : title;
  return pageMetadata(page.metaTitle || title, page.metaDescription || description.slice(0, 320), pagePath(slug));
}
