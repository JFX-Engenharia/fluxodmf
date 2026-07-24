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

Acesse `http://localhost:3000` e entre com:

```
usuário: jfx
senha:   jfx
```

Esse usuário nasce como **Coordenador**. Troque a senha antes de usar para
valer, e gere um `AUTH_SECRET` longo e aleatório — é ele que assina a sessão.

### Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe em modo desenvolvimento |
| `npm install` / `npm run build` | Instalação e build garantem o Prisma Client |
| `npm start` | Aplica migrações, garante os dados iniciais e inicia o serviço |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Cria/aplica migrações no desenvolvimento |
| `npm run db:migrate:deploy` | Aplica migrações pendentes sem alterar o schema |
| `npm run db:push` | Sincroniza o schema diretamente; use apenas como transição/prototipação |
| `npm run db:setup` | Aplica migrações e garante os dados iniciais |
| `npm run db:seed` | Cria/atualiza o usuário inicial |
| `npm run db:reset` | **Apaga** os dados e recria o banco local do zero |

### Deploy no Render

Crie um PostgreSQL gerenciado na mesma região do Web Service e configure nele a
variável `DATABASE_URL` com a **Internal Database URL**. Configure também um
`AUTH_SECRET` longo e fixo. O comando `npm start` aplica somente as migrações
versionadas, executa o seed idempotente e então inicia o Next.js.

Não use SQLite no filesystem padrão do Render: os arquivos gravados pelo serviço
são efêmeros e desaparecem em reinícios e novos deploys.

## Perfis e acesso

O acesso é por perfil, e cada aba do painel só existe para quem pode vê-la:

| | Dashboard | Indicadores | Calendário | Importação | Solicitações | Conciliação | Pagamentos | Adiantamentos | Configurações | Administração |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **Funcionário** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | | |
| **Gestor** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| **Coordenador** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Todos os perfis acessam Dashboard, Indicadores, Calendário, Importação, Solicitações e Conciliação.
A operação de pagamentos permanece restrita a Gestor e Coordenador. Coordenador
tem acesso total, incluindo as ações críticas (cancelar e reabrir pagamento,
gerenciar usuários e permissões).

## Gestão financeira avançada

- **Alçadas:** regras por faixa de valor, obra, categoria ou tag, com perfil mínimo,
  quantidade de aprovadores e bloqueio de autoaprovação. Os padrões iniciais são
  Gestor até R$ 5 mil, Coordenador acima desse valor e dupla aprovação de
  Coordenador para a tag `Extraordinário`.
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
funcionário (menor privilégio) e não entra até um coordenador aprovar e definir
o perfil. O coordenador também pode criar contas direto, já ativas.

O sistema impede que o último coordenador ativo se rebaixe, se desative ou seja
excluído — sem isso, dá para ficar sem ninguém capaz de gerenciar o acesso.
Usuário com histórico (importações, pagamentos, ações) é desativado em vez de
excluído, para não quebrar a auditoria.

## Solicitações de pagamento

Antes de entrar no fluxo diário, qualquer colaborador pode abrir uma solicitação
para uma obra à qual esteja vinculado. Fornecedor, valor, vencimento, descrição,
obra e ao menos um anexo são obrigatórios; os anexos aceitos são PDF, JPG e PNG,
com até 5 MB cada e no máximo cinco por solicitação.

Cada obra tem um **responsável pela aprovação**, definido por um coordenador na
aba **Permissões**. O responsável — ou um coordenador — aprova ou reprova a
solicitação, sempre com motivo na reprovação. A aprovação registra responsável,
data e histórico, mas não cria pagamento automaticamente: a solicitação aprovada
fica pronta para conferência e posterior inclusão no fluxo diário.

## Importação

Aceita `.xlsx` e `.csv`. As colunas são reconhecidas por nome, com aliases:

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
do fluxo. Apenas um **Coordenador** pode reabrir um fluxo fechado, informando
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
  check-converter.ts  valida a conversão e reimportação de planilhas
```

Stack: Next 16 (App Router), React 19, TypeScript, Prisma 7 com PostgreSQL
(`@prisma/adapter-pg`), Zod para validação, `jose` para a sessão JWT, `bcryptjs`
para as senhas, ExcelJS e `csv-parse` para a importação.

## Dados e privacidade

O `.gitignore` mantém fora do versionamento o `.env` e as planilhas (`*.xlsx`,
`*.xls`) — elas contêm nomes de fornecedores e
funcionários e valores reais. Use `samples/conta-azul-exemplo.csv` como
referência de formato.
