-- Login corporativo e controle de sessões.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "authProvider" TEXT;
ALTER TABLE "User" ADD COLUMN "externalSubject" TEXT;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_authProvider_externalSubject_key" ON "User"("authProvider", "externalSubject");

CREATE TABLE "UserSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'local',
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "device" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UserSession_userId_revokedAt_expiresAt_idx" ON "UserSession"("userId", "revokedAt", "expiresAt");

CREATE TABLE "LoginEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "identifier" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'local',
  "success" BOOLEAN NOT NULL,
  "reason" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "device" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId", "createdAt");
CREATE INDEX "LoginEvent_createdAt_idx" ON "LoginEvent"("createdAt");

-- Chaves de repetição para operações críticas.
CREATE TABLE "IdempotencyKey" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "actorId" TEXT,
  "status" INTEGER NOT NULL,
  "response" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdempotencyKey_scope_key_key" ON "IdempotencyKey"("scope", "key");
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- Contexto operacional da manutenção.
ALTER TABLE "MaintenanceNotice" ADD COLUMN "reason" TEXT;
ALTER TABLE "MaintenanceNotice" ADD COLUMN "estimatedEndAt" TIMESTAMP(3);
