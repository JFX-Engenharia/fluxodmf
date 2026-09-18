import { execFileSync } from "node:child_process";
import pg from "pg";

/** Testes de configuração global usam banco próprio, nunca a configuração local. */
export async function isolatedDatabase() {
  const name = `fluxo_check_${Date.now()}_${process.pid}`;
  const source = new URL(process.env.DATABASE_URL!);
  const adminUrl = new URL(source);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  source.pathname = `/${name}`;
  const cleanup = async () => {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [name]);
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  };
  try {
    process.env.DATABASE_URL = source.toString();
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: process.env, stdio: "pipe",
    });
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
