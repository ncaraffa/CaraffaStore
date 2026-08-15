import { notFound } from "next/navigation";
import { StatusPage } from "@/components/onboarding/StatusPage";
import { Button } from "@/components/ui/Button";
import { IconCheck } from "@/components/ui/icons";
import Link from "next/link";

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
    <StatusPage
      icon={<IconCheck />}
      title="Pedido recebido!"
      tone="success"
      actions={
        <Link href={`/loja/${storeSlug}`}>
          <Button as="span" variant="outline">Voltar para a loja</Button>
        </Link>
      }
    >
      <p>
        Código do pedido: <strong>{publicCode}</strong>
      </p>
      {/* O texto antigo dizia que o comerciante entraria em contato para
          combinar o pagamento — isso descrevia o fluxo anterior ao Pix e
          contradizia o que o cliente acabou de fazer na tela de pagamento. */}
      <p>Guarde este código: é por ele que o comerciante identifica o seu pedido.</p>
    </StatusPage>
  );
}
