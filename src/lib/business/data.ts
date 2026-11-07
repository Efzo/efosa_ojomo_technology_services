import { prisma } from "@/lib/prisma";
import { businessDatabaseReady, requireBusinessOwner } from "./access";
import { BUSINESS_NAME, todayInAustin, invoiceState, profileSchema, type BusinessRow, type Choice, type Section, type Entity } from "./config";

export type PaymentRow = { id: string; kind: string; amountCents: number; feeCents: number; date: string; method: string; reference: string; notes: string };
export type WorkspaceData = {
  available: boolean; message: string; rows: BusinessRow[]; total: number; page: number; pages: number;
  clients: Choice[]; engagements: Choice[]; optionsLimited: boolean; leads: { id: string; company: string; name: string }[];
  profile: { name: string; email: string; address: string; paymentInstructions: string; weeklyHours: number };
  payments: Record<string, PaymentRow[]>;
  summary: { activeClients: number; activeEngagements: number; openTasks: number; outstandingCents: number; monthlyCollectedCents: number; monthlyExpenseCents: number; monthlyFeeCents: number; monthlyMinutes: number };
  followUps: BusinessRow[]; dueTasks: BusinessRow[]; renewals: BusinessRow[];
};
export const sectionEntity: Partial<Record<Section, Entity>> = { clients: "client", engagements: "engagement", retainers: "engagement", tasks: "task", invoices: "invoice", expenses: "expense", time: "time", documents: "document", setup: "task" };
export const entityModels = { client: "businessClient", engagement: "businessEngagement", task: "businessTask", invoice: "businessInvoice", expense: "businessExpense", time: "businessTimeEntry", document: "businessDocument", payment: "businessPayment" } as const;
export function flattenBusinessRow(record: Record<string, unknown>): BusinessRow {
  const row: BusinessRow = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" || typeof value === "number") row[key] = value;
    else if (value === null) row[key] = "";
    else if (value instanceof Date) row[key] = value.toISOString();
  }
  const counts = record._count as { files?: number; documents?: number } | undefined;
  if (counts?.files !== undefined) row.fileCount = counts.files;
  if (counts?.documents !== undefined) row.documentCount = counts.documents;
  const client = record.client as { company?: string } | undefined;
  const engagement = record.engagement as { title?: string } | undefined;
  if (client) row.clientLabel = client.company ?? "";
  if (engagement) row.engagementLabel = engagement.title ?? "";
  return row;
}
const initial = (): WorkspaceData => ({ available: false, message: "", rows: [], total: 0, page: 1, pages: 1, clients: [], engagements: [], optionsLimited: false, leads: [], payments: {}, profile: { name: BUSINESS_NAME, email: "", address: "Austin, Texas", paymentInstructions: "", weeklyHours: 20 }, summary: { activeClients: 0, activeEngagements: 0, openTasks: 0, outstandingCents: 0, monthlyCollectedCents: 0, monthlyExpenseCents: 0, monthlyFeeCents: 0, monthlyMinutes: 0 }, followUps: [], dueTasks: [], renewals: [] });

export async function getBusinessWorkspace(section: Section, query: string, requestedPage: number, status: string, recordId = "", filters: { clientId?: string; folder?: string } = {}): Promise<WorkspaceData> {
  await requireBusinessOwner();
  const data = initial();
  if (!businessDatabaseReady()) return { ...data, message: "Preview only. Connect PostgreSQL, apply the business workspace migration, and disable demo mode to keep real business records." };
  try {
    const today = todayInAustin(), month = today.slice(0, 7);
    const [clients, engagements, profile] = await Promise.all([
      prisma.businessClient.findMany({ orderBy: { updatedAt: "desc" }, take: 501, select: { id: true, company: true, contactName: true, email: true, billingAddress: true } }),
      prisma.businessEngagement.findMany({ orderBy: { updatedAt: "desc" }, take: 501, select: { id: true, title: true, clientId: true } }),
      prisma.siteSetting.findUnique({ where: { key: "business.private.profile.v1" } }),
    ]);
    data.clients = clients.slice(0, 500).map(c => ({ id: c.id, label: `${c.company} · ${c.contactName}`, email: c.email, address: c.billingAddress }));
    data.engagements = engagements.slice(0, 500).map(e => ({ id: e.id, label: e.title, clientId: e.clientId }));
    if (filters.clientId && !data.clients.some(c => c.id === filters.clientId)) {
      const client = await prisma.businessClient.findUnique({ where: { id: filters.clientId } });
      if (client) data.clients.push({ id: client.id, label: `${client.company} · ${client.contactName}`, email: client.email, address: client.billingAddress });
    }
    data.optionsLimited = clients.length > 500 || engagements.length > 500;
    const parsedProfile = profileSchema.safeParse(profile?.value);
    if (parsedProfile.success) data.profile = parsedProfile.data;
    if (section === "overview") {
      const [activeClients, activeEngagements, openTasks, invoiced, payments, refunds, monthlyPayments, monthlyRefunds, expenses, time, followUps, dueTasks, renewals] = await Promise.all([
        prisma.businessClient.count({ where: { status: "ACTIVE" } }),
        prisma.businessEngagement.count({ where: { status: { in: ["READY", "ACTIVE", "REVIEW"] } } }),
        prisma.businessTask.count({ where: { status: { not: "DONE" } } }),
        prisma.businessInvoice.aggregate({ where: { status: "ISSUED" }, _sum: { subtotalCents: true, taxCents: true } }),
        prisma.businessPayment.aggregate({ where: { kind: "PAYMENT", invoice: { status: "ISSUED" } }, _sum: { amountCents: true } }),
        prisma.businessPayment.aggregate({ where: { kind: "REFUND", invoice: { status: "ISSUED" } }, _sum: { amountCents: true } }),
        prisma.businessPayment.aggregate({ where: { kind: "PAYMENT", date: { startsWith: month } }, _sum: { amountCents: true, feeCents: true } }),
        prisma.businessPayment.aggregate({ where: { kind: "REFUND", date: { startsWith: month } }, _sum: { amountCents: true } }),
        prisma.businessExpense.aggregate({ where: { date: { startsWith: month } }, _sum: { amountCents: true } }),
        prisma.businessTimeEntry.aggregate({ where: { date: { startsWith: month } }, _sum: { minutes: true } }),
        prisma.businessClient.findMany({ where: { followUpDate: { not: "", lte: today }, status: { not: "ARCHIVED" } }, orderBy: { followUpDate: "asc" }, take: 6 }),
        prisma.businessTask.findMany({ where: { dueDate: { not: "", lte: today }, status: { not: "DONE" } }, orderBy: { dueDate: "asc" }, take: 6, include: { engagement: { select: { title: true } } } }),
        prisma.businessEngagement.findMany({ where: { kind: "RETAINER", status: { notIn: ["COMPLETE", "CANCELLED"] }, renewalDate: { not: "" } }, orderBy: { renewalDate: "asc" }, take: 5, include: { client: { select: { company: true } } } }),
      ]);
      data.summary = { activeClients, activeEngagements, openTasks, outstandingCents: (invoiced._sum.subtotalCents ?? 0) + (invoiced._sum.taxCents ?? 0) - (payments._sum.amountCents ?? 0) + (refunds._sum.amountCents ?? 0), monthlyCollectedCents: (monthlyPayments._sum.amountCents ?? 0) - (monthlyRefunds._sum.amountCents ?? 0), monthlyExpenseCents: expenses._sum.amountCents ?? 0, monthlyFeeCents: monthlyPayments._sum.feeCents ?? 0, monthlyMinutes: time._sum.minutes ?? 0 };
      data.followUps = followUps.map(flattenBusinessRow); data.dueTasks = dueTasks.map(flattenBusinessRow); data.renewals = renewals.map(flattenBusinessRow);
    } else {
      const entity = sectionEntity[section]!;
      const searchFields: Record<Entity, string[]> = { client: ["company", "contactName", "email", "nextAction"], engagement: ["title", "scope"], task: ["title", "owner", "notes"], invoice: ["number", "billedTo", "description"], expense: ["vendor", "description"], time: ["description"], document: ["title", "body"] };
      const where: Record<string, unknown> = {};
      if (section === "documents" && filters.clientId) where.clientId = filters.clientId;
      if (section === "documents" && filters.folder) where.folder = filters.folder;
      if (recordId) where.id = recordId.slice(0, 100);
      if (query.trim()) where.OR = searchFields[entity].map(field => ({ [field]: { contains: query.trim().slice(0, 150), mode: "insensitive" } }));
      if (section === "retainers") where.kind = "RETAINER";
      if (section === "setup") where.seedKey = { startsWith: "business-setup-v1:" };
      if (status && ["client", "engagement", "task", "invoice", "document"].includes(entity)) where.status = status;
      const include = entity === "engagement" ? { client: { select: { company: true } } } : ["invoice", "document"].includes(entity) ? { client: { select: { company: true } }, engagement: { select: { title: true } }, ...(entity === "invoice" ? { payments: { orderBy: { createdAt: "asc" } } } : { _count: { select: { files: true } } }) } : ["task", "time"].includes(entity) ? { engagement: { select: { title: true } } } : entity === "client" ? { _count: { select: { documents: true } } } : undefined;
      type Reader = { count(args: { where: Record<string, unknown> }): Promise<number>; findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]> };
      const model = prisma[entityModels[entity]] as unknown as Reader;
      data.total = await model.count({ where }); data.pages = Math.max(1, Math.ceil(data.total / 25)); data.page = Math.min(Math.max(1, requestedPage || 1), data.pages);
      const rows = await model.findMany({ where, include, orderBy: { updatedAt: "desc" }, skip: (data.page - 1) * 25, take: 25 });
      data.rows = rows.map(flattenBusinessRow);
      if (entity === "invoice") rows.forEach((record, i) => {
        const payments = record.payments as PaymentRow[];
        data.payments[String(record.id)] = payments.map(p => ({ id: p.id, kind: p.kind, amountCents: p.amountCents, feeCents: p.feeCents, date: p.date, method: p.method, reference: p.reference, notes: p.notes }));
        const state = invoiceState(record as unknown as Parameters<typeof invoiceState>[0], today);
        Object.assign(data.rows[i], { balanceCents: state.balance, netPaidCents: state.paid, totalCents: state.total, displayStatus: state.state });
      });
      if (entity === "engagement") {
        const time = await prisma.businessTimeEntry.groupBy({ by: ["engagementId"], where: { engagementId: { in: data.rows.map(r => String(r.id)) }, date: { startsWith: month } }, _sum: { minutes: true } });
        data.rows.forEach(row => { row.usedMinutes = time.find(t => t.engagementId === row.id)?._sum.minutes ?? 0; });
      }
      if (section === "clients") data.leads = await prisma.lead.findMany({ where: { businessClient: null }, select: { id: true, company: true, name: true }, orderBy: { createdAt: "desc" }, take: 50 });
    }
    return { ...data, available: true };
  } catch { return { ...initial(), message: "Business records are unavailable. Check PostgreSQL connectivity and apply the business workspace migration. No changes have been made." }; }
}
