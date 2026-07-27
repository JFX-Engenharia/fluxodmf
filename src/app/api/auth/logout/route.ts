import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getSession, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST() {
  const session = await getSession();
  if (session) {
    await prisma.userSession.updateMany({
      where: { id: session.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await auditLog({
      actorId: session.id,
      event: "LOGOUT",
      entity: "User",
      entityId: session.id,
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  return response;
}
