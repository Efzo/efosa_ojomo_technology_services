import { z } from "zod";

export const BUSINESS_NAME = "Efosa Ojomo Technology Services";
export const sections = [
  { id: "overview", label: "Today", description: "Your next actions, delivery commitments, and cash position." },
  { id: "clients", label: "Clients & prospects", description: "Keep contacts, discovery notes, and the next follow-up in one place." },
  { id: "engagements", label: "Engagements", description: "Agree the scope, confirm readiness, and manage project delivery." },
  { id: "retainers", label: "Monthly care", description: "Track covered systems, service expectations, capacity, and renewals." },
  { id: "tasks", label: "Tasks", description: "Move work from a clear next action through client review to completion." },
  { id: "invoices", label: "Invoices & payments", description: "Prepare invoice records and reconcile payments received externally." },
  { id: "expenses", label: "Expenses", description: "Record business spending and retain a link to the receipt." },
  { id: "time", label: "Time log", description: "Record delivery time and monitor monthly care allocations." },
  { id: "documents", label: "Documents", description: "Prepare proposals, scope worksheets, changes, and handover notes." },
  { id: "setup", label: "Business setup", description: "Work through the handbook checklist and keep your billing identity current." },
] as const;
export type Section = typeof sections[number]["id"];
export type Entity = "client" | "engagement" | "task" | "invoice" | "expense" | "time" | "document";
export const documentFolders = ["GENERAL", "PROPOSALS", "AGREEMENTS", "FINANCE", "DELIVERY", "CORRESPONDENCE"] as const;
export const documentKinds = ["PROPOSAL", "AGREEMENT", "SOW", "INVOICE", "RECEIPT", "CHANGE", "UPDATE", "HANDOVER", "CORRESPONDENCE", "NOTE", "OTHER"] as const;
export type BusinessRow = Record<string, string | number>;
export type Choice = { id: string; label: string; clientId?: string; email?: string; address?: string };
export type Field = { name: string; label: string; type?: "text" | "email" | "date" | "url" | "number" | "textarea" | "select" | "money"; required?: boolean; choices?: readonly string[]; source?: "clients" | "engagements"; help?: string; group?: string };
const text = (max = 500) => z.string().trim().max(max);
const required = (max = 200) => text(max).min(1, "This field is required.");
export const calendarDate = z.string().refine(v => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(new Date(`${v}T12:00:00Z`).getTime()) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v, "Enter a valid calendar date.");
const date = calendarDate.or(z.literal(""));
const url = text(2000).refine(v => !v || (() => { try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } })(), "Use an HTTPS link without embedded credentials.");
export function parseMoney(value: string) {
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value)) throw new Error("Enter an amount with no more than two decimal places.");
  const [dollars, cents = ""] = value.split(".");
  return Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
}
const money = z.string().trim().regex(/^\d{1,7}(?:\.\d{1,2})?$/, "Enter USD, for example 1250.00.").transform(parseMoney);
const positiveMoney = money.refine(v => v > 0, "Amount must be greater than zero.");
const minutes = z.coerce.number().int().min(1).max(1440);
const base = { id: text(100).optional(), version: z.number().int().min(0).optional() };
export const serviceRecipes: Record<string, { label: string; tasks: string[] }> = {
  website: { label: "Business website", tasks: ["Confirm pages, content, access, and success checks", "Approve sitemap and design direction", "Build private preview and gather agreed feedback", "Test mobile, forms, navigation, and editing", "Obtain written launch approval", "Launch, train, and complete handover"] },
  support: { label: "Customer support systems", tasks: ["Map channels, ticket ownership, and escalation", "Configure inbox, routing, and approved knowledge articles", "Test assignment, escalation, and human handoff", "Train the team and hand over operating instructions"] },
  automation: { label: "Workflow automation", tasks: ["Map trigger, data, permitted actions, and fallback", "Build and test with sample data", "Test duplicates, missing fields, retries, and outages", "Obtain approval before production actions", "Enable gradually and hand over troubleshooting guide"] },
  discovery: { label: "Product discovery", tasks: ["Confirm problem, users, evidence, and constraints", "Run agreed discovery workshops", "Prioritize MVP and review feasibility", "Present findings, risks, and editable roadmap"] },
  engineering: { label: "Custom software engineering", tasks: ["Agree requirements, architecture, and milestone tests", "Build and demonstrate reviewable increments", "Test access controls and integrations in staging", "Obtain release approval and verify rollback plan", "Deploy and hand over documentation"] },
  product: { label: "Fractional product management", tasks: ["Confirm authority, stakeholders, and monthly allocation", "Review roadmap and prioritize backlog", "Write acceptance criteria and coordinate delivery", "Review risks, decisions, and monthly outcomes"] },
  care: { label: "Website / system care", tasks: ["Inventory systems, access, health, and backups", "Agree monthly priorities and covered tasks", "Complete checks and record work / time", "Report incidents, capacity, renewals, and next actions"] },
  advisory: { label: "Architecture & advisory", tasks: ["Define the decision, constraints, and evidence", "Review options and trade-offs", "Present recommendation, assumptions, and next steps"] },
};
export const setupChecklist = [
  "Confirm legal structure, business name, address, and applicable DBA requirements",
  "Complete applicable formation, registered-agent, EIN, and local setup requirements",
  "Open a dedicated business bank account",
  "Have a Texas accountant classify each offer for sales tax and confirm permit / filings",
  "Set up bookkeeping, owner-payment guidance, tax reserves, and filing calendar",
  "Review service agreement, SOW, cancellation terms, and insurance with qualified advisers",
  "Verify payment provider, bank payouts, invoice details, and receipt process",
  "Enable MFA, password manager, backups, and recovery ownership",
  "Test website inquiry storage, notifications, and calendar booking end to end",
  "Choose one audience and entry offer; prepare two honest demonstrations",
  "List first prospects and schedule weekly outreach / finance routines",
];
export const schemas = {
  client: z.object({ ...base, company: required(), contactName: required(), email: z.email(), phone: text(80), billingAddress: text(1000), status: z.enum(["PROSPECT", "ACTIVE", "PAST", "ARCHIVED"]), source: text(), nextAction: text(), followUpDate: date, notes: text(15000) }),
  engagement: z.object({ ...base, clientId: required(100), title: required(), service: z.enum(Object.keys(serviceRecipes) as [string, ...string[]]), kind: z.enum(["PROJECT", "RETAINER"]), status: z.enum(["PROPOSAL", "READY", "ACTIVE", "REVIEW", "COMPLETE", "ON_HOLD", "CANCELLED"]), feeCents: money, scope: required(15000), exclusions: text(10000), acceptance: text(10000), clientInputs: text(10000), agreementUrl: url, signedDate: date, initialPaymentReference: text(500), startDate: date, dueDate: date, acceptedDate: date, renewalDate: date, monthlyMinutes: z.coerce.number().int().min(0).max(44640), coverage: text(5000), serviceHours: text(500), responseTarget: text(500), rolloverTerms: text(2000), cancellationTerms: text(2000), notes: text(10000) }),
  task: z.object({ ...base, engagementId: text(100), title: required(300), status: z.enum(["TODO", "DOING", "WAITING", "REVIEW", "DONE"]), category: z.enum(["DELIVERY", "SALES", "ADMIN", "RETENTION"]), priority: z.enum(["NORMAL", "HIGH"]), dueDate: date, owner: required(), notes: text(10000) }),
  invoice: z.object({ ...base, clientId: required(100), engagementId: text(100), number: required(80), status: z.enum(["DRAFT", "ISSUED", "VOID"]), description: required(5000), subtotalCents: positiveMoney, taxCents: money, billedTo: required(), billingEmail: z.email(), billingAddress: text(1000), issueDate: calendarDate, dueDate: calendarDate, paymentUrl: url, notes: text(5000) }),
  expense: z.object({ ...base, vendor: required(), description: required(1000), category: z.enum(["SOFTWARE", "HOSTING", "CONTRACTORS", "PROFESSIONAL_FEES", "MARKETING", "EQUIPMENT", "OTHER"]), amountCents: positiveMoney, date: calendarDate, receiptUrl: url, notes: text(5000) }),
  time: z.object({ ...base, engagementId: required(100), date: calendarDate, minutes, description: required(1000) }),
  document: z.object({ ...base, clientId: required(100), engagementId: text(100), title: required(), kind: z.enum(documentKinds), status: z.enum(["DRAFT", "SHARED", "APPROVED", "SIGNED"]), body: text(50000).default(""), externalUrl: url, folder: z.enum(documentFolders).default("GENERAL"), sentDate: date.default(""), signedDate: date.default("") }),
};
export const paymentSchema = z.object({ invoiceId: required(100), kind: z.enum(["PAYMENT", "REFUND"]), amountCents: positiveMoney, feeCents: money, date: calendarDate, method: required(100), reference: required(200), notes: text(2000) });
export const profileSchema = z.object({ name: required(), email: z.email().or(z.literal("")), address: text(1000), paymentInstructions: text(2000), weeklyHours: z.coerce.number().int().min(1).max(100) });
export function todayInAustin(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function moneyLabel(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
export function label(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()); }
export function netPayments(payments: { amountCents: number; kind: string }[]) { return payments.reduce((sum, p) => sum + (p.kind === "REFUND" ? -p.amountCents : p.amountCents), 0); }
export function invoiceState(invoice: { status: string; subtotalCents: number; taxCents: number; dueDate: string; payments: { amountCents: number; kind: string }[] }, today: string) {
  const paid = netPayments(invoice.payments), total = invoice.subtotalCents + invoice.taxCents;
  const balance = invoice.status === "VOID" ? 0 : total - paid;
  return { paid, total, balance, state: invoice.status !== "ISSUED" ? invoice.status : balance === 0 ? "PAID" : invoice.dueDate < today ? "OVERDUE" : paid > 0 ? "PARTIAL" : "ISSUED" };
}
export function engagementProblem(data: { kind: string; status: string; signedDate: string; agreementUrl: string; initialPaymentReference: string; acceptance: string; acceptedDate: string; monthlyMinutes: number; coverage: string; serviceHours: string; responseTarget: string; rolloverTerms: string; cancellationTerms: string; startDate: string; dueDate: string }) {
  if (data.startDate && data.dueDate && data.dueDate < data.startDate) return "Delivery date cannot be before the start date.";
  if (["READY", "ACTIVE", "REVIEW", "COMPLETE"].includes(data.status)) {
    if (!data.signedDate || !data.agreementUrl || !data.initialPaymentReference || !data.acceptance) return "Before delivery, record the signed agreement link/date, acceptance checks, and initial payment reference (or agreed payment exception).";
    if (data.kind === "RETAINER" && (!data.monthlyMinutes || !data.coverage || !data.serviceHours || !data.responseTarget || !data.rolloverTerms || !data.cancellationTerms)) return "Monthly care needs a capacity, covered systems/tasks, service hours, response target, unused-time terms, and cancellation terms.";
  }
  if (data.status === "COMPLETE" && !data.acceptedDate) return "Record the client's acceptance date before completing the engagement.";
  return null;
}
