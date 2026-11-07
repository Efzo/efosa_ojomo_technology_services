"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireBusinessOwner, businessDatabaseReady } from "@/lib/business/access";
import { schemas, paymentSchema, profileSchema, engagementProblem, netPayments, serviceRecipes, setupChecklist, todayInAustin, type Entity } from "@/lib/business/config";
import { z } from "zod";
import { fields } from "@/lib/business/fields";

type Tx = Prisma.TransactionClient;
const entities = z.enum(["client", "engagement", "task", "invoice", "expense", "time", "document"]);
const names = { client: "businessClient", engagement: "businessEngagement", task: "businessTask", invoice: "businessInvoice", expense: "businessExpense", time: "businessTimeEntry", document: "businessDocument" } as const;
// Data reaches this adapter only after its entity-specific Zod schema has parsed it.
type Store = { create(args: { data: Record<string, unknown> }): Promise<{ id: string }>; updateMany(args: { where: { id: string; version: number }; data: Record<string, unknown> }): Promise<{ count: number }> };
const store = (tx: Tx, entity: Entity) => tx[names[entity]] as unknown as Store;
class BusinessError extends Error {}
function fail(message: string): never { throw new BusinessError(message); }
function resultError(error: unknown) {
  if (error instanceof BusinessError) return error.message;
  if ((error as { code?: string })?.code === "P2002") return "That invoice number, payment reference, or imported lead already exists. Refresh before trying again.";
  if ((error as { code?: string })?.code === "P2034") return "Another change happened at the same time. Refresh and try again.";
  return "The record could not be saved. Check the database connection and business workspace migration, then try again.";
}
async function audit(tx: Tx, actorId: string, action: string, target: string) { await tx.auditEvent.create({ data: { actorId, action: `business.${action}`, target } }); }
async function linkedEngagement(tx: Tx, engagementId: string, clientId?: string) {
  const engagement = await tx.businessEngagement.findUnique({ where: { id: engagementId } });
  if (!engagement || (clientId && engagement.clientId !== clientId)) fail("Choose an engagement belonging to the selected client.");
  return engagement;
}

export async function saveBusinessRecord(entityInput: unknown, input: unknown) {
  try {
    const actorId = await requireBusinessOwner();
    if (!businessDatabaseReady() || !actorId) return { success: false, message: "Connect PostgreSQL, apply the business workspace migration, and disable demo mode before saving." };
    const entityParsed = entities.safeParse(entityInput);
    if (!entityParsed.success) return { success: false, message: "Unknown record type." };
    const entity = entityParsed.data;
    const parsed = schemas[entity].safeParse(input);
    if (!parsed.success) return { success: false, message: parsed.error.issues.map(i => `${fields[entity].find(f => f.name === i.path[0])?.label ?? "Record"}: ${i.message}`).join(" ") };
    const { id, version, ...data } = parsed.data;
    if (id && version === undefined) return { success: false, message: "Refresh this record before editing it." };
    const savedId = await prisma.$transaction(async tx => {
      if ("clientId" in data) {
        const client = await tx.businessClient.findUnique({ where: { id: data.clientId } });
        if (!client) fail("The selected client no longer exists.");
      }
      if ("engagementId" in data && data.engagementId) await linkedEngagement(tx, data.engagementId, "clientId" in data ? data.clientId : undefined);
      if (entity === "engagement") {
        const item = schemas.engagement.parse(input);
        const problem = engagementProblem(item);
        if (problem) fail(problem);
        if (id) {
          const old = await tx.businessEngagement.findUnique({ where: { id } });
          if (old && old.clientId !== item.clientId) fail("An engagement's client cannot be changed. Create a separate engagement for another client.");
        }
      }
      if (entity === "invoice") {
        const item = schemas.invoice.parse(input);
        if (item.dueDate < item.issueDate) fail("The invoice due date cannot be before its issue date.");
        if (id) {
          const old = await tx.businessInvoice.findUnique({ where: { id }, include: { payments: true } });
          if (!old) fail("Invoice not found.");
          if (old.status !== "DRAFT") {
            const immutable = ["clientId", "engagementId", "number", "description", "subtotalCents", "taxCents", "billedTo", "billingEmail", "billingAddress", "issueDate", "dueDate"] as const;
            if (immutable.some(key => (old[key] ?? "") !== (item[key] ?? ""))) fail("Issued invoices retain their original billing details and amounts. Void an unpaid invoice and create a corrected draft instead.");
            if (old.status === "VOID" || item.status === "DRAFT") fail("An issued or void invoice cannot return to draft.");
            if (item.status === "VOID" && old.payments.length) fail("An invoice with payment history cannot be voided. Record any actual refund and retain its history.");
          }
        } else if (item.status !== "DRAFT") fail("Create the invoice as a draft first, then review and mark it issued.");
      }
      if (entity === "time" || entity === "expense") {
        const item = entity === "time" ? schemas.time.parse(input) : schemas.expense.parse(input);
        if (item.date > todayInAustin()) fail("Record completed work and paid expenses using today or an earlier date.");
      }
      if (entity === "document") {
        const item = schemas.document.parse(input);
        if (id) {
          const old = await tx.businessDocument.findUnique({ where: { id } });
          if (!old || old.clientId !== item.clientId) fail("A document stays with its original client. Create a separate record for another client.");
        }
        if (item.status === "SIGNED" && !item.externalUrl && !(id && await tx.businessDocumentFile.count({ where: { documentId: id, status: "SIGNED" } }))) fail("Add the external signed document link, or upload a signed file version before marking this record signed.");
        if (item.sentDate > todayInAustin() || item.signedDate > todayInAustin()) fail("Use the actual sent / signed date, not a future date.");
      }
      const payload: Record<string, unknown> = { ...data };
      if ("engagementId" in payload && !payload.engagementId) payload.engagementId = null;
      if (id) {
        const changed = await store(tx, entity).updateMany({ where: { id, version: version! }, data: { ...payload, version: { increment: 1 } } });
        if (changed.count !== 1) fail("This record changed or is no longer available. Refresh before saving your changes.");
        await audit(tx, actorId, `${entity}.updated`, id);
        return id;
      }
      const created = await store(tx, entity).create({ data: payload });
      await audit(tx, actorId, `${entity}.created`, created.id);
      if (entity === "engagement") {
        const item = schemas.engagement.parse(input);
        await tx.businessTask.createMany({ data: serviceRecipes[item.service].tasks.map((title, i) => ({ title, engagementId: created.id, seedKey: `engagement:${created.id}:${i}`, category: "DELIVERY" })) });
      }
      return created.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    revalidatePath("/admin/business", "layout");
    return { success: true, id: savedId, message: `${entity === "time" ? "Time entry" : "Record"} saved.` };
  } catch (error) { return { success: false, message: error instanceof Error && /owner|Sign in/.test(error.message) ? error.message : resultError(error) }; }
}

export async function recordBusinessPayment(input: unknown) {
  try {
    const actorId = await requireBusinessOwner();
    if (!actorId || !businessDatabaseReady()) return { success: false, message: "A live database is required to record payments." };
    const parsed = paymentSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: parsed.error.issues.map(i => `${({ amountCents: "Amount", feeCents: "Processing fee", invoiceId: "Invoice", date: "Date", reference: "Reference" } as Record<string, string>)[String(i.path[0])] ?? "Transaction"}: ${i.message}`).join(" ") };
    const data = parsed.data;
    if (data.date > todayInAustin()) return { success: false, message: "Record payments only after they occur; use today's date or an earlier date." };
    if (data.feeCents > data.amountCents || (data.kind === "REFUND" && data.feeCents)) return { success: false, message: "A payment fee cannot exceed the payment. Record additional refund charges as expenses." };
    await prisma.$transaction(async tx => {
      const invoice = await tx.businessInvoice.findUnique({ where: { id: data.invoiceId }, include: { payments: true } });
      if (!invoice || invoice.status !== "ISSUED") fail("Payments and refunds can only be recorded against issued invoices.");
      const paid = netPayments(invoice.payments);
      if (data.kind === "REFUND" ? data.amountCents > paid : data.amountCents > invoice.subtotalCents + invoice.taxCents - paid) fail(data.kind === "REFUND" ? "The refund exceeds the recorded net payment." : "The payment exceeds the invoice's outstanding balance.");
      const payment = await tx.businessPayment.create({ data });
      await audit(tx, actorId, `invoice.${data.kind.toLowerCase()}_recorded`, payment.id);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    revalidatePath("/admin/business", "layout");
    return { success: true, message: "External transaction recorded. No money was moved by this portal." };
  } catch (error) { return { success: false, message: resultError(error) }; }
}

export async function importBusinessLead(leadId: string) {
  try {
    const actorId = await requireBusinessOwner();
    if (!actorId || !businessDatabaseReady()) return { success: false, message: "Connect the database to import website inquiries." };
    if (!z.string().min(1).max(100).safeParse(leadId).success) return { success: false, message: "Choose a valid inquiry." };
    await prisma.$transaction(async tx => {
      const existing = await tx.businessClient.findUnique({ where: { leadId } });
      if (existing) fail("This inquiry already has a client record.");
      const lead = await tx.lead.findUnique({ where: { id: leadId } });
      if (!lead) fail("Inquiry not found.");
      const client = await tx.businessClient.create({ data: { leadId, company: lead.company, contactName: lead.name, email: lead.email, source: lead.leadSource ?? "Website", nextAction: "Qualify the inquiry and arrange an introductory call", notes: `Requested service: ${lead.serviceRequested}\nBudget: ${lead.budget ?? "Not provided"}\nTimeline: ${lead.timeline}\n\n${lead.challenge}\n\n${lead.notes ?? ""}` } });
      await audit(tx, actorId, "client.imported", client.id);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    revalidatePath("/admin/business", "layout");
    return { success: true, message: "Inquiry imported as a prospect. Original inquiry and status preserved." };
  } catch (error) { return { success: false, message: resultError(error) }; }
}

export async function initializeBusinessChecklist() {
  try {
    const actorId = await requireBusinessOwner();
    if (!actorId || !businessDatabaseReady()) return { success: false, message: "Connect the database before creating your setup checklist." };
    await prisma.$transaction(async tx => {
      await tx.businessTask.createMany({ data: setupChecklist.map((title, i) => ({ title, category: "ADMIN", seedKey: `business-setup-v1:${i}` })), skipDuplicates: true });
      await audit(tx, actorId, "setup.initialized", "business-setup-v1");
    });
    revalidatePath("/admin/business", "layout");
    return { success: true, message: "Setup checklist added. Existing progress was preserved." };
  } catch (error) { return { success: false, message: resultError(error) }; }
}

export async function saveBusinessProfile(input: unknown) {
  try {
    const actorId = await requireBusinessOwner();
    if (!actorId || !businessDatabaseReady()) return { success: false, message: "Connect the database before saving the business profile." };
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: "Check the business name, email, and weekly capacity (1-100 hours)." };
    await prisma.$transaction(async tx => {
      await tx.siteSetting.upsert({ where: { key: "business.private.profile.v1" }, create: { key: "business.private.profile.v1", value: parsed.data }, update: { value: parsed.data } });
      await audit(tx, actorId, "profile.updated", "business.private.profile.v1");
    });
    revalidatePath("/admin/business", "layout");
    return { success: true, message: "Private business profile saved." };
  } catch (error) { return { success: false, message: resultError(error) }; }
}
