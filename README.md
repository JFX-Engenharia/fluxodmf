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
| `npm run db:migrate` | Cria/aplica migrações no desenvolvimento |
| `npm run db:migrate:deploy` | Aplica migrações pendentes sem alterar o schema |
| `npm run db:push` | Sincroniza o schema diretamente; use apenas como transição/prototipação |
| `npm run db:setup` | Aplica migrações e garante os dados iniciais |
| `npm run db:seed` | Cria/atualiza o usuário inicial |
| `npm run db:reset` | **Apaga** os dados e recria o banco local do zero |

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

Antes de entrar no fluxo diário, qualquer usuário com acesso à aba Solicitações
pode abrir uma solicitação para uma obra permitida ao seu perfil. Fornecedor, valor, vencimento, descrição,
obra e ao menos um anexo são obrigatórios; os anexos aceitos são PDF, JPG e PNG,
com até 5 MB cada e no máximo cinco por solicitação.

Cada obra pode ter vários **responsáveis pela aprovação**, definidos por um
Administrador na aba **Permissões** entre Gestores e Administradores ativos.
Todos os responsáveis devem aprovar a solicitação; um Administrador também pode
concluir a aprovação. Um responsável ou Administrador pode reprovar, sempre com
motivo. A aprovação registra responsável,
data e histórico, mas não cria pagamento automaticamente: a solicitação aprovada
fica pronta para conferência e posterior inclusão no fluxo diário.

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
