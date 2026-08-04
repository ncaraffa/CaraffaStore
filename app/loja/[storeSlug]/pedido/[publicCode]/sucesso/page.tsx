import { notFound } from "next/navigation";

const PUBLIC_CODE_FORMAT = /^[0-9A-Z]{8}$/;

/**
 * Nenhuma consulta ao banco nesta página — de propósito. `publicCode` vem
 * só da URL (preenchida pelo redirecionamento após o checkout bem-
 * sucedido, lib/orders/service.ts:createOrder), nunca é usado para ler
 * dados administrativos do pedido. Isso garante, por construção, que
 * nenhum dado pessoal de OUTRO pedido, nem detalhe administrativo, pode
 * vazar por aqui — a página não tem acesso a nada além do próprio código.
 */
export default async function OrderSuccessPage({
  params,
}: {
  params: Promise<{ storeSlug: string; publicCode: string }>;
}) {
  const { storeSlug, publicCode } = await params;
  if (!PUBLIC_CODE_FORMAT.test(publicCode)) {
    notFound();
  }

  return (
    <main>
      <h1>Pedido recebido!</h1>
      <p>
        Código do pedido: <strong>{publicCode}</strong>
      </p>
      <p>Guarde este código. O comerciante vai entrar em contato para combinar o pagamento e os próximos passos.</p>
      <p>
        <a href={`/loja/${storeSlug}`}>← Voltar para a loja</a>
      </p>
    </main>
  );
}
