import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";

const { Client } = pg;
const databaseName = `fluxo_codex_test_${Date.now()}`;
if (!/^fluxo_codex_test_\d+$/.test(databaseName)) throw new Error("Nome temporário inválido.");

const sourceUrl = new URL(process.env.DATABASE_URL);
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl.toString() });
let adminConnected = false;

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: "inherit",
  });

  const test = new Client({ connectionString: testUrl.toString() });
  await test.connect();
  try {
    const result = await test.query(`
      SELECT
        (SELECT COUNT(*)::int FROM "ApprovalRule") AS rules,
        (SELECT COUNT(*)::int FROM "Tag") AS tags,
        (SELECT COUNT(*)::int FROM "StandardReason") AS reasons
    `);
    if (result.rows[0].rules < 3 || result.rows[0].tags < 7 || result.rows[0].reasons < 8) {
      throw new Error("A migração não criou a configuração financeira inicial esperada.");
    }
    const expected = [
      ["Contribution", "amount", 14, 2], ["Payment", "amount", 14, 2],
      ["ApprovalRule", "minAmount", 14, 2], ["ApprovalRule", "maxAmount", 14, 2],
      ["PaymentAllocation", "amount", 14, 2],
      ["Advance", "amount", 14, 2], ["Advance", "spentAmount", 14, 2], ["Advance", "returnedAmount", 14, 2],
      ["PaymentRequest", "amount", 14, 2],
      ["AllocationRuleSplit", "percentage", 7, 4], ["PaymentAllocation", "percentage", 7, 4],
    ];
    const columns = await test.query(`
      SELECT table_name, column_name, numeric_precision, numeric_scale
      FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'numeric'
    `);
    assert.deepEqual(columns.rows.map((row) => [row.table_name, row.column_name,
      row.numeric_precision, row.numeric_scale]).sort(), expected.sort());

    const preflight = readFileSync("scripts/check-decimal-precision.sql", "utf8");
    assert.equal((await test.query(preflight)).rowCount, 0);
    // Simula dados legados no banco temporario para exercitar o SQL real do deploy.
    await test.query(`
      ALTER TABLE "ApprovalRule" ALTER COLUMN "minAmount" TYPE DECIMAL(65, 30);
      ALTER TABLE "AllocationRuleSplit" ALTER COLUMN "percentage" TYPE DECIMAL(65, 30);
      INSERT INTO "Work" (id, name, slug, "updatedAt")
        VALUES ('precision-work', 'Precisao', 'precision-work', CURRENT_TIMESTAMP);
      INSERT INTO "AllocationRule" (id, name, "updatedAt")
        VALUES ('precision-rule', 'Precisao', CURRENT_TIMESTAMP);
      INSERT INTO "AllocationRuleSplit" (id, "ruleId", "workId", percentage)
        VALUES ('precision-split', 'precision-rule', 'precision-work', 50);
    `);
    const migration = readFileSync("prisma/migrations/20260918000000_decimal_precision/migration.sql", "utf8");
    for (const [table, column, id, value, reset] of [
      ["ApprovalRule", "minAmount", "default-up-to-5000", "1.001", "0"],
      ["ApprovalRule", "minAmount", "default-up-to-5000", "-1.001", "0"],
      ["ApprovalRule", "minAmount", "default-up-to-5000", "1000000000000", "0"],
      ["AllocationRuleSplit", "percentage", "precision-split", "50.00001", "50"],
      ["AllocationRuleSplit", "percentage", "precision-split", "1000", "50"],
    ]) {
      await test.query(`UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`, [value, id]);
      const violations = await test.query(preflight);
      assert.ok(violations.rows.some((row) => row.table_name === table && row.column_name === column));
      await assert.rejects(test.query(migration), /Precisao decimal incompativel/);
      await test.query("ROLLBACK");
      const unchanged = await test.query(`SELECT "${column}" = $1::numeric AS intact FROM "${table}" WHERE id = $2`, [value, id]);
      assert.equal(unchanged.rows[0].intact, true, "a migracao recusada nao pode arredondar dados");
      await test.query(`UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`, [reset, id]);
    }
    await test.query(migration);
    assert.equal((await test.query(preflight)).rowCount, 0);
    console.log("Precisao decimal validada: 11 colunas, escala, faixa e preservacao dos dados na recusa.");
    console.log("Migração financeira validada em PostgreSQL temporário.");
  } finally {
    await test.end();
  }
} finally {
  if (adminConnected) {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    ).catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}
