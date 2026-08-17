import { handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessTab, type TabId } from "@/lib/permissions";

type SearchResult = {
  id: string;
  type: "payment" | "request" | "work";
  title: string;
  subtitle: string;
  tab: TabId;
};

function numericSearch(query: string) {
  const normalized = query.trim().replace(/R\$\s*/i, "").replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export async function GET(request: Request) {
  try {
    // Busca global do painel: exige acesso ao painel, nao apenas sessao valida.
    const user = await requireTab("dashboard");
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2) return ok({ results: [] });
    const amount = numericSearch(query);
    const text = { contains: query, mode: "insensitive" as const };
    const results: SearchResult[] = [];

    const [works, requests, payments] = await Promise.all([
      prisma.work.findMany({
        where: {
          OR: [
            { name: text },
            { slug: text },
            { costCenterAliases: text },
            { approvers: { some: { user: { name: text } } } },
          ],
        },
        take: 8,
        orderBy: { name: "asc" },
        include: { approvers: { select: { user: { select: { name: true } } } } },
      }),
      prisma.paymentRequest.findMany({
        where: {
          AND: [
            user.role === "ADMINISTRADOR"
              ? {}
              : {
                  OR: [
                    { requestedById: user.id },
                    { approvals: { some: { approverId: user.id } } },
                    { workId: { in: user.works.map((item) => item.workId) } },
                  ],
                },
            {
              OR: [
                { supplierName: text },
                { description: text },
                { category: text },
                { work: { name: text } },
                { work: { approvers: { some: { user: { name: text } } } } },
                { attachments: { some: { fileName: text } } },
                ...(amount === null ? [] : [{ amount: { equals: amount } }]),
              ],
            },
          ],
        },
        take: 8,
        orderBy: { createdAt: "desc" },
        include: { work: true, requestedBy: { select: { name: true } } },
      }),
      canAccessTab(user.role, "pagamentos")
        ? prisma.payment.findMany({
            where: {
              OR: [
                { supplierName: text },
                { description: text },
                { costCenter: text },
                { category: text },
                { externalReference: text },
                { work: { name: text } },
                { work: { approvers: { some: { user: { name: text } } } } },
                { attachments: { some: { OR: [{ fileName: text }, { url: text }] } } },
                ...(amount === null ? [] : [{ amount: { equals: amount } }]),
              ],
            },
            take: 8,
            orderBy: { createdAt: "desc" },
            include: { work: true },
          })
        : Promise.resolve([]),
    ]);

    results.push(
      ...payments.map((payment) => ({
        id: payment.id,
        type: "payment" as const,
        title: payment.supplierName,
        subtitle: `${payment.description} · ${payment.work.name} · R$ ${Number(payment.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}${payment.externalReference ? ` · Ref. ${payment.externalReference}` : ""}`,
        tab: "pagamentos" as const,
      })),
      ...requests.map((item) => ({
        id: item.id,
        type: "request" as const,
        title: item.supplierName,
        subtitle: `${item.description} · ${item.work.name} · Solicitado por ${item.requestedBy.name} · R$ ${Number(item.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
        tab: "solicitacoes" as const,
      })),
      ...works.map((work) => ({
        id: work.id,
        type: "work" as const,
        title: work.name,
        subtitle: work.approvers.length
          ? `Responsáveis: ${work.approvers.map(({ user }) => user.name).join(", ")}`
          : "Sem responsável definido",
        tab: canAccessTab(user.role, "permissoes") ? "permissoes" as const : "dashboard" as const,
      })),
    );

    return ok({ results: results.slice(0, 20) });
  } catch (error) {
    return handleApiError(error);
  }
}
