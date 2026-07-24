-- Renomeia os perfis existentes sem perder os usuários associados.
ALTER TYPE "Role" RENAME VALUE 'FUNCIONARIO' TO 'OPERADOR';
ALTER TYPE "Role" RENAME VALUE 'COORDENADOR' TO 'ADMINISTRADOR';
ALTER TYPE "Role" ADD VALUE 'APROVADOR';

-- As alçadas que antes dependiam do gestor passam ao perfil dedicado de aprovação.
UPDATE "ApprovalRule"
SET "requiredRole" = 'APROVADOR'
WHERE "requiredRole" = 'GESTOR';
