"use client";

import { useActionState } from "react";
import {
  addProductImageAction,
  removeProductImageAction,
  setCoverImageAction,
  moveProductImageAction,
  type ImageFormState,
} from "./actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { Field } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import styles from "./image-manager.module.css";

type ProductImage = {
  id: string;
  storage_path: string;
  position: number;
  is_cover: boolean;
};

const IDLE: ImageFormState = { status: "idle" };

export function ImageManager({
  storeSlug,
  productId,
  images,
  publicBaseUrl,
  maxImages,
}: {
  storeSlug: string;
  productId: string;
  images: ProductImage[];
  publicBaseUrl: string;
  maxImages: number;
}) {
  const [state, formAction, pending] = useActionState(addProductImageAction, IDLE);

  return (
    <div>
      {images.length === 0 ? (
        <EmptyState title="Nenhuma imagem ainda" description="Produtos com foto vendem mais — adicione ao menos uma imagem." />
      ) : (
        <div className={styles.grid}>
          {images.map((image, index) => (
            <figure key={image.id} className={styles.item}>
              <div className={styles.imageWrap}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${publicBaseUrl}/${image.storage_path}`} alt="" width={160} height={160} />
                {image.is_cover && (
                  <span className={styles.coverBadge}>
                    <Badge tone="success">Capa</Badge>
                  </span>
                )}
              </div>
              <div className={styles.actions}>
                <form action={moveProductImageAction}>
                  <input type="hidden" name="storeSlug" value={storeSlug} />
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="imageId" value={image.id} />
                  <input type="hidden" name="direction" value="up" />
                  <Button type="submit" variant="ghost" size="sm" disabled={index === 0} aria-label="Mover para cima">
                    ↑
                  </Button>
                </form>
                <form action={moveProductImageAction}>
                  <input type="hidden" name="storeSlug" value={storeSlug} />
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="imageId" value={image.id} />
                  <input type="hidden" name="direction" value="down" />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    disabled={index === images.length - 1}
                    aria-label="Mover para baixo"
                  >
                    ↓
                  </Button>
                </form>
                {!image.is_cover && (
                  <form action={setCoverImageAction}>
                    <input type="hidden" name="storeSlug" value={storeSlug} />
                    <input type="hidden" name="productId" value={productId} />
                    <input type="hidden" name="imageId" value={image.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Definir capa
                    </Button>
                  </form>
                )}
                <form action={removeProductImageAction}>
                  <input type="hidden" name="storeSlug" value={storeSlug} />
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="imageId" value={image.id} />
                  <input type="hidden" name="storagePath" value={image.storage_path} />
                  <ConfirmSubmitButton
                    label="Excluir"
                    confirmTitle="Excluir imagem"
                    confirmMessage="Esta imagem será removida definitivamente do produto."
                    confirmLabel="Excluir"
                  />
                </form>
              </div>
            </figure>
          ))}
        </div>
      )}

      {images.length < maxImages ? (
        <form action={formAction} noValidate className={styles.uploadForm}>
          <input type="hidden" name="storeSlug" value={storeSlug} />
          <input type="hidden" name="productId" value={productId} />

          {state.status === "error" && state.message && (
            <div className={styles.alertGap}>
              <Alert tone="danger">{state.message}</Alert>
            </div>
          )}

          <Field label="Adicionar imagem (JPEG, PNG ou WebP, até 5 MB)" htmlFor="file">
            <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required className={styles.fileInput} />
          </Field>

          <Button type="submit" variant="outline" loading={pending}>
            Enviar imagem
          </Button>
        </form>
      ) : (
        <p className={styles.limitHint}>Limite de {maxImages} imagens por produto atingido.</p>
      )}
    </div>
  );
}
