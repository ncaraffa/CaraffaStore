"use client";

import { useActionState } from "react";
import {
  addProductImageAction,
  removeProductImageAction,
  setCoverImageAction,
  moveProductImageAction,
  type ImageFormState,
} from "./actions";

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
        <p>Nenhuma imagem ainda.</p>
      ) : (
        <div className="image-grid">
          {images.map((image, index) => (
            <figure key={image.id} className="image-grid-item">
              <img src={`${publicBaseUrl}/${image.storage_path}`} alt="" width={160} height={160} />
              {image.is_cover && <figcaption className="badge" data-tone="success">Capa</figcaption>}
              <div className="image-grid-actions">
                <form action={moveProductImageAction}>
                  <input type="hidden" name="storeSlug" value={storeSlug} />
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="imageId" value={image.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button type="submit" className="btn-link" disabled={index === 0}>
                    ↑
                  </button>
                </form>
                <form action={moveProductImageAction}>
                  <input type="hidden" name="storeSlug" value={storeSlug} />
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="imageId" value={image.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button type="submit" className="btn-link" disabled={index === images.length - 1}>
                    ↓
                  </button>
                </form>
                {!image.is_cover && (
                  <form action={setCoverImageAction}>
                    <input type="hidden" name="storeSlug" value={storeSlug} />
                    <input type="hidden" name="productId" value={productId} />
                    <input type="hidden" name="imageId" value={image.id} />
                    <button type="submit" className="btn-link">
                      Definir como capa
                    </button>
                  </form>
                )}
                <form action={removeProductImageAction}>
                  <input type="hidden" name="storeSlug" value={storeSlug} />
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="imageId" value={image.id} />
                  <input type="hidden" name="storagePath" value={image.storage_path} />
                  <button type="submit" className="btn-link" data-tone="danger">
                    Excluir
                  </button>
                </form>
              </div>
            </figure>
          ))}
        </div>
      )}

      {images.length < maxImages ? (
        <form action={formAction} noValidate>
          <input type="hidden" name="storeSlug" value={storeSlug} />
          <input type="hidden" name="productId" value={productId} />

          {state.status === "error" && state.message && (
            <p className="form-status" data-tone="error" role="alert">
              {state.message}
            </p>
          )}

          <div className="form-field">
            <label htmlFor="file">Adicionar imagem (JPEG, PNG ou WebP, até 5&nbsp;MB)</label>
            <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
          </div>

          <button type="submit" disabled={pending}>
            {pending ? "Enviando..." : "Enviar imagem"}
          </button>
        </form>
      ) : (
        <p className="form-hint">Limite de {maxImages} imagens por produto atingido.</p>
      )}
    </div>
  );
}
