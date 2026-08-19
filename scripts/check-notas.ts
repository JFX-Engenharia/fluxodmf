/**
 * Regressao das notas do colaborador (PWA). O que se testa aqui e a fronteira
 * da rota, e nao o banco: descricao obrigatoria, dono do envio, magic bytes,
 * idempotencia e quem pode ver a foto sao regras que moram DENTRO dos
 * handlers — validar so o Prisma deixaria justamente essa parte sem rede.
 *
 * Por isso os handlers sao executados de verdade. A unica peca substituida e
 * `next/headers`, que fora de uma requisicao do Next nao tem de onde ler o
 * cookie: o stub devolve o mesmo token que o login emitiria, gerado por
 * `createSessionToken`. Sessao, usuario e permissao continuam sendo os reais.
 *
 * O script cria tudo o que usa (dois colaboradores, um gestor, sessoes, notas)
 * e apaga tudo no fim, inclusive quando alguma asercao falha.
 *
 * Uso: npm run check:notas
 */

import assert from "node:assert/strict";
import Module from "node:module";
import { Role, UserStatus } from "../generated/prisma/enums";

/** Token que o cookie falso devolve; trocar isto e trocar de usuario logado. */
let sessionToken: string | null = null;

/**
 * O patch precisa estar de pe ANTES de qualquer modulo da aplicacao ser
 * carregado — `src/lib/auth` importa `next/headers` no topo. Como o tsx compila
 * para CJS, os `import` estaticos deste arquivo ja rodaram; por isso tudo o que
 * e da aplicacao entra por `await import()` dentro de `main`.
 */
const loader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = loader._load;
loader._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request !== "next/headers") return originalLoad.call(this, request, parent, isMain);
  return {
    cookies: async () => ({
      get: (name: string) =>
        name === "fluxo_session" && sessionToken ? { name, value: sessionToken } : undefined,
    }),
  };
};

const suffix = `check-notas-${Date.now()}`;
const BASE = "https://fluxo.local/api/notas";

function bytesWith(signature: number[], size = 128) {
  const buffer = Buffer.alloc(size, 0x2a);
  buffer.set(signature, 0);
  return buffer;
}

const JPEG = bytesWith([0xff, 0xd8, 0xff]);
const PNG = bytesWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Nem JPEG, nem PNG, nem PDF: assinatura que o servidor nao reconhece. */
const LIXO = bytesWith([0x00, 0x01, 0x02, 0x03]);

type PostOptions = {
  key: string;
  ownerId: string;
  description?: string;
  bytes?: Buffer;
  mimeType?: string;
  fileName?: string;
};

function postRequest(options: PostOptions) {
  const form = new FormData();
  if (options.description !== undefined) form.set("description", options.description);
  form.set("ownerId", options.ownerId);
  const bytes = options.bytes ?? JPEG;
  form.set(
    "foto",
    new File([new Uint8Array(bytes)], options.fileName ?? "nota.jpg", {
      type: options.mimeType ?? "image/jpeg",
    }),
  );
  return new Request(BASE, {
    method: "POST",
    headers: { "Idempotency-Key": options.key },
    body: form,
  });
}

async function body(response: Response) {
  return (await response.json()) as {
    error?: string;
    note?: { id: string; clientKey: string | null };
  };
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { createSessionToken } = await import("../src/lib/auth");
  const notas = await import("../src/app/api/notas/route");
  const foto = await import("../src/app/api/notas/[id]/foto/route");

  const maintenance = await prisma.maintenanceNotice.findUnique({
    where: { id: "singleton" },
    select: { active: true },
  });
  assert.ok(
    !maintenance?.active,
    "modo somente leitura ativo: desligue a manutencao antes de rodar este check",
  );

  const userIds: string[] = [];
  async function novoUsuario(apelido: string, role: Role) {
    const user = await prisma.user.create({
      data: {
        name: `${apelido} ${suffix}`,
        username: `${suffix}-${apelido}`,
        email: `${suffix}-${apelido}@local.test`,
        passwordHash: "teste",
        role,
        status: UserStatus.ATIVO,
      },
    });
    userIds.push(user.id);
    const token = await createSessionToken(
      {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        provider: "local",
      },
      { ipAddress: "127.0.0.1", userAgent: "check-notas", device: "script" },
    );
    return { id: user.id, token };
  }

  const colaboradorA = await novoUsuario("colab-a", Role.COLABORADOR);
  const colaboradorB = await novoUsuario("colab-b", Role.COLABORADOR);
  const gestor = await novoUsuario("gestor", Role.GESTOR);

  try {
    sessionToken = colaboradorA.token;

    /* ------------------------------------------------------------------ */
    /* POST /api/notas — descricao obrigatoria                             */
    /* ------------------------------------------------------------------ */

    const semDescricao = await notas.POST(
      postRequest({ key: `${suffix}-sem-descricao`, ownerId: colaboradorA.id }),
    );
    assert.equal(semDescricao.status, 400, "envio sem descricao nao pode ser aceito");

    const descricaoCurta = await notas.POST(
      postRequest({ key: `${suffix}-curta`, ownerId: colaboradorA.id, description: "ab" }),
    );
    assert.equal(descricaoCurta.status, 400, "descricao com menos de 3 caracteres nao vale");
    assert.equal((await body(descricaoCurta)).error, "Escreva o que você comprou.");

    /* ------------------------------------------------------------------ */
    /* POST /api/notas — a foto e de quem a tirou                          */
    /* ------------------------------------------------------------------ */

    // Fila offline despejada depois de trocar de conta no mesmo aparelho.
    const donoErrado = await notas.POST(
      postRequest({
        key: `${suffix}-dono-errado`,
        ownerId: colaboradorB.id,
        description: "almoco da equipe",
      }),
    );
    assert.equal(donoErrado.status, 403, "nota de outra conta nao pode ser gravada nesta sessao");
    assert.equal(
      await prisma.receiptNote.count({ where: { userId: colaboradorB.id } }),
      0,
      "a recusa nao pode gravar a nota em conta nenhuma",
    );

    /* ------------------------------------------------------------------ */
    /* POST /api/notas — magic bytes                                       */
    /* ------------------------------------------------------------------ */

    const naoEImagem = await notas.POST(
      postRequest({
        key: `${suffix}-lixo`,
        ownerId: colaboradorA.id,
        description: "arquivo qualquer",
        bytes: LIXO,
      }),
    );
    assert.equal(naoEImagem.status, 400);
    const mensagemLixo = (await body(naoEImagem)).error ?? "";
    assert.match(mensagemLixo, /JPG ou PNG/, "a mensagem deve citar os tipos desta tela");
    assert.doesNotMatch(mensagemLixo, /PDF/, "a tela de notas nao aceita PDF e nao pode cita-lo");

    // Conteudo PNG anunciado como JPEG: o tipo declarado nao vale como prova.
    const tipoTrocado = await notas.POST(
      postRequest({
        key: `${suffix}-tipo-trocado`,
        ownerId: colaboradorA.id,
        description: "nota renomeada",
        bytes: PNG,
        mimeType: "image/jpeg",
      }),
    );
    assert.equal(tipoTrocado.status, 400);
    assert.match((await body(tipoTrocado)).error ?? "", /não corresponde ao tipo informado/);

    /* ------------------------------------------------------------------ */
    /* POST /api/notas — envio valido e clientKey                          */
    /* ------------------------------------------------------------------ */

    const chaveJpeg = `${suffix}-nota-jpeg`;
    const criada = await notas.POST(
      postRequest({
        key: chaveJpeg,
        ownerId: colaboradorA.id,
        description: "material de obra",
        bytes: JPEG,
      }),
    );
    assert.equal(criada.status, 201);
    const notaJpeg = (await body(criada)).note;
    assert.ok(notaJpeg);
    assert.equal(notaJpeg.clientKey, chaveJpeg, "o clientKey e o mesmo uuid da idempotencia");

    const chavePng = `${suffix}-nota-png`;
    const criadaPng = await notas.POST(
      postRequest({
        key: chavePng,
        ownerId: colaboradorA.id,
        description: "combustivel",
        bytes: PNG,
        mimeType: "image/png",
        fileName: "nota.png",
      }),
    );
    assert.equal(criadaPng.status, 201);

    /* ------------------------------------------------------------------ */
    /* Idempotencia — reenvio nao duplica e nao consome cota                */
    /* ------------------------------------------------------------------ */

    // Primeira barreira: a chave gravada devolve a MESMA resposta de antes
    // (portanto o 201 original), marcada como replay. O que importa e que
    // nenhuma linha nova aparece.
    const replay = await notas.POST(
      postRequest({
        key: chaveJpeg,
        ownerId: colaboradorA.id,
        description: "material de obra",
        bytes: JPEG,
      }),
    );
    assert.equal(replay.headers.get("X-Idempotent-Replay"), "true");
    assert.equal((await body(replay)).note?.id, notaJpeg.id, "o replay devolve a nota ja gravada");
    assert.equal(
      await prisma.receiptNote.count({ where: { userId: colaboradorA.id } }),
      2,
      "reenvio nao pode criar nota nova",
    );

    // Segunda barreira: a chave de idempotencia expira em 24h e a fila offline
    // pode durar mais. Sem o registro, o reenvio chega ao INSERT e quem barra e
    // o UNIQUE de clientKey — dai a resposta 200 com a nota que ja existia.
    await prisma.idempotencyKey.deleteMany({ where: { key: chaveJpeg } });
    const reenvioTardio = await notas.POST(
      postRequest({
        key: chaveJpeg,
        ownerId: colaboradorA.id,
        description: "material de obra",
        bytes: JPEG,
      }),
    );
    assert.equal(reenvioTardio.status, 200, "reenvio fora da janela de idempotencia responde 200");
    assert.equal(reenvioTardio.headers.get("X-Idempotent-Replay"), null);
    assert.equal((await body(reenvioTardio)).note?.id, notaJpeg.id);
    assert.equal(
      await prisma.receiptNote.count({ where: { userId: colaboradorA.id } }),
      2,
      "o UNIQUE de clientKey e a segunda linha de defesa contra duplicata",
    );

    // Chave repetida vinda de OUTRA conta nao e reenvio: e um cliente mandando
    // um identificador que nao gerou. A resposta e 409 seca — devolver a nota
    // existente vazaria a foto de um colaborador para outro.
    sessionToken = colaboradorB.token;
    const chaveDeOutraConta = await notas.POST(
      postRequest({
        key: chaveJpeg,
        ownerId: colaboradorB.id,
        description: "tentativa com chave alheia",
        bytes: JPEG,
      }),
    );
    assert.equal(chaveDeOutraConta.status, 409);
    const corpoDoConflito = await chaveDeOutraConta.text();
    // Ancora o ramo: 409 tambem sai da idempotencia ("ja esta em processamento"),
    // e nao e esse que se quer aqui.
    assert.match(corpoDoConflito, /Já existe um envio com esta identificação/);
    assert.doesNotMatch(corpoDoConflito, new RegExp(notaJpeg.id), "o 409 nao pode citar a nota de A");
    assert.doesNotMatch(corpoDoConflito, /material de obra/, "nem a descricao dela");
    assert.equal(
      await prisma.receiptNote.count({ where: { userId: colaboradorB.id } }),
      0,
      "a chave alheia nao grava nota nenhuma",
    );
    sessionToken = colaboradorA.token;

    // Cota do nota-upload: 30 envios por 10 minutos, por usuario. Ate aqui o
    // colaborador A gastou 8 envios de verdade. Se cada replay tambem cobrasse,
    // as repeticoes abaixo estourariam o teto e o envio novo seguinte levaria
    // 429 — que e exatamente o que travaria a fila offline do celular.
    for (let tentativa = 0; tentativa < 29; tentativa += 1) {
      const repetido = await notas.POST(
        postRequest({
          key: chavePng,
          ownerId: colaboradorA.id,
          description: "combustivel",
          bytes: PNG,
          mimeType: "image/png",
          fileName: "nota.png",
        }),
      );
      assert.equal(repetido.headers.get("X-Idempotent-Replay"), "true");
    }
    const depoisDosReplays = await notas.POST(
      postRequest({
        key: `${suffix}-nota-apos-replays`,
        ownerId: colaboradorA.id,
        description: "pedagio da viagem",
        bytes: JPEG,
      }),
    );
    assert.equal(depoisDosReplays.status, 201, "replay nao pode consumir cota do nota-upload");

    /* ------------------------------------------------------------------ */
    /* GET /api/notas — historico e so do proprio colaborador              */
    /* ------------------------------------------------------------------ */

    sessionToken = colaboradorB.token;
    const criadaB = await notas.POST(
      postRequest({
        key: `${suffix}-nota-b`,
        ownerId: colaboradorB.id,
        description: "nota do colega",
        bytes: JPEG,
      }),
    );
    assert.equal(criadaB.status, 201);
    const notaB = (await body(criadaB)).note;
    assert.ok(notaB);

    sessionToken = colaboradorA.token;
    const lista = (await (await notas.GET(new Request(BASE))).json()) as {
      notes: { id: string; clientKey: string | null }[];
    };
    const idsListados = lista.notes.map((nota) => nota.id);
    assert.equal(idsListados.length, 3, "as tres notas do proprio colaborador");
    assert.ok(idsListados.includes(notaJpeg.id));
    assert.ok(!idsListados.includes(notaB.id), "o historico nao mostra nota de outro colaborador");
    assert.equal(
      lista.notes.find((nota) => nota.id === notaJpeg.id)?.clientKey,
      chaveJpeg,
      "a listagem devolve o clientKey para o PWA casar com a fila local",
    );

    /* ------------------------------------------------------------------ */
    /* A tela de envio e do colaborador                                    */
    /* ------------------------------------------------------------------ */

    sessionToken = gestor.token;
    const gestorEnviando = await notas.POST(
      postRequest({
        key: `${suffix}-gestor`,
        ownerId: gestor.id,
        description: "envio pelo painel",
        bytes: JPEG,
      }),
    );
    assert.equal(gestorEnviando.status, 403, "quem nao tem a aba notas nao envia nota");

    /* ------------------------------------------------------------------ */
    /* GET /api/notas/[id]/foto — dono OU gestao                           */
    /* ------------------------------------------------------------------ */

    async function baixarFoto(id: string) {
      return foto.GET(new Request(`${BASE}/${id}/foto`), { params: Promise.resolve({ id }) });
    }

    sessionToken = colaboradorA.token;
    const doDono = await baixarFoto(notaJpeg.id);
    assert.equal(doDono.status, 200, "o dono ve a propria nota");
    assert.equal(doDono.headers.get("Content-Type"), "image/jpeg");
    assert.deepEqual(
      Buffer.from(await doDono.arrayBuffer()),
      JPEG,
      "os bytes da foto voltam intactos",
    );

    const inexistente = await baixarFoto(`${suffix}-nota-que-nao-existe`);
    assert.equal(inexistente.status, 404);

    sessionToken = colaboradorB.token;
    const deOutroColaborador = await baixarFoto(notaJpeg.id);
    assert.equal(deOutroColaborador.status, 403, "colaborador nao ve nota de colega");

    sessionToken = gestor.token;
    const daGestao = await baixarFoto(notaJpeg.id);
    assert.equal(daGestao.status, 200, "quem tem a aba notas-colaboradores ve todas");

    sessionToken = null;
    const semSessao = await baixarFoto(notaJpeg.id);
    assert.equal(semSessao.status, 401, "sem sessao nao se baixa foto nenhuma");
  } finally {
    sessionToken = null;
    await prisma.receiptNote.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
}

main()
  .then(() => console.log("Notas do colaborador validadas."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
