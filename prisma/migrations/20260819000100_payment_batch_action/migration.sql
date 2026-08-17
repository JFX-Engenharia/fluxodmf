-- Job de acao em lote sobre pagamentos, processado em segundo plano.
--
-- Ate aqui o lote era N requisicoes HTTP em serie, uma por pagamento, cada uma
-- refazendo autenticacao, checagem de manutencao, idempotencia e leitura das
-- regras de aprovacao. Com 50 a 200 pagamentos por fluxo diario, isso dava 30 a
-- 90 segundos de espera com a tela travada.
--
-- O estado do job mora aqui, e nao em memoria, pelo mesmo motivo do ImportBatch:
-- para ser retomavel se o processo cair no meio, e para a UI acompanhar por
-- polling mesmo depois de a aba ser fechada.
CREATE TABLE "PaymentBatchAction" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "standardReasonId" TEXT,
    "newDueDate" TIMESTAMP(3),
    -- Array JSON dos ids alvo, mesma convencao de ImportBatch.payload.
    "paymentIds" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDENTE',
    "totalCount" INTEGER NOT NULL,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    -- Resultado POR ITEM. Falha parcial e requisito: a alcada depende do valor
    -- de cada pagamento, entao um lote heterogeneo aprova uns e recusa outros
    -- legitimamente. Tambem e o que permite retomar sem reaplicar o que ja foi
    -- feito — reaplicar criaria PaymentAction duplicado no historico.
    "results" TEXT NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentBatchAction_pkey" PRIMARY KEY ("id")
);

-- Historico do proprio usuario, que e como a UI lista os lotes recentes.
CREATE INDEX "PaymentBatchAction_actorId_createdAt_idx" ON "PaymentBatchAction"("actorId", "createdAt");

-- Serve ao claim atomico do worker e a auto-cura que re-dispara job PENDENTE
-- parado, no mesmo molde de /api/imports/tasks.
CREATE INDEX "PaymentBatchAction_status_createdAt_idx" ON "PaymentBatchAction"("status", "createdAt");

ALTER TABLE "PaymentBatchAction" ADD CONSTRAINT "PaymentBatchAction_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
