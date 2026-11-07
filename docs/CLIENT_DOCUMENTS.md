# Keep a client document record

Use **Admin → Business Operations → Clients & prospects → ACME → Open this client's documents**. You can also open **Documents** and choose ACME in the client filter.

## Example: proposal, agreement, and a later change

1. Choose **Add document**. Select ACME, give it a title such as "ACME website proposal", choose Proposal and the Proposals category, and save. Notes are optional. New records start as Draft.
2. Open that saved record. Under **Files & version history**, choose your externally prepared PDF or Word document, add a description such as "Original proposal sent by email", select Shared, and enter the actual date sent. Click **Upload private file**.
3. If the proposal changes, open this same record and upload the revised file. It becomes Version 2. Version 1 remains downloadable with its original details.
4. For the signed services agreement, create a **separate ACME document** titled "ACME signed services agreement", with type Agreement and category Agreements. Save as Draft, reopen, upload the signed file, select Signed, and enter the signature date. The record's status/date update with that file.
5. Add later documents as separate records: a change request, invoice copy, project update, saved email, acceptance evidence, or handover. Link a record to the relevant engagement when useful.
6. Use the client/category/status filters and search to find records. Open a record to download its current file or any earlier version. File-history paging preserves access to older uploads.

A version is another file for the **same document**. A different document gets its **own record**, while remaining linked to ACME. There is no need to register ACME again.

## Details worth recording

- A clear document title and type.
- The client and, when applicable, engagement.
- Category: Proposals, Agreements, Finance, Delivery, Correspondence, or General.
- Overall status and actual dates sent/signed externally.
- Notes explaining the purpose or related conversation.
- For every file version: what changed, its status, and its actual sent/signed dates.

Save edits to the document details before starting a file upload. Uploading a new version updates the overall record to the version's selected status/dates; earlier file versions keep their history.

## File support and privacy

PDF, DOCX, XLSX, PPTX, PNG/JPEG, TXT, CSV, Markdown, and EML are supported, up to 20 MB per file. Use EML for an exported email, or PDF for an externally saved correspondence record. Downloads return the original file, not a regenerated version.

Files remain private to owner accounts. They are separate from the public website's media library. Uploading is recordkeeping: it does not email the client, share a public link, obtain signatures, or change a file you already sent.

## Activation

Apply the core business-operations migration and the client-document-files migration through the intended environment's release process, and configure private Vercel Blob storage using the server-side storage token. No production migration or real storage upload was performed while implementing this feature.
