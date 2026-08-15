import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage";
import { getContactEmail } from "@/lib/config/site";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Como a CaraffaStore trata os dados do comerciante e dos clientes finais: o que é coletado, para que é usado, com quem é compartilhado e como solicitar exclusão.",
};

/** Ver comentário em app/termos/page.tsx — data real da última revisão. */
const UPDATED_AT = "14 de agosto de 2026";

export default function PrivacidadePage() {
  // Server Component: process.env.LEGAL_OPERATOR_CPF é lido só aqui, no
  // servidor, e nunca chega ao bundle do navegador — sem prefixo
  // NEXT_PUBLIC_, o Next não o expõe ao client. Sem a variável definida
  // (ambiente local, por exemplo), a linha de CPF simplesmente não
  // renderiza — nada de placeholder.
  const operatorCpf = process.env.LEGAL_OPERATOR_CPF?.trim() || null;
  const contactEmail = getContactEmail();

  const sections: LegalSection[] = [
    {
      id: "controlador",
      title: "Quem é o controlador dos dados",
      body: (
        <p>
          Responsável pela CaraffaStore e controlador dos dados: <strong>NICOLAS CARAFFA</strong>
          {operatorCpf && (
            <>
              <br />
              CPF: {operatorCpf}
            </>
          )}
          <br />
          Contato: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </p>
      ),
    },
    {
      id: "dados-lojista",
      title: "Dados que coletamos do comerciante",
      body: (
        <ul>
          <li>E-mail e senha, para cadastro e autenticação.</li>
          <li>Nome do comerciante, nome da loja, endereço público da loja e WhatsApp de contato.</li>
          <li>
            Ao conectar o Mercado Pago: as credenciais de integração da conta do lojista, guardadas{" "}
            <strong>criptografadas</strong> (AES-256-GCM) e nunca exibidas por completo depois de salvas.
          </li>
          <li>Registros de eventos da conta (login, recuperação de senha), sem qualquer senha.</li>
        </ul>
      ),
    },
    {
      id: "dados-cliente",
      title: "Dados que coletamos do cliente final",
      body: (
        <>
          <p>
            São os dados que o comprador informa no checkout da loja, necessários para o pedido e para o pagamento:
          </p>
          <ul>
            <li>Nome, telefone e e-mail.</li>
            <li>Endereço, quando o pedido é para entrega.</li>
            <li>CPF ou CNPJ, exigido pelo Mercado Pago para processar o Pix.</li>
            <li>Itens do pedido, valores e situação do pagamento.</li>
          </ul>
          <p>O cliente final não cria conta nem senha para comprar.</p>
        </>
      ),
    },
    {
      id: "uso",
      title: "Como os dados são usados",
      body: (
        <p>
          Os dados são usados exclusivamente para operar a loja — catálogo, pedidos e pagamentos — e para administrar
          a própria plataforma: autenticação, segurança e suporte. <strong>Não vendemos dados</strong> de
          comerciantes nem de clientes finais, e não os usamos para publicidade de terceiros.
        </p>
      ),
    },
    {
      id: "compartilhamento",
      title: "Com quem os dados são compartilhados",
      body: (
        <ul>
          <li>
            <strong>Mercado Pago</strong> — provedor de pagamentos escolhido pelo lojista. Recebe apenas o necessário
            para processar cada cobrança Pix.
          </li>
          <li>
            <strong>Supabase</strong> — infraestrutura de banco de dados e autenticação, atuando como operador
            técnico em nome da plataforma.
          </li>
          <li>
            <strong>Vercel</strong> — infraestrutura de hospedagem e entrega da aplicação.
          </li>
        </ul>
      ),
    },
    {
      id: "seguranca",
      title: "Segurança",
      body: (
        <ul>
          <li>
            Os dados de cada loja ficam separados dos dados das outras lojas por regras aplicadas no próprio banco de
            dados — não apenas pela tela.
          </li>
          <li>As credenciais de pagamento são armazenadas criptografadas.</li>
          <li>As senhas nunca são armazenadas em texto puro (autenticação gerenciada pelo Supabase Auth).</li>
          <li>Toda a comunicação em produção acontece por HTTPS.</li>
        </ul>
      ),
    },
    {
      id: "retencao",
      title: "Por quanto tempo guardamos",
      body: (
        <p>
          Os dados são mantidos enquanto a conta e a loja existirem, e depois pelo prazo exigido por obrigações
          legais — fiscais e de defesa em eventuais disputas. Não há exclusão automática programada: pedidos de
          exclusão são atendidos individualmente pelo e-mail de contato.
        </p>
      ),
    },
    {
      id: "direitos",
      title: "Direitos de quem tem dados aqui",
      body: (
        <p>
          Comerciantes e clientes finais podem solicitar acesso, correção ou exclusão dos seus dados escrevendo para{" "}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. Responderemos com o que for possível dentro das
          obrigações legais aplicáveis.
        </p>
      ),
    },
    {
      id: "responsabilidade-lojista",
      title: "Responsabilidade do lojista",
      body: (
        <p>
          Cada lojista é responsável por tratar corretamente os dados dos seus próprios clientes finais, coletados
          através da sua loja, em conformidade com a legislação aplicável.
        </p>
      ),
    },
  ];

  return (
    <LegalPage
      title="Política de Privacidade"
      summary="O que a CaraffaStore coleta do comerciante e do cliente final, para que usa, com quem compartilha e como pedir correção ou exclusão."
      updatedAt={UPDATED_AT}
      sections={sections}
      siblingHref="/termos"
      siblingLabel="Termos de Uso"
    />
  );
}
