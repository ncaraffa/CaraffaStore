/**
 * Mensagens fixas e neutras para os fluxos de auth. Nenhuma delas pode
 * variar com base em "o e-mail existe ou não" — ver T2-DEC-011 e
 * docs/DECISIONS.md ("mensagens de cadastro, login e recuperação nunca
 * confirmam se o e-mail já possui conta").
 */
/**
 * O aviso de demora é real, não hedge defensivo: a entrega do e-mail de
 * confirmação leva alguns minutos de fato. Sem dizer isso, a pessoa acha
 * que falhou, tenta de novo, esbarra no rate limit e desiste no meio do
 * cadastro. Continua neutro quanto à existência da conta (T2-DEC-011).
 */
export const SIGNUP_RESULT_MESSAGE =
  "Se o e-mail informado for válido, enviamos instruções de confirmação. Verifique sua caixa de entrada — o e-mail pode levar alguns minutos para chegar.";

export const LOGIN_FAILED_MESSAGE = "E-mail ou senha inválidos.";

export const RECOVERY_REQUEST_MESSAGE =
  "Se este e-mail tiver uma conta, enviamos instruções de recuperação de senha.";

export const RESEND_VERIFICATION_MESSAGE =
  "Se sua conta ainda não estiver confirmada, reenviamos as instruções por e-mail. Aguarde alguns minutos antes de pedir de novo.";

export const RESET_LINK_INVALID_MESSAGE =
  "Este link de recuperação é inválido ou expirou. Solicite um novo.";

export const GENERIC_UNEXPECTED_ERROR_MESSAGE =
  "Não foi possível concluir agora. Tente novamente em instantes.";

export const RATE_LIMITED_MESSAGE = "Muitas tentativas. Aguarde um pouco antes de tentar novamente.";

export const CAPTCHA_FAILED_MESSAGE = "Não foi possível validar o CAPTCHA. Tente novamente.";
