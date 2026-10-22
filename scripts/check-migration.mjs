import "dotenv/config";
import { execFileSync } from "node:child_process";
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
  const result = await test.query(`
    SELECT
      (SELECT COUNT(*)::int FROM "Tag") AS tags,
      (SELECT COUNT(*)::int FROM "StandardReason") AS reasons
  `);
  await test.end();
  if (result.rows[0].tags < 7 || result.rows[0].reasons < 8) {
    throw new Error("A migração não criou a configuração financeira inicial esperada.");
  }
  console.log("Migração financeira validada em PostgreSQL temporário.");
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
