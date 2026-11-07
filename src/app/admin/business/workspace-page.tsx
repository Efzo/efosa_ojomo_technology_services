import { getBusinessWorkspace } from "@/lib/business/data";
import { requireBusinessOwner } from "@/lib/business/access";
import { documentFolders, type Section } from "@/lib/business/config";
import BusinessWorkspace from "@/components/admin/business/BusinessWorkspace";
export async function BusinessPage({ section, params }: { section: Section; params: { q?: string; page?: string; status?: string; record?: string; client?: string; folder?: string; new?: string } }) {
  try { await requireBusinessOwner(); }
  catch { return <section className="glass-panel p-8"><h1 className="text-2xl font-semibold">Owner access required</h1><p className="mt-3 text-slate-muted">Business operations contains private client and financial information. Sign in with the business owner account to continue.</p></section>; }
  const query = typeof params.q === "string" ? params.q.slice(0, 150) : "";
  const status = typeof params.status === "string" ? params.status.slice(0, 40) : "";
  const clientId = typeof params.client === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(params.client) ? params.client : "";
  const folder = documentFolders.find(f => f === params.folder) ?? "";
  const requestedPage = /^\d{1,6}$/.test(params.page ?? "") ? Math.max(1, Number(params.page)) : 1;
  const data = await getBusinessWorkspace(section, query, requestedPage, status, typeof params.record === "string" ? params.record.slice(0, 100) : "", { clientId, folder });
  return <BusinessWorkspace key={`${section}:${query}:${status}:${data.page}:${params.record ?? ""}:${clientId}:${folder}:${params.new ?? ""}`} section={section} data={data} query={query} status={status} clientId={clientId} folder={folder} />;
}
