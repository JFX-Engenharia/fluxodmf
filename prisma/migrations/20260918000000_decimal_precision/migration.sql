-- Nada e arredondado silenciosamente. O lock impede escritas entre a
-- verificacao e a conversao; toda a mudanca e atomica.
BEGIN;
LOCK TABLE "Contribution", "Payment", "ApprovalRule", "PaymentAllocation", "Advance", "PaymentRequest", "AllocationRuleSplit" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  incompatible RECORD;
BEGIN
  FOR incompatible IN
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
  LOOP
    RAISE EXCEPTION 'Precisao decimal incompativel em %.%: % registro(s).',
      incompatible.table_name, incompatible.column_name, incompatible.incompatible_rows
      USING HINT = 'Execute scripts/check-decimal-precision.sql e revise os valores antes do deploy.';
  END LOOP;
END $$;

ALTER TABLE "Contribution" ALTER COLUMN "amount" TYPE DECIMAL(14, 2);
ALTER TABLE "Payment" ALTER COLUMN "amount" TYPE DECIMAL(14, 2);
ALTER TABLE "ApprovalRule" ALTER COLUMN "minAmount" TYPE DECIMAL(14, 2);
ALTER TABLE "ApprovalRule" ALTER COLUMN "maxAmount" TYPE DECIMAL(14, 2);
ALTER TABLE "PaymentAllocation" ALTER COLUMN "amount" TYPE DECIMAL(14, 2);
ALTER TABLE "Advance" ALTER COLUMN "amount" TYPE DECIMAL(14, 2);
ALTER TABLE "Advance" ALTER COLUMN "spentAmount" TYPE DECIMAL(14, 2);
ALTER TABLE "Advance" ALTER COLUMN "returnedAmount" TYPE DECIMAL(14, 2);
ALTER TABLE "PaymentRequest" ALTER COLUMN "amount" TYPE DECIMAL(14, 2);
ALTER TABLE "AllocationRuleSplit" ALTER COLUMN "percentage" TYPE DECIMAL(7, 4);
ALTER TABLE "PaymentAllocation" ALTER COLUMN "percentage" TYPE DECIMAL(7, 4);

COMMIT;
