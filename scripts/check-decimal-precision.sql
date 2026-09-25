-- Somente leitura. Execute em producao ANTES do deploy e faca backup no Render.
-- Nenhuma linha retornada = todos os valores cabem nos novos tipos sem arredondar.
-- Esta e a mesma verificacao usada no bloco DO da migracao.
SELECT table_name, column_name, COUNT(*) AS incompatible_rows
FROM (
  SELECT 'Contribution' AS table_name, 'amount' AS column_name,
    "amount" AS value, 14 AS precision, 2 AS scale FROM "Contribution"
  UNION ALL
  SELECT 'Payment' AS table_name, 'amount' AS column_name,
    "amount" AS value, 14 AS precision, 2 AS scale FROM "Payment"
  UNION ALL
  SELECT 'ApprovalRule' AS table_name, 'minAmount' AS column_name,
    "minAmount" AS value, 14 AS precision, 2 AS scale FROM "ApprovalRule"
  UNION ALL
  SELECT 'ApprovalRule' AS table_name, 'maxAmount' AS column_name,
    "maxAmount" AS value, 14 AS precision, 2 AS scale FROM "ApprovalRule"
  UNION ALL
  SELECT 'PaymentAllocation' AS table_name, 'amount' AS column_name,
    "amount" AS value, 14 AS precision, 2 AS scale FROM "PaymentAllocation"
  UNION ALL
  SELECT 'Advance' AS table_name, 'amount' AS column_name,
    "amount" AS value, 14 AS precision, 2 AS scale FROM "Advance"
  UNION ALL
  SELECT 'Advance' AS table_name, 'spentAmount' AS column_name,
    "spentAmount" AS value, 14 AS precision, 2 AS scale FROM "Advance"
  UNION ALL
  SELECT 'Advance' AS table_name, 'returnedAmount' AS column_name,
    "returnedAmount" AS value, 14 AS precision, 2 AS scale FROM "Advance"
  UNION ALL
  SELECT 'PaymentRequest' AS table_name, 'amount' AS column_name,
    "amount" AS value, 14 AS precision, 2 AS scale FROM "PaymentRequest"
  UNION ALL
  SELECT 'AllocationRuleSplit' AS table_name, 'percentage' AS column_name,
    "percentage" AS value, 7 AS precision, 4 AS scale FROM "AllocationRuleSplit"
  UNION ALL
  SELECT 'PaymentAllocation' AS table_name, 'percentage' AS column_name,
    "percentage" AS value, 7 AS precision, 4 AS scale FROM "PaymentAllocation"
) AS checked_values
WHERE value <> round(value, scale)
   OR abs(value) >= power(10::numeric, precision - scale)
GROUP BY table_name, column_name
ORDER BY table_name, column_name;
