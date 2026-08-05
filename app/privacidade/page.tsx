import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade",
};

export default function PrivacidadePage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem", lineHeight: 1.6 }}>
      <h1>Política de Privacidade</h1>
      <p>
        <strong>
          Este texto é uma minuta preparada para operação em piloto controlado e ainda precisa de
          revisão jurídica antes de qualquer lançamento público amplo.
        </strong>
      </p>

      <h2>1. Operador e controlador dos dados</h2>
      <p>
        Operador: [RAZÃO SOCIAL / NOME DO OPERADOR — A DEFINIR POR CARAFFA]
        <br />
        CNPJ: [CNPJ — A DEFINIR]
        <br />
        Endereço: [ENDEREÇO — A DEFINIR]
        <br />
        Contato: caraffastore@gmail.com
      </p>

      <h2>2. Dados que coletamos do comerciante (lojista)</h2>
      <ul>
        <li>E-mail e senha (cadastro/autenticação).</li>
        <li>Nome do comerciante, nome da loja, WhatsApp e slug da loja.</li>
        <li>
          Ao configurar Pix: Access Token e Webhook Secret do Mercado Pago, armazenados
          criptografados (AES-256-GCM) e nunca expostos em texto puro fora do processo do servidor.
        </li>
        <li>Registros de auditoria de eventos de conta (login, recuperação de senha), sem senha.</li>
      </ul>

      <h2>3. Dados que coletamos do cliente final (comprador na loja)</h2>
      <ul>
        <li>Nome, telefone e endereço de entrega informados no checkout.</li>
        <li>
          CPF/CNPJ, quando exigido para o processamento do pagamento Pix junto ao Mercado Pago.
        </li>
        <li>Itens do pedido, valores e status do pagamento.</li>
      </ul>

      <h2>4. Como os dados são usados</h2>
      <p>
        Os dados são usados exclusivamente para operar a loja (catálogo, pedidos, pagamentos) e
        para a própria administração da plataforma (autenticação, segurança, suporte). Não
        vendemos dados de comerciantes ou clientes finais a terceiros.
      </p>

      <h2>5. Compartilhamento com terceiros</h2>
      <p>
        Dados de pagamento Pix são compartilhados com o <strong>Mercado Pago</strong>, provedor de
        pagamentos escolhido pelo lojista, apenas na medida necessária para processar cada
        transação. O Supabase (infraestrutura de banco de dados e autenticação) processa os dados
        em nome da plataforma como operador técnico.
      </p>

      <h2>6. Retenção</h2>
      <p>
        Os dados são mantidos enquanto a conta/loja estiver ativa e pelo prazo mínimo exigido por
        obrigações legais (fiscais, de defesa em disputas) após o encerramento. Não há hoje um
        prazo de retenção automatizado configurado nesta fase piloto — exclusões são tratadas
        manualmente mediante solicitação ao contato do operador.
      </p>

      <h2>7. Segurança</h2>
      <p>
        Isolamento entre lojas (multi-tenant) reforçado por Row Level Security no banco de dados;
        credenciais de pagamento criptografadas; senhas nunca armazenadas em texto puro (gerenciadas
        pelo Supabase Auth); comunicação via HTTPS em produção.
      </p>

      <h2>8. Direitos do titular</h2>
      <p>
        Comerciantes e clientes finais podem solicitar acesso, correção ou exclusão dos seus dados
        entrando em contato pelo e-mail informado acima.
      </p>

      <h2>9. Responsabilidade do lojista</h2>
      <p>
        O lojista é responsável por tratar corretamente os dados dos seus próprios clientes finais
        coletados através da sua loja, em conformidade com a legislação aplicável.
      </p>

      <p style={{ marginTop: "2rem" }}>
        <a href="/termos">Termos de Uso</a>
      </p>
    </main>
  );
}
