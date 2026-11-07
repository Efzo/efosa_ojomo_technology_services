import { z } from "zod";
import { calendarDate, todayInAustin } from "./config";

export const documentFileMaxBytes = 20 * 1024 * 1024;
export const documentFileTypes: Record<string, string> = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain", csv: "text/csv", md: "text/markdown", eml: "message/rfc822",
};
export const documentFileAccept = Object.keys(documentFileTypes).map(ext => `.${ext}`).join(",");
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const documentUploadMetadata = z.object({
  documentId: id,
  filename: z.string().trim().min(1).max(200).refine(v => !/[\r\n\x00/\\]/.test(v), "Use a plain filename."),
  revisionNote: z.string().trim().min(2).max(1000),
  status: z.enum(["DRAFT", "SHARED", "APPROVED", "SIGNED"]),
  sentDate: calendarDate.or(z.literal("")), signedDate: calendarDate.or(z.literal("")),
}).superRefine((v, ctx) => {
  if (v.status === "SHARED" && !v.sentDate) ctx.addIssue({ code: "custom", message: "Record the date this version was sent.", path: ["sentDate"] });
  if (v.status === "SIGNED" && !v.signedDate) ctx.addIssue({ code: "custom", message: "Record the date this version was signed.", path: ["signedDate"] });
  if (v.sentDate > todayInAustin() || v.signedDate > todayInAustin()) ctx.addIssue({ code: "custom", message: "Use the actual sent or signed date, not a future date." });
  if (!documentFileType(v.filename)) ctx.addIssue({ code: "custom", message: "Choose a supported document format.", path: ["filename"] });
});
export function documentFileType(filename: string) { const extension = filename.split(".").at(-1)?.toLowerCase() ?? ""; return Object.hasOwn(documentFileTypes, extension) ? documentFileTypes[extension] : undefined; }
export function documentFilePathAllowed(pathname: string, documentId: string, ownerId: string) {
  if (!id.safeParse(documentId).success || !id.safeParse(ownerId).success) return false;
  const prefix = `business-documents/${documentId}/${ownerId}/`;
  return pathname.startsWith(prefix) && /^[a-f0-9-]{36}\/[a-zA-Z0-9._-]{1,200}$/.test(pathname.slice(prefix.length));
}
export type DocumentFile = { id: string; documentId: string; revision: number; filename: string; mimeType: string; size: number; revisionNote: string; status: string; sentDate: string; signedDate: string; createdAt: string };
export async function readDocumentResponse(response: Response) {
  let result;
  try { result = JSON.parse(await response.text()); }
  catch { throw new Error(response.status === 413 ? "The file was too large. Choose a supported file up to 20 MB." : "The document service did not respond correctly. Your saved records are unchanged; please retry."); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("The document service returned an unexpected response.");
  if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : "The document request failed.");
  return result;
}
