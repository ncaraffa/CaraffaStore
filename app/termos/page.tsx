import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Uso",
};

export default function TermosPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem", lineHeight: 1.6 }}>
      <h1>Termos de Uso</h1>
      <p>
        <strong>
          Este texto é uma minuta preparada para operação em piloto controlado e ainda precisa de
          revisão jurídica antes de qualquer lançamento público amplo.
        </strong>
      </p>

      <h2>1. O que é a plataforma</h2>
      <p>
        Esta plataforma (&quot;CaraffaStore&quot;) é um serviço SaaS multi-tenant que permite a
        pequenos comerciantes (&quot;lojistas&quot;) criar, administrar e operar lojas virtuais
        próprias, incluindo catálogo de produtos, carrinho, checkout e recebimento de pagamentos via
        Pix.
      </p>

      <h2>2. Operador da plataforma</h2>
      <p>
        Operador: Caraffa
        <br />
        CPF: 078.661.751-95
        <br />
        Contato: caraffastore@gmail.com
      </p>

      <h2>3. Cadastro do lojista</h2>
      <p>
        O lojista se cadastra com e-mail e senha, confirma o e-mail e conclui um onboarding que
        cria sua loja (nome, slug, WhatsApp) e registra a escolha de um plano mensal. A loja
        permanece em estado <code>pending_payment</code> até que a ativação (hoje um procedimento
        manual documentado internamente — ver contato do operador) seja concluída.
      </p>

      <h2>4. Planos e cobrança</h2>
      <p>
        A plataforma oferece planos mensais de R$ 30, R$ 50 ou R$ 70, escolhidos no onboarding. A
        cobrança recorrente automatizada desses planos ainda não está implementada nesta fase
        piloto — a ativação/renovação de loja é feita manualmente pelo operador, mediante acordo
        direto com o lojista. Isso será revisado antes de qualquer operação em maior escala.
      </p>

      <h2>5. Pagamentos das vendas (Pix)</h2>
      <p>
        Cada loja pode configurar suas próprias credenciais do Mercado Pago para receber pagamentos
        Pix diretamente dos seus clientes finais. A plataforma nunca processa, retém ou tem acesso
        aos valores recebidos pelo lojista — atua apenas como intermediária técnica entre o pedido
        do cliente final e a API do Mercado Pago, usando as credenciais do próprio lojista.
      </p>

      <h2>6. Responsabilidades do lojista</h2>
      <ul>
        <li>Manter suas credenciais de acesso e do Mercado Pago em sigilo.</li>
        <li>Fornecer informações verdadeiras sobre sua loja e produtos.</li>
        <li>Cumprir a legislação aplicável às suas vendas (fiscal, consumidor, etc.).</li>
        <li>Responder por reembolsos, trocas e atendimento aos seus próprios clientes finais.</li>
      </ul>

      <h2>7. Disponibilidade e limitações</h2>
      <p>
        Este é um serviço em fase de piloto controlado. Não há garantia de disponibilidade
        contínua (SLA) nesta fase. Funcionalidades podem mudar sem aviso prévio enquanto o produto
        estiver em validação.
      </p>

      <h2>8. Contato</h2>
      <p>
        Dúvidas sobre estes termos: caraffastore@gmail.com.
      </p>

      <p style={{ marginTop: "2rem" }}>
        <a href="/privacidade">Política de Privacidade</a>
      </p>
    </main>
  );
}
