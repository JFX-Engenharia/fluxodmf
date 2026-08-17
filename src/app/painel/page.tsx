import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PanelShell } from "@/components/panel/PanelShell";
import { getSession } from "@/lib/auth";
import { defaultTab } from "@/lib/permissions";

export default async function PainelPage() {
  // Guarda no servidor para nao servir o shell a quem nao tem sessao. O shell
  // revalida no cliente e cada rota de API checa o perfil por conta propria.
  const session = await getSession();
  if (!session) redirect("/login");

  // Rede de seguranca para o perfil que nao tem aba nenhuma do painel (o
  // colaborador de campo): cobre bookmark salvo e volta do OIDC, caminhos que
  // nao passam pelo redirect do formulario de login.
  if (defaultTab(session.role) === "notas") redirect("/notas");

  return (
    // O shell le a aba de ?tab=, e useSearchParams exige um limite de Suspense.
    <Suspense
      fallback={
        <div className="login-shell">
          <div className="panel pad">Carregando...</div>
        </div>
      }
    >
      <PanelShell />
    </Suspense>
  );
}
