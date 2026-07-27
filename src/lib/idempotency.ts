import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";

type IdempotentOperation = {
  request: Request;
  scope: string;
  actorId: string;
  execute: () => Promise<Response>;
};


export async function withIdempotency(operation: IdempotentOperation) {
  const key = operation.request.headers.get("Idempotency-Key")?.trim();
  if (!key || key.length > 100 || !/^[a-zA-Z0-9._:-]+$/.test(key)) {
    throw new ApiError(400, "Informe uma chave de idempotência válida.");
  }
  const scope = `${operation.scope}:${operation.actorId}`;
  const existing = await prisma.idempotencyKey.findUnique({
    where: { scope_key: { scope, key } },
  });
  if (existing) {
    if (existing.expiresAt <= new Date()) {
      await prisma.idempotencyKey.delete({ where: { id: existing.id } });
    } else if (existing.status === 102) {
      return NextResponse.json({ error: "Esta operação já está em processamento." }, { status: 409 });
    } else {
      return new Response(existing.response, {
        status: existing.status,
        headers: { "Content-Type": "application/json; charset=utf-8", "X-Idempotent-Replay": "true" },
      });
    }
  }

  const reservation = await prisma.idempotencyKey.create({
    data: {
      scope,
      key,
      actorId: operation.actorId,
      status: 102,
      response: "{}",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
    },
  }).catch(async () => {
    const duplicate = await prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (!duplicate || duplicate.status === 102) {
      throw new ApiError(409, "Esta operação já está em processamento.");
    }
    return duplicate;
  });

  if (reservation.status !== 102) {
    return new Response(reservation.response, {
      status: reservation.status,
      headers: { "Content-Type": "application/json; charset=utf-8", "X-Idempotent-Replay": "true" },
    });
  }

  try {
    const response = await operation.execute();
    const body = await response.clone().text();
    if (response.status >= 500) {
      await prisma.idempotencyKey.delete({ where: { id: reservation.id } });
    } else {
      await prisma.idempotencyKey.update({
        where: { id: reservation.id },
        data: { status: response.status, response: body },
      });
    }
    return response;
  } catch (error) {
    await prisma.idempotencyKey.deleteMany({ where: { id: reservation.id, status: 102 } });
    throw error;
  }
}
