/**
 * Mensagens fixas e neutras para os fluxos de auth. Nenhuma delas pode
 * variar com base em "o e-mail existe ou não" — ver T2-DEC-011 e
 * docs/DECISIONS.md ("mensagens de cadastro, login e recuperação nunca
 * confirmam se o e-mail já possui conta").
 */
export const SIGNUP_RESULT_MESSAGE =
  "Se o e-mail informado for válido, enviamos instruções de confirmação. Verifique sua caixa de entrada.";

export const LOGIN_FAILED_MESSAGE = "E-mail ou senha inválidos.";

export const RECOVERY_REQUEST_MESSAGE =
  "Se este e-mail tiver uma conta, enviamos instruções de recuperação de senha.";

export const RESEND_VERIFICATION_MESSAGE =
  "Se sua conta ainda não estiver confirmada, reenviamos as instruções por e-mail.";

export const RESET_LINK_INVALID_MESSAGE =
  "Este link de recuperação é inválido ou expirou. Solicite um novo.";

export const GENERIC_UNEXPECTED_ERROR_MESSAGE =
  "Não foi possível concluir agora. Tente novamente em instantes.";

export const RATE_LIMITED_MESSAGE = "Muitas tentativas. Aguarde um pouco antes de tentar novamente.";

export const CAPTCHA_FAILED_MESSAGE = "Não foi possível validar o CAPTCHA. Tente novamente.";
