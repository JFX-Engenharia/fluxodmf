import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { getDatabaseUrl } from "@/lib/database-url";

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

// Invalida o singleton após migrações que alteram os delegates do Prisma. Sem
// isso, o Fast Refresh pode conservar um cliente criado antes do `generate`.
const PRISMA_RUNTIME_VERSION = "20260814000000_colaborador_receipt_notes";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClientInstance;
  prismaRuntimeVersion?: string;
};

const adapter = new PrismaPg({ connectionString: getDatabaseUrl() });

if (globalForPrisma.prisma && globalForPrisma.prismaRuntimeVersion !== PRISMA_RUNTIME_VERSION) {
  void globalForPrisma.prisma.$disconnect();
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaRuntimeVersion = PRISMA_RUNTIME_VERSION;
}
