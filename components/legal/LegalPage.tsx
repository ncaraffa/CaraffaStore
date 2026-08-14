import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";
import { getContactEmail } from "@/lib/config/site";
import { IconArrowLeft, IconMail } from "@/components/ui/icons";
import styles from "./LegalPage.module.css";

export interface LegalSection {
  /** Âncora estável — entra no sumário e no `id` do bloco. */
  id: string;
  title: string;
  body: ReactNode;
}

/**
 * Casca das páginas institucionais (Termos, Privacidade).
 *
 * Antes, essas duas páginas eram um `<main>` com estilo inline, sem
 * cabeçalho, sem rodapé e sem tipografia da marca — visualmente elas
 * pareciam outro site, e um documento jurídico que parece improvisado
 * contamina a confiança na plataforma inteira. Aqui elas ganham a mesma
 * linguagem visual do resto do produto, com sumário navegável e data de
 * atualização visível.
 *
 * A casca é só apresentação: todo o conteúdo continua vindo da própria
 * página, e nada aqui altera comportamento.
 */
export function LegalPage({
  title,
  summary,
  updatedAt,
  sections,
  siblingHref,
  siblingLabel,
}: {
  title: string;
  /** Uma frase que diz ao leitor o que ele vai encontrar. */
  summary: string;
  /** Data legível ("14 de agosto de 2026") — nunca inventada. */
  updatedAt: string;
  sections: LegalSection[];
  siblingHref: string;
  siblingLabel: string;
}) {
  const contactEmail = getContactEmail();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.headerLogo} aria-label="CaraffaStore, página inicial">
            <Logo size="md" compact />
          </Link>
          <Link href="/" className={styles.headerBack}>
            <IconArrowLeft />
            Voltar ao site
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.intro}>
          <p className={styles.label}>Documento oficial</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.summary}>{summary}</p>
          <p className={styles.updated}>
            Última atualização: <time>{updatedAt}</time>
          </p>
        </div>

        <div className={styles.layout}>
          {/* Sumário: no desktop acompanha a leitura; no celular vira um
              bloco fechado no topo, sem roubar a primeira tela. */}
          <nav className={styles.toc} aria-label="Seções deste documento">
            <p className={styles.tocTitle}>Nesta página</p>
            <ol className={styles.tocList}>
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    <span className={styles.tocIndex}>{String(index + 1).padStart(2, "0")}</span>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <article className={styles.content}>
            {sections.map((section, index) => (
              <section key={section.id} id={section.id} className={styles.section}>
                <h2 className={styles.sectionTitle}>
                  <span className={styles.sectionIndex}>{String(index + 1).padStart(2, "0")}</span>
                  {section.title}
                </h2>
                <div className={styles.sectionBody}>{section.body}</div>
              </section>
            ))}

            <div className={styles.contact}>
              <span className={styles.contactIcon}>
                <IconMail />
              </span>
              <div>
                <p className={styles.contactTitle}>Ficou alguma dúvida sobre este documento?</p>
                <p className={styles.contactBody}>
                  Escreva para <a href={`mailto:${contactEmail}`}>{contactEmail}</a> e nós respondemos.
                </p>
              </div>
            </div>
          </article>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <Logo size="sm" />
          <nav className={styles.footerNav} aria-label="Rodapé">
            <Link href={siblingHref}>{siblingLabel}</Link>
            <Link href="/">Início</Link>
            <Link href="/signup">Criar minha loja</Link>
          </nav>
          <p className={styles.footerCopy}>© {new Date().getFullYear()} CaraffaStore</p>
        </div>
      </footer>
    </div>
  );
}
