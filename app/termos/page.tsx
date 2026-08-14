import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage";
import { getContactEmail } from "@/lib/config/site";
import styles from "@/components/legal/LegalPage.module.css";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description:
    "Condições de uso da CaraffaStore: cadastro, planos, ativação da loja, pagamentos por Pix e responsabilidades de cada lado.",
};

/**
 * Data real da última revisão deste texto. Só muda quando o conteúdo
 * muda — nunca é gerada dinamicamente, senão diria "hoje" todo dia e
 * deixaria de significar alguma coisa.
 */
const UPDATED_AT = "14 de agosto de 2026";

export default function TermosPage() {
  // Server Component: process.env.LEGAL_OPERATOR_CPF é lido só aqui, no
  // servidor, e nunca chega ao bundle do navegador — sem prefixo
  // NEXT_PUBLIC_, o Next não o expõe ao client. Sem a variável definida
  // (ambiente local, por exemplo), a linha de CPF simplesmente não
  // renderiza — nada de placeholder.
  const operatorCpf = process.env.LEGAL_OPERATOR_CPF?.trim() || null;
  const contactEmail = getContactEmail();

  /**
   * Cada seção descreve o que o sistema faz HOJE, verificado no código:
   * a ativação da loja após a aprovação do Pix é automática
   * (supabase/migrations/0008_saas_billing.sql, função
   * billing_charge_apply_provider_state), enquanto a renovação mensal
   * ainda não tem cobrança recorrente — e isso é dito abertamente, em
   * vez de descrito como "fase experimental".
   */
  const sections: LegalSection[] = [
    {
      id: "servico",
      title: "O que é a CaraffaStore",
      body: (
        <>
          <p>
            A CaraffaStore é um serviço de software que permite a pequenos comerciantes criar e administrar a
            própria loja virtual: catálogo de produtos, categorias, carrinho, checkout e cobrança por Pix dos seus
            clientes finais.
          </p>
          <p>
            Cada loja é independente das demais. A CaraffaStore fornece a plataforma; a loja, os produtos, os preços
            e a relação com o cliente final são do lojista.
          </p>
        </>
      ),
    },
    {
      id: "responsavel",
      title: "Quem é o responsável",
      body: (
        <>
          <p>
            Responsável pela CaraffaStore: <strong>NICOLAS CARAFFA</strong>
            {operatorCpf && (
              <>
                <br />
                CPF: {operatorCpf}
              </>
            )}
            <br />
            Contato: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          </p>
        </>
      ),
    },
    {
      id: "cadastro",
      title: "Cadastro e criação da loja",
      body: (
        <>
          <p>
            O lojista se cadastra com e-mail e senha e confirma o e-mail. Em seguida conclui o onboarding, onde
            informa o nome da loja, o endereço público dela (o link que será compartilhado), o WhatsApp de contato e
            escolhe um plano mensal.
          </p>
          <p>
            O lojista é responsável por manter suas credenciais de acesso em sigilo e por informar dados verdadeiros
            sobre a loja e os produtos.
          </p>
        </>
      ),
    },
    {
      id: "planos",
      title: "Planos e ativação",
      body: (
        <>
          <p>
            A CaraffaStore oferece três planos mensais — Essencial (R$ 30), Crescimento (R$ 50) e Profissional
            (R$ 70). <strong>Os três dão acesso aos mesmos recursos da plataforma</strong>; a diferença entre eles é
            o valor da mensalidade, escolhido pelo lojista conforme o tamanho da sua operação.
          </p>
          <p>
            Concluído o onboarding, a loja fica aguardando o pagamento da primeira mensalidade, que é feito por Pix
            dentro da própria plataforma. Assim que esse Pix é aprovado pelo Mercado Pago,{" "}
            <strong>a loja é ativada automaticamente</strong> e o painel é liberado.
          </p>
          <div className={styles.note}>
            <p>
              <strong>Sobre a renovação:</strong> a CaraffaStore não guarda cartão de crédito nem faz débito
              automático. Hoje não existe cobrança recorrente automatizada — a continuidade do plano a cada mês é
              combinada diretamente com o responsável pela CaraffaStore, pelo e-mail de contato acima. Nenhum valor é
              cobrado sem que o lojista faça o pagamento.
            </p>
          </div>
        </>
      ),
    },
    {
      id: "pagamentos",
      title: "Pagamentos das vendas da loja",
      body: (
        <>
          <p>
            Para receber pelas vendas, o lojista conecta a própria conta do Mercado Pago à sua loja. Os pagamentos
            dos clientes finais vão <strong>diretamente para a conta do lojista</strong>.
          </p>
          <p>
            A CaraffaStore não processa, não retém e não tem acesso aos valores recebidos pelo lojista: ela apenas
            envia o pedido ao Mercado Pago usando as credenciais do próprio lojista e registra o resultado. A
            CaraffaStore também não cobra comissão sobre as vendas — a única cobrança é a mensalidade do plano.
          </p>
          <p>
            As tarifas do Mercado Pago sobre cada transação, bem como os prazos de repasse, seguem as condições
            contratadas pelo lojista diretamente com o Mercado Pago.
          </p>
        </>
      ),
    },
    {
      id: "responsabilidades",
      title: "Responsabilidades do lojista",
      body: (
        <ul>
          <li>Manter em sigilo as credenciais de acesso à conta e as credenciais do Mercado Pago.</li>
          <li>Fornecer informações verdadeiras sobre a loja, os produtos, os preços e os prazos.</li>
          <li>Cumprir a legislação aplicável às suas vendas (fiscal, consumidor, entre outras).</li>
          <li>Responder por entrega, trocas, reembolsos e atendimento aos seus próprios clientes finais.</li>
          <li>Tratar corretamente os dados pessoais dos clientes finais coletados através da sua loja.</li>
        </ul>
      ),
    },
    {
      id: "disponibilidade",
      title: "Disponibilidade do serviço",
      body: (
        <>
          <p>
            A CaraffaStore trabalha para manter o serviço disponível de forma contínua, mas{" "}
            <strong>não oferece garantia contratual de disponibilidade (SLA)</strong> nem indenização por
            indisponibilidade. Manutenções e melhorias podem alterar funcionalidades ao longo do tempo; mudanças
            relevantes são comunicadas ao lojista.
          </p>
          <p>
            A plataforma depende de serviços de terceiros — em especial o Mercado Pago, para os pagamentos, e a
            infraestrutura de hospedagem e banco de dados. Interrupções nesses serviços podem afetar o
            funcionamento da loja.
          </p>
        </>
      ),
    },
    {
      id: "suspensao",
      title: "Suspensão e encerramento",
      body: (
        <>
          <p>
            O lojista pode encerrar o uso do serviço quando quiser, entrando em contato pelo e-mail acima. Não há
            fidelidade nem multa de cancelamento.
          </p>
          <p>
            A CaraffaStore pode suspender ou encerrar uma loja em caso de falta de pagamento da mensalidade, uso do
            serviço para atividade ilícita, ou descumprimento destes Termos. Sempre que possível, o lojista é avisado
            antes.
          </p>
        </>
      ),
    },
    {
      id: "alteracoes",
      title: "Alterações destes Termos",
      body: (
        <p>
          Estes Termos podem ser atualizados para refletir mudanças no serviço ou na legislação. A data da última
          atualização fica sempre visível no topo desta página, e alterações relevantes são comunicadas ao lojista
          pelo e-mail cadastrado.
        </p>
      ),
    },
    {
      id: "contato",
      title: "Contato",
      body: (
        <p>
          Dúvidas sobre estes Termos, sobre cobrança ou sobre a sua loja:{" "}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      ),
    },
  ];

  return (
    <LegalPage
      title="Termos de Uso"
      summary="As condições de uso da CaraffaStore, escritas em português claro: como a loja é criada e ativada, como funcionam os planos, como o dinheiro das suas vendas chega até você e o que cabe a cada lado."
      updatedAt={UPDATED_AT}
      sections={sections}
      siblingHref="/privacidade"
      siblingLabel="Política de Privacidade"
    />
  );
}
