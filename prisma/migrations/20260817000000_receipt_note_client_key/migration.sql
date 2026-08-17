-- Vinculo entre a foto na fila offline do PWA e a linha gravada aqui: guarda o
-- UUID que o cliente gerou na captura, o mesmo valor que chega no cabecalho
-- Idempotency-Key. Sem ele o app nao casa o que enviou com o que a listagem
-- devolve e mostra a mesma nota duas vezes.
--
-- Nullable porque as notas ja gravadas nao tem esse valor e nao ha de onde
-- deduzi-lo; o cliente trata nulo como "sem par local". Por isso tambem nao ha
-- backfill nem NOT NULL: a coluna nasce vazia no que ja existe.
ALTER TABLE "ReceiptNote" ADD COLUMN "clientKey" TEXT;

-- Segunda linha de defesa contra duplicata, alem da idempotencia da API. No
-- Postgres um indice UNIQUE aceita varios NULL, entao as notas antigas (todas
-- com clientKey nulo) convivem sem conflito.
CREATE UNIQUE INDEX "ReceiptNote_clientKey_key" ON "ReceiptNote"("clientKey");
