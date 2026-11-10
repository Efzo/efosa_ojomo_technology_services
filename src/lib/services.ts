import { publicRead } from "@/lib/public-cache";
import { services as fallbackServices, serviceAliases, type Service } from "@/data/services";
import { prisma } from "@/lib/prisma";

export type ManagedService = Service & {
  updatedAt?: Date;
  id?: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  price?: string | null;
  isPublished?: boolean;
};

function databaseReady() {
  return process.env.DEMO_MODE !== "true" && Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL?.includes("demo_");
}

export async function getManagedServices(): Promise<ManagedService[]> {
  if (!databaseReady()) return fallbackServices;
  try {
    const records = await publicRead("services", () => prisma.service.findMany({ orderBy: { createdAt: "asc" } }));
    if (!records.length && await publicRead("consulting-initialized", () => prisma.siteSetting.findUnique({ where: { key: "consulting.initialized" } }))) return [];
    return records.length ? records.map((record) => ({ ...record, updatedAt: new Date(record.updatedAt) })).filter((service) => service.isPublished && service.slug !== "introductory-discovery-call" && !Object.hasOwn(serviceAliases, service.slug)) : fallbackServices;
  } catch (error) {
    const failure = error as { code?: unknown; errorCode?: unknown; name?: unknown; message?: unknown } | null;
    const code = failure?.code ?? failure?.errorCode;
    const safeCode = typeof code === "string" && /^P\d{4}$/.test(code) ? code : "unknown";
    const safeName = typeof failure?.name === "string" && /^PrismaClient[A-Za-z]+Error$/.test(failure.name) ? failure.name : "unknown";
    const message = typeof failure?.message === "string" ? failure.message : "";
    const signals = ["engine", "binary", "openssl", "tls", "certificate", "ssl", "timeout", "connection", "authentication", "protocol", "url", "cache", "cached", "generation", "generated", "postinstall", "permission", "hostname", "refused", "closed", "datasource", "database", "schema", "server", "files"].filter((word) => new RegExp(`\\b${word}\\b`, "i").test(message));
    console.error("[services] database_read_failed", safeCode, safeName, signals.join(",") || "no_message_signals");
    return fallbackServices;
  }
}

export async function getManagedService(slug: string): Promise<ManagedService | undefined> {
  const services = await getManagedServices();
  return services.find((service) => service.slug === (serviceAliases[slug] ?? slug));
}
