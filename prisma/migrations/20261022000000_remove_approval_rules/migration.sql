-- Fim da alcada nos pagamentos. Qualquer aprovador (ou administrador) aprova
-- qualquer pagamento com uma unica aprovacao; as regras por faixa de valor,
-- obra, categoria e tag deixam de existir. O bloqueio de autoaprovacao
-- continua, agora fixo no codigo.
--
-- O historico de quem aprovou fica em "PaymentApproval" (sem o vinculo com a
-- regra) e em "PaymentAction"; so a configuracao das regras e descartada.

ALTER TABLE "Payment" DROP CONSTRAINT "Payment_appliedApprovalRuleId_fkey";
ALTER TABLE "PaymentApproval" DROP CONSTRAINT "PaymentApproval_approvalRuleId_fkey";

ALTER TABLE "Payment"
DROP COLUMN "appliedApprovalRuleId",
DROP COLUMN "requiredApprovals",
DROP COLUMN "requiredApprovalRole";

ALTER TABLE "PaymentApproval" DROP COLUMN "approvalRuleId";

DROP TABLE "ApprovalRule";
