import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBusinessOwner, businessDatabaseReady } from "@/lib/business/access";
import { documentFileMaxBytes, documentFilePathAllowed, documentFileType, documentUploadMetadata } from "@/lib/business/document-files";
import { registerDocumentFile } from "@/lib/business/register-document-file";

export async function POST(request: Request) {
  if (!businessDatabaseReady() || !process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN.includes("demo_")) return NextResponse.json({ message: "Connect PostgreSQL and private Vercel Blob storage before uploading client files." }, { status: 503 });
  let body: HandleUploadBody;
  try { body = await request.json(); } catch { return NextResponse.json({ message: "Invalid upload request." }, { status: 400 }); }
  if (!body || !["blob.generate-client-token", "blob.upload-completed"].includes(body.type)) return NextResponse.json({ message: "Invalid upload request." }, { status: 400 });
  let ownerId: string | null = null;
  if (body.type === "blob.generate-client-token") {
    if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ message: "Invalid upload origin." }, { status: 403 });
    try { ownerId = await requireBusinessOwner(); } catch { return NextResponse.json({ message: "Sign in with the owner account to upload client files." }, { status: 403 }); }
    if (!ownerId) return NextResponse.json({ message: "Owner access required." }, { status: 403 });
  }
  try {
    const result = await handleUpload({ request, body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const values = documentUploadMetadata.parse(JSON.parse(clientPayload || "{}"));
        if (!ownerId || !documentFilePathAllowed(pathname, values.documentId, ownerId)) throw new Error("Invalid document path.");
        if (!await prisma.businessDocument.findUnique({ where: { id: values.documentId }, select: { id: true } })) throw new Error("Save the document record first.");
        const contentType = documentFileType(values.filename);
        if (!contentType) throw new Error("Unsupported document format.");
        return { allowedContentTypes: [contentType], maximumSizeInBytes: documentFileMaxBytes, addRandomSuffix: true, allowOverwrite: false, validUntil: Date.now() + 15 * 60_000, tokenPayload: JSON.stringify({ ...values, ownerId }) };
      },
      // handleUpload verifies the provider's callback signature. Registration
      // rechecks the owner's current role, path, private blob metadata, and size.
      onUploadCompleted: async ({ blob, tokenPayload }) => { await registerDocumentFile({ ...JSON.parse(tokenPayload || "{}"), pathname: blob.pathname }); },
    });
    return NextResponse.json(result);
  } catch { return NextResponse.json({ message: "The file could not be authorized or attached. Check the document record and upload details, then retry." }, { status: body.type === "blob.upload-completed" ? 500 : 400 }); }
}
