-- Indice para o filtro por periodo das notas de colaborador, na aba da gestao e
-- no PWA. O filtro e por capturedAt, e nao por createdAt, porque o que interessa
-- e quando a compra aconteceu: a foto pode ficar dias na fila offline antes de
-- chegar ao servidor, entao createdAt contaria a nota no mes errado.
--
-- Os indices que ja existiam cobrem createdAt (usado na ordenacao e no cursor),
-- nao capturedAt. Sem este, filtrar periodo vira seq scan na tabela que guarda
-- as fotos — a maior do banco, porque a imagem mora na propria linha.
CREATE INDEX "ReceiptNote_userId_capturedAt_idx" ON "ReceiptNote"("userId", "capturedAt");
