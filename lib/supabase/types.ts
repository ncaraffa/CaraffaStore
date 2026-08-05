export type StoreRole = "owner" | "admin" | "staff";
export type StoreStatus = "onboarding" | "pending_payment" | "active" | "suspended";
export type OnboardingStep =
  | "profile"
  | "store_name"
  | "slug"
  | "plan"
  | "review"
  | "completed";
export type PlanCode = 30 | 50 | 80;
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
  | "payment_manual_review_required";
export type ProductStatus = "draft" | "published" | "archived";
export type OrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "completed" | "cancelled";
export type FulfillmentMethod = "pickup" | "delivery";
export type OrderPaymentMode = "manual" | "pix";
export type PixPaymentEnvironment = "test" | "production";
export type PixDocType = "CPF" | "CNPJ";
export type PaymentStatus = "creating" | "pending" | "approved" | "rejected" | "cancelled" | "expired" | "error" | "manual_review";
export type WebhookProcessingStatus = "received" | "processed" | "ignored" | "rejected" | "error";

/**
 * Minimal hand-written mirror of `supabase/migrations/0001_init.sql`
 * through `0004_account_audit.sql`. Kept small on purpose — only what
 * TASK-001/TASK-002 actually created, not the full future catalog/
 * billing schema.
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
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          status?: StoreStatus;
          whatsapp?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          status?: StoreStatus;
          whatsapp?: string | null;
          created_at?: string;
        };
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
          total_cents: number;
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
        };
        Returns: Database["public"]["Tables"]["orders"]["Row"];
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
    };
  };
}
