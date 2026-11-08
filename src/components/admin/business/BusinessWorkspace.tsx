"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUpRight, BriefcaseBusiness, Check, CheckCircle2, Clock3, Download, FileText, Plus, Search, ShieldCheck, X } from "lucide-react";
import { sections, BUSINESS_NAME, documentFolders, label, moneyLabel, serviceRecipes, todayInAustin, type Section, type Entity, type BusinessRow, type Field } from "@/lib/business/config";
import { fields, documentTemplates } from "@/lib/business/fields";
import type { WorkspaceData } from "@/lib/business/data";
import { saveBusinessRecord, recordBusinessPayment, importBusinessLead, initializeBusinessChecklist, saveBusinessProfile } from "@/app/actions/business";
import DocumentFiles from "./DocumentFiles";
import "./business.css";

const entityFor: Partial<Record<Section, Entity>> = { clients: "client", engagements: "engagement", retainers: "engagement", tasks: "task", invoices: "invoice", expenses: "expense", time: "time", documents: "document", setup: "task" };
const nouns: Record<Entity, string> = { client: "contact", engagement: "engagement", task: "task", invoice: "invoice", expense: "expense", time: "time entry", document: "document" };
const inputClass = "business-input";
function Badge({ value }: { value: string }) { return <span className={`business-badge ${["DONE", "COMPLETE", "PAID", "ACTIVE", "SIGNED", "APPROVED"].includes(value) ? "business-badge-good" : ["OVERDUE", "HIGH", "ON_HOLD", "WAITING"].includes(value) ? "business-badge-warn" : ""}`}>{label(value)}</span>; }
function dateText(value: string | number | undefined) { return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : "Not scheduled"; }
function blank(entity: Entity, section: Section): Record<string, string> {
  const data = Object.fromEntries(fields[entity].map(f => [f.name, f.choices?.[0] ?? ""]));
  if (entity === "task") Object.assign(data, { owner: "Efosa Ojomo", category: section === "setup" ? "ADMIN" : "DELIVERY" });
  if (entity === "engagement") Object.assign(data, { kind: section === "retainers" ? "RETAINER" : "PROJECT", monthlyMinutes: "0", feeCents: "0.00" });
  if (entity === "invoice") Object.assign(data, { number: `INV-${todayInAustin().replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`, subtotalCents: "0.00", taxCents: "0.00", issueDate: todayInAustin(), dueDate: todayInAustin() });
  if (entity === "expense" || entity === "time") Object.assign(data, { date: todayInAustin(), amountCents: "0.00", minutes: "60" });
  if (entity === "document") data.body = documentTemplates.PROPOSAL;
  return data;
}
function editValues(entity: Entity, row: BusinessRow) { return Object.fromEntries(fields[entity].map(f => [f.name, f.type === "money" ? (Number(row[f.name] ?? 0) / 100).toFixed(2) : String(row[f.name] ?? "")])); }
function rowTitle(entity: Entity, row: BusinessRow) { return String(row[entity === "client" ? "company" : entity === "invoice" ? "number" : entity === "expense" ? "vendor" : entity === "time" ? "description" : "title"] ?? ""); }
function rowDetail(entity: Entity, row: BusinessRow) {
  if (entity === "client") return `${row.contactName} · ${row.email}`;
  if (entity === "engagement") return `${row.clientLabel} · ${serviceRecipes[String(row.service)]?.label ?? row.service}`;
  if (entity === "invoice") return `${row.billedTo} · ${row.description}`;
  if (entity === "expense") return String(row.description);
  if (entity === "document") return `${row.clientLabel} · ${label(String(row.kind))}`;
  return String(row.engagementLabel || row.owner || "Business operations");
}

export default function BusinessWorkspace({ section, data, query, status, clientId = "", folder = "" }: { section: Section; data: WorkspaceData; query: string; status: string; clientId?: string; folder?: string }) {
  const router = useRouter(), searchParams = useSearchParams();
  const entity = entityFor[section], sectionInfo = sections.find(s => s.id === section)!;
  const initialRecord = data.rows.find(r => r.id === searchParams.get("record"));
  const startNew = entity === "document" && searchParams.get("new") === "1" && data.available;
  const [uploadBusy, setUploadBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ success: boolean; message: string } | null>(null);
  const [selected, setSelected] = useState<BusinessRow | "new" | null>(() => data.rows.find(r => r.id === searchParams.get("record")) ?? (startNew ? "new" : null));
  const [mode, setMode] = useState<"edit" | "print" | "payment">("edit");
  const [draft, setDraft] = useState<Record<string, string>>(() => initialRecord && entity ? editValues(entity, initialRecord) : startNew ? { ...blank("document", section), clientId, folder: folder || "GENERAL", body: "" } : {});
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (selected && !dialog.current?.open) dialog.current?.showModal(); else if (!selected) dialog.current?.close(); }, [selected]);
  useEffect(() => {
    if (!selected || mode !== "print") return;
    const preview = dialog.current;
    let restorePreview = false;
    // A modal stays in the browser's top layer even when its ancestors are hidden.
    // Print only the document portal, then restore the preview after save/cancel.
    const beforePrint = () => {
      if (preview?.open) { restorePreview = true; preview.close(); }
    };
    const afterPrint = () => {
      if (restorePreview && preview?.isConnected && !preview.open) preview.showModal();
      restorePreview = false;
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [selected, mode]);
  const [profile, setProfile] = useState(data.profile);
  function open(row: BusinessRow | "new", nextMode: typeof mode = "edit") {
    setNotice(null); setMode(nextMode);
    if (entity) setDraft(row === "new" ? { ...blank(entity, section), ...(entity === "document" ? { clientId, folder: folder || "GENERAL", body: "" } : {}) } : nextMode === "payment" ? { invoiceId: String(row.id), kind: "PAYMENT", amountCents: (Number(row.balanceCents) / 100).toFixed(2), feeCents: "0.00", date: todayInAustin(), method: "Bank transfer", reference: "", notes: "" } : editValues(entity, row));
    setSelected(row);
  }
  async function perform(action: () => Promise<{ success: boolean; message: string }>, close = false) {
    setNotice(null);
    startTransition(async () => {
      try { const result = await action(); setNotice(result); if (result.success) { if (close) setSelected(null); router.refresh(); } }
      catch { setNotice({ success: false, message: "The request could not be completed. Refresh your session and try again." }); }
    });
  }
  function updateField(name: string, value: string) {
    setDraft(old => {
      const next = { ...old, [name]: value };
      if (name === "clientId") {
        next.engagementId = "";
        const client = data.clients.find(c => c.id === value);
        if (entity === "invoice" && client) Object.assign(next, { billedTo: client.label.split(" · ")[0], billingEmail: client.email ?? "", billingAddress: client.address ?? "" });
      }
      return next;
    });
  }
  function renderField(field: Field) {
    const value = draft[field.name] ?? "";
    let choices = field.source ? data[field.source].filter(c => field.source !== "engagements" || !draft.clientId || c.clientId === draft.clientId).map(c => ({ value: c.id, name: c.label })) : field.choices?.map(c => ({ value: c, name: field.name === "service" ? serviceRecipes[c].label : label(c) }));
    if (field.source && value && !choices?.some(c => c.value === value)) choices = [{ value, name: "Current linked record" }, ...(choices ?? [])];
    const lockedInvoice = entity === "invoice" && selected !== "new" && selected && selected.status !== "DRAFT" && !["status", "paymentUrl", "notes"].includes(field.name);
    const lockedClient = ["engagement", "document"].includes(entity!) && selected !== "new" && selected && field.name === "clientId";
    return <label key={field.name} className={field.type === "textarea" ? "business-field business-field-wide" : "business-field"}><span>{field.label}{field.required ? " *" : ""}</span>{field.type === "select" ? <select className={inputClass} value={value} required={field.required} disabled={Boolean(lockedInvoice || lockedClient)} onChange={e => updateField(field.name, e.target.value)}>{field.source && <option value="">Choose {field.source === "clients" ? "a client" : "an engagement"}</option>}{choices?.map(c => <option value={c.value} key={c.value}>{c.name}</option>)}</select> : field.type === "textarea" ? <textarea className={inputClass} value={value} rows={field.name === "body" ? 18 : 4} required={field.required} disabled={Boolean(lockedInvoice)} onChange={e => updateField(field.name, e.target.value)} /> : <input className={inputClass} type={field.type === "money" ? "text" : field.type ?? "text"} inputMode={field.type === "money" ? "decimal" : undefined} value={value} min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? 1 : undefined} required={field.required} disabled={Boolean(lockedInvoice || lockedClient)} onChange={e => updateField(field.name, e.target.value)} />}{field.help && <small>{field.help}</small>}</label>;
  }
  const selectedRow = selected && selected !== "new" ? selected : null;
  const paymentFields: Field[] = [{ name: "kind", label: "Transaction", type: "select", choices: ["PAYMENT", "REFUND"] }, { name: "amountCents", label: "Gross amount (USD)", type: "money", required: true }, { name: "feeCents", label: "Processing fee (USD)", type: "money", required: true }, { name: "date", label: "Transaction date", type: "date", required: true }, { name: "method", label: "Payment method", required: true }, { name: "reference", label: "Unique bank / provider transaction reference", required: true }, { name: "notes", label: "Reconciliation notes", type: "textarea" }];
  const statuses = entity ? fields[entity].find(f => f.name === "status")?.choices : undefined;
  function urlFor(page: number) { const params = new URLSearchParams(); if (query) params.set("q", query); if (status) params.set("status", status); if (clientId) params.set("client", clientId); if (folder) params.set("folder", folder); params.set("page", String(page)); return `/admin/business/${section}?${params}`; }
  return <div className="business-app">
    <header className="business-heading"><div><p className="business-eyebrow"><ShieldCheck size={14} aria-hidden="true" /> Private owner workspace</p><h1>Business operations</h1><p className="business-brand">{data.profile.name || BUSINESS_NAME}</p></div><Link href="/admin/leads" className="business-button-secondary">Website inquiries <ArrowUpRight size={15} /></Link></header>
    <nav aria-label="Business operations" className="business-tabs">{sections.map(s => <Link href={s.id === "overview" ? "/admin/business" : `/admin/business/${s.id}`} key={s.id} aria-current={section === s.id ? "page" : undefined}>{s.label}</Link>)}</nav>
    {!data.available && <div className="business-notice" role="status"><strong>{data.issue?.title ?? "Workspace setup required"}</strong><p>{data.message}</p><Link href={data.issue?.href ?? "/admin/settings#connections"}>{data.issue?.linkLabel ?? "Review connections"}</Link></div>}
    {notice && !selected && <div className={`business-notice ${notice.success ? "business-notice-good" : ""}`} role={notice.success ? "status" : "alert"}>{notice.message}</div>}
    {section === "overview" ? <>
      <div className="business-intro"><div><h2>A clear next step for every client.</h2><p>Follow up, deliver the agreed work, and keep the money organized.</p></div><span>{dateText(todayInAustin())} · Central time</span></div>
      <div className="business-stats">{[
        ["Outstanding invoices", moneyLabel(data.summary.outstandingCents), "invoices", "Issued balances, including tax"],
        ["Collected this month", moneyLabel(data.summary.monthlyCollectedCents), "invoices", "Payments less refunds, before fees/tax"],
        ["Expenses this month", moneyLabel(data.summary.monthlyExpenseCents), "expenses", `${moneyLabel(data.summary.monthlyFeeCents)} processing fees tracked separately`],
        ["Active engagements", String(data.summary.activeEngagements), "engagements", `${data.summary.openTasks} open tasks · ${data.summary.activeClients} active clients`],
      ].map(([name, value, route, note]) => <Link className="business-stat" href={`/admin/business/${route}`} key={name}><span>{name}</span><strong>{data.available ? value : "—"}</strong><small>{note}</small></Link>)}</div>
      <div className="business-dashboard-grid"><ActionList title="Follow-ups due" description="Give each conversation a next step." rows={data.followUps} empty="No follow-ups due. Add a prospect and set the next action/date." href="clients" nameKey="company" dateKey="followUpDate" detailKey="nextAction" /><ActionList title="Delivery & admin due" description="Tasks due today or earlier." rows={data.dueTasks} empty="No tasks due. Open an engagement to plan its next milestone." href="tasks" nameKey="title" dateKey="dueDate" detailKey="engagementLabel" /></div>
      <div className="business-dashboard-grid"><section className="business-panel"><div className="business-panel-heading"><div><h3>Run the client journey</h3><p>One controlled step at a time.</p></div><BriefcaseBusiness size={21} /></div><ol className="business-journey">{[["01", "Understand the need", "Add the contact, run discovery, and agree the next action.", "clients"], ["02", "Agree scope and payment", "Record the agreement, acceptance checks, and first payment.", "engagements"], ["03", "Deliver and review", "Use the service checklist, track time, and document decisions.", "tasks"], ["04", "Close and follow up", "Confirm acceptance, hand over, and offer suitable care.", "documents"]].map(([num, title, desc, route]) => <li key={num}><span>{num}</span><div><Link href={`/admin/business/${route}`}>{title} <ArrowRight size={14} /></Link><p>{desc}</p></div></li>)}</ol></section><ActionList title="Monthly care reviews" description="Upcoming and overdue renewal / review dates." rows={data.renewals} empty="No care reviews scheduled. Define coverage and capacity when you add a monthly plan." href="retainers" nameKey="title" dateKey="renewalDate" detailKey="clientLabel" /></div>
      <section className="business-routine"><Clock3 size={22} /><div><h3>Keep your Friday owner appointment</h3><p>Reconcile payments, review hours, chase missing inputs, and plan next week. {Math.round(data.summary.monthlyMinutes / 60 * 10) / 10} hours logged this month across engagements.</p></div><Link className="business-button-secondary" href="/admin/business/setup">Business setup <ArrowRight size={15} /></Link></section>
    </> : <>
      <div className="business-section-heading"><div><h2>{sectionInfo.label}</h2><p>{sectionInfo.description}</p></div><div className="business-actions">{section !== "setup" && <a download href={`/admin/business/export?entity=${entity}`} className="business-button-secondary" aria-disabled={!data.available} onClick={e => { if (!data.available) e.preventDefault(); }}><Download size={15} /> Export CSV</a>}{section === "invoices" && data.available && <a download href="/admin/business/export?entity=payment" className="business-button-secondary"><Download size={15} /> Transactions CSV</a>}{section !== "setup" && <button type="button" className="business-button" onClick={() => open("new")} disabled={!data.available}><Plus size={16} /> Add {section === "retainers" ? "care plan" : nouns[entity!]}</button>}</div></div>
      {section === "invoices" && <p className="business-context">USD records only. Use your bank or hosted payment provider to receive money. Issued records keep their billing details and amounts; payment status is calculated from the transaction history. Sales tax requires your confirmed tax treatment.</p>}
      {section === "documents" && <p className="business-context">Keep each client’s proposals, agreements, invoices, and correspondence together. Save a document record, then upload its original file or a revised version. Record what you sent externally and when; files remain private.</p>}
      {section === "retainers" && <p className="business-context">Define named systems, included tasks, monthly minutes, response expectations, and overage terms. Time is measured for the current calendar month in Central time; billing and renewals remain manual.</p>}
      {section === "setup" && <><section className="business-panel"><h3>Your launch checklist</h3><p>Based on the handbook. Confirm each item with the right adviser or provider; completion records your own review.</p><button className="business-button-secondary" disabled={!data.available || pending} onClick={() => perform(initializeBusinessChecklist)}><CheckCircle2 size={16} /> Add missing setup tasks</button></section><section className="business-panel"><h3>Business identity & capacity</h3><p>Private billing details for printed invoices. This does not change your public website or register the business name.</p><form className="business-form" onSubmit={e => { e.preventDefault(); perform(() => saveBusinessProfile(profile)); }}><fieldset disabled={!data.available || pending} className="business-form-grid">{([['name', 'Legal / billing name'], ['email', 'Business billing email'], ['address', 'Business billing address'], ['paymentInstructions', 'Payment instructions'], ['weeklyHours', 'Available business hours / week']] as const).map(([key, title]) => <label className="business-field" key={key}><span>{title}</span><input className={inputClass} type={key === "email" ? "email" : key === "weeklyHours" ? "number" : "text"} value={profile[key]} required={key === "name" || key === "weeklyHours"} min={key === "weeklyHours" ? 1 : undefined} max={key === "weeklyHours" ? 100 : undefined} onChange={e => setProfile(p => ({ ...p, [key]: key === "weeklyHours" ? Number(e.target.value) : e.target.value }))} /></label>)}<div className="business-field-wide"><button className="business-button" type="submit">{pending ? "Saving…" : "Save business profile"}</button></div></fieldset></form></section></>}
      {section === "clients" && data.leads.length > 0 && <details className="business-panel"><summary>Import a website inquiry <span className="business-count">{data.leads.length}</span></summary><p>Creates a prospect without changing the original inquiry or its sales stage. Showing up to 50 recent unimported inquiries.</p><div className="business-import-list">{data.leads.map(lead => <div key={lead.id}><div><strong>{lead.company}</strong><span>{lead.name}</span></div><button className="business-button-secondary" disabled={pending} onClick={() => perform(() => importBusinessLead(lead.id))}>Import prospect</button></div>)}</div></details>}
      <form className="business-filters" action={`/admin/business/${section}`}>{section === "documents" && <><select name="client" defaultValue={clientId} aria-label="Filter documents by client"><option value="">All clients</option>{data.clients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select><select name="folder" defaultValue={folder} aria-label="Filter document category"><option value="">All categories</option>{documentFolders.map(f => <option key={f} value={f}>{label(f)}</option>)}</select></>}<label><span className="sr-only">Search {sectionInfo.label}</span><Search size={16} /><input name="q" defaultValue={query} placeholder={`Search ${sectionInfo.label.toLowerCase()}…`} /></label>{statuses && <select name="status" defaultValue={status} aria-label="Filter by status"><option value="">All stages</option>{statuses.map(s => <option key={s} value={s}>{label(s)}</option>)}</select>}<button className="business-button-secondary" type="submit">Search</button>{(query || status || clientId || folder || searchParams.get("record")) && <Link href={`/admin/business/${section}`} className="business-button-secondary">Clear</Link>}</form>
      <section className="business-panel business-records"><div className="business-list-heading"><h3>{section === "setup" ? "Setup tasks" : "Your records"}</h3><span>{data.total} {data.total === 1 ? "record" : "records"}</span></div>{data.rows.length ? <div className="business-record-list">{data.rows.map(row => <article key={row.id}><div className="business-record-main"><button type="button" onClick={() => open(row)}>{rowTitle(entity!, row)}</button><p>{rowDetail(entity!, row)}</p>{entity === "client" && row.nextAction ? <span className="business-next">Next: {row.nextAction} {row.followUpDate ? `· ${dateText(row.followUpDate)}` : ""}</span> : null}{entity === "document" && <span className="business-next">{label(String(row.folder || "GENERAL"))} · {row.fileCount ?? 0} file versions{row.sentDate ? ` · Sent ${dateText(row.sentDate)}` : ""}{row.signedDate ? ` · Signed ${dateText(row.signedDate)}` : ""}</span>}{entity === "client" && <Link className="business-client-files-link" href={`/admin/business/documents?client=${encodeURIComponent(String(row.id))}`}>{row.documentCount ?? 0} documents · Open library <ArrowRight size={12} /></Link>}{entity === "engagement" && row.kind === "RETAINER" ? <div className="business-capacity"><span>{row.usedMinutes} / {row.monthlyMinutes} minutes this month{Number(row.usedMinutes) > Number(row.monthlyMinutes) ? " · Over allocation" : ""}</span><progress aria-label={`${row.title} monthly capacity`} value={Math.min(Number(row.usedMinutes), Number(row.monthlyMinutes))} max={Math.max(1, Number(row.monthlyMinutes))} /></div> : null}</div><div className="business-record-meta">{["invoice", "expense", "engagement"].includes(entity!) && <strong>{moneyLabel(Number(row[entity === "invoice" ? "balanceCents" : entity === "expense" ? "amountCents" : "feeCents"]))}{entity === "invoice" && <small>outstanding</small>}</strong>}{entity === "time" && <strong>{row.minutes} minutes</strong>}{(row.displayStatus || row.status) && <Badge value={String(row.displayStatus || row.status)} />}{(row.dueDate || row.date) && <span>{dateText(row.dueDate || row.date)}</span>}<div className="business-row-actions"><button className="business-text-button" onClick={() => open(row)}>Open <ArrowRight size={14} /></button>{entity === "invoice" && row.status === "ISSUED" && <button className="business-text-button" onClick={() => open(row, "payment")}>Record transaction</button>}{["invoice", "document"].includes(entity!) && <button className="business-text-button" onClick={() => open(row, "print")}>Preview / print</button>}</div></div></article>)}</div> : <div className="business-empty"><FileText size={27} /><h3>{data.available ? query || status ? "No records match this search" : "Your workspace starts here" : "Ready for your business records"}</h3><p>{data.available ? section === "setup" ? "Add the handbook setup checklist above, then open each task to record your progress." : `Add your first ${nouns[entity!]}${section === "clients" ? " or import a website inquiry" : ""}.` : "Connect the database to start saving. No sample clients or financial records have been created."}</p></div>}</section>
      {data.pages > 1 && <nav className="business-pagination" aria-label="Record pages">{data.page > 1 && <Link href={urlFor(data.page - 1)}>Previous</Link>}<span>Page {data.page} of {data.pages}</span>{data.page < data.pages && <Link href={urlFor(data.page + 1)}>Next</Link>}</nav>}
    </>}
    <dialog ref={dialog} onCancel={event => { if (pending || uploadBusy) event.preventDefault(); else setSelected(null); }} className="business-dialog" aria-labelledby="business-dialog-title"><div className="business-dialog-heading"><div><p className="business-eyebrow">{mode === "payment" ? "External payment reconciliation" : mode === "print" ? "Document preview" : selected === "new" ? "New record" : "Record details"}</p><h2 id="business-dialog-title">{mode === "payment" ? "Record a transaction" : selectedRow && entity ? rowTitle(entity, selectedRow) : entity ? `Add ${nouns[entity]}` : "Record"}</h2></div><button type="button" onClick={() => setSelected(null)} disabled={pending || uploadBusy} aria-label="Close record" className="business-icon-button"><X size={22} /></button></div>
      {notice && <div className={`business-notice ${notice.success ? "business-notice-good" : ""}`} role={notice.success ? "status" : "alert"}>{notice.message}</div>}
      {selected && mode === "print" && selectedRow ? <><div className="business-print-toolbar"><p>Review saved details before sharing. Use your browser's print dialog to save as PDF.</p><button className="business-button" onClick={() => window.print()}>Print / save PDF</button></div><PrintDocument entity={entity!} row={selectedRow} profile={data.profile} /></> : selected && entity ? <form onSubmit={e => { e.preventDefault(); if (mode === "payment") perform(() => recordBusinessPayment(draft), true); else if (!uploadBusy) perform(() => saveBusinessRecord(entity, { ...draft, ...(selectedRow ? { id: selectedRow.id, version: selectedRow.version } : {}) }), true); }}>
        {mode === "payment" && <p className="business-context">Record a transaction verified in your bank or provider. Refunds must have happened externally. References are unique to prevent duplicate entry. This form does not collect or return money.</p>}
        {data.optionsLimited && <p className="business-context">Client and engagement selectors show the 500 most recently updated records. Current links are retained when editing.</p>}
        {entity === "engagement" && mode === "edit" && <p className="business-context">A new engagement creates the selected service's delivery checklist. Before marking it ready or active, record the agreement, payment evidence, and acceptance checks.</p>}
        {entity === "document" && mode === "edit" && <button type="button" className="business-button-secondary business-template-button" onClick={() => { if (!draft.body || window.confirm("Replace the current document text with this worksheet?")) setDraft(d => ({ ...d, body: documentTemplates[d.kind] ?? documentTemplates.NOTE })); }}>Use {label(draft.kind ?? "PROPOSAL")} worksheet</button>}
        <fieldset disabled={pending || uploadBusy} className="business-form-grid">{(mode === "payment" ? paymentFields : fields[entity]).filter(field => !(entity === "engagement" && draft.kind !== "RETAINER" && ["monthlyMinutes", "renewalDate", "coverage", "serviceHours", "responseTarget", "rolloverTerms", "cancellationTerms"].includes(field.name))).map(renderField)}</fieldset>
        {entity === "client" && selectedRow && <section className="business-file-library"><h3>Client document library</h3><p className="business-context">Keep every proposal, agreement, invoice, and later document with {selectedRow.company}. Earlier file versions are retained.</p><Link className="business-button-secondary" href={`/admin/business/documents?client=${encodeURIComponent(String(selectedRow.id))}`}>Open this client’s documents <ArrowRight size={14} /></Link> <Link className="business-button-secondary" href={`/admin/business/documents?client=${encodeURIComponent(String(selectedRow.id))}&new=1`}>Add a client document <Plus size={14} /></Link></section>}
        {entity === "document" && mode === "edit" && selectedRow && JSON.stringify(draft) !== JSON.stringify(editValues("document", selectedRow)) && <p className="business-context">Save your changes to the document details before uploading a file.</p>}
        {entity === "document" && mode === "edit" && (selectedRow ? <DocumentFiles key={String(selectedRow.id)} documentId={String(selectedRow.id)} disabled={pending || JSON.stringify(draft) !== JSON.stringify(editValues("document", selectedRow))} onBusy={setUploadBusy} onAttached={snapshot => { const updated = { ...selectedRow, ...snapshot }; setSelected(updated); setDraft(editValues("document", updated)); router.refresh(); }} /> : <p className="business-context">Save this document record first. Then open it to upload the original file and keep its version history. To upload an already signed agreement, save as Draft first, then choose Signed when uploading the file.</p>)}
        {entity === "invoice" && mode === "edit" && selectedRow && <section className="business-payment-history"><h3>Recorded payment history</h3>{(data.payments[String(selectedRow.id)] ?? []).length ? data.payments[String(selectedRow.id)].map(p => <div key={p.id}><strong>{label(p.kind)} · {moneyLabel(p.amountCents)}</strong><span>{dateText(p.date)} · {p.method} · {p.reference}</span><small>Processing fee: {moneyLabel(p.feeCents)}{p.notes ? ` · ${p.notes}` : ""}</small></div>) : <p>No transactions recorded.</p>}</section>}
        <footer className="business-dialog-footer"><button type="button" className="business-button-secondary" disabled={pending || uploadBusy} onClick={() => setSelected(null)}>Cancel</button><button type="submit" className="business-button" disabled={pending || uploadBusy}>{pending ? "Saving…" : <><Check size={16} /> {mode === "payment" ? "Record transaction" : "Save record"}</>}</button></footer>
      </form> : null}
    </dialog>
    {selectedRow && mode === "print" && createPortal(<div className="business-print-root"><PrintDocument entity={entity!} row={selectedRow} profile={data.profile} /></div>, document.body)}
  </div>;
}
function ActionList({ title, description, rows, empty, href, nameKey, dateKey, detailKey }: { title: string; description: string; rows: BusinessRow[]; empty: string; href: string; nameKey: string; dateKey: string; detailKey: string }) {
  return <section className="business-panel"><div className="business-panel-heading"><div><h3>{title}</h3><p>{description}</p></div><Link href={`/admin/business/${href}`} aria-label={`View all ${title.toLowerCase()}`}><ArrowUpRight size={20} /></Link></div>{rows.length ? <ul className="business-action-list">{rows.map(row => <li key={row.id}><Link href={`/admin/business/${href}?record=${encodeURIComponent(String(row.id))}`}><strong>{row[nameKey]}</strong><span>{row[detailKey]}</span></Link><time>{dateText(row[dateKey])}</time></li>)}</ul> : <p className="business-empty-copy">{empty}</p>}</section>;
}

function PrintDocument({ entity, row, profile }: { entity: Entity; row: BusinessRow; profile: WorkspaceData["profile"] }) {
  return <div className="business-print"><p>{profile.name}</p><p>{profile.address}<br />{profile.email}</p>{entity === "invoice" ? <><h1>Invoice {row.number}</h1><p><strong>{label(String(row.status))}</strong> · USD</p><p>Bill to: {row.billedTo}<br />{row.billingAddress}<br />{row.billingEmail}</p><p>Issued: {dateText(row.issueDate)}<br />Due: {dateText(row.dueDate)}</p><hr /><p>{row.description}</p><dl><dt>Subtotal</dt><dd>{moneyLabel(Number(row.subtotalCents))}</dd><dt>Tax</dt><dd>{moneyLabel(Number(row.taxCents))}</dd><dt>Total</dt><dd>{moneyLabel(Number(row.totalCents))}</dd><dt>Payments less refunds</dt><dd>{moneyLabel(Number(row.netPaidCents))}</dd><dt>Balance</dt><dd>{moneyLabel(Number(row.balanceCents))}</dd></dl><p>{row.notes}</p><p>{profile.paymentInstructions}</p>{row.paymentUrl && <p><a href={String(row.paymentUrl)} target="_blank" rel="noopener noreferrer">Pay through the payment provider</a></p>}</> : <><h1>{row.title}</h1><p>{row.clientLabel} · {label(String(row.status))}</p><div className="business-document-body">{row.body}</div></>}</div>;
}
