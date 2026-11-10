import { publicRead } from "@/lib/public-cache";
import { canPreviewPages } from "@/lib/managed-pages";
import { prisma } from "@/lib/prisma";
import { homeDefaults, homeSchema } from "@/lib/home-content";
import { isSiteSettingsDatabaseReady } from "@/lib/site-settings";

export async function getHomePageContent() {
  if (!isSiteSettingsDatabaseReady()) return homeDefaults;
  try {
    if (await canPreviewPages()) {
      const draft = await prisma.page.findUnique({ where: { slug: "home" } });
      const parsed = homeSchema.safeParse(draft?.content);
      if (parsed.success) return parsed.data;
    }
    // Published snapshot keeps draft edits off the public homepage.
    const snapshot = await publicRead("homepage", () => prisma.siteSetting.findUnique({ where: { key: "homepage.published" } }));
    const parsed = homeSchema.safeParse(snapshot?.value);
    if (parsed.success) return parsed.data;
    const page = await publicRead("homepage-legacy", () => prisma.page.findUnique({ where: { slug: "home", isPublished: true, status: "PUBLISHED" } }));
    if (page?.isPublished && page.status === "PUBLISHED") {
      const legacy = homeSchema.safeParse(page.content);
      if (legacy.success) return legacy.data;
    }
  } catch { /* Use a complete homepage during setup or database outages. */ }
  return homeDefaults;
}
