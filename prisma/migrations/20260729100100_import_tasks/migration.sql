-- Importação em segundo plano: o próprio ImportBatch vira a tarefa durável.
ALTER TYPE "ImportStatus" ADD VALUE 'PENDENTE';
ALTER TYPE "ImportStatus" ADD VALUE 'PROCESSANDO';

ALTER TABLE "ImportBatch"
  ADD COLUMN "sourceFileName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "flowName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "payload" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "processedRows" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "importedRows" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "importedContributions" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "createdAccounts" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "error" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "finishedAt" TIMESTAMP(3);
CREATE INDEX "ImportBatch_importedById_createdAt_idx" ON "ImportBatch"("importedById", "createdAt");
