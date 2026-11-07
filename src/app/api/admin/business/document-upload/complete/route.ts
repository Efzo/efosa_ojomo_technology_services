import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBusinessOwner, businessDatabaseReady } from "@/lib/business/access";
import { documentFilePathAllowed, documentUploadMetadata } from "@/lib/business/document-files";
import { registerDocumentFile } from "@/lib/business/register-document-file";
import { revalidatePath } from "next/cache";
export async function POST(request: Request) {
  let ownerId;
  try { ownerId = await requireBusinessOwner(); } catch { return NextResponse.json({ message: "Owner access required." }, { status: 403 }); }
  if (!ownerId || !businessDatabaseReady()) return NextResponse.json({ message: "A live database is required." }, { status: 503 });
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ message: "Invalid upload origin." }, { status: 403 });
  try {
    const input = documentUploadMetadata.and(z.object({ pathname: z.string().max(600) })).parse(await request.json());
    if (!documentFilePathAllowed(input.pathname, input.documentId, ownerId)) return NextResponse.json({ message: "Invalid document path." }, { status: 400 });
    const { file, document } = await registerDocumentFile({ ...input, ownerId });
    revalidatePath("/admin/business", "layout");
    return NextResponse.json({ file: { id: file.id, revision: file.revision }, document });
  } catch { return NextResponse.json({ message: "The file could not be attached to this record. Retry attachment; an already uploaded file will not be uploaded again." }, { status: 400 }); }
}
