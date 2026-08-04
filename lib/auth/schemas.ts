import { z } from "zod";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";

export const emailSchema = z.string().trim().toLowerCase().email().max(255);

// Sem regex de composição — só comprimento. Espaços/frases-senha
// aceitos como digitados (T2-DEC-011).
export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  .max(MAX_PASSWORD_LENGTH, `A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`);

export const signupSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // Sem limite mínimo aqui: uma senha "errada" com 3 caracteres ainda
  // deve resultar na MESMA mensagem genérica de credencial inválida,
  // não num erro de validação diferenciado.
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  password: newPasswordSchema,
});

export const merchantProfileSchema = z.object({
  merchantName: z.string().trim().min(2).max(120),
  whatsapp: z
    .string()
    .trim()
    .min(8, "Informe um WhatsApp válido.")
    .max(20, "Informe um WhatsApp válido.")
    .regex(/^[0-9+()\-\s]+$/, "Use apenas números, espaços e os símbolos + ( ) -."),
});

export const storeNameSchema = z.object({
  storeName: z.string().trim().min(2).max(120),
});

export const slugSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, "Informe um endereço para a loja.")
    .max(80, "Endereço muito longo."),
});

export const planSchema = z.object({
  planCode: z.coerce.number().int().refine((value) => value === 30 || value === 50 || value === 80, {
    message: "Plano inválido.",
  }),
});
