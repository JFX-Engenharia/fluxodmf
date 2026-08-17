-- Novo perfil de acesso do colaborador de campo.
-- ATENCAO: o Postgres nao deixa usar um valor de enum recem-adicionado na mesma
-- transacao em que ele foi criado. Por isso nada aqui referencia 'COLABORADOR'
-- (nenhum INSERT, UPDATE ou DEFAULT) — as contas sao criadas pelo admin depois.
ALTER TYPE "Role" ADD VALUE 'COLABORADOR';

-- CONFERIDA ja nasce no enum, reservada para a triagem futura no painel.
CREATE TYPE "ReceiptNoteStatus" AS ENUM ('ENVIADA', 'CONFERIDA');

CREATE TABLE "ReceiptNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "status" "ReceiptNoteStatus" NOT NULL DEFAULT 'ENVIADA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReceiptNote_userId_createdAt_idx" ON "ReceiptNote"("userId", "createdAt");
CREATE INDEX "ReceiptNote_createdAt_idx" ON "ReceiptNote"("createdAt");

-- Sem ON DELETE CASCADE: a nota e documento de auditoria e sobrevive a exclusao
-- da conta, que reatribui as notas ao usuario-sentinel.
ALTER TABLE "ReceiptNote" ADD CONSTRAINT "ReceiptNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
