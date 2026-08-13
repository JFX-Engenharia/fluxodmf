import assert from "node:assert/strict";

// session-info carrega o cliente Prisma (por causa de recordLoginEvent), que
// exige DATABASE_URL ja na importacao do modulo. Nenhuma conexao e aberta: este
// teste so exercita a leitura de cabecalhos. Por isso o import e dinamico, para
// rodar depois da variavel estar definida.
process.env.DATABASE_URL ??= "postgresql://check:check@127.0.0.1:5432/check";

function requestWith(headers: Record<string, string>) {
  return new Request("https://fluxo.local/api/auth/login", { headers });
}

async function main() {
  const { normalizeIpAddress, requestIpAddress, sessionRequestInfo } = await import(
    "../src/lib/session-info"
  );

  // Precedencia: a borda (Cloudflare/Render) vence quem o cliente pode forjar.
  assert.equal(
    requestIpAddress(
      requestWith({
        "cf-connecting-ip": "198.51.100.10",
        "x-real-ip": "198.51.100.20",
        "x-forwarded-for": "203.0.113.1, 198.51.100.30",
      }),
    ),
    "198.51.100.10",
  );

  // Sem CF-Connecting-IP, X-Real-IP vem antes do X-Forwarded-For.
  assert.equal(
    requestIpAddress(
      requestWith({
        "x-real-ip": "198.51.100.20",
        "x-forwarded-for": "203.0.113.1, 198.51.100.30",
      }),
    ),
    "198.51.100.20",
  );

  // Cabecalho de borda vazio nao pode engolir os demais.
  assert.equal(
    requestIpAddress(requestWith({ "cf-connecting-ip": "   ", "x-real-ip": "198.51.100.20" })),
    "198.51.100.20",
  );

  // X-Forwarded-For: vale o elemento MAIS A DIREITA, escrito pelo proxy mais
  // proximo da aplicacao. O 203.0.113.x a esquerda e o que um cliente
  // conseguiria injetar mandando o cabecalho ja preenchido.
  assert.equal(
    requestIpAddress(requestWith({ "x-forwarded-for": "203.0.113.1, 203.0.113.2, 198.51.100.30" })),
    "198.51.100.30",
  );

  // Lista com sobra de virgula/espaco continua caindo no ultimo valor real.
  assert.equal(
    requestIpAddress(requestWith({ "x-forwarded-for": "203.0.113.1, 198.51.100.30,  " })),
    "198.51.100.30",
  );

  // Um unico elemento segue funcionando.
  assert.equal(
    requestIpAddress(requestWith({ "x-forwarded-for": "198.51.100.30" })),
    "198.51.100.30",
  );

  // Normalizacao preservada: loopback IPv6 e enderecos IPv4 mapeados.
  assert.equal(requestIpAddress(requestWith({ "cf-connecting-ip": "::1" })), "127.0.0.1");
  assert.equal(
    requestIpAddress(requestWith({ "x-forwarded-for": "::ffff:198.51.100.30" })),
    "198.51.100.30",
  );
  assert.equal(normalizeIpAddress("0:0:0:0:0:0:0:1"), "127.0.0.1");
  assert.equal(normalizeIpAddress("  "), null);
  assert.equal(normalizeIpAddress(undefined), null);

  // Sem nenhum cabecalho de proxy, nao ha IP a registrar.
  assert.equal(requestIpAddress(requestWith({})), null);

  // sessionRequestInfo usa a mesma resolucao e mantem o resto do payload.
  const info = sessionRequestInfo(
    requestWith({
      "cf-connecting-ip": "198.51.100.10",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0",
    }),
  );
  assert.equal(info.ipAddress, "198.51.100.10");
  assert.equal(info.device, "Google Chrome em Windows");

  console.log("OK: resolucao de IP (CF-Connecting-IP > X-Real-IP > X-Forwarded-For a direita).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
