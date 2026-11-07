"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronLeft, ExternalLink, HelpCircle, LogOut, Menu, X } from "lucide-react";
import AdminSessionBoundary from "@/components/admin/AdminSessionBoundary";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { adminGroups, getAdminLocation } from "@/lib/admin-navigation";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const menuButton = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const location = getAdminLocation(pathname);
  const collapsedLabel = isCollapsed ? "md:hidden" : "";

  function closeMobile() { setIsMobileOpen(false); menuButton.current?.focus(); }

  if (["/admin/login", "/admin/setup", "/admin/forgot-password", "/admin/reset-password"].includes(pathname)) return <div className="min-h-screen bg-midnight text-platinum"><Navbar /><main>{children}</main><Footer /></div>;

  return <AdminSessionBoundary><div className="min-h-screen bg-slate-deep text-platinum">
    <a href="#admin-main" className="skip-link">Skip to page content</a>
    <button ref={menuButton} type="button" aria-label="Open site manager menu" aria-expanded={isMobileOpen} aria-controls="admin-sidebar" onClick={() => setIsMobileOpen(true)} className="fixed left-4 top-4 z-40 rounded-lg border border-glass bg-midnight p-2 md:hidden"><Menu className="h-5 w-5" /></button>
    {isMobileOpen && <button aria-label="Close site manager menu" type="button" onClick={closeMobile} className="fixed inset-0 z-40 bg-black/60 md:hidden" />}
    <aside id="admin-sidebar" onKeyDown={(event) => { if (event.key === "Escape" && isMobileOpen) closeMobile(); }} className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-glass bg-midnight/95 backdrop-blur-xl transition-all duration-300 ${isCollapsed ? "md:w-20" : "md:w-72"} ${isMobileOpen ? "translate-x-0" : "invisible -translate-x-full md:visible md:translate-x-0"}`}>
      <div className="flex h-20 shrink-0 items-center justify-between border-b border-glass px-5">
        <Link href="/admin" onClick={() => setIsMobileOpen(false)} className={collapsedLabel}><span className="block text-lg font-bold">Admin Workspace</span><span className="text-xs text-slate-muted">Business & Website</span></Link>
        <button type="button" aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!isCollapsed} onClick={() => setIsCollapsed(!isCollapsed)} className="hidden rounded-lg p-2 text-slate-muted hover:bg-white/10 md:block"><ChevronLeft className={`h-5 w-5 ${isCollapsed ? "rotate-180" : ""}`} /></button>
        <button type="button" aria-label="Close site manager menu" onClick={closeMobile} className="p-2 md:hidden"><X className="h-5 w-5" /></button>
      </div>
      <nav aria-label="Website management" className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        {adminGroups.map((group) => {
          const expanded = openGroups[group.id] ?? (group.id !== "access" || location?.group.id === group.id);
          return <section key={group.id} aria-label={group.name}>
            <button type="button" onClick={() => setOpenGroups({ ...openGroups, [group.id]: !expanded })} aria-expanded={expanded} aria-controls={`admin-group-${group.id}`} className={`mb-1 flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-bold uppercase tracking-widest text-slate-muted ${collapsedLabel}`}>
              {group.name}<ChevronDown aria-hidden="true" className={`h-3 w-3 transition-transform ${expanded ? "" : "-rotate-90"}`} />
            </button>
            <div id={`admin-group-${group.id}`} className={`${expanded ? "" : isCollapsed ? "hidden md:block" : "hidden"} space-y-1`}>
              {group.items.map((item) => {
                const active = location?.item.href === item.href;
                return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} aria-label={item.name} title={`${item.name}: ${item.description}`} onClick={() => setIsMobileOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active ? "bg-electric/15 font-semibold text-electric" : "text-slate-muted hover:bg-white/10 hover:text-white"}`}><item.icon aria-hidden="true" className="h-5 w-5 shrink-0" /><span className={collapsedLabel}>{item.name}</span></Link>;
              })}
            </div>
          </section>;
        })}
      </nav>
      <div className="shrink-0 space-y-1 border-t border-glass p-3">
        <Link href="/" target="_blank" rel="noopener noreferrer" title="View public website" aria-label="View public website (opens in a new tab)" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-muted hover:bg-white/10"><ExternalLink className="h-5 w-5 shrink-0" /><span className={collapsedLabel}>View Website ↗</span></Link>
        <Link href="/api/auth/signout" aria-label="Sign out" title="Sign out" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-muted hover:bg-red-500/10 hover:text-red-300"><LogOut className="h-5 w-5 shrink-0" /><span className={collapsedLabel}>Sign Out</span></Link>
      </div>
    </aside>
    <div className={`min-h-screen transition-[padding] duration-300 ${isCollapsed ? "md:pl-20" : "md:pl-72"}`}>
      <header className="sticky top-0 z-30 flex min-h-20 min-w-0 items-center justify-between gap-4 border-b border-glass bg-midnight/90 px-4 py-3 backdrop-blur-xl md:px-8">
        <div className="min-w-0 pl-10 md:pl-0"><p className="text-xs text-slate-muted">{location?.group.name ?? "Website Manager"}</p><p className="truncate font-semibold">{location?.item.name ?? "Overview"}</p></div>
        <Link href="/admin/content" className="flex shrink-0 items-center gap-2 rounded-lg border border-glass px-3 py-2 text-sm text-slate-muted hover:text-white"><HelpCircle className="h-4 w-4" /><span className="hidden sm:inline">Where do I edit this?</span><span className="sm:hidden">Help</span></Link>
      </header>
      <main id="admin-main" tabIndex={-1} className="min-w-0 p-4 md:p-8">{children}</main>
    </div>
  </div></AdminSessionBoundary>;
}
