-- AlterTable
ALTER TABLE "BusinessDocument" ADD COLUMN     "folder" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "sentDate" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "signedDate" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "BusinessDocumentFile" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "revisionNote" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sentDate" TEXT NOT NULL DEFAULT '',
    "signedDate" TEXT NOT NULL DEFAULT '',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessDocumentFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDocumentFile_storageKey_key" ON "BusinessDocumentFile"("storageKey");

-- CreateIndex
CREATE INDEX "BusinessDocumentFile_documentId_createdAt_idx" ON "BusinessDocumentFile"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDocumentFile_documentId_revision_key" ON "BusinessDocumentFile"("documentId", "revision");

-- CreateIndex
CREATE INDEX "BusinessDocument_clientId_folder_updatedAt_idx" ON "BusinessDocument"("clientId", "folder", "updatedAt");

-- AddForeignKey
ALTER TABLE "BusinessDocumentFile" ADD CONSTRAINT "BusinessDocumentFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BusinessDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- File versions are immutable records with bounded metadata.
ALTER TABLE "BusinessDocumentFile" ADD CONSTRAINT "BusinessDocumentFile_valid_size_revision" CHECK ("size" BETWEEN 1 AND 20971520 AND "revision" > 0);
