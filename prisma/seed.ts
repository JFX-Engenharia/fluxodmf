import "dotenv/config";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Role, UserStatus } from "../generated/prisma/enums";
import { getDatabaseUrl } from "../src/lib/database-url";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: getDatabaseUrl() }),
});


async function upsertUser(input: {
  name: string;
  username: string;
  email: string;
  role: Role;
  status: UserStatus;
  password: string;
  phone?: string;
}) {
  const passwordHash = await hash(input.password, 12);
  return prisma.user.upsert({
    where: { username: input.username },
    // O seed também roda quando o serviço inicia no Render. Não sobrescrever
    // senha, perfil ou status de uma conta que já existe.
    update: {},
    create: {
      name: input.name,
      username: input.username,
      email: input.email,
      role: input.role,
      status: input.status,
      passwordHash,
      phone: input.phone,
    },
  });
}

async function main() {
  // Login inicial pedido na especificacao: jfx / jfx. So o nome exibido e o
  // e-mail sao genericos; as credenciais seguem as combinadas.
  await upsertUser({
    name: "Administrador",
    username: "jfx",
    email: "admin@djfluxo.local",
    role: Role.ADMINISTRADOR,
    status: UserStatus.ATIVO,
    password: "jfx",
  });

  console.log("Seed concluido.");
  console.log("Acesso inicial, se criado agora: jfx / jfx (Administrador)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
