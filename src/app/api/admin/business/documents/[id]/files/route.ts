import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBusinessOwner, businessDatabaseReady } from "@/lib/business/access";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { if (!await requireBusinessOwner()) return NextResponse.json({ message: "Database required." }, { status: 503 }); }
  catch { return NextResponse.json({ message: "Owner access required." }, { status: 403 }); }
  if (!businessDatabaseReady()) return NextResponse.json({ message: "Database required." }, { status: 503 });
  const { id } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return NextResponse.json({ message: "Invalid document." }, { status: 400 });
  try {
    const document = await prisma.businessDocument.findUnique({ where: { id }, select: { id: true } });
    if (!document) return NextResponse.json({ message: "Document not found." }, { status: 404 });
    const total = await prisma.businessDocumentFile.count({ where: { documentId: id } });
    const pages = Math.max(1, Math.ceil(total / 10));
    const raw = new URL(request.url).searchParams.get("page") ?? "1";
    const page = /^\d{1,6}$/.test(raw) ? Math.min(Math.max(1, Number(raw)), pages) : 1;
    const files = await prisma.businessDocumentFile.findMany({ where: { documentId: id }, orderBy: { revision: "desc" }, skip: (page - 1) * 10, take: 10, select: { id: true, documentId: true, revision: true, filename: true, mimeType: true, size: true, revisionNote: true, status: true, sentDate: true, signedDate: true, createdAt: true } });
    return NextResponse.json({ files, total, page, pages }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ message: "File history is unavailable. Check the database and document-files migration." }, { status: 503 }); }
}
