CREATE TYPE "PaymentRequestEventType" AS ENUM ('CRIADA', 'INFO_SOLICITADA', 'INFO_RESPONDIDA', 'APROVADA', 'REPROVADA', 'CANCELADA');

ALTER TABLE "PaymentRequest" ADD COLUMN "requiresOwnerApproval" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "PaymentRequest_requiresOwnerApproval_status_createdAt_idx" ON "PaymentRequest"("requiresOwnerApproval", "status", "createdAt");

CREATE TABLE "PaymentRequestSettings" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "highValueThreshold" DECIMAL(14,2),
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentRequestSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentRequestSettings_singleton" CHECK ("id" = 'singleton'),
  CONSTRAINT "PaymentRequestSettings_threshold_nonnegative" CHECK ("highValueThreshold" >= 0),
  CONSTRAINT "PaymentRequestSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- A linha existe desde a migração para coordenar criação/decisão e troca de designados.
INSERT INTO "PaymentRequestSettings" ("id", "updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP);

CREATE TABLE "HighValueApprover" (
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HighValueApprover_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "HighValueApprover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PaymentRequestEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "type" "PaymentRequestEventType" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRequestEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PaymentRequestEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PaymentRequestEvent_requestId_createdAt_idx" ON "PaymentRequestEvent"("requestId", "createdAt");

-- A criação das solicitações anteriores também é um fato conhecido do histórico.
INSERT INTO "PaymentRequestEvent" ("id", "requestId", "actorId", "type", "createdAt")
SELECT 'legacy-created-' || "id", "id", "requestedById", 'CRIADA', "createdAt" FROM "PaymentRequest";
