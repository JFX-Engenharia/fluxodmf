-- Obras podem exigir aprovação de mais de um gestor: TODOS os indicados precisam aprovar.
CREATE TABLE "WorkApprover" (
  "workId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "WorkApprover_pkey" PRIMARY KEY ("workId", "userId"),
  CONSTRAINT "WorkApprover_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkApprover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorkApprover_userId_idx" ON "WorkApprover"("userId");

INSERT INTO "WorkApprover" ("workId", "userId")
SELECT "id", "responsibleUserId" FROM "Work" WHERE "responsibleUserId" IS NOT NULL;

-- Progresso por solicitação: um slot por aprovador exigido, congelado na criação da solicitação.
CREATE TABLE "PaymentRequestApproval" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "approverId" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRequestApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentRequestApproval_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PaymentRequestApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PaymentRequestApproval_requestId_approverId_key" ON "PaymentRequestApproval"("requestId", "approverId");
CREATE INDEX "PaymentRequestApproval_approverId_approvedAt_idx" ON "PaymentRequestApproval"("approverId", "approvedAt");

-- Solicitações pendentes ganham slots dos aprovadores atuais da obra.
INSERT INTO "PaymentRequestApproval" ("id", "requestId", "approverId")
SELECT gen_random_uuid()::text, pr."id", wa."userId"
FROM "PaymentRequest" pr JOIN "WorkApprover" wa ON wa."workId" = pr."workId"
WHERE pr."status" = 'PENDENTE';

ALTER TABLE "Work" DROP CONSTRAINT "Work_responsibleUserId_fkey";
ALTER TABLE "Work" DROP COLUMN "responsibleUserId";
