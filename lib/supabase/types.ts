export type StoreRole = "owner" | "admin" | "staff";
export type StoreStatus = "onboarding" | "pending_payment" | "active" | "suspended";
export type OnboardingStep =
  | "profile"
  | "store_name"
  | "slug"
  | "plan"
  | "review"
  | "completed";
export type PlanKey = "essential" | "growth" | "professional";

export type PlanCode = 30 | 50 | 80;

/**
 * TASK-013 — faixa de frete aplicada a um pedido. `free` é uma faixa
 * como as outras (e não um booleano à parte) porque é assim que o banco
 * grava: shipping_rule guarda a razão do valor, não só o valor.
 */
export type ShippingRule = "free" | "same_city" | "same_state" | "other_state";

export type AuditAction =
  | "email_verification_completed"
  | "password_recovery_grant_issued"
  | "password_recovery_authorization_claimed"
  | "password_recovery_completed"
  | "password_recovery_revoked"
  | "store_created"
  | "owner_assigned"
  | "plan_selected"
  | "onboarding_completed"
  | "access_denied"
  | "category_created"
  | "category_updated"
  | "category_archived"
  | "product_created"
  | "product_updated"
  | "product_published"
  | "product_unpublished"
  | "product_archived"
  | "product_stock_adjusted"
  | "product_image_added"
  | "product_image_removed"
  | "product_cover_changed"
  | "order_created"
  | "order_status_changed"
  | "order_cancelled"
  | "order_stock_reserved"
  | "order_stock_restored"
  | "payment_settings_configured"
  | "payment_settings_disabled"
  | "pix_payment_creation_started"
  | "pix_payment_created"
  | "pix_payment_approved"
  | "pix_payment_rejected"
  | "pix_payment_cancelled"
  | "pix_payment_expired"
  | "pix_payment_reconciliation_failed"
  | "order_confirmed_by_payment"
  | "order_cancelled_by_payment_failure"
  | "payment_manual_review_required"
  | "billing_charge_creation_started"
  | "billing_charge_created"
  | "billing_charge_approved"
  | "billing_charge_rejected"
  | "billing_charge_cancelled"
  | "billing_charge_expired"
  | "billing_manual_review_required"
  | "store_activated_by_billing"
  | "billing_subscription_renewed"
  | "store_suspended_by_platform_admin"
  | "store_reactivated_by_platform_admin"
  | "store_suspended_by_billing_overdue"
  | "store_reactivated_by_billing"
  | "plan_changed_by_billing"
  | "shipping_settings_updated";
export type StoreSuspensionReason = "platform_admin" | "billing_overdue";
export type ProductStatus = "draft" | "published" | "archived";
export type OrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "completed" | "cancelled";
export type FulfillmentMethod = "pickup" | "delivery";
export type OrderPaymentMode = "manual" | "pix";
export type PixPaymentEnvironment = "test" | "production";
export type PixDocType = "CPF" | "CNPJ";
export type PaymentStatus = "creating" | "pending" | "approved" | "rejected" | "cancelled" | "expired" | "error" | "manual_review";
export type WebhookProcessingStatus = "received" | "processed" | "ignored" | "rejected" | "error";
/** billing_charges.status usa exatamente o mesmo vocabulário de PaymentStatus (order_payments) — mesma máquina de estados, dois domínios (0007_payments.sql loja↔cliente vs 0008_saas_billing.sql CaraffaStore↔comerciante). */
export type BillingChargeStatus = PaymentStatus;

/**
 * Minimal hand-written mirror of `supabase/migrations/0001_init.sql`
 * through `0009_platform_admin.sql`. Kept small on purpose — only what
 * each migration actually created, not raw `supabase gen types` output.
 */
export interface Database {
  public: {
    Tables: {
      stores: {
        Row: {
          id: string;
          slug: string;
          name: string;
          status: StoreStatus;
          whatsapp: string | null;
          pre_suspension_status: StoreStatus | null;
          suspension_reason: StoreSuspensionReason | null;
          created_at: string;
          /** TASK-012: workspace (conta de cobrança) dono da loja. NOT NULL no banco. */
          workspace_id: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          status?: StoreStatus;
          whatsapp?: string | null;
          pre_suspension_status?: StoreStatus | null;
          suspension_reason?: StoreSuspensionReason | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          status?: StoreStatus;
          whatsapp?: string | null;
          pre_suspension_status?: StoreStatus | null;
          suspension_reason?: StoreSuspensionReason | null;
          created_at?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          user_id: string;
          granted_at: string;
        };
        Insert: {
          user_id: string;
          granted_at?: string;
        };
        Update: {
          user_id?: string;
          granted_at?: string;
        };
        Relationships: [];
      };
      /**
       * TASK-012 — ASSENTO/licença de equipe. Uma linha por PESSOA por
       * workspace. Não confundir com store_members, que é a projeção de
       * ACESSO (uma linha por pessoa POR LOJA).
       */
      coupons: {
        Row: {
          id: string;
          store_id: string;
          code: string;
          normalized_code: string;
          discount_type: "percentage" | "fixed_amount";
          /** percentage: BASIS POINTS (1000 = 10%). fixed_amount: CENTAVOS. Sempre inteiro. */
          discount_value: number;
          minimum_order_cents: number | null;
          maximum_discount_cents: number | null;
          starts_at: string | null;
          expires_at: string | null;
          max_uses: number | null;
          active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      coupon_redemptions: {
        Row: {
          id: string;
          coupon_id: string;
          store_id: string;
          order_id: string;
          status: "reserved" | "consumed" | "released";
          discount_cents: number;
          reserved_at: string;
          consumed_at: string | null;
          released_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workspace_members: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          role: "owner" | "member";
          invited_by: string | null;
          joined_at: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workspace_invitations: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          /** Só o SHA-256 — o token em claro nunca é persistido. */
          token_hash: string;
          role: "member";
          invited_by: string | null;
          status: "pending" | "accepted" | "revoked" | "expired";
          expires_at: string;
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      app_sessions: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          supabase_session_hash: string;
          enforces_single_session: boolean;
          user_agent_label: string | null;
          created_at: string;
          last_seen_at: string;
          expires_at: string;
          revoked_at: string | null;
          revoked_reason: "logout" | "takeover" | "member_removed" | "stale" | "plan_downgrade" | "admin" | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workspace_subscriptions: {
        Row: {
          id: string;
          workspace_id: string;
          plan_key: PlanKey;
          status: "pending_payment" | "active" | "past_due" | "cancelled";
          entitlement_version: number;
          started_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          owner_user_id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      store_members: {
        Row: {
          id: string;
          store_id: string;
          user_id: string;
          role: StoreRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          user_id: string;
          role: StoreRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          user_id?: string;
          role?: StoreRole;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_members_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          id: string;
          store_id: string;
          category_id: string | null;
          name: string;
          slug: string | null;
          description: string | null;
          price_cents: number;
          sku: string | null;
          stock: number;
          status: ProductStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          category_id?: string | null;
          name: string;
          slug?: string | null;
          description?: string | null;
          price_cents?: number;
          sku?: string | null;
          stock?: number;
          status?: ProductStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          category_id?: string | null;
          name?: string;
          slug?: string | null;
          description?: string | null;
          price_cents?: number;
          sku?: string | null;
          stock?: number;
          status?: ProductStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          id: string;
          store_id: string;
          name: string;
          slug: string;
          description: string | null;
          display_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          name: string;
          slug: string;
          description?: string | null;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          name?: string;
          slug?: string;
          description?: string | null;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      product_images: {
        Row: {
          id: string;
          store_id: string;
          product_id: string;
          storage_path: string;
          position: number;
          is_cover: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          product_id: string;
          storage_path: string;
          position?: number;
          is_cover?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          product_id?: string;
          storage_path?: string;
          position?: number;
          is_cover?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_images_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      merchant_profiles: {
        Row: {
          user_id: string;
          display_name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          display_name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          display_name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      onboarding_progress: {
        Row: {
          user_id: string;
          step: OnboardingStep;
          merchant_name: string | null;
          whatsapp: string | null;
          store_name: string | null;
          slug: string | null;
          plan_code: PlanCode | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          step?: OnboardingStep;
          merchant_name?: string | null;
          whatsapp?: string | null;
          store_name?: string | null;
          slug?: string | null;
          plan_code?: PlanCode | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          step?: OnboardingStep;
          merchant_name?: string | null;
          whatsapp?: string | null;
          store_name?: string | null;
          slug?: string | null;
          plan_code?: PlanCode | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      store_plans: {
        Row: {
          store_id: string;
          plan_code: PlanCode;
          selected_at: string;
        };
        Insert: {
          store_id: string;
          plan_code: PlanCode;
          selected_at?: string;
        };
        Update: {
          store_id?: string;
          plan_code?: PlanCode;
          selected_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_plans_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: true;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: string;
          actor_user_id: string | null;
          store_id: string | null;
          action: AuditAction;
          target_type: string | null;
          target_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_user_id?: string | null;
          store_id?: string | null;
          action: AuditAction;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_user_id?: string | null;
          store_id?: string | null;
          action?: AuditAction;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          id: string;
          store_id: string;
          public_code: string;
          idempotency_key: string;
          request_fingerprint: string;
          customer_name: string;
          customer_phone: string;
          fulfillment_method: FulfillmentMethod;
          delivery_address: string | null;
          customer_notes: string | null;
          status: OrderStatus;
          subtotal_cents: number;
          /** TASK-012: desconto aplicado neste pedido. total = subtotal - discount, garantido por CHECK no banco. */
          discount_cents: number;
          total_cents: number;
          coupon_id: string | null;
          coupon_code_snapshot: string | null;
          coupon_discount_type_snapshot: "percentage" | "fixed_amount" | null;
          coupon_discount_value_snapshot: number | null;
          /**
           * TASK-013: frete cobrado neste pedido. total = subtotal -
           * discount + shipping, garantido pela CHECK
           * orders_total_matches_components no banco.
           */
          shipping_amount_cents: number;
          /** Faixa aplicada no momento da compra — snapshot, nunca recalculada. */
          shipping_rule: ShippingRule | null;
          shipping_postal_code: string | null;
          shipping_street: string | null;
          shipping_number: string | null;
          shipping_complement: string | null;
          shipping_neighborhood: string | null;
          shipping_city: string | null;
          shipping_state: string | null;
          /** Origem usada no cálculo — preserva a conta mesmo se a loja mudar de cidade. */
          shipping_origin_postal_code: string | null;
          shipping_origin_city: string | null;
          shipping_origin_state: string | null;
          created_at: string;
          updated_at: string;
          cancelled_at: string | null;
          completed_at: string | null;
          payment_mode: OrderPaymentMode;
          receipt_token_hash: string | null;
        };
        Insert: {
          id?: string;
          store_id: string;
          public_code: string;
          idempotency_key: string;
          request_fingerprint: string;
          customer_name: string;
          customer_phone: string;
          fulfillment_method: FulfillmentMethod;
          delivery_address?: string | null;
          customer_notes?: string | null;
          status?: OrderStatus;
          subtotal_cents: number;
          total_cents: number;
          created_at?: string;
          updated_at?: string;
          cancelled_at?: string | null;
          completed_at?: string | null;
          payment_mode?: OrderPaymentMode;
          receipt_token_hash?: string | null;
        };
        Update: {
          id?: string;
          store_id?: string;
          public_code?: string;
          idempotency_key?: string;
          request_fingerprint?: string;
          customer_name?: string;
          customer_phone?: string;
          fulfillment_method?: FulfillmentMethod;
          delivery_address?: string | null;
          customer_notes?: string | null;
          status?: OrderStatus;
          subtotal_cents?: number;
          total_cents?: number;
          created_at?: string;
          updated_at?: string;
          cancelled_at?: string | null;
          completed_at?: string | null;
          payment_mode?: OrderPaymentMode;
          receipt_token_hash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * TASK-013 — configuração de frete por LOJA (nunca por workspace:
       * um workspace pode ter lojas em cidades diferentes). Escrita só
       * por shipping_settings_upsert; o comprador nunca lê esta tabela.
       */
      store_shipping_settings: {
        Row: {
          id: string;
          store_id: string;
          enabled: boolean;
          origin_postal_code: string | null;
          origin_city: string | null;
          origin_state: string | null;
          same_city_fee_cents: number;
          same_state_fee_cents: number;
          other_state_fee_cents: number;
          additional_fee_cents: number;
          free_shipping_enabled: boolean;
          free_shipping_minimum_cents: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          enabled?: boolean;
          origin_postal_code?: string | null;
          origin_city?: string | null;
          origin_state?: string | null;
          same_city_fee_cents?: number;
          same_state_fee_cents?: number;
          other_state_fee_cents?: number;
          additional_fee_cents?: number;
          free_shipping_enabled?: boolean;
          free_shipping_minimum_cents?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          enabled?: boolean;
          origin_postal_code?: string | null;
          origin_city?: string | null;
          origin_state?: string | null;
          same_city_fee_cents?: number;
          same_state_fee_cents?: number;
          other_state_fee_cents?: number;
          additional_fee_cents?: number;
          free_shipping_enabled?: boolean;
          free_shipping_minimum_cents?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_shipping_settings_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: true;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          store_id: string;
          product_id: string;
          product_name_snapshot: string;
          product_slug_snapshot: string | null;
          unit_price_cents: number;
          quantity: number;
          line_total_cents: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          store_id: string;
          product_id: string;
          product_name_snapshot: string;
          product_slug_snapshot?: string | null;
          unit_price_cents: number;
          quantity: number;
          line_total_cents: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          store_id?: string;
          product_id?: string;
          product_name_snapshot?: string;
          product_slug_snapshot?: string | null;
          unit_price_cents?: number;
          quantity?: number;
          line_total_cents?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      store_payment_settings: {
        Row: {
          id: string;
          store_id: string;
          provider: "mercado_pago";
          environment: PixPaymentEnvironment;
          encrypted_access_token: string;
          encrypted_webhook_secret: string;
          access_token_preview: string;
          webhook_key: string;
          is_enabled: boolean;
          credentials_verified_at: string | null;
          last_error_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          provider?: "mercado_pago";
          environment: PixPaymentEnvironment;
          encrypted_access_token: string;
          encrypted_webhook_secret: string;
          access_token_preview: string;
          webhook_key: string;
          is_enabled?: boolean;
          credentials_verified_at?: string | null;
          last_error_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          provider?: "mercado_pago";
          environment?: PixPaymentEnvironment;
          encrypted_access_token?: string;
          encrypted_webhook_secret?: string;
          access_token_preview?: string;
          webhook_key?: string;
          is_enabled?: boolean;
          credentials_verified_at?: string | null;
          last_error_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_payment_settings_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: true;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      order_payments: {
        Row: {
          id: string;
          store_id: string;
          order_id: string;
          provider: "mercado_pago";
          provider_payment_id: string | null;
          provider_idempotency_key: string;
          external_reference: string;
          status: PaymentStatus;
          provider_status: string | null;
          provider_status_detail: string | null;
          amount_cents: number;
          currency: string;
          qr_code: string | null;
          qr_code_base64: string | null;
          ticket_url: string | null;
          payer_email: string;
          payer_doc_type: PixDocType;
          payer_doc_last4: string;
          expires_at: string | null;
          approved_at: string | null;
          failed_at: string | null;
          cancelled_at: string | null;
          last_webhook_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          order_id: string;
          provider?: "mercado_pago";
          provider_payment_id?: string | null;
          provider_idempotency_key: string;
          external_reference: string;
          status?: PaymentStatus;
          provider_status?: string | null;
          provider_status_detail?: string | null;
          amount_cents: number;
          currency?: string;
          qr_code?: string | null;
          qr_code_base64?: string | null;
          ticket_url?: string | null;
          payer_email: string;
          payer_doc_type: PixDocType;
          payer_doc_last4: string;
          expires_at?: string | null;
          approved_at?: string | null;
          failed_at?: string | null;
          cancelled_at?: string | null;
          last_webhook_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          order_id?: string;
          provider?: "mercado_pago";
          provider_payment_id?: string | null;
          provider_idempotency_key?: string;
          external_reference?: string;
          status?: PaymentStatus;
          provider_status?: string | null;
          provider_status_detail?: string | null;
          amount_cents?: number;
          currency?: string;
          qr_code?: string | null;
          qr_code_base64?: string | null;
          ticket_url?: string | null;
          payer_email?: string;
          payer_doc_type?: PixDocType;
          payer_doc_last4?: string;
          expires_at?: string | null;
          approved_at?: string | null;
          failed_at?: string | null;
          cancelled_at?: string | null;
          last_webhook_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_payments_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_webhook_events: {
        Row: {
          id: string;
          store_id: string;
          payment_attempt_id: string | null;
          provider: "mercado_pago";
          provider_event_id: string | null;
          provider_payment_id: string | null;
          action: string | null;
          payload_hash: string;
          received_at: string;
          processed_at: string | null;
          processing_status: WebhookProcessingStatus;
          error_code: string | null;
        };
        Insert: {
          id?: string;
          store_id: string;
          payment_attempt_id?: string | null;
          provider?: "mercado_pago";
          provider_event_id?: string | null;
          provider_payment_id?: string | null;
          action?: string | null;
          payload_hash: string;
          received_at?: string;
          processed_at?: string | null;
          processing_status?: WebhookProcessingStatus;
          error_code?: string | null;
        };
        Update: {
          id?: string;
          store_id?: string;
          payment_attempt_id?: string | null;
          provider?: "mercado_pago";
          provider_event_id?: string | null;
          provider_payment_id?: string | null;
          action?: string | null;
          payload_hash?: string;
          received_at?: string;
          processed_at?: string | null;
          processing_status?: WebhookProcessingStatus;
          error_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_webhook_events_payment_attempt_id_fkey";
            columns: ["payment_attempt_id"];
            isOneToOne: false;
            referencedRelation: "order_payments";
            referencedColumns: ["id"];
          },
        ];
      };
      password_recovery_grants: {
        Row: {
          id: string;
          user_id: string;
          session_id: string;
          nonce_hash: string | null;
          completion_secret_hash: string | null;
          password_fingerprint_before: string | null;
          created_at: string;
          expires_at: string;
          claimed_at: string | null;
          claim_expires_at: string | null;
          completed_at: string | null;
          revoked_at: string | null;
          revoke_reason: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id: string;
          nonce_hash?: string | null;
          completion_secret_hash?: string | null;
          password_fingerprint_before?: string | null;
          created_at?: string;
          expires_at: string;
          claimed_at?: string | null;
          claim_expires_at?: string | null;
          completed_at?: string | null;
          revoked_at?: string | null;
          revoke_reason?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          session_id?: string;
          nonce_hash?: string | null;
          completion_secret_hash?: string | null;
          password_fingerprint_before?: string | null;
          created_at?: string;
          expires_at?: string;
          claimed_at?: string | null;
          claim_expires_at?: string | null;
          completed_at?: string | null;
          revoked_at?: string | null;
          revoke_reason?: string | null;
        };
        Relationships: [];
      };
      billing_charges: {
        Row: {
          id: string;
          store_id: string;
          plan_code: PlanCode;
          amount_cents: number;
          currency: string;
          provider: "mercado_pago";
          provider_payment_id: string | null;
          provider_idempotency_key: string;
          external_reference: string;
          status: BillingChargeStatus;
          provider_status: string | null;
          provider_status_detail: string | null;
          payer_email: string;
          payer_doc_type: PixDocType;
          payer_doc_last4: string;
          period_start: string;
          period_end: string;
          qr_code: string | null;
          qr_code_base64: string | null;
          ticket_url: string | null;
          expires_at: string | null;
          approved_at: string | null;
          failed_at: string | null;
          cancelled_at: string | null;
          last_webhook_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          plan_code: PlanCode;
          amount_cents: number;
          currency?: string;
          provider?: "mercado_pago";
          provider_payment_id?: string | null;
          provider_idempotency_key: string;
          external_reference: string;
          status?: BillingChargeStatus;
          provider_status?: string | null;
          provider_status_detail?: string | null;
          payer_email: string;
          payer_doc_type: PixDocType;
          payer_doc_last4: string;
          period_start: string;
          period_end: string;
          qr_code?: string | null;
          qr_code_base64?: string | null;
          ticket_url?: string | null;
          expires_at?: string | null;
          approved_at?: string | null;
          failed_at?: string | null;
          cancelled_at?: string | null;
          last_webhook_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          plan_code?: PlanCode;
          amount_cents?: number;
          currency?: string;
          provider?: "mercado_pago";
          provider_payment_id?: string | null;
          provider_idempotency_key?: string;
          external_reference?: string;
          status?: BillingChargeStatus;
          provider_status?: string | null;
          provider_status_detail?: string | null;
          payer_email?: string;
          payer_doc_type?: PixDocType;
          payer_doc_last4?: string;
          period_start?: string;
          period_end?: string;
          qr_code?: string | null;
          qr_code_base64?: string | null;
          ticket_url?: string | null;
          expires_at?: string | null;
          approved_at?: string | null;
          failed_at?: string | null;
          cancelled_at?: string | null;
          last_webhook_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "billing_charges_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_webhook_events: {
        Row: {
          id: string;
          store_id: string;
          charge_id: string | null;
          provider: "mercado_pago";
          provider_event_id: string | null;
          provider_payment_id: string | null;
          action: string | null;
          payload_hash: string;
          received_at: string;
          processed_at: string | null;
          processing_status: WebhookProcessingStatus;
          error_code: string | null;
        };
        Insert: {
          id?: string;
          store_id: string;
          charge_id?: string | null;
          provider?: "mercado_pago";
          provider_event_id?: string | null;
          provider_payment_id?: string | null;
          action?: string | null;
          payload_hash: string;
          received_at?: string;
          processed_at?: string | null;
          processing_status?: WebhookProcessingStatus;
          error_code?: string | null;
        };
        Update: {
          id?: string;
          store_id?: string;
          charge_id?: string | null;
          provider?: "mercado_pago";
          provider_event_id?: string | null;
          provider_payment_id?: string | null;
          action?: string | null;
          payload_hash?: string;
          received_at?: string;
          processed_at?: string | null;
          processing_status?: WebhookProcessingStatus;
          error_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "billing_webhook_events_charge_id_fkey";
            columns: ["charge_id"];
            isOneToOne: false;
            referencedRelation: "billing_charges";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_webhook_events_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      onboarding_ensure_progress: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["onboarding_progress"]["Row"];
      };
      onboarding_save_profile: {
        Args: { p_merchant_name: string; p_whatsapp: string };
        Returns: Database["public"]["Tables"]["onboarding_progress"]["Row"];
      };
      onboarding_save_store_name: {
        Args: { p_store_name: string };
        Returns: Database["public"]["Tables"]["onboarding_progress"]["Row"];
      };
      onboarding_save_slug: {
        Args: { p_slug: string };
        Returns: Database["public"]["Tables"]["onboarding_progress"]["Row"];
      };
      onboarding_save_plan: {
        Args: { p_plan_code: PlanCode };
        Returns: Database["public"]["Tables"]["onboarding_progress"]["Row"];
      };
      onboarding_complete: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["stores"]["Row"];
      };
      is_slug_available: {
        Args: { p_slug: string };
        Returns: boolean;
      };
      issue_password_recovery_grant: {
        Args: { p_user_id: string; p_session_id: string; p_nonce: string; p_ttl_seconds?: number };
        Returns: string;
      };
      claim_recovery_grant_for_password_change: {
        Args: { p_nonce: string };
        Returns: {
          claimed: boolean;
          attempt_id: string | null;
          completion_capability: string | null;
        };
      };
      is_current_session_recovery_grant: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      complete_password_recovery_attempt: {
        Args: { p_attempt_id: string; p_capability: string };
        Returns: boolean;
      };
      catalog_create_category: {
        Args: {
          p_store_id: string;
          p_name: string;
          p_slug: string;
          p_description?: string | null;
          p_display_order?: number;
        };
        Returns: Database["public"]["Tables"]["categories"]["Row"];
      };
      catalog_update_category: {
        Args: {
          p_category_id: string;
          p_name: string;
          p_slug: string;
          p_description?: string | null;
          p_display_order?: number;
        };
        Returns: Database["public"]["Tables"]["categories"]["Row"];
      };
      catalog_set_category_active: {
        Args: { p_category_id: string; p_is_active: boolean };
        Returns: Database["public"]["Tables"]["categories"]["Row"];
      };
      catalog_create_product: {
        Args: {
          p_store_id: string;
          p_name: string;
          p_slug: string;
          p_price_cents: number;
          p_stock: number;
          p_category_id?: string | null;
          p_description?: string | null;
          p_sku?: string | null;
        };
        Returns: Database["public"]["Tables"]["products"]["Row"];
      };
      catalog_update_product: {
        Args: {
          p_product_id: string;
          p_name: string;
          p_slug: string;
          p_price_cents: number;
          p_category_id?: string | null;
          p_description?: string | null;
          p_sku?: string | null;
        };
        Returns: Database["public"]["Tables"]["products"]["Row"];
      };
      catalog_set_product_status: {
        Args: { p_product_id: string; p_status: ProductStatus };
        Returns: Database["public"]["Tables"]["products"]["Row"];
      };
      catalog_adjust_stock: {
        Args: { p_product_id: string; p_delta: number; p_reason: string; p_reference?: string | null };
        Returns: number;
      };
      catalog_add_product_image: {
        Args: { p_product_id: string; p_storage_path: string; p_is_cover?: boolean };
        Returns: Database["public"]["Tables"]["product_images"]["Row"];
      };
      catalog_remove_product_image: {
        Args: { p_image_id: string };
        Returns: void;
      };
      catalog_set_cover_image: {
        Args: { p_image_id: string };
        Returns: void;
      };
      catalog_move_product_image: {
        Args: { p_image_id: string; p_direction: "up" | "down" };
        Returns: void;
      };
      can_view_store_orders: {
        Args: { target_store_id: string };
        Returns: boolean;
      };
      can_manage_store_orders: {
        Args: { target_store_id: string };
        Returns: boolean;
      };
      coupon_preview: {
        Args: { p_store_slug: string; p_code: string; p_subtotal_cents: number };
        Returns: {
          valid: boolean;
          reason: string | null;
          code: string | null;
          discount_cents: number;
          minimum_order_cents: number | null;
        }[];
      };
      coupon_list: {
        Args: { p_store_id: string };
        Returns: {
          id: string;
          code: string;
          discount_type: "percentage" | "fixed_amount";
          discount_value: number;
          minimum_order_cents: number | null;
          maximum_discount_cents: number | null;
          starts_at: string | null;
          expires_at: string | null;
          max_uses: number | null;
          used_count: number;
          active: boolean;
          created_at: string;
        }[];
      };
      coupon_upsert: {
        Args: {
          p_store_id: string;
          p_coupon_id: string | null;
          p_code: string;
          p_discount_type: "percentage" | "fixed_amount";
          p_discount_value: number;
          p_minimum_order_cents?: number | null;
          p_maximum_discount_cents?: number | null;
          p_starts_at?: string | null;
          p_expires_at?: string | null;
          p_max_uses?: number | null;
          p_active?: boolean;
        };
        Returns: Database["public"]["Tables"]["coupons"]["Row"];
      };
      create_order: {
        Args: {
          p_store_slug: string;
          p_idempotency_key: string;
          p_customer_name: string;
          p_customer_phone: string;
          p_fulfillment_method: FulfillmentMethod;
          p_delivery_address: string | null;
          p_customer_notes: string | null;
          p_items: { product_id: string; quantity: number }[];
          /** TASK-012: código do cupom como digitado. Normalização, validação e cálculo do desconto acontecem no banco. */
          p_coupon_code?: string | null;
          /**
           * TASK-013: endereço de entrega estruturado. Só é exigido
           * quando a loja tem frete configurado e a modalidade é
           * `delivery`; nas demais, é ignorado. Não existe parâmetro de
           * VALOR de frete — o número sai de shipping_fee_for dentro da
           * transação, e por isso nenhum payload consegue alterá-lo.
           */
          p_shipping_postal_code?: string | null;
          p_shipping_street?: string | null;
          p_shipping_number?: string | null;
          p_shipping_complement?: string | null;
          p_shipping_neighborhood?: string | null;
          p_shipping_city?: string | null;
          p_shipping_state?: string | null;
        };
        Returns: Database["public"]["Tables"]["orders"]["Row"];
      };
      shipping_settings_get: {
        Args: { p_store_id: string };
        Returns: {
          is_configured: boolean;
          enabled: boolean;
          origin_postal_code: string | null;
          origin_city: string | null;
          origin_state: string | null;
          same_city_fee_cents: number;
          same_state_fee_cents: number;
          other_state_fee_cents: number;
          additional_fee_cents: number;
          free_shipping_enabled: boolean;
          free_shipping_minimum_cents: number | null;
          updated_at: string | null;
        }[];
      };
      shipping_settings_upsert: {
        Args: {
          p_store_id: string;
          p_enabled: boolean;
          p_origin_postal_code: string | null;
          p_origin_city: string | null;
          p_origin_state: string | null;
          p_same_city_fee_cents: number;
          p_same_state_fee_cents: number;
          p_other_state_fee_cents: number;
          p_additional_fee_cents: number;
          p_free_shipping_enabled: boolean;
          p_free_shipping_minimum_cents: number | null;
        };
        Returns: Database["public"]["Tables"]["store_shipping_settings"]["Row"];
      };
      /**
       * Prévia do frete no checkout. Recebe os ITENS, nunca um subtotal
       * pronto: subtotal, desconto e frete são todos recalculados no
       * banco, então o total mostrado na tela é o mesmo que create_order
       * vai gravar e o Mercado Pago vai cobrar.
       */
      shipping_quote: {
        Args: {
          p_store_slug: string;
          p_items: { product_id: string; quantity: number }[];
          p_coupon_code: string | null;
          p_postal_code: string | null;
          p_city: string | null;
          p_state: string | null;
        };
        Returns: {
          shipping_enabled: boolean;
          available: boolean;
          reason: string | null;
          rule: ShippingRule | null;
          shipping_cents: number;
          subtotal_cents: number;
          discount_cents: number;
          total_cents: number;
          free_shipping_enabled: boolean;
          free_shipping_minimum_cents: number | null;
          origin_city: string | null;
          origin_state: string | null;
        }[];
      };
      order_advance_status: {
        Args: { p_order_id: string; p_new_status: OrderStatus };
        Returns: Database["public"]["Tables"]["orders"]["Row"];
      };
      order_cancel: {
        Args: { p_order_id: string };
        Returns: Database["public"]["Tables"]["orders"]["Row"];
      };
      can_manage_store_payments: {
        Args: { target_store_id: string };
        Returns: boolean;
      };
      payment_settings_get: {
        Args: { p_store_id: string };
        Returns: {
          is_configured: boolean;
          environment: PixPaymentEnvironment | null;
          is_enabled: boolean;
          credentials_verified_at: string | null;
          last_error_code: string | null;
          access_token_preview: string | null;
          webhook_key: string | null;
        }[];
      };
      payment_settings_upsert: {
        Args: {
          p_store_id: string;
          p_environment: PixPaymentEnvironment;
          p_encrypted_access_token: string;
          p_encrypted_webhook_secret: string;
          p_access_token_preview: string;
        };
        Returns: Database["public"]["Tables"]["store_payment_settings"]["Row"];
      };
      payment_settings_set_enabled: {
        Args: { p_store_id: string; p_is_enabled: boolean };
        Returns: Database["public"]["Tables"]["store_payment_settings"]["Row"];
      };
      payment_settings_mark_verified: {
        Args: { p_store_id: string; p_ok: boolean; p_error_code: string | null };
        Returns: Database["public"]["Tables"]["store_payment_settings"]["Row"];
      };
      pix_payment_attempt_upsert_creating: {
        Args: {
          p_order_id: string;
          p_provider_idempotency_key: string;
          p_amount_cents: number;
          p_currency: string;
          p_payer_email: string;
          p_payer_doc_type: PixDocType;
          p_payer_doc_last4: string;
          p_receipt_token_hash: string;
        };
        Returns: Database["public"]["Tables"]["order_payments"]["Row"];
      };
      pix_payment_mark_created: {
        Args: {
          p_payment_attempt_id: string;
          p_provider_payment_id: string;
          p_provider_status: string;
          p_provider_status_detail: string | null;
          p_qr_code: string | null;
          p_qr_code_base64: string | null;
          p_ticket_url: string | null;
          p_expires_at: string | null;
        };
        Returns: Database["public"]["Tables"]["order_payments"]["Row"];
      };
      pix_payment_mark_creation_failed: {
        Args: { p_payment_attempt_id: string; p_error_code: string };
        Returns: Database["public"]["Tables"]["order_payments"]["Row"];
      };
      pix_payment_apply_provider_state: {
        Args: {
          p_payment_attempt_id: string;
          p_provider_payment_id: string;
          p_internal_status: string;
          p_provider_status: string;
          p_provider_status_detail: string | null;
          p_amount_cents: number;
          p_currency: string;
          p_external_reference: string;
          p_qr_code: string | null;
          p_qr_code_base64: string | null;
          p_ticket_url: string | null;
          p_expires_at: string | null;
        };
        Returns: Database["public"]["Tables"]["order_payments"]["Row"];
      };
      pix_webhook_event_record: {
        Args: {
          p_store_id: string;
          p_payment_attempt_id: string | null;
          p_provider_event_id: string | null;
          p_provider_payment_id: string;
          p_action: string | null;
          p_payload_hash: string;
          p_processing_status: WebhookProcessingStatus;
          p_error_code: string | null;
        };
        Returns: { event_id: string; is_duplicate: boolean }[];
      };
      payment_events_list_sanitized: {
        Args: { p_order_id: string };
        Returns: {
          action: string;
          processing_status: WebhookProcessingStatus;
          received_at: string;
          processed_at: string | null;
          error_code: string | null;
        }[];
      };
      platform_plan_price_cents: {
        Args: { p_plan_code: PlanCode };
        Returns: number | null;
      };
      billing_charge_upsert_creating: {
        Args: {
          p_store_id: string;
          p_provider_idempotency_key: string;
          p_payer_email: string;
          p_payer_doc_type: PixDocType;
          p_payer_doc_last4: string;
          /** TASK-012: plano escolhido para ESTA cobrança (renovação com troca), por plan_key. Ausente = mantém o plano vigente da ASSINATURA. Só passa a valer em workspace_subscriptions quando a cobrança é aprovada. */
          p_plan_key?: PlanKey | null;
        };
        Returns: Database["public"]["Tables"]["billing_charges"]["Row"];
      };
      billing_charge_mark_created: {
        Args: {
          p_charge_id: string;
          p_provider_payment_id: string;
          p_provider_status: string;
          p_provider_status_detail: string | null;
          p_qr_code: string | null;
          p_qr_code_base64: string | null;
          p_ticket_url: string | null;
          p_expires_at: string | null;
        };
        Returns: Database["public"]["Tables"]["billing_charges"]["Row"];
      };
      billing_charge_mark_creation_failed: {
        Args: { p_charge_id: string; p_error_code: string };
        Returns: Database["public"]["Tables"]["billing_charges"]["Row"];
      };
      billing_charge_apply_provider_state: {
        Args: {
          p_charge_id: string;
          p_provider_payment_id: string;
          p_internal_status: string;
          p_provider_status: string;
          p_provider_status_detail: string | null;
          p_amount_cents: number;
          p_currency: string;
          p_external_reference: string | null;
          p_qr_code: string | null;
          p_qr_code_base64: string | null;
          p_ticket_url: string | null;
          p_expires_at: string | null;
        };
        Returns: Database["public"]["Tables"]["billing_charges"]["Row"];
      };
      billing_webhook_event_record: {
        Args: {
          p_store_id: string;
          p_charge_id: string | null;
          p_provider_event_id: string | null;
          p_provider_payment_id: string;
          p_action: string | null;
          p_payload_hash: string;
          p_processing_status: WebhookProcessingStatus;
          p_error_code: string | null;
        };
        Returns: { event_id: string; is_duplicate: boolean }[];
      };
      billing_get_current_charge: {
        Args: { p_store_id: string };
        Returns: {
          id: string;
          status: BillingChargeStatus;
          plan_code: PlanCode;
          amount_cents: number;
          qr_code: string | null;
          qr_code_base64: string | null;
          ticket_url: string | null;
          expires_at: string | null;
          period_start: string;
          period_end: string;
          created_at: string;
        }[];
      };
      app_session_start_for_store: {
        Args: { p_store_id: string; p_user_agent_label?: string | null; p_takeover?: boolean };
        Returns: {
          session_id: string | null;
          conflict: boolean;
          other_label: string | null;
          other_last_seen: string | null;
        }[];
      };
      app_session_start: {
        Args: { p_workspace_id: string; p_user_agent_label?: string | null; p_takeover?: boolean };
        Returns: {
          session_id: string | null;
          conflict: boolean;
          other_label: string | null;
          other_last_seen: string | null;
        }[];
      };
      app_session_heartbeat: { Args: Record<string, never>; Returns: boolean };
      app_session_logout: { Args: Record<string, never>; Returns: undefined };
      workspace_team: {
        Args: { p_store_id: string };
        Returns: {
          user_id: string;
          email: string;
          display_name: string | null;
          role: "owner" | "member";
          joined_at: string;
          is_self: boolean;
        }[];
      };
      workspace_invite_member: {
        Args: { p_email: string; p_token_hash: string };
        Returns: { id: string; email: string; expires_at: string; status: string };
      };
      workspace_resend_invitation: {
        Args: { p_email: string; p_token_hash: string };
        Returns: { id: string; email: string; expires_at: string; status: string };
      };
      workspace_accept_invitation: {
        Args: { p_token_hash: string };
        Returns: { id: string; workspace_id: string; user_id: string; role: string };
      };
      workspace_revoke_invitation: { Args: { p_invitation_id: string }; Returns: undefined };
      workspace_remove_member: { Args: { p_user_id: string }; Returns: undefined };
      workspace_reserved_seats: { Args: { p_workspace_id: string }; Returns: number };
      workspace_can_use_plan: {
        Args: { p_workspace_id: string; p_plan_key: string };
        Returns: { allowed: boolean; reason: string | null; current_value: number | null; target_limit: number | null }[];
      };
      store_quota_usage: {
        Args: { p_store_id: string };
        Returns: {
          plan_key: PlanKey;
          products_used: number;
          products_limit: number;
          images_per_product_limit: number;
          stores_used: number;
          stores_limit: number;
          team_used: number;
          team_limit: number;
          coupons_enabled: boolean;
        }[];
      };
      catalog_can_add_product_image: {
        Args: { p_product_id: string };
        Returns: { allowed: boolean; used: number; image_limit: number }[];
      };
      workspace_create_store: {
        Args: { p_name: string; p_slug: string; p_whatsapp?: string | null };
        Returns: Database["public"]["Tables"]["stores"]["Row"];
      };
      store_product_quota_count: {
        Args: { p_store_id: string };
        Returns: number;
      };
      billing_get_subscription: {
        Args: { p_store_id: string };
        Returns: {
          current_plan_code: PlanCode | null;
          subscribed_at: string | null;
          current_period_start: string | null;
          current_period_end: string | null;
          last_approved_plan_code: PlanCode | null;
          last_approved_amount_cents: number | null;
        }[];
      };
      is_platform_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      platform_admin_store_overview: {
        Args: Record<string, never>;
        Returns: {
          store_id: string;
          slug: string;
          name: string;
          status: StoreStatus;
          pre_suspension_status: StoreStatus | null;
          suspension_reason: StoreSuspensionReason | null;
          whatsapp: string | null;
          plan_code: PlanCode | null;
          store_created_at: string;
          owner_user_id: string | null;
          owner_email: string | null;
          owner_display_name: string | null;
          latest_charge_status: BillingChargeStatus | null;
          latest_charge_amount_cents: number | null;
          latest_charge_approved_at: string | null;
          latest_charge_period_end: string | null;
        }[];
      };
      platform_admin_set_store_status: {
        Args: { p_store_id: string; p_action: "suspend" | "reactivate" };
        Returns: Database["public"]["Tables"]["stores"]["Row"];
      };
      billing_suspend_overdue_stores: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["stores"]["Row"][];
      };
    };
  };
}
