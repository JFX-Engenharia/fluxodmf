import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { defaultTab } from "@/lib/permissions";

// A instalação compartilhada abre a área adequada ao perfil.
export default async function Home() {
  const session = await getSession();
  redirect(session ? defaultTab(session.role) === "notas" ? "/notas" : "/painel" : "/login");
}
