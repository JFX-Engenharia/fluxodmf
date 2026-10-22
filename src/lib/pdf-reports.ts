import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { CajuTransaction } from "@/lib/reconciliation";

const ORANGE = rgb(0.949, 0.42, 0.12);
const PEACH = rgb(0.98, 0.85, 0.77);
const PEACH_LIGHT = rgb(0.99, 0.91, 0.86);
const DARK = rgb(0.12, 0.1, 0.09);
const MUTED = rgb(0.4, 0.38, 0.36);
const WHITE = rgb(1, 1, 1);
const A4_PORTRAIT: [number, number] = [595.28, 841.89];
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];

function safeText(value: unknown) {
  return String(value ?? "-")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "-");
}

function fitText(value: unknown, font: PDFFont, size: number, maxWidth: number) {
  const text = safeText(value);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const suffix = "...";
  let shortened = text;
  while (
    shortened.length > 0 &&
    font.widthOfTextAtSize(`${shortened}${suffix}`, size) > maxWidth
  ) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}${suffix}`;
}

function brl(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.replace(/\u00A0/g, " ");
}

function brDate(value: string | Date | null | undefined, withTime = false) {
  if (!value) return "-";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function addPageNumbers(document: PDFDocument, font: PDFFont) {
  const pages = document.getPages();
  pages.forEach((page, index) => {
    const label = `Página ${index + 1} de ${pages.length}`;
    const width = font.widthOfTextAtSize(label, 8);
    page.drawText(label, {
      x: page.getWidth() - 28 - width,
      y: 16,
      size: 8,
      font,
      color: MUTED,
    });
  });
}

type TableColumn<T> = {
  label: string;
  width: number;
  align?: "left" | "right";
  value: (row: T) => string;
};

function drawHeader<T>(input: {
  page: PDFPage;
  x: number;
  y: number;
  height: number;
  columns: TableColumn<T>[];
  font: PDFFont;
  size: number;
}) {
  let x = input.x;
  for (const column of input.columns) {
    input.page.drawRectangle({
      x,
      y: input.y - input.height,
      width: column.width,
      height: input.height,
      color: ORANGE,
      borderColor: WHITE,
      borderWidth: 1,
    });
    input.page.drawText(fitText(column.label, input.font, input.size, column.width - 8), {
      x: x + 4,
      y: input.y - input.height + 6,
      size: input.size,
      font: input.font,
      color: WHITE,
    });
    x += column.width;
  }
}

function drawRow<T>(input: {
  page: PDFPage;
  x: number;
  y: number;
  height: number;
  columns: TableColumn<T>[];
  row: T;
  font: PDFFont;
  size: number;
  alternate: boolean;
}) {
  let x = input.x;
  for (const column of input.columns) {
    const value = fitText(column.value(input.row), input.font, input.size, column.width - 8);
    const textWidth = input.font.widthOfTextAtSize(value, input.size);
    input.page.drawRectangle({
      x,
      y: input.y - input.height,
      width: column.width,
      height: input.height,
      color: input.alternate ? PEACH_LIGHT : PEACH,
      borderColor: WHITE,
      borderWidth: 1,
    });
    input.page.drawText(value, {
      x:
        column.align === "right"
          ? x + column.width - textWidth - 4
          : x + 4,
      y: input.y - input.height + 6,
      size: input.size,
      font: input.font,
      color: DARK,
    });
    x += column.width;
  }
}

export async function buildMissingNotesPdf(input: {
  rows: CajuTransaction[];
  collaborators: string[];
}) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(`Auditoria de notas faltantes - ${input.collaborators.join(", ")}`);
  document.setAuthor("DJ Fluxo");
  document.setCreator("DJ Fluxo");

  const columns: TableColumn<CajuTransaction>[] = [
    { label: "Nome do Colaborador", width: 158, value: (row) => row.collaborator || "-" },
    { label: "Tipo de Transação", width: 102, value: (row) => row.type || "-" },
    { label: "Nome do Estabelecimento", width: 188, value: (row) => row.merchant || "-" },
    { label: "Valor (R$)", width: 88, align: "right", value: (row) => brl(row.amount) },
    { label: "Data", width: 82, value: (row) => brDate(row.date) },
    {
      label: "Status da Transação",
      width: 152,
      value: (row) => row.transactionStatus || "-",
    },
  ];

  const margin = 36;
  const top = A4_LANDSCAPE[1] - 58;
  const headerHeight = 23;
  const rowHeight = 22;
  let page = document.addPage(A4_LANDSCAPE);
  let y = top;

  const startTable = () => {
    drawHeader({ page, x: margin, y, height: headerHeight, columns, font: bold, size: 9.5 });
    y -= headerHeight;
  };

  startTable();

  if (input.rows.length === 0) {
    page.drawText("Nenhuma nota faltante encontrada.", {
      x: margin,
      y: y - 28,
      size: 12,
      font: regular,
      color: MUTED,
    });
  }

  input.rows.forEach((row, index) => {
    if (y - rowHeight < 42) {
      page = document.addPage(A4_LANDSCAPE);
      y = top;
      startTable();
    }
    drawRow({
      page,
      x: margin,
      y,
      height: rowHeight,
      columns,
      row,
      font: regular,
      size: 9.5,
      alternate: index % 2 === 1,
    });
    y -= rowHeight;
  });

  addPageNumbers(document, regular);
  return document.save();
}

type FlowReportPayment = {
  supplierName: string;
  amount: number | string | { toString(): string };
  currentDueDate: Date;
  status: string;
  work: { name: string };
  allocations: Array<{ percentage: number | string | { toString(): string }; work: { name: string } }>;
};

type FlowReportEvent = {
  type: string;
  reason: string | null;
  createdAt: Date;
  actor: { name: string };
};

type FlowReport = {
  name: string;
  createdAt: Date;
  closedAt: Date | null;
  importedBy: string;
  closedBy: string;
  summary: {
    total: { count: number; amount: number };
    approved: { count: number; amount: number };
    rejected: { count: number; amount: number };
    transferred: { count: number; amount: number };
    cancelled: { count: number; amount: number };
  };
  payments: FlowReportPayment[];
  events: FlowReportEvent[];
};

function numberFromDecimal(value: FlowReportPayment["amount"]) {
  return typeof value === "number" ? value : Number(value.toString());
}

export async function buildDailyFlowReportPdf(flow: FlowReport) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(`Relatório final - ${flow.name}`);
  document.setAuthor("DJ Fluxo");

  const margin = 36;
  const pageWidth = A4_PORTRAIT[0];
  const pageHeight = A4_PORTRAIT[1];
  let page = document.addPage(A4_PORTRAIT);
  let y = pageHeight - margin;

  const newPage = () => {
    page = document.addPage(A4_PORTRAIT);
    y = pageHeight - margin;
  };
  const ensure = (height: number) => {
    if (y - height < 44) newPage();
  };
  const line = (label: string, value: string) => {
    ensure(18);
    page.drawText(label, { x: margin, y, size: 9, font: bold, color: MUTED });
    page.drawText(fitText(value, regular, 10, pageWidth - 2 * margin - 135), {
      x: margin + 135,
      y,
      size: 10,
      font: regular,
      color: DARK,
    });
    y -= 18;
  };
  const section = (title: string) => {
    ensure(34);
    y -= 8;
    page.drawRectangle({ x: margin, y: y - 21, width: pageWidth - 2 * margin, height: 24, color: ORANGE });
    page.drawText(title, { x: margin + 8, y: y - 13, size: 11, font: bold, color: WHITE });
    y -= 30;
  };

  page.drawText("RELATÓRIO FINAL DO FLUXO DIÁRIO", {
    x: margin,
    y,
    size: 18,
    font: bold,
    color: ORANGE,
  });
  y -= 28;
  line("Identificação", flow.name);
  line("Importado em", brDate(flow.createdAt, true));
  line("Importado por", flow.importedBy);
  line("Fechado em", brDate(flow.closedAt, true));
  line("Fechado por", flow.closedBy);

  section("Resumo do fechamento");
  const summaryRows = [
    ["Total", flow.summary.total],
    ["Aprovados", flow.summary.approved],
    ["Reprovados", flow.summary.rejected],
    ["Remarcados", flow.summary.transferred],
    ["Cancelados", flow.summary.cancelled],
  ] as const;
  summaryRows.forEach(([label, value], index) => {
    ensure(22);
    page.drawRectangle({
      x: margin,
      y: y - 17,
      width: pageWidth - 2 * margin,
      height: 20,
      color: index % 2 ? PEACH_LIGHT : PEACH,
    });
    page.drawText(label, { x: margin + 6, y: y - 10, size: 10, font: bold, color: DARK });
    page.drawText(`${value.count} pagamento(s)`, {
      x: margin + 190,
      y: y - 10,
      size: 10,
      font: regular,
      color: DARK,
    });
    const amount = brl(value.amount);
    page.drawText(amount, {
      x: pageWidth - margin - regular.widthOfTextAtSize(amount, 10) - 6,
      y: y - 10,
      size: 10,
      font: regular,
      color: DARK,
    });
    y -= 20;
  });

  section("Pagamentos do fluxo");
  const paymentColumns: TableColumn<FlowReportPayment>[] = [
    { label: "Fornecedor", width: 155, value: (row) => row.supplierName },
    {
      label: "Conta / rateio",
      width: 150,
      value: (row) => row.allocations.length
        ? row.allocations.map((item) => `${item.work.name} ${Number(item.percentage.toString())}%`).join(" / ")
        : row.work.name,
    },
    { label: "Vencimento", width: 65, value: (row) => brDate(row.currentDueDate) },
    { label: "Status", width: 75, value: (row) => row.status.replaceAll("_", " ") },
    { label: "Valor", width: 78, align: "right", value: (row) => brl(numberFromDecimal(row.amount)) },
  ];
  const paymentHeader = () => {
    ensure(46);
    drawHeader({ page, x: margin, y, height: 22, columns: paymentColumns, font: bold, size: 8.5 });
    y -= 22;
  };
  paymentHeader();
  flow.payments.forEach((payment, index) => {
    if (y - 21 < 44) {
      newPage();
      paymentHeader();
    }
    drawRow({
      page,
      x: margin,
      y,
      height: 21,
      columns: paymentColumns,
      row: payment,
      font: regular,
      size: 8.5,
      alternate: index % 2 === 1,
    });
    y -= 21;
  });

  section("Histórico do fechamento e reaberturas");
  const eventColumns: TableColumn<FlowReportEvent>[] = [
    { label: "Data", width: 100, value: (row) => brDate(row.createdAt, true) },
    { label: "Ação", width: 112, value: (row) => row.type.replaceAll("_", " ") },
    { label: "Responsável", width: 120, value: (row) => row.actor.name },
    { label: "Motivo", width: 191, value: (row) => row.reason || "-" },
  ];
  const eventHeader = () => {
    ensure(46);
    drawHeader({ page, x: margin, y, height: 22, columns: eventColumns, font: bold, size: 8.5 });
    y -= 22;
  };
  eventHeader();
  flow.events.forEach((event, index) => {
    if (y - 21 < 44) {
      newPage();
      eventHeader();
    }
    drawRow({
      page,
      x: margin,
      y,
      height: 21,
      columns: eventColumns,
      row: event,
      font: regular,
      size: 8.5,
      alternate: index % 2 === 1,
    });
    y -= 21;
  });

  addPageNumbers(document, regular);
  return document.save();
}

export function pdfContentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
