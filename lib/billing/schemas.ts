import { z } from "zod";

export const billingChargeSchema = z.object({
  payerEmail: z.string().trim().email("Informe um e-mail válido.").max(200, "E-mail muito longo."),
  payerDocument: z.string().trim().min(11, "Informe um CPF ou CNPJ válido.").max(20, "Documento inválido."),
});
