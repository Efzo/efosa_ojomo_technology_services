"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidatePublicPath as revalidatePath } from "@/lib/public-cache";
import { isSiteSettingsDatabaseReady } from "@/lib/site-settings";
import { isManagedPageSlug, managedPageNames, parsePageContent, pagePath } from "@/lib/page-content-schema";

async function authorize() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user || !["OWNER", "EDITOR"].includes(user.role ?? "")) throw new Error("Unauthorized");
  return user;
}
const draftSchema = z.object({ slug: z.string(), id: z.string().optional(), baseRevision: z.number().int().nonnegative(), content: z.unknown(), metaTitle: z.string().trim().max(160), metaDescription: z.string().trim().max(320) });
const toJson = (value: unknown) => value as Prisma.InputJsonValue;

export async function saveManagedPageDraft(input: unknown): Promise<{ success: boolean; message: string; id?: string; revision?: number }> {
  const user = await authorize();
  if (!isSiteSettingsDatabaseReady()) return { success: false, message: "Connect PostgreSQL and disable demo mode to save page content." };
  const result = draftSchema.safeParse(input);
  if (!result.success || !isManagedPageSlug(result.data.slug)) return { success: false, message: "Choose a supported page and check the page settings." };
  const { slug, content, metaTitle, metaDescription, id, baseRevision } = result.data;
  if (!isManagedPageSlug(slug)) return { success: false, message: "Unknown page." };
  const parsed = parsePageContent(slug, content);
  if (!parsed.success) return { success: false, message: parsed.error.issues.map((issue) => `${issue.path.join(" / ")}: ${issue.message}`).join("; ") };
  try {
    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.page.findUnique({ where: { slug }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
      const revision = existing?.versions[0]?.version ?? 0;
      if ((id && existing?.id !== id) || revision !== baseRevision) throw new Error("This page changed in another session. Reload before saving.");
      // Preserve a legacy published page before its first draft edit.
      if (existing?.isPublished && existing.status === "PUBLISHED") {
        const previous = parsePageContent(slug, existing.content);
        if (previous.success) await tx.siteSetting.upsert({ where: { key: `page.${slug}.published` }, update: {}, create: { key: `page.${slug}.published`, value: toJson({ content: previous.data, metaTitle: existing.metaTitle ?? "", metaDescription: existing.metaDescription ?? "" }) } });
      }
      const version = revision + 1;
      const data = { title: managedPageNames[slug], content: toJson(parsed.data), metaTitle: metaTitle || null, metaDescription: metaDescription || null, status: "DRAFT" as const, isPublished: false };
      const page = existing ? await tx.page.update({ where: { id: existing.id }, data }) : await tx.page.create({ data: { slug, ...data } });
      await tx.pageVersion.create({ data: { pageId: page.id, version, title: page.title, content: data.content, metaTitle: data.metaTitle, metaDescription: data.metaDescription, createdById: user.id || null } });
      await tx.auditEvent.create({ data: { actorId: user.id || null, action: "page.draft_saved", target: page.id, metadata: { slug, version } } });
      return { id: page.id, revision: version };
    });
    revalidatePath(`/admin/pages/${slug}`);
    return { success: true, ...saved, message: "Draft saved. Public content has not changed." };
  } catch (error) {
    return { success: false, message: error instanceof Error && error.message.startsWith("This page changed") ? error.message : "The page could not be saved. Your edits are still in the form; try again." };
  }
}

export async function publishManagedPage(slug: string, expectedRevision: number) {
  const user = await authorize();
  if (!isManagedPageSlug(slug) || !Number.isInteger(expectedRevision) || expectedRevision < 1) return { success: false, message: "Save a valid page draft first." };
  if (!isSiteSettingsDatabaseReady()) return { success: false, message: "Connect PostgreSQL before publishing." };
  try {
    await prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({ where: { slug }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
      if (!page || page.versions[0]?.version !== expectedRevision) throw new Error("The draft changed. Reload and review it before publishing.");
      const parsed = parsePageContent(slug, page.content);
      if (!parsed.success) throw new Error("Invalid page content.");
      await tx.siteSetting.upsert({ where: { key: `page.${slug}.published` }, create: { key: `page.${slug}.published`, value: toJson({ content: parsed.data, metaTitle: page.metaTitle ?? "", metaDescription: page.metaDescription ?? "" }) }, update: { value: toJson({ content: parsed.data, metaTitle: page.metaTitle ?? "", metaDescription: page.metaDescription ?? "" }) } });
      await tx.page.update({ where: { id: page.id }, data: { status: "PUBLISHED", isPublished: true, publishedAt: new Date() } });
      await tx.auditEvent.create({ data: { actorId: user.id || null, action: "page.published", target: page.id, metadata: { slug, version: expectedRevision } } });
    });
    revalidatePath(pagePath(slug));
    revalidatePath(`/admin/pages/${slug}`);
    revalidatePath("/admin/content");
    return { success: true, message: "Published. Your changes are now visible on the website." };
  } catch (error) {
    return { success: false, message: error instanceof Error && error.message.startsWith("The draft changed") ? error.message : "The page could not be published. The previous public content is still available." };
  }
}

export async function restoreManagedPageVersion(slug: string, versionId: string, baseRevision: number) {
  await authorize();
  if (!isManagedPageSlug(slug) || !isSiteSettingsDatabaseReady()) return { success: false, message: "Page revision restore requires a configured database." };
  const page = await prisma.page.findUnique({ where: { slug } });
  const version = await prisma.pageVersion.findUnique({ where: { id: versionId } });
  if (!page || !version || version.pageId !== page.id) return { success: false, message: "That revision does not belong to this page." };
  return saveManagedPageDraft({ slug, id: page.id, baseRevision, content: version.content, metaTitle: version.metaTitle ?? "", metaDescription: version.metaDescription ?? "" });
}
