/**
 * Normaliza telefone/WhatsApp digitado pelo cliente para o formato exigido
 * pela RPC create_order (supabase/migrations/0006_orders.sql:
 * `^\+?[0-9]{8,15}$`) — mantém só dígitos e um `+` inicial opcional.
 * Retorna null quando o resultado não tem um número plausível de dígitos
 * (8 a 15), para o chamador rejeitar antes de ir ao banco.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return (hasPlus ? "+" : "") + digits;
}
