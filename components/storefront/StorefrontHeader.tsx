import Link from "next/link";
import { CartBadge } from "@/app/loja/[storeSlug]/cart-badge";
import { IconArrowLeft } from "@/components/ui/icons";
import styles from "./StorefrontHeader.module.css";

export function StorefrontHeader({
  storeSlug,
  storeName,
  backHref,
  backLabel,
}: {
  storeSlug: string;
  storeName: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        {backHref ? (
          <Link href={backHref} className={styles.back}>
            <IconArrowLeft />
            {backLabel ?? storeName}
          </Link>
        ) : (
          <Link href={`/loja/${storeSlug}`} className={styles.storeName}>
            {storeName}
          </Link>
        )}
      </div>
      <CartBadge storeSlug={storeSlug} />
    </header>
  );
}
