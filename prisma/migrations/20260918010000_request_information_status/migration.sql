-- Separada das tabelas que usam o novo valor: o PostgreSQL exige o commit do enum.
ALTER TYPE "PaymentRequestStatus" ADD VALUE 'INFO_SOLICITADA';
