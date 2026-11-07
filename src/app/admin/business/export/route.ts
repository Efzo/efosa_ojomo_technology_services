import { prisma } from "@/lib/prisma";
import { requireBusinessOwner, businessDatabaseReady } from "@/lib/business/access";
import { entityModels } from "@/lib/business/data";
import { csvCell } from "@/lib/business/csv";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { await requireBusinessOwner(); } catch { return new Response("Owner access required", { status: 403 }); }
  if (!businessDatabaseReady()) return new Response("Database required", { status: 503 });
  const entity = new URL(request.url).searchParams.get("entity") ?? "";
  if (!Object.hasOwn(entityModels, entity)) return new Response("Unknown export", { status: 400 });
  const model = prisma[entityModels[entity as keyof typeof entityModels]] as unknown as { findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]> };
  let cursor: string | undefined, columns: string[] | undefined;
  const encoder = new TextEncoder();
  // Each pull reads a bounded batch. The export includes all records of this
  // type, not just the current page or active search filter.
  const stream = new ReadableStream({ async pull(controller) {
    try {
      const rows = await model.findMany({ orderBy: { id: "asc" }, take: 250, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!rows.length) { controller.close(); return; }
      let output = "";
      if (!columns) { columns = Object.keys(rows[0]); output += columns.map(csvCell).join(",") + "\r\n"; }
      for (const row of rows) output += columns.map(c => csvCell(row[c])).join(",") + "\r\n";
      cursor = String(rows.at(-1)!.id);
      controller.enqueue(encoder.encode(output));
      if (rows.length < 250) controller.close();
    } catch { controller.error(new Error("Export unavailable. Check database connectivity.")); }
  } });
  return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="business-${entity}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
