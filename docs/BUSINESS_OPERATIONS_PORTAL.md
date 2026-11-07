# Business operations portal

Open **Admin → Business Operations** (`/admin/business`) with an OWNER account. Website editors and viewers cannot read or mutate business records. The billing name starts as **Efosa Ojomo Technology Services**; it is a proposed identity until you complete registration. Set your actual billing identity under Business setup.

## What to do first

1. Open Business setup, save your billing identity, and add the handbook setup checklist. Existing checklist progress survives repeated initialization.
2. Add a prospect under Clients & prospects, or import an existing website inquiry. Imports preserve the original lead and status, and cannot import the same lead twice.
3. Record a next action and follow-up date. Today shows due follow-ups and tasks, plus upcoming monthly-care reviews.
4. Create an engagement: choose the client, service playbook, scope, exclusions, acceptance checks, fee, inputs, and dates. A new engagement creates its service-specific delivery tasks.
5. Prepare a proposal or SOW worksheet in Documents. Finish legal review and signing externally, then record the signed agreement URL/date and payment evidence (or agreed payment exception) in the engagement. Ready/Active requires these records and acceptance checks; Complete requires an acceptance date.
6. Create a draft invoice. Check billing details, amount, due date, and sales tax with your accountant's instructions. Preview/print or save as PDF; issue/share it through your billing process, then mark the record Issued. Issuing inside this portal does not send email.
7. After confirming a real external payment, choose Record transaction. Record the gross amount, processor fee, date, and unique bank/provider reference. Partial, paid, and overdue status derive from the ledger. Refunds record money already refunded externally. A record is not a bank transaction.
8. Work through Tasks and record Time log entries. Monthly care shows current calendar-month minutes against the agreed capacity. Keep rollover, service-hour, response, and cancellation terms explicit.
9. Record expenses and private receipt links. Export invoices, payment transactions, and expenses to your accountant; reconcile fees separately and avoid counting processor payouts as additional income.
10. Record acceptance, prepare the handover document, and schedule a client follow-up. Renewals, client reminders, recurring tasks/invoices, and charges are manual.

## Included features

- Today: all-time issued invoice balances; month-to-date external payments less refunds (including collected tax, before fees); expense/processor-fee figures; active engagements, due tasks/follow-ups, care reviews, and logged time.
- Searchable, paginated contacts, engagements, tasks, invoices, expenses, time entries, and documents (25 records/page).
- Eight service playbooks spanning the handbook's service families, plus monthly-care fields and time utilization.
- Plain-text editable worksheets for proposals, SOW preparation, changes, weekly updates, handovers, and notes. Printable documents escape user content through React.
- Printable invoice summaries, immutable issued billing details/amounts, append-only payment/refund history, duplicate-reference checks, and serializable transactions to prevent concurrent overpayment/refund.
- Version checks reject stale saves rather than overwriting another edit. Audits are stored in the same transaction as mutations.
- Full-record CSV exports in bounded streaming batches; formula-looking input is neutralized for spreadsheet safety. Exports include all records of a type, regardless of page/search. Financial values are integer USD cents; invoice CSV does not embed payment rows, which have their own export.
- No example records are created in your configured database. Demo/unavailable databases show explicit read-only states.

Client/engagement selectors show the 500 most recently updated records; existing selected relationships are retained. Inquiry import shows the 50 most recent unimported leads. Lists and exports do not share those selector limits. Client files can be uploaded through the document library into private Vercel Blob storage; external HTTPS references are also supported. Uploaded business files use a separate owner-only download route and do not enter the website media library. Do not store passwords in document notes.

This is an owner operations ledger, not full double-entry accounting, a tax engine, an e-signature service, a client-facing login, or an automated payment provider. It does not calculate tax liability, file returns, send client communications, charge cards, or initiate refunds. Obtain your offer-specific Texas tax treatment separately. Calendar-month care utilization does not calculate contractual rollover or prorated billing cycles.

## Database activation

The core additive migration is `prisma/migrations/20261107120000_business_operations/migration.sql`. Client file uploads additionally require `prisma/migrations/20261107170000_client_document_files/migration.sql`, which adds categories/sent/signed dates and the ninth business table, `BusinessDocumentFile`. It creates eight business tables and a nullable Lead relation; existing CMS data is preserved. Financial/capacity checks supplement application validation. The migration does not seed real clients or update existing content.

Generate the client as part of the normal build (`npm run build`). Apply the migration to the intended environment through your normal database release process before accepting records. Do not use `db push --accept-data-loss` on an existing environment. Review migration history first: the repository's older foundation migration may not describe all existing CMS tables, so an unbaselined database needs migration-history reconciliation before a blanket `prisma migrate deploy`.

No migration was applied to the configured application/production database during implementation. The new migration was applied successfully to a disposable localhost PostgreSQL database initialized from the prior schema, then verified using real Prisma transactions.

## Validation and local smoke check

Run `npm run lint`, `npm test`, `npm run build`, and `git diff --check`.

For integration testing, provision an isolated **local** PostgreSQL database named `portfolio_business_test`, apply the schema/migration, and run:

```sh
BUSINESS_TEST_DATABASE_URL='postgresql://LOCAL_TEST_USER@127.0.0.1:55439/portfolio_business_test' node scripts/smoke-business.mjs
```

The script refuses remote hosts and other database names. It creates synthetic contacts, engagements, invoice/payment/refund records, tasks, time, expenses, and documents only in that disposable database. It verifies inquiry deduplication, kickoff boundaries, client relationships, stale edits, immutable invoices, serializable payment/refund limits, checklist idempotency, care utilization, dashboard balances, and audit records. It also creates a local test owner for browser review. Never use its credentials or fixtures in a real business environment.

### Verification performed

Lint, TypeScript/production build, unit/UI tests, real PostgreSQL workflow smoke checks, and authenticated HTTP checks were run. HTTP checks cover all ten workspace pages, all eight CSV exports, unauthenticated redirects, viewer denial, and private/noindex headers.

Desktop Chrome review confirmed the dashboard, contact creation/persistence, invoice balances, and document preview. The initial browser print preview exposed an admin-layout pagination problem; printing was moved to a separate document-level portal and its isolation/escaping is covered by a UI test. The final native print pagination could not be visually rechecked because the computer-use connection lost the Chrome window after closing print preview. Mobile layouts have responsive styles but did not receive a device/browser visual pass. Check these two presentation details in staging before release.

The HTTP smoke check can be repeated against the isolated local preview on port 3105 using `scripts/smoke-business-http.mjs` and the same `BUSINESS_TEST_DATABASE_URL`. Its synthetic session fixtures are specific to the temporary test preview; never configure them in a real environment.

## Client document library

From a client record, use **Open this client's documents** or **Add a client document**. The document list can be filtered by client, category, status, and search, with filters preserved across pages. Categories cover proposals, agreements, finance, delivery, correspondence, and general records.

Create a record with a title and type, save it, and reopen it to upload. Text content is optional for externally prepared files. Upload PDF, DOCX, XLSX, PPTX, PNG/JPEG, TXT, CSV, Markdown, or saved email (EML), up to 20 MB per file. File bytes upload directly to private storage; function requests carry only bounded metadata. Set the version description, status, and actual sent/signed dates. A new upload creates an immutable numbered file version and updates the record's status/dates. Earlier versions retain their own filename, status, dates, description, and upload time. File history is paginated in groups of ten. Adding a different document, such as a signed agreement after a proposal, means creating a new record for the same client; revising the proposal means uploading a new version to its existing record.

Save any metadata edits before uploading. After attachment, the editor reloads the current saved document/version to retain stale-edit protection. Signed file versions can serve as evidence for the document's Signed status; a signed record with only an external link still works. Client associations cannot be changed on an existing document.

Private downloads require the owner's current session/role, use attachment disposition, no-store/noindex headers, and nosniff/sandbox protections. Files are not exposed through public media routes or to website editors/viewers. Callback and browser completion registration are idempotent and retry serializable conflicts, so retries do not create duplicate versions. No file deletion or automatic customer sharing/signing is implemented.

Both database migrations and a configured private Vercel Blob store are required in the intended environment. The document-files migration and registration/version workflow were tested on isolated localhost PostgreSQL with mocked Blob metadata. Actual cloud upload/download credentials, signed provider callbacks, and a live production file transfer were not exercised. No client files were uploaded to your configured storage during implementation.

## A connected database can still need a schema update

Database configuration and file-storage configuration do not create the business tables. `npm run build` generates Prisma Client but does not apply migrations. Run the pending migrations against the database used by the intended environment, not a different local `.env` database.

The workspace distinguishes missing tables/columns (Prisma P2021/P2022) from database-connection failures. Server diagnostics log only a stable error code; connection strings and provider errors are not returned to the browser.

For a controlled release, `scripts/check-business-schema.mjs` reports table/migration metadata without customer data. `--require-business` additionally verifies all nine model queries. If production database credentials are sensitive/write-only in Vercel, execute migrations inside the verified production project's build environment instead of exporting secrets. A one-time build command can run `npx prisma generate && node scripts/check-business-schema.mjs && npm run db:migrate && node scripts/check-business-schema.mjs --require-business && npm run build`. Review existing migration history before enabling this command; if the database is unbaselined or has failed migrations, stop and reconcile history first. Do not reset the database or use `db push --accept-data-loss`.
