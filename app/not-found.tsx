import Link from "next/link";
import { StatusPage } from "@/components/onboarding/StatusPage";
import { Button } from "@/components/ui/Button";
import { IconSearch } from "@/components/ui/icons";

export default function NotFound() {
  return (
    <StatusPage
      icon={<IconSearch />}
      title="Página não encontrada"
      actions={
        <Link href="/">
          <Button as="span">Voltar ao início</Button>
        </Link>
      }
    >
      <p>A página que você procura não existe ou foi movida.</p>
    </StatusPage>
  );
}
