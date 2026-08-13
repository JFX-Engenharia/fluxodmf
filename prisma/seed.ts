import "dotenv/config";
import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Role, UserStatus } from "../generated/prisma/enums";
import { getDatabaseUrl } from "../src/lib/database-url";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: getDatabaseUrl() }),
});

type SeedUserInput = {
  name: string;
  username: string;
  email: string;
  role: Role;
  status: UserStatus;
  passwordEnv: "SEED_ADMIN_PASSWORD" | "SEED_ARTHUR_PASSWORD";
  phone?: string;
};

async function createUserIfMissing(input: SeedUserInput) {
  const existing = await prisma.user.findUnique({
    where: { username: input.username },
    select: { id: true },
  });
  if (existing) return null;

  const configuredPassword = process.env[input.passwordEnv]?.trim();
  const initialPassword = configuredPassword || randomBytes(24).toString("base64url");
  const passwordHash = await hash(initialPassword, 12);

  try {
    await prisma.user.create({
      data: {
        name: input.name,
        username: input.username,
        email: input.email,
        role: input.role,
        status: input.status,
        passwordHash,
        phone: input.phone,
      },
    });
  } catch (error) {
    // Dois boots concorrentes podem tentar criar o mesmo seed. Se outra
    // instancia venceu a corrida, nenhuma senha deve ser anunciada por este processo.
    const concurrentUser = await prisma.user.findUnique({
      where: { username: input.username },
      select: { id: true },
    });
    if (concurrentUser) return null;
    throw error;
  }

  return initialPassword;
}

async function main() {
  const initialCredentials: Array<{ username: string; password: string }> = [];

  const adminPassword = await createUserIfMissing({
    name: "Administrador",
    username: "jfx",
    email: "admin@djfluxo.local",
    role: Role.ADMINISTRADOR,
    status: UserStatus.ATIVO,
    passwordEnv: "SEED_ADMIN_PASSWORD",
  });
  if (adminPassword) initialCredentials.push({ username: "jfx", password: adminPassword });

  const arthurPassword = await createUserIfMissing({
    name: "Arthur",
    username: "arthur",
    email: "arthur@djfluxo.local",
    role: Role.ADMINISTRADOR,
    status: UserStatus.ATIVO,
    passwordEnv: "SEED_ARTHUR_PASSWORD",
  });
  if (arthurPassword) {
    initialCredentials.push({ username: "arthur", password: arthurPassword });
  }

  console.log("Seed concluido.");
  for (const credential of initialCredentials) {
    console.log(
      `Credencial inicial criada para ${credential.username}: ${credential.password} (troque no primeiro login)`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
