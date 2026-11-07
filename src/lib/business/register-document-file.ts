import { head } from "@vercel/blob";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { documentFileMaxBytes, documentFilePathAllowed, documentFileType, documentUploadMetadata } from "./document-files";

export async function registerDocumentFile(input: unknown) {
  const values = documentUploadMetadata.and(pathMetadata).parse(input);
  const { pathname, ownerId, documentId } = values;
  if (!documentFilePathAllowed(pathname, documentId, ownerId)) throw new Error("Invalid document path.");
  const blob = await head(pathname);
  const url = new URL(blob.url);
  const mimeType = blob.contentType.split(";")[0].trim();
  if (url.protocol !== "https:" || !url.hostname.endsWith(".private.blob.vercel-storage.com") || blob.pathname !== pathname || !Number.isInteger(blob.size) || blob.size <= 0 || blob.size > documentFileMaxBytes || mimeType !== documentFileType(values.filename)) throw new Error("Invalid private document upload.");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { role: true } });
        if (owner?.role !== "OWNER") throw new Error("Owner access required.");
        const document = await tx.businessDocument.findUnique({ where: { id: documentId } });
        if (!document) throw new Error("Document not found.");
        const existing = await tx.businessDocumentFile.findUnique({ where: { storageKey: pathname } });
        if (existing) {
          if (existing.documentId !== documentId || existing.uploadedById !== ownerId) throw new Error("Invalid document attachment.");
          return { file: existing, document };
        }
        const latest = await tx.businessDocumentFile.findFirst({ where: { documentId }, orderBy: { revision: "desc" }, select: { revision: true } });
        const file = await tx.businessDocumentFile.create({ data: { documentId, revision: (latest?.revision ?? 0) + 1, storageKey: pathname, filename: values.filename, mimeType, size: blob.size, revisionNote: values.revisionNote, status: values.status, sentDate: values.sentDate, signedDate: values.signedDate, uploadedById: ownerId } });
        const updated = await tx.businessDocument.update({ where: { id: documentId }, data: { version: { increment: 1 }, status: values.status, sentDate: values.sentDate, signedDate: values.signedDate } });
        await tx.auditEvent.create({ data: { actorId: ownerId, action: "business.document.file_uploaded", target: file.id } });
        return { file, document: updated };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!["P2002", "P2034"].includes((error as { code?: string }).code ?? "") || attempt === 2) throw error;
    }
  }
  throw new Error("The document could not be registered. Please retry.");
}
const pathMetadata = z.object({ pathname: z.string().max(600), ownerId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) });
