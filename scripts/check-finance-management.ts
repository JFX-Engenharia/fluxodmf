import assert from "node:assert/strict";
import { Role } from "../generated/prisma/enums";
import {
  allocationRows,
  chooseAllocationRule,
  chooseApprovalRule,
  roleAtLeast,
} from "../src/lib/finance-management";

const payment = {
  amount: 7500,
  workId: "obra-a",
  category: "Materiais",
  tags: [{ tagId: "extra" }],
};
const rule = chooseApprovalRule(payment, [
  { id: "value", minAmount: 5000.01, maxAmount: null, workId: null, category: null, tagId: null, requiredRole: Role.APROVADOR, requiredApprovals: 1, preventSelfApproval: true, priority: 20 },
  { id: "extra", minAmount: 0, maxAmount: null, workId: null, category: null, tagId: "extra", requiredRole: Role.APROVADOR, requiredApprovals: 2, preventSelfApproval: true, priority: 100 },
]);
assert.equal(rule?.id, "extra", "a tag extraordinária deve prevalecer pela prioridade");
assert.equal(rule?.requiredApprovals, 2);
assert.equal(roleAtLeast(Role.APROVADOR, Role.GESTOR), true);
assert.equal(roleAtLeast(Role.GESTOR, Role.APROVADOR), false);
assert.equal(roleAtLeast(Role.ADMINISTRADOR, Role.APROVADOR), true);

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
