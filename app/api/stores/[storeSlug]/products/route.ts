import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SupabaseStoreRepository } from "@/lib/data/supabase-repository";
import { DuplicateProductNameError } from "@/lib/data/repository";
import { ForbiddenTenantError } from "@/lib/tenant/context";
import {
  createProductForStore,
  listProductsForStore,
} from "@/lib/products/service";

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  stock: z.number().int().min(0),
});

type RouteParams = { params: Promise<{ storeSlug: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { storeSlug } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    const products = await listProductsForStore({
      repository: new SupabaseStoreRepository(supabase),
      userId: user?.id ?? null,
      storeSlug,
    });
    return NextResponse.json({ products });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { storeSlug } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    // Only `name`/`stock` are read from the body. Any `storeId`/`store_id`
    // sent by the client is ignored on purpose — the store is always the
    // one resolved server-side from the session, never the caller's claim.
    const body: unknown = await request.json();
    const input = createProductSchema.parse(body);

    const product = await createProductForStore({
      repository: new SupabaseStoreRepository(supabase),
      userId: user?.id ?? null,
      storeSlug,
      input,
    });
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ForbiddenTenantError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "Dados inválidos.", issues: error.issues },
      { status: 400 },
    );
  }
  if (error instanceof DuplicateProductNameError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  console.error(error);
  return NextResponse.json({ error: "Erro interno." }, { status: 500 });
}
