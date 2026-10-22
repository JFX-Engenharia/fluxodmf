import assert from "node:assert/strict";
import { Role } from "../generated/prisma/enums";
import { allocationRows, chooseAllocationRule } from "../src/lib/finance-management";
import { canApprovePayments } from "../src/lib/permissions";

// Sem alcada: a permissao de aprovar e por perfil, nao por valor.
assert.equal(canApprovePayments(Role.APROVADOR), true);
assert.equal(canApprovePayments(Role.ADMINISTRADOR), true);
assert.equal(canApprovePayments(Role.GESTOR), false);
assert.equal(canApprovePayments(Role.OPERADOR), false);
assert.equal(canApprovePayments(Role.COLABORADOR), false);

const allocationRule = chooseAllocationRule(
  { category: "Administrativo", supplierName: "Escritório Central" },
  [{ id: "dg-jr", category: "Administrativo", supplierPattern: "central", priority: 10, splits: [{ workId: "dg", percentage: 60 }, { workId: "jr", percentage: 40 }] }],
);
assert.equal(allocationRule?.id, "dg-jr");
const allocations = allocationRows(100.01, allocationRule!.splits);
assert.deepEqual(allocations.map((item) => item.amount), [60.01, 40]);
assert.equal(Number(allocations.reduce((sum, item) => sum + item.amount, 0).toFixed(2)), 100.01);
assert.throws(() => allocationRows(100, [{ workId: "dg", percentage: 70 }, { workId: "jr", percentage: 20 }]));

console.log("Regras financeiras validadas.");
