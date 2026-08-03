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
  | "password_recovery_completed"
  | "store_created"
  | "owner_assigned"
  | "plan_selected"
  | "onboarding_completed"
  | "access_denied";

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
          name: string;
          stock: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          name: string;
          stock?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          name?: string;
          stock?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
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
      recovery_grants: {
        Row: {
          user_id: string;
          session_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          session_id?: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          session_id?: string;
          created_at?: string;
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
      log_email_verification_completed: {
        Args: Record<string, never>;
        Returns: void;
      };
      log_password_recovery_completed: {
        Args: Record<string, never>;
        Returns: void;
      };
    };
  };
}
