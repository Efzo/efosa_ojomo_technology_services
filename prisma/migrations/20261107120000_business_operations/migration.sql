-- CreateTable
CREATE TABLE "BusinessClient" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "leadId" TEXT,
    "company" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "billingAddress" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PROSPECT',
    "source" TEXT NOT NULL DEFAULT '',
    "nextAction" TEXT NOT NULL DEFAULT '',
    "followUpDate" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessEngagement" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PROJECT',
    "status" TEXT NOT NULL DEFAULT 'PROPOSAL',
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "scope" TEXT NOT NULL DEFAULT '',
    "exclusions" TEXT NOT NULL DEFAULT '',
    "acceptance" TEXT NOT NULL DEFAULT '',
    "clientInputs" TEXT NOT NULL DEFAULT '',
    "agreementUrl" TEXT NOT NULL DEFAULT '',
    "signedDate" TEXT NOT NULL DEFAULT '',
    "initialPaymentReference" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT NOT NULL DEFAULT '',
    "dueDate" TEXT NOT NULL DEFAULT '',
    "acceptedDate" TEXT NOT NULL DEFAULT '',
    "renewalDate" TEXT NOT NULL DEFAULT '',
    "monthlyMinutes" INTEGER NOT NULL DEFAULT 0,
    "coverage" TEXT NOT NULL DEFAULT '',
    "serviceHours" TEXT NOT NULL DEFAULT '',
    "responseTarget" TEXT NOT NULL DEFAULT '',
    "rolloverTerms" TEXT NOT NULL DEFAULT '',
    "cancellationTerms" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessTask" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "seedKey" TEXT,
    "engagementId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "category" TEXT NOT NULL DEFAULT 'DELIVERY',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "dueDate" TEXT NOT NULL DEFAULT '',
    "owner" TEXT NOT NULL DEFAULT 'Efosa Ojomo',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessInvoice" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "clientId" TEXT NOT NULL,
    "engagementId" TEXT,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "description" TEXT NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "billedTo" TEXT NOT NULL,
    "billingEmail" TEXT NOT NULL,
    "billingAddress" TEXT NOT NULL DEFAULT '',
    "issueDate" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "paymentUrl" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessPayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PAYMENT',
    "amountCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "date" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessExpense" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "vendor" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "receiptUrl" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessTimeEntry" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "engagementId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessDocument" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "clientId" TEXT NOT NULL,
    "engagementId" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "externalUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessClient_leadId_key" ON "BusinessClient"("leadId");

-- CreateIndex
CREATE INDEX "BusinessClient_status_followUpDate_idx" ON "BusinessClient"("status", "followUpDate");

-- CreateIndex
CREATE INDEX "BusinessEngagement_status_dueDate_idx" ON "BusinessEngagement"("status", "dueDate");

-- CreateIndex
CREATE INDEX "BusinessEngagement_clientId_idx" ON "BusinessEngagement"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessTask_seedKey_key" ON "BusinessTask"("seedKey");

-- CreateIndex
CREATE INDEX "BusinessTask_status_dueDate_idx" ON "BusinessTask"("status", "dueDate");

-- CreateIndex
CREATE INDEX "BusinessTask_engagementId_idx" ON "BusinessTask"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInvoice_number_key" ON "BusinessInvoice"("number");

-- CreateIndex
CREATE INDEX "BusinessInvoice_status_dueDate_idx" ON "BusinessInvoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "BusinessInvoice_clientId_idx" ON "BusinessInvoice"("clientId");

-- CreateIndex
CREATE INDEX "BusinessInvoice_engagementId_idx" ON "BusinessInvoice"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPayment_reference_key" ON "BusinessPayment"("reference");

-- CreateIndex
CREATE INDEX "BusinessPayment_invoiceId_idx" ON "BusinessPayment"("invoiceId");

-- CreateIndex
CREATE INDEX "BusinessPayment_date_idx" ON "BusinessPayment"("date");

-- CreateIndex
CREATE INDEX "BusinessExpense_date_idx" ON "BusinessExpense"("date");

-- CreateIndex
CREATE INDEX "BusinessTimeEntry_engagementId_date_idx" ON "BusinessTimeEntry"("engagementId", "date");

-- CreateIndex
CREATE INDEX "BusinessDocument_clientId_idx" ON "BusinessDocument"("clientId");

-- CreateIndex
CREATE INDEX "BusinessDocument_engagementId_idx" ON "BusinessDocument"("engagementId");

-- AddForeignKey
ALTER TABLE "BusinessClient" ADD CONSTRAINT "BusinessClient_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessEngagement" ADD CONSTRAINT "BusinessEngagement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "BusinessClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessTask" ADD CONSTRAINT "BusinessTask_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "BusinessEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessInvoice" ADD CONSTRAINT "BusinessInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "BusinessClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessInvoice" ADD CONSTRAINT "BusinessInvoice_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "BusinessEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessPayment" ADD CONSTRAINT "BusinessPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "BusinessInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessTimeEntry" ADD CONSTRAINT "BusinessTimeEntry_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "BusinessEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDocument" ADD CONSTRAINT "BusinessDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "BusinessClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDocument" ADD CONSTRAINT "BusinessDocument_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "BusinessEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve financial invariants even for direct database writes.
ALTER TABLE "BusinessInvoice" ADD CONSTRAINT "BusinessInvoice_nonnegative_amounts" CHECK ("subtotalCents" > 0 AND "taxCents" >= 0);
ALTER TABLE "BusinessPayment" ADD CONSTRAINT "BusinessPayment_positive_amounts" CHECK ("amountCents" > 0 AND "feeCents" >= 0 AND "feeCents" <= "amountCents");
ALTER TABLE "BusinessPayment" ADD CONSTRAINT "BusinessPayment_valid_kind" CHECK ("kind" IN ('PAYMENT', 'REFUND'));
ALTER TABLE "BusinessExpense" ADD CONSTRAINT "BusinessExpense_positive_amount" CHECK ("amountCents" > 0);
ALTER TABLE "BusinessTimeEntry" ADD CONSTRAINT "BusinessTimeEntry_valid_minutes" CHECK ("minutes" BETWEEN 1 AND 1440);
ALTER TABLE "BusinessEngagement" ADD CONSTRAINT "BusinessEngagement_nonnegative_capacity" CHECK ("feeCents" >= 0 AND "monthlyMinutes" BETWEEN 0 AND 44640);
