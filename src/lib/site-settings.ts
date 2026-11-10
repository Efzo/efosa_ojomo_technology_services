import { publicRead } from "@/lib/public-cache";
import { prisma } from "@/lib/prisma";

import { pricingPlans as fallbackPricingPlans, pricingPlansSchema, pricingCatalogKey, type PricingPlan } from "@/data/pricing";

export const footerSettingDefaults = {
  linkedinUrl: "https://linkedin.com/in/efosa-o-4882a015a/",
  articlesUrl: "/blog",
  allServicesUrl: "/services",
  aiStrategyUrl: "/services/ai-solutions",
  fractionalTpmUrl: "/services/technical-product-management",
  aiArchitectureUrl: "/services/software-architecture",
  aboutUrl: "/about",
  processUrl: "/process",
  caseStudiesUrl: "/case-studies",
  contactUrl: "/contact",
  privacyUrl: "/privacy",
  termsUrl: "/terms",
} as const;

export type FooterSettings = Record<keyof typeof footerSettingDefaults, string>;

export type ContactBudgetOption = {
  value: string;
  label: string;
};

export const contactBudgetDefaults: ContactBudgetOption[] = [
  { value: "undetermined", label: "Undetermined" },
  { value: "5k-15k", label: "$5k – $15k" },
  { value: "15k-50k", label: "$15k – $50k" },
  { value: "50k-plus", label: "$50k+" },
];

export type NavigationItem = { label: string; href: string };
export type SeoSettings = { title: string; description: string; ogImage: string };
export type ManagedTestimonial = { id: string; quote: string; name: string; role: string; company: string; isPublished: boolean };

export const navigationDefaults: NavigationItem[] = [
  { label: "Services", href: "/services" },
  { label: "Case Studies", href: "/case-studies" },
  { label: "About", href: "/about" },
  { label: "Engagements & Pricing", href: "/engagements" },
  { label: "Blog", href: "/blog" },
  { label: "Videos", href: "/videos" },
];

export const seoDefaults: SeoSettings = {
  title: "Efosa Ojomo Technology Services | Your Technology Partner",
  description: "Websites, custom software, customer support systems, automation, and product leadership. Project delivery and ongoing care for businesses and founders.",
  ogImage: "/logo_pack/logo.png",
};

export const testimonialDefaults: ManagedTestimonial[] = [];

const trustLogosDefaults: { name: string; logoUrl: string }[] = [];

const demoOverrides = new Map<string, string>();

function dbReady() {
  return process.env.DEMO_MODE !== "true" && Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL?.includes("demo_");
}

function settingKey(key: keyof typeof footerSettingDefaults) {
  return `footer.${key}`;
}

async function readJsonSetting<T>(key: string, fallback: T): Promise<T> {
  if (!dbReady()) {
    const demoValue = demoOverrides.get(key);
    if (!demoValue) return fallback;
    try { return JSON.parse(demoValue) as T; } catch { return fallback; }
  }
  try {
    const record = await publicRead(`setting:${key}`, () => prisma.siteSetting.findUnique({ where: { key } }));
    return record?.value ? record.value as T : fallback;
  } catch {
    return fallback;
  }
}

export function getDefaultFooterSettings(): FooterSettings {
  return Object.fromEntries(
    Object.entries(footerSettingDefaults).map(([key, value]) => [key, demoOverrides.get(settingKey(key as keyof typeof footerSettingDefaults)) ?? value]),
  ) as FooterSettings;
}

export async function getFooterSettings(): Promise<FooterSettings> {
  const defaults = getDefaultFooterSettings();
  if (!dbReady()) return defaults;

  try {
    const records = await publicRead("footer", () => prisma.siteSetting.findMany({ where: { key: { startsWith: "footer." } } }));
    for (const record of records) {
      const key = record.key.replace(/^footer\./, "") as keyof typeof footerSettingDefaults;
      if (key in defaults && typeof record.value === "string") defaults[key] = record.value;
    }
  } catch {
    return defaults;
  }

  return defaults;
}

export async function getContactBudgetOptions(): Promise<ContactBudgetOption[]> {
  if (!dbReady()) {
    const demoValue = demoOverrides.get("contact.budgetOptions");
    if (demoValue) {
      try {
        const options = JSON.parse(demoValue) as unknown;
        if (Array.isArray(options) && options.length > 0) return options as ContactBudgetOption[];
      } catch {
        return contactBudgetDefaults;
      }
    }
    return contactBudgetDefaults;
  }

  try {
    const record = await publicRead("contact-budgets", () => prisma.siteSetting.findUnique({ where: { key: "contact.budgetOptions" } }));
    if (!Array.isArray(record?.value)) return contactBudgetDefaults;
    const options = record.value.filter((option): option is ContactBudgetOption => {
      if (!option || typeof option !== "object") return false;
      const candidate = option as { value?: unknown; label?: unknown };
      return typeof candidate.value === "string" && typeof candidate.label === "string" && candidate.value.trim().length > 0 && candidate.label.trim().length > 0;
    }).map((option) => ({ value: option.value.trim(), label: option.label.trim() }));
    const unique = options.filter((option, index) => options.findIndex((item) => item.value === option.value) === index);
    return unique.length > 0 ? unique : contactBudgetDefaults;
  } catch {
    return contactBudgetDefaults;
  }
}

export async function getNavigationItems(): Promise<NavigationItem[]> {
  const value = await readJsonSetting<unknown>("navigation.items", navigationDefaults);
  if (!Array.isArray(value)) return navigationDefaults;
  const items = value.filter((item): item is NavigationItem => Boolean(item && typeof item === "object" && typeof (item as NavigationItem).label === "string" && typeof (item as NavigationItem).href === "string" && (item as NavigationItem).label.trim() && (item as NavigationItem).href.trim())).map((item) => ({ label: item.label.trim(), href: item.href.trim() }));
  const canonical = items.filter((item) => !["/pricing", "/engagements"].includes(item.href));
  const pricingIndex = items.findIndex((item) => ["/pricing", "/engagements"].includes(item.href));
  canonical.splice(pricingIndex < 0 ? Math.min(2, canonical.length) : pricingIndex, 0, { label: "Engagements & Pricing", href: "/engagements" });
  return canonical;
}

export async function getSeoSettings(): Promise<SeoSettings> {
  const value = await readJsonSetting<Partial<SeoSettings>>("seo.settings", seoDefaults);
  return {
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : seoDefaults.title,
    description: typeof value.description === "string" && value.description.trim() ? value.description.trim() : seoDefaults.description,
    ogImage: typeof value.ogImage === "string" && value.ogImage.trim() ? value.ogImage.trim() : seoDefaults.ogImage,
  };
}

export async function getPricingPlans(): Promise<PricingPlan[]> {
  const value = await readJsonSetting<unknown>(pricingCatalogKey, fallbackPricingPlans);
  const parsed = pricingPlansSchema.safeParse(value);
  return parsed.success ? parsed.data : fallbackPricingPlans;
}

export async function getTestimonials(): Promise<ManagedTestimonial[]> {
  const value = await readJsonSetting<unknown>("testimonials.items", testimonialDefaults);
  return Array.isArray(value) && value.length ? value as ManagedTestimonial[] : testimonialDefaults;
}

export async function getTrustLogos(): Promise<{ name: string; logoUrl: string }[]> {
  return readJsonSetting<{ name: string; logoUrl: string }[]>("trust.logos", trustLogosDefaults);
}

export function setDemoSiteSetting(key: string, value: string) {
  demoOverrides.set(key, value);
}

export function isSiteSettingsDatabaseReady() {
  return dbReady();
}

export type ContactDetails = { email: string; availability: string };
export async function getContactDetails(): Promise<ContactDetails> {
  const value = await readJsonSetting<Partial<ContactDetails>>("contact.details", {});
  return { email: typeof value.email === "string" ? value.email : "", availability: typeof value.availability === "string" ? value.availability : "" };
}
