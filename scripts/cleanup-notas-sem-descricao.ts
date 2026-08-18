/**
 * Remove notas gravadas sem descricao, de antes de a descricao virar
 * obrigatoria.
 *
 * NAO e migration de proposito. As migrations rodam sozinhas no predev e no
 * start, entao um DELETE ali dispararia em producao a cada deploy, para sempre,
 * sem ninguem decidir. Aqui a exclusao acontece por decisao explicita.
 *
 * E IRREVERSIVEL: a imagem mora na propria linha (ReceiptNote.data), entao
 * apagar a linha apaga a foto da nota fiscal junto. Nao ha backup.
 *
 * Uso:
 *   npm run cleanup:notas          -> so conta e mostra o que seria apagado
 *   npm run cleanup:notas -- --apagar  -> apaga de verdade
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { getDatabaseUrl } from "../src/lib/database-url";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: getDatabaseUrl() }),
});

// Espelha o que a rota passou a recusar (min 3, ja com trim).
const where = { description: { in: ["", " ", "  "] } };

async function main() {
  const apagar = process.argv.includes("--apagar");

  const alvo = await prisma.receiptNote.findMany({
    where,
    select: {
      id: true,
      fileName: true,
      capturedAt: true,
      size: true,
      user: { select: { name: true, username: true } },
    },
    orderBy: { capturedAt: "asc" },
  });

  if (alvo.length === 0) {
    console.log("Nenhuma nota sem descricao. Nada a fazer.");
    return;
  }

  console.log(`${alvo.length} nota(s) sem descricao:\n`);
  for (const nota of alvo) {
    console.log(
      [
        nota.capturedAt.toISOString().slice(0, 10),
        (nota.user.name || nota.user.username).padEnd(24),
        `${(nota.size / 1024).toFixed(0)} KB`.padStart(8),
        nota.fileName,
      ].join("  "),
    );
  }

  if (!apagar) {
    console.log(
      "\nNada foi apagado. Confira a lista acima e, se estiver certa, rode de novo com --apagar.",
    );
    return;
  }

  const removidas = await prisma.receiptNote.deleteMany({ where });
  console.log(`\n${removidas.count} nota(s) apagada(s). A imagem foi junto — nao ha como voltar.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
