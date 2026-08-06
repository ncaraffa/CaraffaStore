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
      actions={
        <Link href={`/loja/${storeSlug}`}>
          <Button variant="outline">Voltar para a loja</Button>
        </Link>
      }
    >
      <p>
        Código do pedido: <strong>{publicCode}</strong>
      </p>
      <p>Guarde este código. O comerciante vai entrar em contato para combinar o pagamento e os próximos passos.</p>
    </StatusPage>
  );
}
