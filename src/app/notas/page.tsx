import { redirect } from "next/navigation";
import { NotasShell } from "@/components/notas/NotasShell";
import { getSession } from "@/lib/auth";
import { canAccessTab } from "@/lib/permissions";

export default async function NotasPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canAccessTab(session.role, "notas")) redirect("/painel");

  return <NotasShell ownerId={session.id} />;
}
