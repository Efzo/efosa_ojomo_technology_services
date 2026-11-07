import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBusinessOwner, businessDatabaseReady } from "@/lib/business/access";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { if (!await requireBusinessOwner()) return NextResponse.json({ message: "Database required." }, { status: 503 }); }
  catch { return NextResponse.json({ message: "Owner access required." }, { status: 403 }); }
  if (!businessDatabaseReady() || !process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ message: "Private file storage is not configured." }, { status: 503 });
  const { id } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return NextResponse.json({ message: "Invalid file." }, { status: 400 });
  try {
    const file = await prisma.businessDocumentFile.findUnique({ where: { id } });
    if (!file) return NextResponse.json({ message: "File not found." }, { status: 404 });
    const result = await get(file.storageKey, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return NextResponse.json({ message: "The file is unavailable in storage." }, { status: 404 });
    const filename = file.filename.replace(/[^a-zA-Z0-9._ -]/g, "_");
    const encodedFilename = encodeURIComponent(file.filename).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(result.stream, { headers: { "Content-Type": file.mimeType, "Content-Length": String(result.blob.size), "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch { return NextResponse.json({ message: "The private file could not be downloaded. Please try again." }, { status: 502 }); }
}
