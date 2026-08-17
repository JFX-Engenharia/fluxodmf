-- Explicacao do que a planilha nao trouxe, gravada na propria compra. Ate aqui
-- a linha incompleta era descartada na importacao e sumia sem aviso; agora ela
-- entra com marcador, e o painel precisa dizer *por que* aquele pagamento esta
-- INDEFINIDO — a previa da importacao some assim que o lote e confirmado.
--
-- Guarda o CODIGO do campo (array JSON, ver src/lib/missing-info.ts) e nao a
-- frase pronta: a redacao e apresentacao e muda; o codigo do campo, nao.
--
-- NOT NULL com default '[]' porque as linhas ja gravadas tem significado
-- conhecido — entraram sob a regra antiga, que so aceitava linha completa —
-- entao '[]' e a verdade sobre elas, nao um "nao sei". Postgres 11+ adiciona
-- coluna com default constante sem reescrever a tabela: sem janela de lock.
ALTER TABLE "Payment" ADD COLUMN "missingInfo" TEXT NOT NULL DEFAULT '[]';

-- Conta-sentinela das compras sem centro de custo. Existe porque Payment.workId
-- e NOT NULL: sem uma conta para apontar, a compra nao teria como ser gravada.
--
-- Nasce INATIVA de proposito. Assim ela nao vira card no Dashboard
-- (dashboard/route.ts filtra active) nem entra no indicador de cobertura: uma
-- conta que nunca recebe aporte apareceria com saldo negativo e distorceria a
-- metrica central. Tambem nao e oferecida no seletor de rateio, e correto — o
-- rateio serve justamente para TIRAR a compra daqui.
--
-- ON CONFLICT porque alguem pode ja ter cadastrado uma obra "INDEFINIDO" a mao
-- (Work.slug e UNIQUE), e a migration nao pode falhar por causa disso.
INSERT INTO "Work" ("id", "name", "slug", "costCenterAliases", "active", "createdAt", "updatedAt")
VALUES (
  'work-indefinido',
  'INDEFINIDO',
  'indefinido',
  '["INDEFINIDO","SEM CENTRO DE CUSTO","NAO INFORMADO"]',
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;
