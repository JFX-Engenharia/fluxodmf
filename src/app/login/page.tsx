import { BrandMark } from "@/components/BrandMark";
import { LoginForm } from "@/components/LoginForm";
import { BarChart3, CheckCircle2, ShieldCheck } from "lucide-react";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ corporate?: string }>;
}) {
  const { corporate } = await searchParams;
  return (
    <main className="login-shell">
      <div className="login-layout">
        <section className="login-hero" aria-labelledby="login-hero-title">
          <div className="login-brand">
            <BrandMark />
            <div>
              <strong>DJ Fluxo</strong>
              <span>Gestão financeira</span>
            </div>
          </div>

          <div className="login-hero-copy">
            <span className="eyebrow">CONTROLE DE PONTA A PONTA</span>
            <h2 id="login-hero-title">Decisões financeiras mais simples, rápidas e seguras.</h2>
            <p>
              Centralize importações, aprovações e conciliações em um fluxo claro para toda a
              equipe.
            </p>
          </div>

          <div className="login-benefits" aria-label="Benefícios da plataforma">
            <div>
              <span><BarChart3 size={18} /></span>
              <p><strong>Visão consolidada</strong>Indicadores e saldos em um só lugar.</p>
            </div>
            <div>
              <span><CheckCircle2 size={18} /></span>
              <p><strong>Aprovações ágeis</strong>Fluxos organizados e rastreáveis.</p>
            </div>
            <div>
              <span><ShieldCheck size={18} /></span>
              <p><strong>Acesso seguro</strong>Permissões adequadas a cada perfil.</p>
            </div>
          </div>
        </section>

        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-panel-heading">
            <span className="login-panel-mark"><BrandMark /></span>
            <span className="eyebrow">BEM-VINDO DE VOLTA</span>
            <h1 className="login-title" id="login-title">Acesse sua conta</h1>
            <p className="login-subtitle">Entre para acompanhar o fluxo de pagamentos.</p>
          </div>
          <LoginForm corporateStatus={corporate} />
          <p className="login-help">Ambiente restrito · Seus dados permanecem protegidos</p>
        </section>
      </div>
    </main>
  );
}
