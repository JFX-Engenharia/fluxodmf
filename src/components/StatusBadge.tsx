import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  HelpCircle,
  Hourglass,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { statusLabels } from "@/lib/format";

type Props = {
  status: keyof typeof statusLabels;
};

const statusIcons: Record<Props["status"], React.ComponentType<{ size?: number }>> = {
  PENDENTE: Clock3,
  EM_ANALISE: Hourglass,
  APROVADO: CheckCircle2,
  REPROVADO: XCircle,
  TRANSFERIDO: CalendarClock,
  INFO_SOLICITADA: HelpCircle,
  CORRIGIDO: RotateCcw,
  CANCELADO: XCircle,
};

export function StatusBadge({ status }: Props) {
  const Icon = statusIcons[status];

  return (
    <span className={`status ${status}`}>
      <Icon size={13} />
      {statusLabels[status]}
    </span>
  );
}
