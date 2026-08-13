import { z } from "zod";
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";

export { PASSWORD_MAX_BYTES, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
/**
 * bcrypt ignora tudo alem de 72 BYTES: sem este teto, duas senhas longas com o
 * mesmo prefixo autenticariam uma a outra. O limite tambem impede que um corpo
 * gigante gaste CPU no hash. Como o corte do bcrypt e em bytes e nao em
 * caracteres, checamos os dois: um caractere acentuado ocupa 2 bytes em UTF-8 e
 * um emoji chega a 4, entao uma senha de 72 caracteres pode passar de 72 bytes
 * e ser truncada silenciosamente.
 */
const utf8 = new TextEncoder();

/** Regra unica de senha, compartilhada por autocadastro e gestao de usuarios. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A senha precisa de ao menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(PASSWORD_MAX_LENGTH, `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`)
  .refine((value) => utf8.encode(value).length <= PASSWORD_MAX_BYTES, {
    message: `A senha é longa demais: o limite é de ${PASSWORD_MAX_BYTES} bytes, e acentos e emojis ocupam mais de um byte cada. Use menos caracteres especiais.`,
  });
