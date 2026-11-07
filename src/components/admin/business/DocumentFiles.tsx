"use client";

import { useEffect, useRef, useState } from "react";
import { getSession } from "next-auth/react";
import { upload } from "@vercel/blob/client";
import { Download, Upload } from "lucide-react";
import { documentFileAccept, documentFileMaxBytes, documentFileType, documentUploadMetadata, readDocumentResponse, type DocumentFile } from "@/lib/business/document-files";
import { label, type BusinessRow } from "@/lib/business/config";

type FileMetadata = { documentId: string; filename: string; revisionNote: string; status: "DRAFT" | "SHARED" | "APPROVED" | "SIGNED"; sentDate: string; signedDate: string };
type DocumentSnapshot = BusinessRow;
export default function DocumentFiles({ documentId, disabled, onBusy, onAttached }: { documentId: string; disabled: boolean; onBusy: (busy: boolean) => void; onAttached: (snapshot: DocumentSnapshot) => void }) {
  const [history, setHistory] = useState<{ files: DocumentFile[]; total: number; pages: number }>({ files: [], total: 0, pages: 1 });
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [file, setFile] = useState<File | null>(null), [note, setNote] = useState("");
  const [status, setStatus] = useState<FileMetadata["status"]>("DRAFT"), [sentDate, setSentDate] = useState(""), [signedDate, setSignedDate] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [hasStaged, setHasStaged] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const staged = useRef<{ file: File; pathname: string; metadata: FileMetadata } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/business/documents/${encodeURIComponent(documentId)}/files?page=${page}`, { cache: "no-store", signal: controller.signal })
      .then(readDocumentResponse).then(result => { if (!controller.signal.aborted) { setHistory({ files: result.files, total: result.total, pages: result.pages }); setHistoryError(""); } })
      .catch(error => { if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : "File history is unavailable."); });
    return () => controller.abort();
  }, [documentId, page, revision]);

  async function send() {
    if (!file) { setMessage("Choose a file first."); return; }
    const metadata = staged.current?.file === file ? staged.current.metadata : { documentId, filename: file.name, revisionNote: note, status, sentDate, signedDate };
    const parsed = documentUploadMetadata.safeParse(metadata);
    if (!parsed.success) { setMessage(parsed.error.issues.map(issue => issue.message).join(" ")); return; }
    if (!file.size || file.size > documentFileMaxBytes || !documentFileType(file.name)) { setMessage("Choose a supported file between 1 byte and 20 MB."); return; }
    setBusy(true); onBusy(true); setMessage("Uploading private document…");
    try {
      if (staged.current?.file !== file) {
        const session = await getSession();
        const user = session?.user as { id?: string; role?: string } | undefined;
        if (!user?.id || user.role !== "OWNER") throw new Error("Sign in with the owner account before uploading.");
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-140);
        const blob = await upload(`business-documents/${documentId}/${user.id}/${crypto.randomUUID()}/${safeName}`, file, { access: "private", handleUploadUrl: "/api/admin/business/document-upload", contentType: documentFileType(file.name), multipart: file.size > 4 * 1024 * 1024, clientPayload: JSON.stringify(parsed.data), onUploadProgress: ({ percentage }) => setMessage(`Uploading private document… ${Math.round(percentage)}%`) });
        staged.current = { file, pathname: blob.pathname, metadata: parsed.data }; setHasStaged(true);
      }
      const result = await readDocumentResponse(await fetch("/api/admin/business/document-upload/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...staged.current.metadata, pathname: staged.current.pathname }) }));
      if (!result.file?.id || !result.document || typeof result.document.version !== "number") throw new Error("The attachment could not be confirmed. Retry without reselecting the file.");
      onAttached(result.document);
      setPage(1); setRevision(n => n + 1); setFile(null); setNote(""); staged.current = null; setHasStaged(false);
      if (picker.current) picker.current.value = "";
      setMessage(`Version ${result.file.revision} saved privately. Earlier versions are retained.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The upload failed. Please retry."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <section className="business-file-library" aria-labelledby={`files-heading-${documentId}`}>
    <div className="business-panel-heading"><div><h3 id={`files-heading-${documentId}`}>Files & version history</h3><p>Each upload creates a new version. Earlier files remain available. Files stay private to the owner.</p></div><span className="business-count">{history.total}</span></div>
    {historyError ? <p role="alert" className="business-file-message">{historyError}</p> : history.files.length ? <ol className="business-file-history">{history.files.map((item, i) => <li key={item.id}><div><strong>Version {item.revision} {page === 1 && i === 0 ? "· Latest" : ""}</strong><span>{item.filename} · {(item.size / 1024 / 1024).toFixed(2)} MB · {label(item.status)}</span><p>{item.revisionNote}</p><small>Uploaded {new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))} Central{item.sentDate ? ` · Sent ${item.sentDate}` : ""}{item.signedDate ? ` · Signed ${item.signedDate}` : ""}</small></div><a download className="business-button-secondary" href={`/api/admin/business/files/${encodeURIComponent(item.id)}`}><Download size={14} /> Download</a></li>)}</ol> : <p className="business-empty-copy">No files yet. Upload the proposal, agreement, or other document you created externally.</p>}
    {history.pages > 1 && <nav className="business-pagination" aria-label="File history pages"><button type="button" disabled={page <= 1 || busy} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {history.pages}</span><button type="button" disabled={page >= history.pages || busy} onClick={() => setPage(p => p + 1)}>Next</button></nav>}
    <fieldset disabled={disabled || busy} className="business-form-grid business-file-upload"><legend>Upload a file / new version</legend>
      <label className="business-field business-field-wide"><span>Choose document *</span><input ref={picker} type="file" accept={documentFileAccept} onChange={event => { const chosen = event.target.files?.[0] ?? null; staged.current = null; setHasStaged(false); if (chosen && (!documentFileType(chosen.name) || chosen.size > documentFileMaxBytes || !chosen.size)) { event.target.value = ""; setFile(null); setMessage("Use PDF, DOCX, XLSX, PPTX, PNG, JPEG, TXT, CSV, Markdown, or EML, up to 20 MB."); } else { setFile(chosen); setMessage(""); } }} /><small>PDF, DOCX, XLSX, PPTX, PNG, JPEG, TXT, CSV, Markdown, or saved email (.eml). Up to 20 MB per file.</small></label>
      <label className="business-field business-field-wide"><span>Version description *</span><input className="business-input" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="For example: Revised proposal with the approved scope" /></label>
      <label className="business-field"><span>This version's status</span><select className="business-input" value={status} onChange={e => setStatus(e.target.value as FileMetadata["status"])}>{["DRAFT", "SHARED", "APPROVED", "SIGNED"].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></label>
      <label className="business-field"><span>Date sent externally</span><input className="business-input" type="date" value={sentDate} onChange={e => setSentDate(e.target.value)} /></label>
      {status === "SIGNED" && <label className="business-field"><span>Date signed externally *</span><input className="business-input" type="date" value={signedDate} onChange={e => setSignedDate(e.target.value)} /></label>}
      <div className="business-field-wide"><p className="business-context">The selected status/dates will update the document record. Uploading stores a private copy; it does not send, share, or sign anything.</p><button className="business-button-secondary" type="button" disabled={!file || note.trim().length < 2 || busy || disabled} onClick={send}><Upload size={15} /> {busy ? "Uploading…" : hasStaged ? "Retry attachment" : "Upload private file"}</button></div>
    </fieldset>
    {message && <p role="status" aria-live="polite" className="business-file-message">{message}</p>}
  </section>;
}
