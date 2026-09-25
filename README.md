# DJ Fluxo

Painel de aprovação do fluxo de pagamentos. Importa a planilha de pagamentos do
dia, valida e classifica cada lançamento, e conduz a sessão de aprovação com
controle de acesso por perfil e registro de auditoria de tudo que é alterado.

## O modelo

A planilha de fluxo tem três blocos, e o sistema trata cada um de um jeito:

| Bloco | O que é | O que o sistema faz |
| --- | --- | --- |
| Linhas de pagamento | Fornecedor, data, descrição, valor, categoria e centro de custo | Importa como pagamentos pendentes |
| Resumo por conta | Total por conta, escrito na planilha | **Recalcula** a partir das linhas e avisa se divergir |
| Aportes | Valor que entra em cada conta para cobrir o dia | Importa, pois não é derivável das linhas |

O resumo é recalculado de propósito: ele é a soma das linhas agrupadas por
centro de custo, então é derivável — e planilhas mantidas à mão ficam
desatualizadas quando uma linha é incluída depois do total ser fechado. Quando o
valor escrito não bate com a soma real, a prévia mostra a diferença e o sistema
segue com a soma das linhas.

Os aportes, ao contrário, são informação nova, e sustentam a métrica central do
painel: **cobertura**, isto é, se o aporte de cada conta cobre o que ainda está
comprometido.

## Como rodar

Requer Node 20+ (desenvolvido no 24), npm e um PostgreSQL acessível.

```bash
cp .env.example .env        # ajuste DATABASE_URL e AUTH_SECRET
npm install
npm run prisma:generate     # gera o client do Prisma
npm run db:migrate          # cria/aplica as tabelas no PostgreSQL local
npm run db:seed             # cria o usuário inicial
npm run dev
```

Acesse `http://localhost:3000`. As senhas das contas administrativas iniciais
podem ser definidas por `SEED_ADMIN_PASSWORD` e `SEED_ARTHUR_PASSWORD`. Quando
uma delas não é informada, o seed gera uma senha aleatória e a imprime somente
no momento em que cria a conta. Troque a senha no primeiro login.

Gere também um `AUTH_SECRET` longo e aleatório — é ele que assina a sessão e é
obrigatório em produção.

### Acesso de teste local

Para criar a conta `teste`, configure no `.env` e execute `npm run db:seed`:

```dotenv
SEED_TEST_USER="true"
SEED_TEST_PASSWORD="sua-senha-de-teste-com-10-ou-mais-caracteres"
```

Ela recebe o perfil **Administrador**, com todas as abas do painel, e entra nos
designados para aprovar solicitações de alto valor, inclusive as abertas antes
do seed. O limite configurado e os demais designados são preservados. As regras
de negócio, como aprovação por mais de uma pessoa quando exigida, continuam valendo.
O envio de notas em `/notas` continua exclusivo do perfil Colaborador; a exclusão
definitiva de contas continua exclusiva de `arthur`.

Se `SEED_TEST_PASSWORD` ficar vazia, o seed gera uma senha e a mostra apenas na
criação. Execuções seguintes não trocam a senha nem reativam a conta. A criação
é opcional, vem desligada e só funciona com PostgreSQL em `localhost`,
`127.0.0.1` ou `::1`, fora de `NODE_ENV=production`. Não configure essas variáveis
no Render. Para impedir novos ajustes pelo seed, volte `SEED_TEST_USER` para
`false`; para revogar o acesso já criado, desative a conta na aba Usuários.

### Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe em modo desenvolvimento |
| `npm install` / `npm run build` | Instalação e build garantem o Prisma Client |
| `npm start` | Aplica migrações, garante os dados iniciais e inicia o serviço |
| `npm run lint` | ESLint |
| `npm run typecheck` | Verifica os tipos TypeScript sem emitir arquivos |
| `npm test` | Executa os checks automatizados; requer um PostgreSQL de teste com as migrações aplicadas |
| `npm run check:converter` | Valida conversão e reimportação com uma amostra sintética; aceita arquivo como argumento |
| `npm run check:migration` | Cria um banco temporário, aplica todas as migrações e verifica a precisão decimal |
| `npm run check:payment-requests` | Testa alçada, conversa, anexos e decisões concorrentes em um banco temporário |
| `npm run check:push` | Testa inscrições, expiração, falhas e service worker, sem chamar serviços externos |
| `npm run check:seed` | Testa a conta local opcional, sua senha, alçada e bloqueios em banco temporário |
| `npm run db:migrate` | Cria/aplica migrações no desenvolvimento |
| `npm run db:migrate:deploy` | Aplica migrações pendentes sem alterar o schema |
| `npm run db:push` | Sincroniza o schema diretamente; use apenas como transição/prototipação |
| `npm run db:setup` | Aplica migrações e garante os dados iniciais |
| `npm run db:seed` | Cria/atualiza o usuário inicial |
| `npm run db:reset` | **Apaga** os dados e recria o banco local do zero |

Os checks de solicitações, push e migrações criam e removem bancos temporários;
o usuário PostgreSQL usado nos testes precisa da permissão `CREATEDB`.

### Deploy no Render

Crie um PostgreSQL gerenciado na mesma região do Web Service e configure nele a
variável `DATABASE_URL` com a **Internal Database URL**. Configure também um
`AUTH_SECRET` longo e fixo. Ele precisa estar disponível tanto no ambiente de
build/CI quanto no runtime do Render: o build de produção falha imediatamente se
o segredo não estiver definido. O comando `npm start` aplica somente as
migrações versionadas, executa o seed idempotente e então inicia o Next.js.

Não use SQLite no filesystem padrão do Render: os arquivos gravados pelo serviço
são efêmeros e desaparecem em reinícios e novos deploys.

Antes de publicar a migração `20260918000000_decimal_precision`, execute
`scripts/check-decimal-precision.sql` no banco de produção, em modo somente
leitura. O resultado deve ser vazio: a consulta encontra valores que seriam
arredondados ou que não caberiam nos novos tipos. Revise qualquer ocorrência e
faça um backup do PostgreSQL no Render antes do deploy. A migração repete essa
verificação e aborta sem alterar valores incompatíveis; a conversão ocorre em
uma transação, com bloqueio das tabelas durante a operação.

## Perfis e acesso

Os cinco perfis seguem `roleLabels` e `roleDescriptions` de
`src/lib/permissions.ts`:

| Perfil | Acesso |
| --- | --- |
| **Operador** | Acessa o painel, importa planilhas, acompanha aprovações, solicita pagamentos e faz a conciliação. |
| **Gestor** | Opera pagamentos e adiantamentos. |
| **Aprovador** | Aprova pagamentos e fecha fluxos em aprovação. |
| **Administrador** | Acesso total, incluindo usuários, permissões e logs. |
| **Colaborador** | Envia fotos de notas fiscais do cartão CAJU pelo celular. Não acessa o painel. |

As 14 abas do painel seguem `tabRoles`. O Colaborador acessa somente `/notas` e
não tem acesso a nenhuma destas abas:

| Aba | Operador | Gestor | Aprovador | Administrador |
| --- | :-: | :-: | :-: | :-: |
| Início (`dashboard`) | ✓ | ✓ | ✓ | ✓ |
| Indicadores (`indicadores`) | ✓ | ✓ | ✓ | ✓ |
| Calendário (`calendario`) | ✓ | ✓ | ✓ | ✓ |
| Importação (`importar`) | ✓ | ✓ | ✓ | ✓ |
| Aprovados (`aprovados`) | ✓ | ✓ | ✓ | ✓ |
| Conciliação (`conciliacao`) | ✓ | ✓ | ✓ | ✓ |
| Solicitações (`solicitacoes`) | ✓ | ✓ | ✓ | ✓ |
| Pagamentos (`pagamentos`) | | ✓ | ✓ | ✓ |
| Adiantamentos (`adiantamentos`) | | ✓ | ✓ | ✓ |
| Dispositivos (`dispositivos`) | ✓ | ✓ | ✓ | ✓ |
| Usuários (`usuarios`) | | | | ✓ |
| Permissões (`permissoes`) | | | | ✓ |
| Logs (`logs`) | | | | ✓ |
| Notas dos colaboradores (`notas-colaboradores`) | | ✓ | ✓ | ✓ |

A operação de pagamentos é restrita a Gestor, Aprovador e Administrador.
As ações disponíveis também dependem das alçadas e das regras de cada operação.
Em Solicitações, o Administrador configura a alçada e acompanha todos os pedidos,
mas só decide pedidos de alto valor se também for designado. Operadores, Gestores,
Aprovadores e Administradores ativos podem ser designados; o Dono não é um perfil novo.

## Gestão financeira avançada

- **Alçadas:** regras por faixa de valor, obra, categoria ou tag, com perfil mínimo,
  quantidade de aprovadores e bloqueio de autoaprovação. Os padrões iniciais são
  Aprovador até R$ 5 mil, Administrador acima desse valor e dupla aprovação de
  Administrador para a tag `Extraordinário`, conforme as migrações existentes.
- **Indicadores:** gasto por fornecedor, evolução por obra (considerando rateios),
  crescimento de categorias, tempo médio de aprovação, remarcações, motivos de
  reprovação e entrega de notas no prazo.
- **Calendário:** visão mensal ou semanal de pagamentos, aportes e prazos de
  prestação de contas.
- **Rateios:** regras configuráveis por categoria/fornecedor e edição manual no
  pagamento. Nenhum percentual DG × JR fica fixo no código.
- **Adiantamentos:** concessão, prazo, valor comprovado, devolução, saldo e status
  da prestação de contas.
- **Motivos e tags:** cadastros administráveis e reutilizados nas ações do fluxo.

Esconder a aba **não** é a proteção: cada rota de API revalida o perfil no
servidor, e perfil e status são lidos do banco a cada requisição, nunca do
token — rebaixar ou desativar alguém tem efeito imediato, sem esperar a sessão
expirar. As regras ficam todas em `src/lib/permissions.ts`, que é a fonte única
consultada tanto pelo menu quanto pelas rotas.

### Entrada de usuários

A tela de login tem **Solicitar acesso**. A conta nasce `PENDENTE` como
Operador e não entra até um Administrador aprovar e definir
o perfil. O Administrador também pode criar contas direto, já ativas.

O sistema impede que o último Administrador ativo se rebaixe, se desative ou seja
excluído — sem isso, dá para ficar sem ninguém capaz de gerenciar o acesso.
A exclusão definitiva só pode ser solicitada pelo usuário `arthur`; os demais
administradores podem desativar contas.
Usuário com histórico (importações, pagamentos, ações) é desativado em vez de
excluído, para não quebrar a auditoria.

## Solicitações de pagamento

Depois da negociação, quem acessa a aba pode solicitar autorização para pagar em
uma obra vinculada à sua conta (o Administrador pode usar qualquer obra ativa).
Fornecedor, valor, vencimento, descrição, obra e ao menos um anexo são obrigatórios.
Na criação, são aceitos de um a cinco arquivos PDF, JPG ou PNG de até 5 MB cada,
com validação do conteúdo e idempotência do envio.

Em **Permissões → Aprovação de alto valor**, o Administrador define o limite e
designa o Dono e seus substitutos, entre usuários ativos que não sejam Colaboradores.
A regra começa desligada (`highValueThreshold = null`).

| Valor na criação | Quem decide |
| --- | --- |
| Até o limite, ou regra desligada | Todos os responsáveis ativos da obra; permanece a possibilidade de conclusão pelo Administrador |
| Acima do limite | Vai direto aos designados de alto valor, sem aprovação intermediária da obra; uma aprovação de qualquer designado conclui |

Sem aprovador ativo, o envio é recusado. O Administrador não designado pode ver e
cancelar pedidos de alto valor, mas não aprovar, reprovar ou pedir informação.
Alterar o limite só afeta novos pedidos: `requiresOwnerApproval` guarda o caminho
decidido na criação. Trocar os designados atualiza as aprovações dos pedidos de
alto valor em `PENDENTE` ou `INFO_SOLICITADA`, preservando os já encerrados. A
configuração não permite deixar esses pedidos abertos sem designados.

A fila **Aguardando sua decisão** apresenta cartões por vencimento. Aprovar aceita
observação opcional; reprovar exige motivo. **Pedir informação** exige texto e
suspende a decisão até o solicitante responder. A resposta pode incluir novos
anexos, até dez no total da solicitação. Podem existir várias rodadas de pergunta
e resposta, todas visíveis no histórico com autor, data e nota. O solicitante e o
Administrador podem cancelar enquanto o pedido estiver pendente ou aguardando
informação. Para mudar o valor, cancele e envie outro pedido.

Decisão, anexos da resposta, evento e auditoria são gravados na mesma transação;
decisões concorrentes conflitantes retornam 409. A aprovação registra a autorização
e não cria `Payment` no fluxo diário. O backup administrativo inclui o caminho de
aprovação, a configuração e os eventos; backups anteriores continuam aceitos.

### Avisos no celular e no desktop

O Web Push avisa os aprovadores quando a solicitação é criada, avisa o solicitante
quando há aprovação, reprovação ou pedido de informação, e avisa os aprovadores
pendentes após uma resposta. A notificação mostra obra e valor; fornecedor,
anexos e conversa ficam dentro do aplicativo. Ao tocar, abre o cartão destacado,
preservando o destino se for necessário entrar novamente.

Para habilitar no **Render**, gere o par uma única vez:

```bash
npx web-push generate-vapid-keys
```

Cadastre `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (um contato
`mailto:administrador@empresa.com.br`) nas variáveis do Web Service. No ambiente
local, use o `.env` ignorado pelo Git. Conserve as chaves entre deploys e mantenha
a privada apenas no servidor. Sem uma configuração válida, os avisos ficam
desligados e todas as funções de aprovação continuam disponíveis. Não é necessário
liberar serviços externos no `connect-src` do navegador; o envio sai do servidor.
O endpoint de inscrição aceita serviços de push do Google, Mozilla, Microsoft e
Apple, exige autenticação e limita cada usuário a dez aparelhos.

1. **Android:** abra o endereço HTTPS no Chrome, Edge ou Samsung Internet. Use
   a opção de instalar/adicionar à tela inicial no menu do navegador, se desejar.
   Entre na aba Solicitações e toque em **Ativar avisos neste aparelho**; permita
   as notificações quando solicitado.
2. **iPhone/iPad (16.4+):** abra no Safari, toque em Compartilhar → **Adicionar à
   Tela de Início**. Abra pelo ícone instalado, entre na conta e ative os avisos
   dentro do aplicativo. A página aberta fora do aplicativo mostra essa orientação.
3. **Desktop:** use HTTPS ou localhost, abra Solicitações e ative os avisos. Para
   desligar somente neste navegador, use **Desativar avisos**. Se a permissão foi
   negada, reative nas permissões do site ou nos ajustes do aplicativo.

O manifesto abre `/`, que encaminha Colaboradores a `/notas` e os outros perfis
ao painel. A identidade anterior do PWA é preservada para instalações existentes.
Em aparelhos compartilhados, ativar avisos em outra conta transfere a inscrição
para essa conta. Usuários inativos não recebem envios. Inscrições são removidas
quando o serviço informa expiração (404/410); falhas temporárias são registradas
sem cancelar a operação. Os envios ocorrem depois do commit, sem garantia de
entrega ou fila de repetição. O contador do menu continua disponível e atualiza
a cada 30 segundos, ao retornar à janela e após alterações feitas na aba.

Validação em aparelho real: instale o PWA, ative os avisos, feche o aplicativo,
crie uma compra acima do limite por outra conta, toque no aviso e aprove. Confira
o aviso da decisão no aparelho do solicitante. Repita no iPhone instalado, quando
usado pela equipe. Restrições de bateria e permissões do sistema podem impedir
avisos; confira sempre a fila. Os testes automatizados usam transporte simulado.

Referências: [Web Push no WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
e [biblioteca web-push](https://github.com/web-push-libs/web-push).

## Importação

Aceita `.xlsx` e `.csv`. As colunas são reconhecidas por nome, com aliases:

Cada arquivo pode conter até 5.000 linhas de pagamento e 500 aportes. A prévia
recusa planilhas acima desses limites; a confirmação também valida as contagens
e recusa envios cujo `Content-Length` exceda 20 MB.

Antes de confirmar, o usuário pode dar um nome ao fluxo importado. Se deixar o
campo vazio, o sistema usa `FLUXO DE PAGAMENTOS dd.MM`, considerando a data de
processamento. Esse nome identifica a importação, o ciclo de aprovação e o
relatório final.

| Campo | Nomes aceitos |
| --- | --- |
| Fornecedor | `fornecedor`, `cliente fornecedor`, `nome fornecedor`, `supplier` |
| Data | `data`, `vencimento`, `data vencimento`, `data de vencimento`, `due date` |
| Descrição | `descricao`, `historico`, `observacao` |
| Valor | `valor`, `valor liquido`, `amount`, `total` |
| Centro de custo | `centro de custo`, `centro custo`, `obra`, `conta`, `cost center` |
| Categoria *(opcional)* | `categoria`, `category`, `plano de contas` |
| Referência *(opcional)* | `referencia`, `documento`, `numero`, `id` |

A comparação ignora acentos, caixa e pontuação. Valores aceitam `1.234,56` e
`1234.56`; datas aceitam `dd/mm/aaaa` e o serial do Excel.

### Centros de custo

O centro de custo é reconhecido **pelo nome**, e não existe lista fixa: qualquer
nome é aceito. A conta é procurada entre as cadastradas — pelo nome, pelo slug
ou pelos apelidos (`costCenterAliases`) — e, se não existir, é **criada na
importação** com o nome que veio na planilha. A prévia mostra quais contas serão
criadas antes de você confirmar.

A comparação é normalizada, então `Reisolamento`, `REISOLAMENTO` e
`reisolamento` caem na mesma conta, sem duplicar. Os apelidos servem para os
casos em que o nome na planilha não é o nome da conta — por exemplo,
`Despesa Pessoal Jeronimo` resolve para a conta `JERONIMO`.


A leitura **para** ao encontrar o subtotal ou o cabeçalho do resumo, em vez de
tratar essas linhas como pagamento. A prévia mostra linha a linha o que é válido,
inválido ou duplicado, e só o que está válido é importado.

Cada lançamento tem uma chave única derivada de fornecedor, descrição, valor,
data e centro de custo. Isso torna a importação **idempotente**: reenviar a mesma
planilha não duplica nada, e a planilha do dia seguinte só traz o que é novo.

## O fluxo do dia

Cada importação cria um fluxo diário em `RASCUNHO`. Nesse estado os pagamentos
podem ser conferidos e alterados. Ao escolher **Enviar para aprovação**, o fluxo
vai para `EM_APROVAÇÃO`, onde as decisões continuam sendo acompanhadas. O
fechamento só é permitido quando nenhum pagamento estiver sem decisão.

Um pagamento importado nasce `PENDENTE`. Durante a aprovação ele pode ser
aprovado, reprovado, ter a data alterada, ou entrar em pedido de informação. As
ações valem individualmente ou **em lote**: clicar nos pagamentos marca vários e
o botão *Ações em lote* aplica aprovar, reprovar ou alterar data a todos, com um
motivo único.

Ao fechar, o sistema grava quantidades e valores finais, bloqueia novas
alterações e libera o relatório PDF consolidado, com os pagamentos e o histórico
do fluxo. Apenas um **Administrador** pode reabrir um fluxo fechado, informando
obrigatoriamente o motivo; autor, data e horário ficam registrados.

Duas noções diferentes convivem, e vale não confundi-las:

- **Em aberto** (o que aparece no fluxo) é o que ainda espera decisão. Ao ser
  pago, reprovado ou remarcado, o lançamento sai da lista. Quando a sessão
  termina, o fluxo fica vazio.
- **Comprometido** (o que pesa na cobertura do aporte) inclui os aprovados —
  aprovar não devolve dinheiro ao caixa. Só reprovar, cancelar ou remarcar para
  outro dia liberam o valor.

Toda ação é registrada com autor, o que mudou (de → para) e quando, visível na
aba **Logs**.

## Conciliação e notas faltantes

A conciliação cruza o extrato do cartão com os lançamentos internos. Quando
existirem transações sem documento correspondente, o botão **Exportar Notas
Faltantes** gera um PDF no mesmo formato tabular do relatório de auditoria, com
colaborador, tipo, estabelecimento, valor, data e status da transação.

## Estrutura

```
src/
  app/
    api/            rotas (auth, imports, payments, dashboard, admin)
    painel/         a SPA: rota única, abas por estado
    login/
    notas/          envio de notas pelo Colaborador
  components/
    panel/          shell, contexto e as abas
  lib/
    permissions.ts  fonte única do RBAC
    import-parser.ts  leitura e validação da planilha
    auth.ts         sessão, hash e guardas de perfil
prisma/
  schema.prisma
  seed.ts
scripts/
  check-*.ts        checks de regras, importação, conversão, notas e integrações
  check-migration.mjs  valida migrações em um PostgreSQL temporário
  check-decimal-precision.sql  verificação somente leitura antes do deploy
.github/workflows/
  ci.yml            valida pushes e pull requests para main
```

`npm test` reúne os checks automatizados, sem executar os scripts de limpeza
ou o servidor de teste visual. O CI usa PostgreSQL 16 e executa `npm ci`,
migrações, lint, typecheck, testes, `check:migration` e build. Para reproduzir,
configure `DATABASE_URL` para um banco local de teste e `AUTH_SECRET`; o usuário
do banco precisa poder criar bancos temporários para `check:migration`.

Stack: Next 16 (App Router), React 19, TypeScript, Prisma 7 com PostgreSQL
(`@prisma/adapter-pg`), Zod para validação, `jose` para a sessão JWT, `bcryptjs`
para as senhas, ExcelJS e `csv-parse` para a importação.

## Dados e privacidade

O `.gitignore` mantém fora do versionamento o `.env` e as planilhas (`*.xlsx`,
`*.xls`) — elas contêm nomes de fornecedores e
funcionários e valores reais. Use `samples/conta-azul-exemplo.csv` como
referência de formato.
