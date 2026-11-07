import Link from "next/link";
import { prisma } from "@/lib/prisma";

async function getDashboardData() {
  if (process.env.DEMO_MODE === "true" || !process.env.DATABASE_URL || process.env.DATABASE_URL.includes("demo_")) return null;
  try {
    const [totalLeads, newLeads, qualifiedLeads, wonLeads, publishedPosts, draftPosts, pages, services, media, recentLeads] = await Promise.all([
      prisma.lead.count(), prisma.lead.count({ where: { status: "NEW" } }), prisma.lead.count({ where: { status: "QUALIFIED" } }), prisma.lead.count({ where: { status: "WON" } }),
      prisma.blogPost.count({ where: { status: "PUBLISHED" } }), prisma.blogPost.count({ where: { status: "DRAFT" } }), prisma.page.count(), prisma.service.count({ where: { isPublished: true } }), prisma.mediaAsset.count(), prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, company: true, status: true, createdAt: true } }),
    ]);
    return { totalLeads, newLeads, qualifiedLeads, wonLeads, publishedPosts, draftPosts, pages, services, media, recentLeads };
  } catch { return null; }
}

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const data = await getDashboardData();
  const tasks = [
    { title: "Run business operations", href: "/admin/business", description: "Open your private workspace for clients, delivery, payments, and the next action." },
    { title: "Edit homepage text", href: "/admin/page-builder", description: "Change the hero, sections, FAQs, and buttons." },
    { title: "Find a page editor", href: "/admin/content", description: "See where each part of your website is managed." },
    { title: "Review project inquiries", href: "/admin/leads", description: "Read messages and follow up with potential clients." },
    { title: "Update a service", href: "/admin/services", description: "Change service descriptions and deliverables." },
    { title: "Manage offers and prices", href: "/admin/packages", description: "Update inclusions, add-ons, and public price visibility." },
    { title: "Update a project story", href: "/admin/case-studies", description: "Edit case studies and add approved screenshots." },
  ];
  const cards = data ? [["Total inquiries", data.totalLeads, "/admin/leads"], ["New inquiries", data.newLeads, "/admin/leads"], ["Qualified inquiries", data.qualifiedLeads, "/admin/leads"], ["Won engagements", data.wonLeads, "/admin/leads"], ["Published articles", data.publishedPosts, "/admin/blog"], ["Draft articles", data.draftPosts, "/admin/blog"], ["Published services", data.services, "/admin/services"], ["Images and files", data.media, "/admin/media"]] : [];
  return <div className="space-y-10">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold tracking-tight">Website Overview</h1><p className="mt-2 text-slate-muted">Manage website content, consulting offers, and client inquiries.</p></div><Link href="/" target="_blank" rel="noopener noreferrer" className="btn-secondary">View Website ↗</Link></header>
    <section><h2 className="text-xl font-bold">What would you like to do?</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{tasks.map((task) => <Link key={task.href} href={task.href} className="glass-card p-6 hover:border-electric/40"><h3 className="font-semibold text-cyan-ai">{task.title} →</h3><p className="mt-3 text-sm leading-relaxed text-slate-muted">{task.description}</p></Link>)}</div></section>
    {data ? <>
      <section><h2 className="text-xl font-bold">Business and content at a glance</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value, href]) => <Link key={label} href={href as string} className="glass-card p-5"><p className="text-sm text-slate-muted">{label}</p><p className="mt-3 text-3xl font-bold">{value}</p></Link>)}</div></section>
      <section className="glass-panel overflow-hidden"><div className="flex items-center justify-between border-b border-glass px-6 py-5"><div><h2 className="text-xl font-bold">Recent project inquiries</h2><p className="mt-1 text-sm text-slate-muted">Messages submitted through your website contact form.</p></div><Link href="/admin/leads" className="text-sm text-cyan-ai">View all →</Link></div>{data.recentLeads.length ? <div className="divide-y divide-glass">{data.recentLeads.map((lead) => <Link href="/admin/leads" key={lead.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 hover:bg-white/5"><div><p className="font-medium">{lead.name} <span className="text-slate-muted">· {lead.company}</span></p><p className="mt-1 text-xs text-slate-muted">{lead.createdAt.toLocaleDateString()}</p></div><span className="rounded-full border border-electric/30 bg-electric/10 px-3 py-1 text-xs text-electric">{lead.status.replaceAll("_", " ")}</span></Link>)}</div> : <p className="p-8 text-sm text-slate-muted">No project inquiries yet.</p>}</section>
    </> : <section className="glass-panel p-6"><h2 className="text-xl font-bold">Live totals are unavailable</h2><p className="mt-3 text-slate-muted">A connected database is needed to show inquiry and content totals. You can still use the shortcuts and editing guide to find your way around.</p><Link href="/admin/settings#connections" className="mt-4 inline-block text-cyan-ai">Review connection settings →</Link></section>}
    <section className="glass-panel p-6"><h2 className="text-xl font-bold">Not sure where something belongs?</h2><p className="mt-3 text-slate-muted">The editing guide explains every menu item and identifies pages that still need a connected editor.</p><Link href="/admin/content" className="mt-4 inline-block text-cyan-ai">Open Where to Edit →</Link></section>
  </div>;
}
