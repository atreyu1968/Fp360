CREATE TABLE "fp360_accounting_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"nature" text NOT NULL,
	"normal_balance" text NOT NULL,
	"parent_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_accounting_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"entry_number" integer,
	"fiscal_year" integer NOT NULL,
	"period" integer NOT NULL,
	"entry_date" date NOT NULL,
	"concept" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"source_reference" text,
	"debit_cents" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"posted_at" timestamp with time zone,
	"reversal_of_entry_id" text,
	"reversed_by_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_accounting_entry_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"account_id" text NOT NULL,
	"line_number" integer NOT NULL,
	"description" text NOT NULL,
	"debit_cents" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"third_party_organization_id" text
);

CREATE TABLE "fp360_accounting_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"entry_id" text,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_accounting_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"fiscal_year" integer NOT NULL,
	"period" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"reopened_at" timestamp with time zone,
	"reopened_by_user_id" text,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_accounting_sequences" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"fiscal_year" integer NOT NULL,
	"next_entry_number" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "fp360_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"action" text NOT NULL,
	"description" text NOT NULL,
	"reference" text NOT NULL,
	"simulated_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_crm_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"contact_id" text,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"due_date" date,
	"simulated_date" date NOT NULL,
	"actor_user_id" text,
	"actor_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_crm_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"full_name" text NOT NULL,
	"position" text NOT NULL,
	"channel" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_crm_opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"estimated_value_cents" integer NOT NULL,
	"probability_basis_points" integer DEFAULT 1000 NOT NULL,
	"expected_date" date,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_crm_opportunity_history" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" text,
	"actor_role" text NOT NULL,
	"simulated_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_direction_alert_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"alert_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to_user_id" text,
	"justification" text DEFAULT '' NOT NULL,
	"evidence_reference" text DEFAULT '' NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"updated_by_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_direction_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"proposed_action" text NOT NULL,
	"impact_cents" integer,
	"impact_note" text NOT NULL,
	"simulated_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_by_user_id" text NOT NULL,
	"submitted_by_role" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_role" text,
	"review_reason" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_direction_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"reason" text NOT NULL,
	"simulated_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_direction_objectives" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"label" text NOT NULL,
	"metric" text NOT NULL,
	"target_value" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_direction_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_role" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_direction_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_simulated_date" date,
	"assigned_to_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_by_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_direction_thresholds" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"value" integer,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"product_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"base_cents" integer NOT NULL,
	"igic_basis_points" integer NOT NULL,
	"igic_cents" integer NOT NULL,
	"total_cents" integer NOT NULL
);

CREATE TABLE "fp360_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"issuer_organization_id" text,
	"reference" text NOT NULL,
	"order_id" text NOT NULL,
	"buyer_name" text NOT NULL,
	"due_date" date,
	"base_cents" integer NOT NULL,
	"igic_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"simulated_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_logistics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"description" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_logistics_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"affected_quantity" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"resolved_by_user_id" text,
	"resolved_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);

CREATE TABLE "fp360_logistics_shipment_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"order_line_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "fp360_logistics_shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"order_id" text NOT NULL,
	"reference" text NOT NULL,
	"origin_organization_id" text,
	"destination_organization_id" text NOT NULL,
	"route_name" text,
	"carrier_name" text,
	"parcel_count" integer DEFAULT 1 NOT NULL,
	"planned_delivery_date" date,
	"status" text DEFAULT 'in_transit' NOT NULL,
	"simulated_date" date NOT NULL,
	"delivered_date" date,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"shipped_quantity" integer DEFAULT 0 NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"invoiced_quantity" integer DEFAULT 0 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"unit_cost_cents" integer,
	"igic_basis_points" integer NOT NULL,
	"item_type" text DEFAULT 'product' NOT NULL,
	"tracks_inventory" boolean DEFAULT true NOT NULL
);

CREATE TABLE "fp360_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"reference" text NOT NULL,
	"buyer_organization_id" text NOT NULL,
	"status" text NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"simulated_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"center" text NOT NULL,
	"island" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);

CREATE TABLE "fp360_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text DEFAULT '' NOT NULL,
	"organization_id" text,
	"invoice_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"simulated_date" date NOT NULL,
	"operation_id" text,
	"request_fingerprint" text,
	"created_by_user_id" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_product_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"object_path" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"uploader_user_id" text NOT NULL,
	"uploader_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_product_price_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"cost_cents" integer NOT NULL,
	"igic_basis_points" integer NOT NULL,
	"max_discount_basis_points" integer DEFAULT 0 NOT NULL,
	"valid_from" date NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_products" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"item_type" text DEFAULT 'product' NOT NULL,
	"unit" text DEFAULT 'unidad' NOT NULL,
	"tracks_inventory" boolean DEFAULT true NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"igic_basis_points" integer NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"minimum_stock" integer DEFAULT 0 NOT NULL,
	"max_discount_basis_points" integer DEFAULT 0 NOT NULL,
	"lead_time_days" integer DEFAULT 0 NOT NULL,
	"supplier_organization_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL
);

CREATE TABLE "fp360_purchase_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"request_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text NOT NULL,
	"simulated_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_purchase_invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"purchase_order_line_id" text NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"igic_basis_points" integer NOT NULL,
	"base_cents" integer NOT NULL,
	"igic_cents" integer NOT NULL
);

CREATE TABLE "fp360_purchase_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"request_id" text NOT NULL,
	"supplier_organization_id" text NOT NULL,
	"supersedes_invoice_id" text,
	"invoice_reference" text NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"base_cents" integer NOT NULL,
	"igic_cents" integer NOT NULL,
	"freight_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"match_status" text NOT NULL,
	"match_summary" text NOT NULL,
	"decision_reason" text,
	"decision_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_by_role" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_purchase_offer_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"request_line_id" text NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"igic_basis_points" integer NOT NULL
);

CREATE TABLE "fp360_purchase_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"request_id" text NOT NULL,
	"supplier_organization_id" text NOT NULL,
	"quote_reference" text NOT NULL,
	"delivery_days" integer NOT NULL,
	"payment_days" integer NOT NULL,
	"freight_cents" integer NOT NULL,
	"quality_score_basis_points" integer NOT NULL,
	"valid_until" date,
	"created_by_user_id" text NOT NULL,
	"created_by_role" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_purchase_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"purchase_order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"sku_snapshot" text NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"igic_basis_points" integer NOT NULL,
	"base_cents" integer NOT NULL,
	"igic_cents" integer NOT NULL
);

CREATE TABLE "fp360_purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"request_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"buyer_organization_id" text NOT NULL,
	"supplier_organization_id" text NOT NULL,
	"order_number" text NOT NULL,
	"base_cents" integer NOT NULL,
	"igic_cents" integer NOT NULL,
	"freight_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"status" text DEFAULT 'ordered' NOT NULL,
	"expected_date" date,
	"received_date" date,
	"awarded_reason" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_role" text NOT NULL,
	"simulated_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_purchase_receipt_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"purchase_order_line_id" text NOT NULL,
	"quantity_accepted" integer NOT NULL,
	"quantity_rejected" integer NOT NULL,
	"issue_reason" text
);

CREATE TABLE "fp360_purchase_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"receipt_reference" text NOT NULL,
	"received_date" date NOT NULL,
	"status" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_role" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_purchase_request_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"request_id" text NOT NULL,
	"product_id" text NOT NULL,
	"sku_snapshot" text NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"quantity" integer NOT NULL,
	"justification" text NOT NULL
);

CREATE TABLE "fp360_purchase_request_suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"request_id" text NOT NULL,
	"supplier_organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_purchase_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"request_number" text NOT NULL,
	"department" text NOT NULL,
	"urgency" text NOT NULL,
	"deadline" date,
	"budget_cap_cents" integer NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_role" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"decision_reason" text,
	"decision_by_user_id" text,
	"awarded_reason" text,
	"awarded_offer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_stock_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity_delta" integer NOT NULL,
	"stock_before" integer NOT NULL,
	"stock_after" integer NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"simulated_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text,
	"account_type" text DEFAULT 'company' NOT NULL,
	"name" text NOT NULL,
	"synthetic_reference" text NOT NULL,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_bank_effects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"reference" text NOT NULL,
	"nominal_cents" integer NOT NULL,
	"maturity_date" date NOT NULL,
	"status" text DEFAULT 'presented' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_bank_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text,
	"account_id" text,
	"transfer_id" text,
	"financing_id" text,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_bank_financing" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"product_type" text NOT NULL,
	"effect_id" text,
	"requested_amount_cents" integer NOT NULL,
	"offered_amount_cents" integer,
	"term_months" integer DEFAULT 0 NOT NULL,
	"annual_rate_bps" integer NOT NULL,
	"commission_bps" integer DEFAULT 0 NOT NULL,
	"installment_cents" integer,
	"total_interest_cents" integer,
	"total_cost_cents" integer,
	"net_disbursement_cents" integer,
	"credit_limit_cents" integer,
	"drawn_cents" integer DEFAULT 0 NOT NULL,
	"maturity_date" date,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"decision_reason" text,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"offered_by_user_id" text,
	"offered_by_name" text,
	"accepted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_bank_installments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"financing_id" text NOT NULL,
	"installment_number" integer NOT NULL,
	"due_date" date NOT NULL,
	"principal_cents" integer NOT NULL,
	"interest_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_operation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_bank_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"account_id" text NOT NULL,
	"counterparty_account_id" text,
	"transfer_id" text,
	"financing_id" text,
	"direction" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"delta_cents" integer NOT NULL,
	"balance_after_cents" integer NOT NULL,
	"reference" text NOT NULL,
	"description" text NOT NULL,
	"operation_id" text NOT NULL,
	"simulated_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_bank_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"source_account_id" text NOT NULL,
	"beneficiary_account_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"concept" text NOT NULL,
	"scheduled_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"validated_by_user_id" text,
	"authorized_by_user_id" text,
	"rejected_reason" text,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_tax_declarations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"tax_type" text NOT NULL,
	"model_code" text NOT NULL,
	"period_key" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"simulated_due_date" date,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payment_status" text DEFAULT 'not_due' NOT NULL,
	"source_invoice_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_purchase_invoice_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"form_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"taxable_base_cents" integer DEFAULT 0 NOT NULL,
	"output_igic_cents" integer DEFAULT 0 NOT NULL,
	"input_igic_cents" integer DEFAULT 0 NOT NULL,
	"withholding_base_cents" integer DEFAULT 0 NOT NULL,
	"withholding_cents" integer DEFAULT 0 NOT NULL,
	"result_cents" integer DEFAULT 0 NOT NULL,
	"receipt_reference" text,
	"supersedes_id" text,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"last_action_by_user_id" text,
	"last_action_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_tax_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"declaration_id" text,
	"requirement_id" text,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"simulated_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_tax_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"igic_regime" text NOT NULL,
	"income_tax_method" text NOT NULL,
	"has_employees" boolean DEFAULT false NOT NULL,
	"withholds_professionals" boolean DEFAULT false NOT NULL,
	"pays_business_rent" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"updated_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_tax_requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"declaration_id" text NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"response" text,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"responded_by_user_id" text,
	"responded_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_social_security_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_social_security_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"operation_type" text NOT NULL,
	"effective_date" date NOT NULL,
	"contribution_group" integer,
	"contract_type" text,
	"monthly_contribution_base_cents" integer,
	"employer_contribution_cents" integer,
	"worker_contribution_cents" integer,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"review_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);

CREATE TABLE "fp360_social_security_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"period_key" text NOT NULL,
	"worker_ids" jsonb NOT NULL,
	"worker_count" integer NOT NULL,
	"contribution_base_cents" integer NOT NULL,
	"employer_contribution_cents" integer NOT NULL,
	"worker_contribution_cents" integer NOT NULL,
	"total_contribution_cents" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_social_security_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"worker_ref" text NOT NULL,
	"contribution_group" integer NOT NULL,
	"contract_type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"monthly_contribution_base_cents" integer NOT NULL,
	"employer_contribution_cents" integer NOT NULL,
	"worker_contribution_cents" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_hr_absences" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"absence_type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"review_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);

CREATE TABLE "fp360_hr_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"vacancy_id" text NOT NULL,
	"candidate_ref" text NOT NULL,
	"training_score" integer NOT NULL,
	"skills_score" integer NOT NULL,
	"availability_score" integer NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);

CREATE TABLE "fp360_hr_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"version" integer NOT NULL,
	"document_type" text NOT NULL,
	"effective_date" date NOT NULL,
	"end_date" date,
	"contract_type" text NOT NULL,
	"weekly_hours" integer NOT NULL,
	"annual_salary_cents" integer NOT NULL,
	"contribution_group" integer NOT NULL,
	"convention_name" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"review_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);

CREATE TABLE "fp360_hr_employees" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"worker_ref" text NOT NULL,
	"job_title" text NOT NULL,
	"department" text NOT NULL,
	"contract_type" text NOT NULL,
	"weekly_hours" integer NOT NULL,
	"contribution_group" integer NOT NULL,
	"annual_salary_cents" integer NOT NULL,
	"convention_name" text NOT NULL,
	"virtual_bank_ref" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_hr_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"entity_id" text NOT NULL,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_hr_lifecycle_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"change_type" text NOT NULL,
	"effective_date" date NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"review_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);

CREATE TABLE "fp360_hr_vacancies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"job_title" text NOT NULL,
	"department" text NOT NULL,
	"contract_type" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_payroll_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_payroll_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"version" integer NOT NULL,
	"worker_social_security_bps" integer NOT NULL,
	"employer_social_security_bps" integer NOT NULL,
	"income_withholding_bps" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"activated_by_user_id" text,
	"activated_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);

CREATE TABLE "fp360_payroll_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"period_key" text NOT NULL,
	"version" integer NOT NULL,
	"policy_id" text NOT NULL,
	"receipt_lines" jsonb NOT NULL,
	"employee_count" integer NOT NULL,
	"gross_total_cents" integer NOT NULL,
	"net_total_cents" integer NOT NULL,
	"employer_cost_total_cents" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_customer_agreements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"agreement_ref" text NOT NULL,
	"product_ref" text NOT NULL,
	"terms" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"replacement_allowed" boolean DEFAULT false NOT NULL,
	"compensation_allowed" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"approved_by_user_id" text,
	"approved_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);

CREATE TABLE "fp360_customer_service_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"case_id" text,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"actor_user_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"simulated_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_customer_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"customer_organization_id" text NOT NULL,
	"case_ref" text NOT NULL,
	"source_type" text NOT NULL,
	"source_reference" text,
	"category" text NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"request" text NOT NULL,
	"standalone_reason" text,
	"assigned_to_user_id" text,
	"assigned_to_name" text,
	"proposed_solution" text,
	"root_cause" text,
	"satisfaction_score" integer,
	"opened_date" date NOT NULL,
	"due_date" date,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_customer_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"case_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"shipment_line_id" text NOT NULL,
	"return_ref" text NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text NOT NULL,
	"units_delivered" integer NOT NULL,
	"units_reported" integer NOT NULL,
	"units_approved" integer DEFAULT 0 NOT NULL,
	"units_received" integer DEFAULT 0 NOT NULL,
	"condition" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"credit_note_requested" boolean DEFAULT false NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_project_billings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text NOT NULL,
	"order_id" text NOT NULL,
	"service_sku" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_project_deliverables" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text,
	"deliverable_ref" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"document_reference" text,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);

CREATE TABLE "fp360_project_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"simulated_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_project_milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"milestone_ref" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"due_date" date,
	"billing_amount_cents" integer DEFAULT 0 NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone
);

CREATE TABLE "fp360_project_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_order_id" text,
	"resource_type" text NOT NULL,
	"description" text NOT NULL,
	"quantity_units" integer NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"total_cost_cents" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_reference" text,
	"source_line_id" text,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);

CREATE TABLE "fp360_project_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"objective" text NOT NULL,
	"scope" text NOT NULL,
	"budget_minutes" integer NOT NULL,
	"budget_amount_cents" integer NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"reason" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);

CREATE TABLE "fp360_project_time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_order_id" text NOT NULL,
	"minutes" integer NOT NULL,
	"hourly_cost_rate_cents" integer NOT NULL,
	"cost_cents" integer NOT NULL,
	"simulated_date" date NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);

CREATE TABLE "fp360_project_work_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_ref" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"assigned_to_user_id" text NOT NULL,
	"assigned_to_name" text NOT NULL,
	"planned_minutes" integer NOT NULL,
	"hourly_cost_rate_cents" integer NOT NULL,
	"status" text DEFAULT 'assigned' NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"customer_organization_id" text,
	"project_ref" text NOT NULL,
	"project_type" text NOT NULL,
	"title" text NOT NULL,
	"objective" text NOT NULL,
	"scope" text NOT NULL,
	"budget_minutes" integer NOT NULL,
	"budget_amount_cents" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);

CREATE TABLE "fp360_document_dossiers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"dossier_ref" text NOT NULL,
	"title" text NOT NULL,
	"dossier_type" text NOT NULL,
	"department" text NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"retention_rule" text DEFAULT 'educational' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);

CREATE TABLE "fp360_document_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"dossier_id" text,
	"document_id" text,
	"version_id" text,
	"event_type" text NOT NULL,
	"details" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"simulated_date" date NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'pending_upload' NOT NULL,
	"object_path" text,
	"original_name" text,
	"content_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"checksum_sha256" text,
	"content_text" text,
	"description" text DEFAULT '' NOT NULL,
	"source_version_id" text,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"operation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"dossier_id" text NOT NULL,
	"document_ref" text NOT NULL,
	"document_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"department" text NOT NULL,
	"period" text NOT NULL,
	"document_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'organization' NOT NULL,
	"owner_user_id" text NOT NULL,
	"owner_name" text NOT NULL,
	"origin_app" text DEFAULT 'manual' NOT NULL,
	"origin_id" text,
	"rectifies_document_id" text,
	"tags" text DEFAULT '' NOT NULL,
	"version_number" integer DEFAULT 0 NOT NULL,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);

CREATE TABLE "fp360_employment_communications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"communication_ref" text NOT NULL,
	"communication_type" text NOT NULL,
	"contract_id" text,
	"lifecycle_change_id" text,
	"simulated_date" date NOT NULL,
	"status" text NOT NULL,
	"acknowledgment_ref" text,
	"response_message" text,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resubmitted_at" timestamp with time zone
);

CREATE TABLE "fp360_communications_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_ref" text NOT NULL,
	"description" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_communications_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"sender_organization_id" text NOT NULL,
	"sender_department" text NOT NULL,
	"body" text NOT NULL,
	"attachment_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"simulated_date" date NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);

CREATE TABLE "fp360_communications_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"assigned_organization_id" text NOT NULL,
	"assigned_department" text NOT NULL,
	"title" text NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"completed_by_user_id" text,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);

CREATE TABLE "fp360_communications_thread_states" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_communications_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"reference" text NOT NULL,
	"origin_organization_id" text NOT NULL,
	"recipient_organization_id" text NOT NULL,
	"origin_department" text NOT NULL,
	"recipient_department" text NOT NULL,
	"subject" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"related_reference" text,
	"assigned_organization_id" text,
	"assigned_department" text,
	"created_by_user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);

CREATE TABLE "fp360_simulation_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"event_id" text,
	"organization_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_simulation_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_organization_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"mode" text NOT NULL,
	"duration_weeks" integer NOT NULL,
	"difficulty" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"participant_organization_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"operation_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"reviewed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_simulation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"description" text NOT NULL,
	"preconditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_document_type" text,
	"simulated_date" date NOT NULL,
	"evidence_document_id" text,
	"completed_by_user_id" text,
	"completed_at" timestamp with time zone,
	"operation_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"reviewed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_portfolio_criteria" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"code" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_portfolio_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"event_id" text NOT NULL,
	"student_user_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reflection" text DEFAULT '' NOT NULL,
	"contribution" text DEFAULT '' NOT NULL,
	"self_assessment" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" text,
	"feedback" text DEFAULT '' NOT NULL
);

CREATE TABLE "fp360_portfolio_entry_criteria" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"criterion_id" text NOT NULL
);

CREATE TABLE "fp360_portfolio_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"version" integer NOT NULL,
	"outcome" text NOT NULL,
	"feedback" text NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_portfolio_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"version" integer NOT NULL,
	"reflection" text NOT NULL,
	"contribution" text NOT NULL,
	"self_assessment" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_evaluation_activity_criteria" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"event_id" text NOT NULL,
	"criterion_id" text NOT NULL,
	"assigned_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_evaluation_assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"portfolio_entry_id" text NOT NULL,
	"student_user_id" text NOT NULL,
	"criterion_id" text NOT NULL,
	"rubric_id" text NOT NULL,
	"rubric_version" integer NOT NULL,
	"rubric_level_id" text NOT NULL,
	"rubric_level_label" text NOT NULL,
	"score" real NOT NULL,
	"score_scale" integer NOT NULL,
	"attempt_number" integer NOT NULL,
	"is_recovery" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"feedback" text NOT NULL,
	"reason" text NOT NULL,
	"evaluated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_evaluation_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"organization_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_evaluation_criteria" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"learning_outcome_code" text NOT NULL,
	"learning_outcome_title" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"weight" real NOT NULL,
	"minimum_score" real DEFAULT 5 NOT NULL,
	"minimum_evidence_count" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_evaluation_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"score_scale" integer DEFAULT 10 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"close_reason" text DEFAULT '' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_evaluation_rubrics" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"criterion_id" text NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"levels" jsonb NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_mentor_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text,
	"organization_id" text,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_label" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_mentor_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"organization_id" text,
	"simulation_event_id" text,
	"title" text NOT NULL,
	"sector" text NOT NULL,
	"level" text NOT NULL,
	"anonymized_summary" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"reviewed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_mentor_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"owner_organization_id" text,
	"linked_organization_id" text,
	"areas" text[] DEFAULT '{}' NOT NULL,
	"agreement_status" text DEFAULT 'draft' NOT NULL,
	"agreement_reference" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_role" text NOT NULL,
	"publish_name_authorized" boolean DEFAULT false NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_mentor_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"session_id" text,
	"challenge_id" text,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"participant_count" integer DEFAULT 0 NOT NULL,
	"document_id" text,
	"simulated_date" date NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_mentor_recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"review_id" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_mentor_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"challenge_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"reviewer_label" text NOT NULL,
	"decision" text NOT NULL,
	"observation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_mentor_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"objective" text NOT NULL,
	"modality" text NOT NULL,
	"scheduled_date" date NOT NULL,
	"scheduled_time" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"group_label" text NOT NULL,
	"participant_count" integer DEFAULT 0 NOT NULL,
	"material_summary" text DEFAULT '' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_coordination_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"center_id" text,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_organization_id" text,
	"actor_role" text NOT NULL,
	"actor_label" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_coordination_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_center_id" text NOT NULL,
	"owner_center_name" text NOT NULL,
	"owner_island" text NOT NULL,
	"title" text NOT NULL,
	"objective" text NOT NULL,
	"resource_plan" text DEFAULT '' NOT NULL,
	"simulation_campaign_id" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"operation_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_coordination_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"center_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text NOT NULL,
	"event_type" text NOT NULL,
	"start_date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"modality" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_coordination_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"center_id" text NOT NULL,
	"center_name" text NOT NULL,
	"incident_type" text NOT NULL,
	"severity" text NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_center_id" text,
	"assigned_center_name" text,
	"resolution" text DEFAULT '' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_coordination_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"center_id" text NOT NULL,
	"center_name" text NOT NULL,
	"island" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_coordination_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"center_id" text NOT NULL,
	"center_name" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"department" text NOT NULL,
	"responsible_role" text NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"evidence_summary" text DEFAULT '' NOT NULL,
	"document_id" text,
	"created_by_user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_coordination_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"center_id" text NOT NULL,
	"center_name" text NOT NULL,
	"status" text DEFAULT 'interested' NOT NULL,
	"adoption_summary" text DEFAULT '' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_admin_backup_exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"label" text NOT NULL,
	"status" text NOT NULL,
	"dataset_counts" jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_admin_config_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"version" integer NOT NULL,
	"valid_from" date NOT NULL,
	"settings" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_admin_privilege_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_type" text NOT NULL,
	"target_user_id" text,
	"email" text,
	"organization_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"approved_by_user_id" text,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);

CREATE TABLE "fp360_admin_ai_coordinator_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text DEFAULT 'local' NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_ai_delegation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"service_actor_id" text NOT NULL,
	"revision" integer NOT NULL,
	"operation_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"snapshot_at" timestamp with time zone,
	"context_hash" text,
	"company_count" integer,
	"operation_count" integer,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);

CREATE TABLE "fp360_ai_delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"service_actor_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"allowed_operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_auth_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_id" text NOT NULL,
	"operation_id" text,
	"operation_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_auth_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"organization_id" text,
	"token_hash" text NOT NULL,
	"created_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_auth_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fp360_auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);

CREATE TABLE "fp360_auth_setup_state" (
	"id" text PRIMARY KEY NOT NULL,
	"completed_at" timestamp with time zone
);

CREATE TABLE "fp360_auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"mfa_secret_encrypted" text,
	"mfa_pending_secret_encrypted" text,
	"mfa_pending_expires_at" timestamp with time zone,
	"mfa_enabled_at" timestamp with time zone,
	"mfa_recovery_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "fp360_accounting_accounts" ADD CONSTRAINT "fp360_accounting_accounts_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_accounting_entries" ADD CONSTRAINT "fp360_accounting_entries_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_accounting_entry_lines" ADD CONSTRAINT "fp360_accounting_entry_lines_entry_id_fp360_accounting_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."fp360_accounting_entries"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "fp360_accounting_entry_lines" ADD CONSTRAINT "fp360_accounting_entry_lines_account_id_fp360_accounting_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fp360_accounting_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_accounting_entry_lines" ADD CONSTRAINT "fp360_accounting_entry_lines_third_party_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("third_party_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_accounting_events" ADD CONSTRAINT "fp360_accounting_events_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_accounting_events" ADD CONSTRAINT "fp360_accounting_events_entry_id_fp360_accounting_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."fp360_accounting_entries"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_accounting_periods" ADD CONSTRAINT "fp360_accounting_periods_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_accounting_sequences" ADD CONSTRAINT "fp360_accounting_sequences_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_crm_activities" ADD CONSTRAINT "fp360_crm_activities_opportunity_id_fp360_crm_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."fp360_crm_opportunities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_crm_activities" ADD CONSTRAINT "fp360_crm_activities_contact_id_fp360_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."fp360_crm_contacts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_crm_contacts" ADD CONSTRAINT "fp360_crm_contacts_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_crm_opportunities" ADD CONSTRAINT "fp360_crm_opportunities_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_crm_opportunity_history" ADD CONSTRAINT "fp360_crm_opportunity_history_opportunity_id_fp360_crm_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."fp360_crm_opportunities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_invoice_lines" ADD CONSTRAINT "fp360_invoice_lines_invoice_id_fp360_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fp360_invoices"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "fp360_invoices" ADD CONSTRAINT "fp360_invoices_issuer_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("issuer_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_invoices" ADD CONSTRAINT "fp360_invoices_order_id_fp360_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."fp360_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_logistics_events" ADD CONSTRAINT "fp360_logistics_events_shipment_id_fp360_logistics_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."fp360_logistics_shipments"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "fp360_logistics_incidents" ADD CONSTRAINT "fp360_logistics_incidents_shipment_id_fp360_logistics_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."fp360_logistics_shipments"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "fp360_logistics_shipment_lines" ADD CONSTRAINT "fp360_logistics_shipment_lines_shipment_id_fp360_logistics_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."fp360_logistics_shipments"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "fp360_logistics_shipment_lines" ADD CONSTRAINT "fp360_logistics_shipment_lines_order_line_id_fp360_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."fp360_order_lines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_logistics_shipments" ADD CONSTRAINT "fp360_logistics_shipments_order_id_fp360_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."fp360_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_logistics_shipments" ADD CONSTRAINT "fp360_logistics_shipments_origin_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("origin_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_logistics_shipments" ADD CONSTRAINT "fp360_logistics_shipments_destination_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("destination_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_order_lines" ADD CONSTRAINT "fp360_order_lines_order_id_fp360_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."fp360_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "fp360_orders" ADD CONSTRAINT "fp360_orders_buyer_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("buyer_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_payments" ADD CONSTRAINT "fp360_payments_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_payments" ADD CONSTRAINT "fp360_payments_invoice_id_fp360_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fp360_invoices"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "fp360_product_documents" ADD CONSTRAINT "fp360_product_documents_product_id_fp360_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."fp360_products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_product_price_versions" ADD CONSTRAINT "fp360_product_price_versions_product_id_fp360_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."fp360_products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_products" ADD CONSTRAINT "fp360_products_supplier_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("supplier_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_events" ADD CONSTRAINT "fp360_purchase_events_request_id_fp360_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."fp360_purchase_requests"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_invoice_lines" ADD CONSTRAINT "fp360_purchase_invoice_lines_invoice_id_fp360_purchase_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fp360_purchase_invoices"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_invoice_lines" ADD CONSTRAINT "fp360_purchase_invoice_lines_purchase_order_line_id_fp360_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."fp360_purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_invoices" ADD CONSTRAINT "fp360_purchase_invoices_order_id_fp360_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."fp360_purchase_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_invoices" ADD CONSTRAINT "fp360_purchase_invoices_request_id_fp360_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."fp360_purchase_requests"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_invoices" ADD CONSTRAINT "fp360_purchase_invoices_supplier_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("supplier_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_offer_lines" ADD CONSTRAINT "fp360_purchase_offer_lines_offer_id_fp360_purchase_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."fp360_purchase_offers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_offer_lines" ADD CONSTRAINT "fp360_purchase_offer_lines_request_line_id_fp360_purchase_request_lines_id_fk" FOREIGN KEY ("request_line_id") REFERENCES "public"."fp360_purchase_request_lines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_offers" ADD CONSTRAINT "fp360_purchase_offers_request_id_fp360_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."fp360_purchase_requests"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_offers" ADD CONSTRAINT "fp360_purchase_offers_supplier_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("supplier_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_order_lines" ADD CONSTRAINT "fp360_purchase_order_lines_purchase_order_id_fp360_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."fp360_purchase_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_order_lines" ADD CONSTRAINT "fp360_purchase_order_lines_product_id_fp360_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."fp360_products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_orders" ADD CONSTRAINT "fp360_purchase_orders_request_id_fp360_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."fp360_purchase_requests"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_orders" ADD CONSTRAINT "fp360_purchase_orders_offer_id_fp360_purchase_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."fp360_purchase_offers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_orders" ADD CONSTRAINT "fp360_purchase_orders_buyer_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("buyer_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_orders" ADD CONSTRAINT "fp360_purchase_orders_supplier_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("supplier_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_receipt_lines" ADD CONSTRAINT "fp360_purchase_receipt_lines_receipt_id_fp360_purchase_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."fp360_purchase_receipts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_receipt_lines" ADD CONSTRAINT "fp360_purchase_receipt_lines_purchase_order_line_id_fp360_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."fp360_purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_receipts" ADD CONSTRAINT "fp360_purchase_receipts_order_id_fp360_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."fp360_purchase_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_request_lines" ADD CONSTRAINT "fp360_purchase_request_lines_request_id_fp360_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."fp360_purchase_requests"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_request_lines" ADD CONSTRAINT "fp360_purchase_request_lines_product_id_fp360_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."fp360_products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_request_suppliers" ADD CONSTRAINT "fp360_purchase_request_suppliers_request_id_fp360_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."fp360_purchase_requests"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_request_suppliers" ADD CONSTRAINT "fp360_purchase_request_suppliers_supplier_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("supplier_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_purchase_requests" ADD CONSTRAINT "fp360_purchase_requests_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_stock_adjustments" ADD CONSTRAINT "fp360_stock_adjustments_product_id_fp360_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."fp360_products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_accounts" ADD CONSTRAINT "fp360_bank_accounts_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_effects" ADD CONSTRAINT "fp360_bank_effects_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_effects" ADD CONSTRAINT "fp360_bank_effects_invoice_id_fp360_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fp360_invoices"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_events" ADD CONSTRAINT "fp360_bank_events_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_events" ADD CONSTRAINT "fp360_bank_events_account_id_fp360_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fp360_bank_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_events" ADD CONSTRAINT "fp360_bank_events_transfer_id_fp360_bank_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."fp360_bank_transfers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_events" ADD CONSTRAINT "fp360_bank_events_financing_id_fp360_bank_financing_id_fk" FOREIGN KEY ("financing_id") REFERENCES "public"."fp360_bank_financing"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_financing" ADD CONSTRAINT "fp360_bank_financing_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_financing" ADD CONSTRAINT "fp360_bank_financing_account_id_fp360_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fp360_bank_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_financing" ADD CONSTRAINT "fp360_bank_financing_effect_id_fp360_bank_effects_id_fk" FOREIGN KEY ("effect_id") REFERENCES "public"."fp360_bank_effects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_installments" ADD CONSTRAINT "fp360_bank_installments_financing_id_fp360_bank_financing_id_fk" FOREIGN KEY ("financing_id") REFERENCES "public"."fp360_bank_financing"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "fp360_bank_movements" ADD CONSTRAINT "fp360_bank_movements_account_id_fp360_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fp360_bank_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_movements" ADD CONSTRAINT "fp360_bank_movements_counterparty_account_id_fp360_bank_accounts_id_fk" FOREIGN KEY ("counterparty_account_id") REFERENCES "public"."fp360_bank_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_movements" ADD CONSTRAINT "fp360_bank_movements_transfer_id_fp360_bank_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."fp360_bank_transfers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_movements" ADD CONSTRAINT "fp360_bank_movements_financing_id_fp360_bank_financing_id_fk" FOREIGN KEY ("financing_id") REFERENCES "public"."fp360_bank_financing"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_transfers" ADD CONSTRAINT "fp360_bank_transfers_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_transfers" ADD CONSTRAINT "fp360_bank_transfers_source_account_id_fp360_bank_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."fp360_bank_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_bank_transfers" ADD CONSTRAINT "fp360_bank_transfers_beneficiary_account_id_fp360_bank_accounts_id_fk" FOREIGN KEY ("beneficiary_account_id") REFERENCES "public"."fp360_bank_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_tax_declarations" ADD CONSTRAINT "fp360_tax_declarations_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_tax_events" ADD CONSTRAINT "fp360_tax_events_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_tax_events" ADD CONSTRAINT "fp360_tax_events_declaration_id_fp360_tax_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."fp360_tax_declarations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_tax_events" ADD CONSTRAINT "fp360_tax_events_requirement_id_fp360_tax_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."fp360_tax_requirements"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_tax_profiles" ADD CONSTRAINT "fp360_tax_profiles_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_tax_requirements" ADD CONSTRAINT "fp360_tax_requirements_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_tax_requirements" ADD CONSTRAINT "fp360_tax_requirements_declaration_id_fp360_tax_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."fp360_tax_declarations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_social_security_events" ADD CONSTRAINT "fp360_social_security_events_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_social_security_movements" ADD CONSTRAINT "fp360_social_security_movements_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_social_security_movements" ADD CONSTRAINT "fp360_social_security_movements_worker_id_fp360_social_security_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."fp360_social_security_workers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_social_security_settlements" ADD CONSTRAINT "fp360_social_security_settlements_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_social_security_workers" ADD CONSTRAINT "fp360_social_security_workers_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_hr_absences" ADD CONSTRAINT "fp360_hr_absences_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_hr_absences" ADD CONSTRAINT "fp360_hr_absences_employee_id_fp360_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."fp360_hr_employees"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_hr_candidates" ADD CONSTRAINT "fp360_hr_candidates_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_hr_candidates" ADD CONSTRAINT "fp360_hr_candidates_vacancy_id_fp360_hr_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."fp360_hr_vacancies"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_hr_contracts" ADD CONSTRAINT "fp360_hr_contracts_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_hr_contracts" ADD CONSTRAINT "fp360_hr_contracts_employee_id_fp360_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."fp360_hr_employees"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_hr_employees" ADD CONSTRAINT "fp360_hr_employees_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_hr_employees" ADD CONSTRAINT "fp360_hr_employees_candidate_id_fp360_hr_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."fp360_hr_candidates"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_hr_events" ADD CONSTRAINT "fp360_hr_events_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_hr_lifecycle_changes" ADD CONSTRAINT "fp360_hr_lifecycle_changes_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_hr_lifecycle_changes" ADD CONSTRAINT "fp360_hr_lifecycle_changes_employee_id_fp360_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."fp360_hr_employees"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_hr_vacancies" ADD CONSTRAINT "fp360_hr_vacancies_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_payroll_events" ADD CONSTRAINT "fp360_payroll_events_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_payroll_policies" ADD CONSTRAINT "fp360_payroll_policies_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_payroll_runs" ADD CONSTRAINT "fp360_payroll_runs_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_payroll_runs" ADD CONSTRAINT "fp360_payroll_runs_policy_id_fp360_payroll_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."fp360_payroll_policies"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_customer_agreements" ADD CONSTRAINT "fp360_customer_agreements_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_customer_service_events" ADD CONSTRAINT "fp360_customer_service_events_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_customer_service_events" ADD CONSTRAINT "fp360_customer_service_events_case_id_fp360_customer_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."fp360_customer_cases"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_customer_cases" ADD CONSTRAINT "fp360_customer_cases_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_customer_cases" ADD CONSTRAINT "fp360_customer_cases_customer_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("customer_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_customer_returns" ADD CONSTRAINT "fp360_customer_returns_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_customer_returns" ADD CONSTRAINT "fp360_customer_returns_case_id_fp360_customer_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."fp360_customer_cases"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_customer_returns" ADD CONSTRAINT "fp360_customer_returns_shipment_id_fp360_logistics_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."fp360_logistics_shipments"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_customer_returns" ADD CONSTRAINT "fp360_customer_returns_shipment_line_id_fp360_logistics_shipment_lines_id_fk" FOREIGN KEY ("shipment_line_id") REFERENCES "public"."fp360_logistics_shipment_lines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_billings" ADD CONSTRAINT "fp360_project_billings_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_billings" ADD CONSTRAINT "fp360_project_billings_project_id_fp360_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fp360_projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_billings" ADD CONSTRAINT "fp360_project_billings_milestone_id_fp360_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."fp360_project_milestones"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_billings" ADD CONSTRAINT "fp360_project_billings_order_id_fp360_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."fp360_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_deliverables" ADD CONSTRAINT "fp360_project_deliverables_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_deliverables" ADD CONSTRAINT "fp360_project_deliverables_project_id_fp360_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fp360_projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_deliverables" ADD CONSTRAINT "fp360_project_deliverables_milestone_id_fp360_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."fp360_project_milestones"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_events" ADD CONSTRAINT "fp360_project_events_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_events" ADD CONSTRAINT "fp360_project_events_project_id_fp360_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fp360_projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_milestones" ADD CONSTRAINT "fp360_project_milestones_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_milestones" ADD CONSTRAINT "fp360_project_milestones_project_id_fp360_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fp360_projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_resources" ADD CONSTRAINT "fp360_project_resources_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_resources" ADD CONSTRAINT "fp360_project_resources_project_id_fp360_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fp360_projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_resources" ADD CONSTRAINT "fp360_project_resources_work_order_id_fp360_project_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."fp360_project_work_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_resources" ADD CONSTRAINT "fp360_project_resources_source_line_id_fp360_purchase_receipt_lines_id_fk" FOREIGN KEY ("source_line_id") REFERENCES "public"."fp360_purchase_receipt_lines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_revisions" ADD CONSTRAINT "fp360_project_revisions_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_revisions" ADD CONSTRAINT "fp360_project_revisions_project_id_fp360_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fp360_projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_time_entries" ADD CONSTRAINT "fp360_project_time_entries_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_time_entries" ADD CONSTRAINT "fp360_project_time_entries_project_id_fp360_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fp360_projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_time_entries" ADD CONSTRAINT "fp360_project_time_entries_work_order_id_fp360_project_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."fp360_project_work_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_work_orders" ADD CONSTRAINT "fp360_project_work_orders_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_project_work_orders" ADD CONSTRAINT "fp360_project_work_orders_project_id_fp360_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fp360_projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_projects" ADD CONSTRAINT "fp360_projects_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_projects" ADD CONSTRAINT "fp360_projects_customer_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("customer_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_document_dossiers" ADD CONSTRAINT "fp360_document_dossiers_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_document_events" ADD CONSTRAINT "fp360_document_events_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_document_events" ADD CONSTRAINT "fp360_document_events_dossier_id_fp360_document_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."fp360_document_dossiers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_document_events" ADD CONSTRAINT "fp360_document_events_document_id_fp360_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fp360_documents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_document_events" ADD CONSTRAINT "fp360_document_events_version_id_fp360_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."fp360_document_versions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_document_versions" ADD CONSTRAINT "fp360_document_versions_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_document_versions" ADD CONSTRAINT "fp360_document_versions_document_id_fp360_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fp360_documents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_documents" ADD CONSTRAINT "fp360_documents_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_documents" ADD CONSTRAINT "fp360_documents_dossier_id_fp360_document_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."fp360_document_dossiers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_employment_communications" ADD CONSTRAINT "fp360_employment_communications_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_employment_communications" ADD CONSTRAINT "fp360_employment_communications_contract_id_fp360_hr_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."fp360_hr_contracts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_employment_communications" ADD CONSTRAINT "fp360_employment_communications_lifecycle_change_id_fp360_hr_lifecycle_changes_id_fk" FOREIGN KEY ("lifecycle_change_id") REFERENCES "public"."fp360_hr_lifecycle_changes"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_communications_events" ADD CONSTRAINT "fp360_communications_events_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_communications_events" ADD CONSTRAINT "fp360_communications_events_thread_id_fp360_communications_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."fp360_communications_threads"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_communications_messages" ADD CONSTRAINT "fp360_communications_messages_thread_id_fp360_communications_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."fp360_communications_threads"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_communications_messages" ADD CONSTRAINT "fp360_communications_messages_sender_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("sender_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_communications_tasks" ADD CONSTRAINT "fp360_communications_tasks_thread_id_fp360_communications_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."fp360_communications_threads"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_communications_tasks" ADD CONSTRAINT "fp360_communications_tasks_assigned_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("assigned_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_communications_thread_states" ADD CONSTRAINT "fp360_communications_thread_states_thread_id_fp360_communications_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."fp360_communications_threads"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_communications_thread_states" ADD CONSTRAINT "fp360_communications_thread_states_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_communications_threads" ADD CONSTRAINT "fp360_communications_threads_origin_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("origin_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_communications_threads" ADD CONSTRAINT "fp360_communications_threads_recipient_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("recipient_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_communications_threads" ADD CONSTRAINT "fp360_communications_threads_assigned_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("assigned_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_simulation_audit_events" ADD CONSTRAINT "fp360_simulation_audit_events_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_simulation_audit_events" ADD CONSTRAINT "fp360_simulation_audit_events_event_id_fp360_simulation_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."fp360_simulation_events"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_simulation_audit_events" ADD CONSTRAINT "fp360_simulation_audit_events_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_simulation_campaigns" ADD CONSTRAINT "fp360_simulation_campaigns_owner_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_simulation_events" ADD CONSTRAINT "fp360_simulation_events_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_simulation_events" ADD CONSTRAINT "fp360_simulation_events_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_simulation_events" ADD CONSTRAINT "fp360_simulation_events_evidence_document_id_fp360_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."fp360_documents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_criteria" ADD CONSTRAINT "fp360_portfolio_criteria_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_criteria" ADD CONSTRAINT "fp360_portfolio_criteria_created_by_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_entries" ADD CONSTRAINT "fp360_portfolio_entries_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_entries" ADD CONSTRAINT "fp360_portfolio_entries_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_entries" ADD CONSTRAINT "fp360_portfolio_entries_event_id_fp360_simulation_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."fp360_simulation_events"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_entries" ADD CONSTRAINT "fp360_portfolio_entries_student_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_entries" ADD CONSTRAINT "fp360_portfolio_entries_reviewed_by_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_entry_criteria" ADD CONSTRAINT "fp360_portfolio_entry_criteria_entry_id_fp360_portfolio_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."fp360_portfolio_entries"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_entry_criteria" ADD CONSTRAINT "fp360_portfolio_entry_criteria_criterion_id_fp360_portfolio_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."fp360_portfolio_criteria"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_reviews" ADD CONSTRAINT "fp360_portfolio_reviews_entry_id_fp360_portfolio_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."fp360_portfolio_entries"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_reviews" ADD CONSTRAINT "fp360_portfolio_reviews_reviewer_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_revisions" ADD CONSTRAINT "fp360_portfolio_revisions_entry_id_fp360_portfolio_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."fp360_portfolio_entries"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_portfolio_revisions" ADD CONSTRAINT "fp360_portfolio_revisions_created_by_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_activity_criteria" ADD CONSTRAINT "fp360_evaluation_activity_criteria_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_activity_criteria" ADD CONSTRAINT "fp360_evaluation_activity_criteria_event_id_fp360_simulation_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."fp360_simulation_events"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_activity_criteria" ADD CONSTRAINT "fp360_evaluation_activity_criteria_criterion_id_fp360_evaluation_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."fp360_evaluation_criteria"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_activity_criteria" ADD CONSTRAINT "fp360_evaluation_activity_criteria_assigned_by_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_assessments" ADD CONSTRAINT "fp360_evaluation_assessments_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_assessments" ADD CONSTRAINT "fp360_evaluation_assessments_portfolio_entry_id_fp360_portfolio_entries_id_fk" FOREIGN KEY ("portfolio_entry_id") REFERENCES "public"."fp360_portfolio_entries"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_assessments" ADD CONSTRAINT "fp360_evaluation_assessments_student_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_assessments" ADD CONSTRAINT "fp360_evaluation_assessments_criterion_id_fp360_evaluation_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."fp360_evaluation_criteria"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_assessments" ADD CONSTRAINT "fp360_evaluation_assessments_rubric_id_fp360_evaluation_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."fp360_evaluation_rubrics"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_assessments" ADD CONSTRAINT "fp360_evaluation_assessments_evaluated_by_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("evaluated_by_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_audit" ADD CONSTRAINT "fp360_evaluation_audit_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_audit" ADD CONSTRAINT "fp360_evaluation_audit_actor_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_criteria" ADD CONSTRAINT "fp360_evaluation_criteria_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_criteria" ADD CONSTRAINT "fp360_evaluation_criteria_created_by_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_groups" ADD CONSTRAINT "fp360_evaluation_groups_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_groups" ADD CONSTRAINT "fp360_evaluation_groups_closed_by_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_groups" ADD CONSTRAINT "fp360_evaluation_groups_created_by_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_rubrics" ADD CONSTRAINT "fp360_evaluation_rubrics_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_rubrics" ADD CONSTRAINT "fp360_evaluation_rubrics_criterion_id_fp360_evaluation_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."fp360_evaluation_criteria"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_evaluation_rubrics" ADD CONSTRAINT "fp360_evaluation_rubrics_created_by_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_audit" ADD CONSTRAINT "fp360_mentor_audit_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_audit" ADD CONSTRAINT "fp360_mentor_audit_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_challenges" ADD CONSTRAINT "fp360_mentor_challenges_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_challenges" ADD CONSTRAINT "fp360_mentor_challenges_entity_id_fp360_mentor_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."fp360_mentor_entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_challenges" ADD CONSTRAINT "fp360_mentor_challenges_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_challenges" ADD CONSTRAINT "fp360_mentor_challenges_simulation_event_id_fp360_simulation_events_id_fk" FOREIGN KEY ("simulation_event_id") REFERENCES "public"."fp360_simulation_events"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_entities" ADD CONSTRAINT "fp360_mentor_entities_owner_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_entities" ADD CONSTRAINT "fp360_mentor_entities_linked_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("linked_organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_evidence" ADD CONSTRAINT "fp360_mentor_evidence_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_evidence" ADD CONSTRAINT "fp360_mentor_evidence_session_id_fp360_mentor_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."fp360_mentor_sessions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_evidence" ADD CONSTRAINT "fp360_mentor_evidence_challenge_id_fp360_mentor_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."fp360_mentor_challenges"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_evidence" ADD CONSTRAINT "fp360_mentor_evidence_document_id_fp360_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fp360_documents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_recommendations" ADD CONSTRAINT "fp360_mentor_recommendations_review_id_fp360_mentor_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."fp360_mentor_reviews"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_reviews" ADD CONSTRAINT "fp360_mentor_reviews_challenge_id_fp360_mentor_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."fp360_mentor_challenges"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_reviews" ADD CONSTRAINT "fp360_mentor_reviews_entity_id_fp360_mentor_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."fp360_mentor_entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_sessions" ADD CONSTRAINT "fp360_mentor_sessions_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_sessions" ADD CONSTRAINT "fp360_mentor_sessions_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_mentor_sessions" ADD CONSTRAINT "fp360_mentor_sessions_entity_id_fp360_mentor_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."fp360_mentor_entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_coordination_audit" ADD CONSTRAINT "fp360_coordination_audit_campaign_id_fp360_coordination_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_coordination_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_coordination_campaigns" ADD CONSTRAINT "fp360_coordination_campaigns_simulation_campaign_id_fp360_simulation_campaigns_id_fk" FOREIGN KEY ("simulation_campaign_id") REFERENCES "public"."fp360_simulation_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_coordination_events" ADD CONSTRAINT "fp360_coordination_events_campaign_id_fp360_coordination_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_coordination_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_coordination_incidents" ADD CONSTRAINT "fp360_coordination_incidents_campaign_id_fp360_coordination_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_coordination_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_coordination_participants" ADD CONSTRAINT "fp360_coordination_participants_campaign_id_fp360_coordination_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_coordination_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_coordination_tasks" ADD CONSTRAINT "fp360_coordination_tasks_campaign_id_fp360_coordination_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_coordination_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_coordination_tasks" ADD CONSTRAINT "fp360_coordination_tasks_document_id_fp360_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fp360_documents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_coordination_transfers" ADD CONSTRAINT "fp360_coordination_transfers_campaign_id_fp360_coordination_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fp360_coordination_campaigns"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_admin_privilege_requests" ADD CONSTRAINT "fp360_admin_privilege_requests_target_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "fp360_ai_delegation_runs" ADD CONSTRAINT "fp360_ai_delegation_runs_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_ai_delegations" ADD CONSTRAINT "fp360_ai_delegations_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fp360_auth_audit" ADD CONSTRAINT "fp360_auth_audit_actor_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "fp360_auth_invitations" ADD CONSTRAINT "fp360_auth_invitations_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "fp360_auth_invitations" ADD CONSTRAINT "fp360_auth_invitations_created_by_fp360_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."fp360_auth_users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "fp360_auth_memberships" ADD CONSTRAINT "fp360_auth_memberships_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "fp360_auth_memberships" ADD CONSTRAINT "fp360_auth_memberships_organization_id_fp360_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."fp360_organizations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "fp360_auth_sessions" ADD CONSTRAINT "fp360_auth_sessions_user_id_fp360_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fp360_auth_users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "fp360_auth_sessions" ADD CONSTRAINT "fp360_auth_sessions_membership_id_fp360_auth_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."fp360_auth_memberships"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "fp360_accounting_accounts_code_idx" ON "fp360_accounting_accounts" USING btree ("tenant_id","organization_id","code");
CREATE INDEX "fp360_accounting_accounts_org_idx" ON "fp360_accounting_accounts" USING btree ("tenant_id","organization_id");
CREATE UNIQUE INDEX "fp360_accounting_entry_operation_idx" ON "fp360_accounting_entries" USING btree ("tenant_id","operation_id");
CREATE UNIQUE INDEX "fp360_accounting_entry_source_idx" ON "fp360_accounting_entries" USING btree ("tenant_id","organization_id","source_type","source_id");
CREATE UNIQUE INDEX "fp360_accounting_entry_number_idx" ON "fp360_accounting_entries" USING btree ("tenant_id","organization_id","fiscal_year","entry_number");
CREATE INDEX "fp360_accounting_entry_period_idx" ON "fp360_accounting_entries" USING btree ("tenant_id","organization_id","fiscal_year","period");
CREATE INDEX "fp360_accounting_entry_status_idx" ON "fp360_accounting_entries" USING btree ("tenant_id","organization_id","status");
CREATE INDEX "fp360_accounting_entry_lines_entry_idx" ON "fp360_accounting_entry_lines" USING btree ("tenant_id","entry_id");
CREATE INDEX "fp360_accounting_entry_lines_account_idx" ON "fp360_accounting_entry_lines" USING btree ("tenant_id","account_id");
CREATE UNIQUE INDEX "fp360_accounting_event_operation_idx" ON "fp360_accounting_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_accounting_event_entry_idx" ON "fp360_accounting_events" USING btree ("tenant_id","entry_id");
CREATE UNIQUE INDEX "fp360_accounting_period_org_idx" ON "fp360_accounting_periods" USING btree ("tenant_id","organization_id","fiscal_year","period");
CREATE UNIQUE INDEX "fp360_accounting_sequence_year_idx" ON "fp360_accounting_sequences" USING btree ("tenant_id","organization_id","fiscal_year");
CREATE INDEX "fp360_activity_tenant_idx" ON "fp360_activity" USING btree ("tenant_id");
CREATE INDEX "fp360_crm_activities_tenant_idx" ON "fp360_crm_activities" USING btree ("tenant_id");
CREATE INDEX "fp360_crm_activities_opportunity_idx" ON "fp360_crm_activities" USING btree ("tenant_id","opportunity_id");
CREATE INDEX "fp360_crm_contacts_tenant_idx" ON "fp360_crm_contacts" USING btree ("tenant_id");
CREATE INDEX "fp360_crm_contacts_org_idx" ON "fp360_crm_contacts" USING btree ("tenant_id","organization_id");
CREATE INDEX "fp360_crm_opportunities_tenant_idx" ON "fp360_crm_opportunities" USING btree ("tenant_id");
CREATE INDEX "fp360_crm_opportunities_org_idx" ON "fp360_crm_opportunities" USING btree ("tenant_id","organization_id");
CREATE INDEX "fp360_crm_stage_history_tenant_idx" ON "fp360_crm_opportunity_history" USING btree ("tenant_id","opportunity_id");
CREATE UNIQUE INDEX "fp360_direction_alert_action_key_idx" ON "fp360_direction_alert_actions" USING btree ("tenant_id","alert_key");
CREATE INDEX "fp360_direction_alert_actions_tenant_status_idx" ON "fp360_direction_alert_actions" USING btree ("tenant_id","status");
CREATE INDEX "fp360_direction_decisions_tenant_status_idx" ON "fp360_direction_decisions" USING btree ("tenant_id","status");
CREATE INDEX "fp360_direction_decisions_tenant_date_idx" ON "fp360_direction_decisions" USING btree ("tenant_id","simulated_date");
CREATE INDEX "fp360_direction_events_tenant_created_idx" ON "fp360_direction_events" USING btree ("tenant_id","created_at");
CREATE INDEX "fp360_direction_events_tenant_entity_idx" ON "fp360_direction_events" USING btree ("tenant_id","entity_type","entity_id");
CREATE INDEX "fp360_direction_objectives_tenant_period_idx" ON "fp360_direction_objectives" USING btree ("tenant_id","period_start","period_end");
CREATE INDEX "fp360_direction_reports_tenant_created_idx" ON "fp360_direction_reports" USING btree ("tenant_id","created_at");
CREATE INDEX "fp360_direction_reports_tenant_role_idx" ON "fp360_direction_reports" USING btree ("tenant_id","created_by_role");
CREATE INDEX "fp360_direction_tasks_tenant_status_idx" ON "fp360_direction_tasks" USING btree ("tenant_id","status");
CREATE INDEX "fp360_direction_tasks_tenant_due_idx" ON "fp360_direction_tasks" USING btree ("tenant_id","due_simulated_date");
CREATE INDEX "fp360_direction_tasks_tenant_assignee_idx" ON "fp360_direction_tasks" USING btree ("tenant_id","assigned_to_user_id");
CREATE UNIQUE INDEX "fp360_direction_threshold_key_idx" ON "fp360_direction_thresholds" USING btree ("tenant_id","key");
CREATE INDEX "fp360_direction_thresholds_tenant_idx" ON "fp360_direction_thresholds" USING btree ("tenant_id");
CREATE INDEX "fp360_invoice_lines_invoice_idx" ON "fp360_invoice_lines" USING btree ("invoice_id");
CREATE INDEX "fp360_invoices_tenant_idx" ON "fp360_invoices" USING btree ("tenant_id");
CREATE INDEX "fp360_invoices_order_idx" ON "fp360_invoices" USING btree ("order_id");
CREATE UNIQUE INDEX "fp360_invoices_reference_idx" ON "fp360_invoices" USING btree ("tenant_id","reference");
CREATE UNIQUE INDEX "fp360_logistics_event_op_idx" ON "fp360_logistics_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_logistics_event_shipment_idx" ON "fp360_logistics_events" USING btree ("tenant_id","shipment_id");
CREATE UNIQUE INDEX "fp360_logistics_incident_op_idx" ON "fp360_logistics_incidents" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_logistics_incident_shipment_idx" ON "fp360_logistics_incidents" USING btree ("tenant_id","shipment_id");
CREATE INDEX "fp360_logistics_shipment_lines_shipment_idx" ON "fp360_logistics_shipment_lines" USING btree ("tenant_id","shipment_id");
CREATE INDEX "fp360_logistics_shipment_lines_order_line_idx" ON "fp360_logistics_shipment_lines" USING btree ("order_line_id");
CREATE UNIQUE INDEX "fp360_logistics_shipment_op_idx" ON "fp360_logistics_shipments" USING btree ("tenant_id","operation_id");
CREATE UNIQUE INDEX "fp360_logistics_shipment_ref_idx" ON "fp360_logistics_shipments" USING btree ("tenant_id","reference");
CREATE INDEX "fp360_logistics_shipment_order_idx" ON "fp360_logistics_shipments" USING btree ("tenant_id","order_id");
CREATE INDEX "fp360_logistics_shipment_origin_idx" ON "fp360_logistics_shipments" USING btree ("tenant_id","origin_organization_id");
CREATE INDEX "fp360_logistics_shipment_destination_idx" ON "fp360_logistics_shipments" USING btree ("tenant_id","destination_organization_id");
CREATE INDEX "fp360_order_lines_order_idx" ON "fp360_order_lines" USING btree ("order_id");
CREATE INDEX "fp360_orders_tenant_idx" ON "fp360_orders" USING btree ("tenant_id");
CREATE INDEX "fp360_orders_buyer_idx" ON "fp360_orders" USING btree ("buyer_organization_id");
CREATE INDEX "fp360_organizations_tenant_idx" ON "fp360_organizations" USING btree ("tenant_id");
CREATE INDEX "fp360_payments_invoice_idx" ON "fp360_payments" USING btree ("invoice_id");
CREATE UNIQUE INDEX "fp360_payments_operation_idx" ON "fp360_payments" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_product_documents_tenant_product_idx" ON "fp360_product_documents" USING btree ("tenant_id","product_id");
CREATE UNIQUE INDEX "fp360_product_documents_object_path_idx" ON "fp360_product_documents" USING btree ("object_path");
CREATE INDEX "fp360_product_price_versions_tenant_product_idx" ON "fp360_product_price_versions" USING btree ("tenant_id","product_id");
CREATE INDEX "fp360_products_tenant_idx" ON "fp360_products" USING btree ("tenant_id");
CREATE UNIQUE INDEX "fp360_products_tenant_sku_idx" ON "fp360_products" USING btree ("tenant_id","sku");
CREATE INDEX "fp360_purchase_events_tenant_idx" ON "fp360_purchase_events" USING btree ("tenant_id","request_id");
CREATE INDEX "fp360_purchase_invoice_lines_tenant_idx" ON "fp360_purchase_invoice_lines" USING btree ("tenant_id","invoice_id");
CREATE UNIQUE INDEX "fp360_purchase_invoice_line_unique_idx" ON "fp360_purchase_invoice_lines" USING btree ("tenant_id","invoice_id","purchase_order_line_id");
CREATE INDEX "fp360_purchase_invoices_tenant_idx" ON "fp360_purchase_invoices" USING btree ("tenant_id","order_id");
CREATE UNIQUE INDEX "fp360_purchase_invoice_number_idx" ON "fp360_purchase_invoices" USING btree ("tenant_id","supplier_organization_id","invoice_reference");
CREATE INDEX "fp360_purchase_offer_lines_idx" ON "fp360_purchase_offer_lines" USING btree ("tenant_id","offer_id");
CREATE UNIQUE INDEX "fp360_purchase_offer_line_unique_idx" ON "fp360_purchase_offer_lines" USING btree ("tenant_id","offer_id","request_line_id");
CREATE INDEX "fp360_purchase_offers_tenant_idx" ON "fp360_purchase_offers" USING btree ("tenant_id","request_id");
CREATE UNIQUE INDEX "fp360_purchase_offer_supplier_unique_idx" ON "fp360_purchase_offers" USING btree ("tenant_id","request_id","supplier_organization_id");
CREATE INDEX "fp360_purchase_order_lines_idx" ON "fp360_purchase_order_lines" USING btree ("tenant_id","purchase_order_id");
CREATE INDEX "fp360_purchase_orders_tenant_idx" ON "fp360_purchase_orders" USING btree ("tenant_id","buyer_organization_id");
CREATE UNIQUE INDEX "fp360_purchase_orders_request_unique_idx" ON "fp360_purchase_orders" USING btree ("tenant_id","request_id");
CREATE UNIQUE INDEX "fp360_purchase_orders_number_unique_idx" ON "fp360_purchase_orders" USING btree ("tenant_id","order_number");
CREATE INDEX "fp360_purchase_receipt_lines_tenant_idx" ON "fp360_purchase_receipt_lines" USING btree ("tenant_id","receipt_id");
CREATE UNIQUE INDEX "fp360_purchase_receipt_line_unique_idx" ON "fp360_purchase_receipt_lines" USING btree ("tenant_id","receipt_id","purchase_order_line_id");
CREATE INDEX "fp360_purchase_receipts_tenant_idx" ON "fp360_purchase_receipts" USING btree ("tenant_id","order_id");
CREATE UNIQUE INDEX "fp360_purchase_receipt_reference_idx" ON "fp360_purchase_receipts" USING btree ("tenant_id","order_id","receipt_reference");
CREATE INDEX "fp360_purchase_request_lines_idx" ON "fp360_purchase_request_lines" USING btree ("tenant_id","request_id");
CREATE INDEX "fp360_purchase_request_suppliers_tenant_idx" ON "fp360_purchase_request_suppliers" USING btree ("tenant_id","request_id");
CREATE UNIQUE INDEX "fp360_purchase_request_supplier_unique_idx" ON "fp360_purchase_request_suppliers" USING btree ("tenant_id","request_id","supplier_organization_id");
CREATE INDEX "fp360_purchase_requests_tenant_idx" ON "fp360_purchase_requests" USING btree ("tenant_id","organization_id");
CREATE UNIQUE INDEX "fp360_purchase_requests_number_idx" ON "fp360_purchase_requests" USING btree ("tenant_id","request_number");
CREATE INDEX "fp360_stock_adjustment_product_idx" ON "fp360_stock_adjustments" USING btree ("tenant_id","product_id");
CREATE UNIQUE INDEX "fp360_bank_accounts_reference_idx" ON "fp360_bank_accounts" USING btree ("tenant_id","synthetic_reference");
CREATE UNIQUE INDEX "fp360_bank_accounts_primary_idx" ON "fp360_bank_accounts" USING btree ("tenant_id","organization_id") WHERE "fp360_bank_accounts"."is_primary" = true;
CREATE INDEX "fp360_bank_accounts_org_idx" ON "fp360_bank_accounts" USING btree ("tenant_id","organization_id");
CREATE UNIQUE INDEX "fp360_bank_effects_reference_idx" ON "fp360_bank_effects" USING btree ("tenant_id","reference");
CREATE UNIQUE INDEX "fp360_bank_effects_operation_idx" ON "fp360_bank_effects" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_bank_effects_org_idx" ON "fp360_bank_effects" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_bank_events_operation_idx" ON "fp360_bank_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_bank_events_transfer_idx" ON "fp360_bank_events" USING btree ("tenant_id","transfer_id");
CREATE INDEX "fp360_bank_events_financing_idx" ON "fp360_bank_events" USING btree ("tenant_id","financing_id");
CREATE UNIQUE INDEX "fp360_bank_financing_operation_idx" ON "fp360_bank_financing" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_bank_financing_org_idx" ON "fp360_bank_financing" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_bank_installments_number_idx" ON "fp360_bank_installments" USING btree ("tenant_id","financing_id","installment_number");
CREATE UNIQUE INDEX "fp360_bank_installments_payment_idx" ON "fp360_bank_installments" USING btree ("tenant_id","payment_operation_id");
CREATE INDEX "fp360_bank_installments_due_idx" ON "fp360_bank_installments" USING btree ("tenant_id","due_date","status");
CREATE UNIQUE INDEX "fp360_bank_movements_operation_account_idx" ON "fp360_bank_movements" USING btree ("tenant_id","operation_id","account_id");
CREATE INDEX "fp360_bank_movements_account_idx" ON "fp360_bank_movements" USING btree ("tenant_id","account_id","created_at");
CREATE INDEX "fp360_bank_movements_transfer_idx" ON "fp360_bank_movements" USING btree ("tenant_id","transfer_id");
CREATE UNIQUE INDEX "fp360_bank_transfers_operation_idx" ON "fp360_bank_transfers" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_bank_transfers_org_idx" ON "fp360_bank_transfers" USING btree ("tenant_id","organization_id","created_at");
CREATE INDEX "fp360_bank_transfers_status_idx" ON "fp360_bank_transfers" USING btree ("tenant_id","status");
CREATE UNIQUE INDEX "fp360_tax_declaration_operation_idx" ON "fp360_tax_declarations" USING btree ("tenant_id","operation_id");
CREATE UNIQUE INDEX "fp360_tax_declaration_version_idx" ON "fp360_tax_declarations" USING btree ("tenant_id","organization_id","tax_type","model_code","period_key","version");
CREATE INDEX "fp360_tax_declaration_org_idx" ON "fp360_tax_declarations" USING btree ("tenant_id","organization_id","status");
CREATE INDEX "fp360_tax_declaration_period_idx" ON "fp360_tax_declarations" USING btree ("tenant_id","organization_id","period_key");
CREATE UNIQUE INDEX "fp360_tax_event_operation_idx" ON "fp360_tax_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_tax_event_org_idx" ON "fp360_tax_events" USING btree ("tenant_id","organization_id","created_at");
CREATE UNIQUE INDEX "fp360_tax_profile_org_idx" ON "fp360_tax_profiles" USING btree ("tenant_id","organization_id");
CREATE UNIQUE INDEX "fp360_tax_requirement_reference_idx" ON "fp360_tax_requirements" USING btree ("tenant_id","reference");
CREATE UNIQUE INDEX "fp360_tax_requirement_operation_idx" ON "fp360_tax_requirements" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_tax_requirement_org_idx" ON "fp360_tax_requirements" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_social_security_event_op_unique" ON "fp360_social_security_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_social_security_events_org_idx" ON "fp360_social_security_events" USING btree ("tenant_id","organization_id","created_at");
CREATE UNIQUE INDEX "fp360_social_security_movement_op_unique" ON "fp360_social_security_movements" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_social_security_movements_org_date_idx" ON "fp360_social_security_movements" USING btree ("tenant_id","organization_id","effective_date");
CREATE INDEX "fp360_social_security_movements_worker_idx" ON "fp360_social_security_movements" USING btree ("worker_id","created_at");
CREATE UNIQUE INDEX "fp360_social_security_settlement_period_unique" ON "fp360_social_security_settlements" USING btree ("tenant_id","organization_id","period_key");
CREATE UNIQUE INDEX "fp360_social_security_settlement_op_unique" ON "fp360_social_security_settlements" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_social_security_settlements_org_idx" ON "fp360_social_security_settlements" USING btree ("tenant_id","organization_id","created_at");
CREATE UNIQUE INDEX "fp360_social_security_worker_ref_unique" ON "fp360_social_security_workers" USING btree ("tenant_id","organization_id","worker_ref");
CREATE INDEX "fp360_social_security_workers_org_status_idx" ON "fp360_social_security_workers" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_hr_absence_op_unique" ON "fp360_hr_absences" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_hr_absences_org_date_idx" ON "fp360_hr_absences" USING btree ("tenant_id","organization_id","start_date");
CREATE UNIQUE INDEX "fp360_hr_candidate_ref_unique" ON "fp360_hr_candidates" USING btree ("tenant_id","organization_id","candidate_ref");
CREATE UNIQUE INDEX "fp360_hr_candidate_vacancy_ref_unique" ON "fp360_hr_candidates" USING btree ("tenant_id","vacancy_id","candidate_ref");
CREATE INDEX "fp360_hr_candidates_org_status_idx" ON "fp360_hr_candidates" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_hr_contract_op_unique" ON "fp360_hr_contracts" USING btree ("tenant_id","operation_id");
CREATE UNIQUE INDEX "fp360_hr_contract_version_unique" ON "fp360_hr_contracts" USING btree ("tenant_id","employee_id","version");
CREATE INDEX "fp360_hr_contracts_org_status_idx" ON "fp360_hr_contracts" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_hr_employee_ref_unique" ON "fp360_hr_employees" USING btree ("tenant_id","organization_id","worker_ref");
CREATE UNIQUE INDEX "fp360_hr_employee_candidate_unique" ON "fp360_hr_employees" USING btree ("tenant_id","candidate_id");
CREATE INDEX "fp360_hr_employees_org_status_idx" ON "fp360_hr_employees" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_hr_event_op_unique" ON "fp360_hr_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_hr_events_org_idx" ON "fp360_hr_events" USING btree ("tenant_id","organization_id","created_at");
CREATE UNIQUE INDEX "fp360_hr_lifecycle_op_unique" ON "fp360_hr_lifecycle_changes" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_hr_lifecycle_org_idx" ON "fp360_hr_lifecycle_changes" USING btree ("tenant_id","organization_id","status");
CREATE INDEX "fp360_hr_vacancies_org_status_idx" ON "fp360_hr_vacancies" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_payroll_event_op_unique" ON "fp360_payroll_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_payroll_events_org_idx" ON "fp360_payroll_events" USING btree ("tenant_id","organization_id","created_at");
CREATE UNIQUE INDEX "fp360_payroll_policy_version_unique" ON "fp360_payroll_policies" USING btree ("tenant_id","organization_id","version");
CREATE UNIQUE INDEX "fp360_payroll_policy_op_unique" ON "fp360_payroll_policies" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_payroll_policy_status_idx" ON "fp360_payroll_policies" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_payroll_run_op_unique" ON "fp360_payroll_runs" USING btree ("tenant_id","operation_id");
CREATE UNIQUE INDEX "fp360_payroll_run_version_unique" ON "fp360_payroll_runs" USING btree ("tenant_id","organization_id","period_key","version");
CREATE INDEX "fp360_payroll_runs_org_period_idx" ON "fp360_payroll_runs" USING btree ("tenant_id","organization_id","period_key");
CREATE UNIQUE INDEX "fp360_customer_agreement_ref_unique" ON "fp360_customer_agreements" USING btree ("tenant_id","organization_id","agreement_ref");
CREATE UNIQUE INDEX "fp360_customer_agreement_operation_unique" ON "fp360_customer_agreements" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_customer_agreements_org_status_idx" ON "fp360_customer_agreements" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_customer_service_event_operation_unique" ON "fp360_customer_service_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_customer_service_events_entity_idx" ON "fp360_customer_service_events" USING btree ("tenant_id","entity_type","entity_id","created_at");
CREATE INDEX "fp360_customer_service_events_case_idx" ON "fp360_customer_service_events" USING btree ("tenant_id","case_id","created_at");
CREATE UNIQUE INDEX "fp360_customer_case_ref_unique" ON "fp360_customer_cases" USING btree ("tenant_id","organization_id","case_ref");
CREATE UNIQUE INDEX "fp360_customer_case_operation_unique" ON "fp360_customer_cases" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_customer_case_org_status_idx" ON "fp360_customer_cases" USING btree ("tenant_id","organization_id","status");
CREATE INDEX "fp360_customer_case_customer_idx" ON "fp360_customer_cases" USING btree ("tenant_id","customer_organization_id");
CREATE UNIQUE INDEX "fp360_customer_return_ref_unique" ON "fp360_customer_returns" USING btree ("tenant_id","organization_id","return_ref");
CREATE UNIQUE INDEX "fp360_customer_return_operation_unique" ON "fp360_customer_returns" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_customer_returns_case_idx" ON "fp360_customer_returns" USING btree ("tenant_id","case_id");
CREATE INDEX "fp360_customer_returns_shipment_line_idx" ON "fp360_customer_returns" USING btree ("tenant_id","shipment_line_id");
CREATE UNIQUE INDEX "fp360_project_billing_milestone_unique" ON "fp360_project_billings" USING btree ("tenant_id","milestone_id");
CREATE UNIQUE INDEX "fp360_project_billing_order_unique" ON "fp360_project_billings" USING btree ("tenant_id","order_id");
CREATE UNIQUE INDEX "fp360_project_billing_operation_unique" ON "fp360_project_billings" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_project_billings_project_idx" ON "fp360_project_billings" USING btree ("tenant_id","project_id");
CREATE UNIQUE INDEX "fp360_project_deliverable_ref_unique" ON "fp360_project_deliverables" USING btree ("tenant_id","project_id","deliverable_ref");
CREATE UNIQUE INDEX "fp360_project_deliverable_operation_unique" ON "fp360_project_deliverables" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_project_deliverables_project_idx" ON "fp360_project_deliverables" USING btree ("tenant_id","project_id","status");
CREATE UNIQUE INDEX "fp360_project_event_operation_unique" ON "fp360_project_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_project_events_project_idx" ON "fp360_project_events" USING btree ("tenant_id","project_id","created_at");
CREATE UNIQUE INDEX "fp360_project_milestone_ref_unique" ON "fp360_project_milestones" USING btree ("tenant_id","project_id","milestone_ref");
CREATE UNIQUE INDEX "fp360_project_milestone_operation_unique" ON "fp360_project_milestones" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_project_milestones_project_idx" ON "fp360_project_milestones" USING btree ("tenant_id","project_id","status");
CREATE UNIQUE INDEX "fp360_project_resource_operation_unique" ON "fp360_project_resources" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_project_resources_project_idx" ON "fp360_project_resources" USING btree ("tenant_id","project_id","status");
CREATE UNIQUE INDEX "fp360_project_revision_version_unique" ON "fp360_project_revisions" USING btree ("tenant_id","project_id","version");
CREATE UNIQUE INDEX "fp360_project_revision_operation_unique" ON "fp360_project_revisions" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_project_revisions_project_idx" ON "fp360_project_revisions" USING btree ("tenant_id","project_id","created_at");
CREATE UNIQUE INDEX "fp360_project_time_operation_unique" ON "fp360_project_time_entries" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_project_time_project_idx" ON "fp360_project_time_entries" USING btree ("tenant_id","project_id","status");
CREATE INDEX "fp360_project_time_work_order_idx" ON "fp360_project_time_entries" USING btree ("tenant_id","work_order_id","simulated_date");
CREATE UNIQUE INDEX "fp360_project_work_ref_unique" ON "fp360_project_work_orders" USING btree ("tenant_id","organization_id","work_ref");
CREATE UNIQUE INDEX "fp360_project_work_operation_unique" ON "fp360_project_work_orders" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_project_work_orders_project_idx" ON "fp360_project_work_orders" USING btree ("tenant_id","project_id","status");
CREATE UNIQUE INDEX "fp360_project_ref_unique" ON "fp360_projects" USING btree ("tenant_id","organization_id","project_ref");
CREATE UNIQUE INDEX "fp360_project_operation_unique" ON "fp360_projects" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_projects_org_status_idx" ON "fp360_projects" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_document_dossier_ref_unique" ON "fp360_document_dossiers" USING btree ("tenant_id","organization_id","dossier_ref");
CREATE UNIQUE INDEX "fp360_document_dossier_operation_unique" ON "fp360_document_dossiers" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_document_dossiers_scope_idx" ON "fp360_document_dossiers" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_document_event_operation_unique" ON "fp360_document_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_document_events_scope_date_idx" ON "fp360_document_events" USING btree ("tenant_id","organization_id","created_at");
CREATE INDEX "fp360_document_events_document_idx" ON "fp360_document_events" USING btree ("tenant_id","document_id","created_at");
CREATE UNIQUE INDEX "fp360_document_version_number_unique" ON "fp360_document_versions" USING btree ("tenant_id","document_id","version_number");
CREATE UNIQUE INDEX "fp360_document_version_operation_unique" ON "fp360_document_versions" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_document_versions_document_idx" ON "fp360_document_versions" USING btree ("tenant_id","document_id","version_number");
CREATE UNIQUE INDEX "fp360_document_ref_unique" ON "fp360_documents" USING btree ("tenant_id","organization_id","document_ref");
CREATE UNIQUE INDEX "fp360_document_operation_unique" ON "fp360_documents" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_documents_scope_status_idx" ON "fp360_documents" USING btree ("tenant_id","organization_id","status");
CREATE INDEX "fp360_documents_dossier_idx" ON "fp360_documents" USING btree ("tenant_id","dossier_id","document_date");
CREATE UNIQUE INDEX "fp360_employment_communication_ref_unique" ON "fp360_employment_communications" USING btree ("tenant_id","communication_ref");
CREATE UNIQUE INDEX "fp360_employment_communication_op_unique" ON "fp360_employment_communications" USING btree ("tenant_id","operation_id");
CREATE UNIQUE INDEX "fp360_employment_contract_communication_unique" ON "fp360_employment_communications" USING btree ("tenant_id","contract_id");
CREATE UNIQUE INDEX "fp360_employment_lifecycle_communication_unique" ON "fp360_employment_communications" USING btree ("tenant_id","lifecycle_change_id");
CREATE INDEX "fp360_employment_communications_org_status_idx" ON "fp360_employment_communications" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_communications_event_operation_unique" ON "fp360_communications_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_communications_event_thread_idx" ON "fp360_communications_events" USING btree ("tenant_id","thread_id","created_at");
CREATE UNIQUE INDEX "fp360_communications_message_operation_unique" ON "fp360_communications_messages" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_communications_message_thread_idx" ON "fp360_communications_messages" USING btree ("tenant_id","thread_id","created_at");
CREATE UNIQUE INDEX "fp360_communications_task_operation_unique" ON "fp360_communications_tasks" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_communications_task_scope_idx" ON "fp360_communications_tasks" USING btree ("tenant_id","assigned_organization_id","status","due_date");
CREATE UNIQUE INDEX "fp360_communications_thread_state_unique" ON "fp360_communications_thread_states" USING btree ("tenant_id","thread_id","user_id");
CREATE INDEX "fp360_communications_thread_state_user_idx" ON "fp360_communications_thread_states" USING btree ("tenant_id","user_id","archived_at");
CREATE UNIQUE INDEX "fp360_communications_thread_ref_unique" ON "fp360_communications_threads" USING btree ("tenant_id","reference");
CREATE UNIQUE INDEX "fp360_communications_thread_operation_unique" ON "fp360_communications_threads" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_communications_origin_idx" ON "fp360_communications_threads" USING btree ("tenant_id","origin_organization_id","updated_at");
CREATE INDEX "fp360_communications_recipient_idx" ON "fp360_communications_threads" USING btree ("tenant_id","recipient_organization_id","updated_at");
CREATE UNIQUE INDEX "fp360_simulation_audit_operation_unique" ON "fp360_simulation_audit_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_simulation_audit_campaign_idx" ON "fp360_simulation_audit_events" USING btree ("tenant_id","campaign_id","created_at");
CREATE UNIQUE INDEX "fp360_simulation_campaign_operation_unique" ON "fp360_simulation_campaigns" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_simulation_campaign_tenant_status_idx" ON "fp360_simulation_campaigns" USING btree ("tenant_id","status","created_at");
CREATE INDEX "fp360_simulation_campaign_owner_idx" ON "fp360_simulation_campaigns" USING btree ("tenant_id","owner_organization_id");
CREATE UNIQUE INDEX "fp360_simulation_event_operation_unique" ON "fp360_simulation_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_simulation_event_campaign_idx" ON "fp360_simulation_events" USING btree ("tenant_id","campaign_id","status");
CREATE INDEX "fp360_simulation_event_org_idx" ON "fp360_simulation_events" USING btree ("tenant_id","organization_id","simulated_date");
CREATE INDEX "fp360_simulation_event_evidence_idx" ON "fp360_simulation_events" USING btree ("evidence_document_id");
CREATE UNIQUE INDEX "fp360_portfolio_criteria_campaign_code_idx" ON "fp360_portfolio_criteria" USING btree ("tenant_id","campaign_id","code");
CREATE INDEX "fp360_portfolio_criteria_campaign_idx" ON "fp360_portfolio_criteria" USING btree ("tenant_id","campaign_id");
CREATE UNIQUE INDEX "fp360_portfolio_entry_event_student_idx" ON "fp360_portfolio_entries" USING btree ("tenant_id","event_id","student_user_id");
CREATE INDEX "fp360_portfolio_entry_campaign_idx" ON "fp360_portfolio_entries" USING btree ("tenant_id","campaign_id","status");
CREATE INDEX "fp360_portfolio_entry_student_idx" ON "fp360_portfolio_entries" USING btree ("tenant_id","student_user_id","updated_at");
CREATE INDEX "fp360_portfolio_entry_org_idx" ON "fp360_portfolio_entries" USING btree ("tenant_id","organization_id","campaign_id");
CREATE UNIQUE INDEX "fp360_portfolio_entry_criterion_unique_idx" ON "fp360_portfolio_entry_criteria" USING btree ("tenant_id","entry_id","criterion_id");
CREATE INDEX "fp360_portfolio_entry_criteria_entry_idx" ON "fp360_portfolio_entry_criteria" USING btree ("tenant_id","entry_id");
CREATE INDEX "fp360_portfolio_review_entry_idx" ON "fp360_portfolio_reviews" USING btree ("tenant_id","entry_id","created_at");
CREATE UNIQUE INDEX "fp360_portfolio_revision_version_idx" ON "fp360_portfolio_revisions" USING btree ("tenant_id","entry_id","version");
CREATE INDEX "fp360_portfolio_revision_entry_idx" ON "fp360_portfolio_revisions" USING btree ("tenant_id","entry_id","created_at");
CREATE UNIQUE INDEX "fp360_evaluation_activity_criterion_idx" ON "fp360_evaluation_activity_criteria" USING btree ("tenant_id","event_id","criterion_id");
CREATE INDEX "fp360_evaluation_activity_campaign_idx" ON "fp360_evaluation_activity_criteria" USING btree ("tenant_id","campaign_id","event_id");
CREATE UNIQUE INDEX "fp360_evaluation_attempt_number_idx" ON "fp360_evaluation_assessments" USING btree ("tenant_id","portfolio_entry_id","criterion_id","attempt_number");
CREATE INDEX "fp360_evaluation_assessment_student_idx" ON "fp360_evaluation_assessments" USING btree ("tenant_id","student_user_id","campaign_id");
CREATE INDEX "fp360_evaluation_assessment_org_idx" ON "fp360_evaluation_assessments" USING btree ("tenant_id","organization_id","campaign_id");
CREATE INDEX "fp360_evaluation_audit_campaign_idx" ON "fp360_evaluation_audit" USING btree ("tenant_id","campaign_id","created_at");
CREATE INDEX "fp360_evaluation_audit_org_idx" ON "fp360_evaluation_audit" USING btree ("tenant_id","organization_id","campaign_id","created_at");
CREATE INDEX "fp360_evaluation_audit_entity_idx" ON "fp360_evaluation_audit" USING btree ("tenant_id","entity_type","entity_id","created_at");
CREATE UNIQUE INDEX "fp360_evaluation_criterion_version_idx" ON "fp360_evaluation_criteria" USING btree ("tenant_id","campaign_id","code","version");
CREATE INDEX "fp360_evaluation_criterion_current_idx" ON "fp360_evaluation_criteria" USING btree ("tenant_id","campaign_id","is_current");
CREATE UNIQUE INDEX "fp360_evaluation_group_campaign_idx" ON "fp360_evaluation_groups" USING btree ("tenant_id","campaign_id");
CREATE INDEX "fp360_evaluation_group_status_idx" ON "fp360_evaluation_groups" USING btree ("tenant_id","status");
CREATE UNIQUE INDEX "fp360_evaluation_rubric_version_idx" ON "fp360_evaluation_rubrics" USING btree ("tenant_id","criterion_id","version");
CREATE INDEX "fp360_evaluation_rubric_campaign_idx" ON "fp360_evaluation_rubrics" USING btree ("tenant_id","campaign_id","criterion_id");
CREATE UNIQUE INDEX "fp360_mentor_audit_tenant_operation_idx" ON "fp360_mentor_audit" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_mentor_audit_tenant_resource_idx" ON "fp360_mentor_audit" USING btree ("tenant_id","resource_type","resource_id");
CREATE INDEX "fp360_mentor_audit_tenant_campaign_idx" ON "fp360_mentor_audit" USING btree ("tenant_id","campaign_id","created_at");
CREATE INDEX "fp360_mentor_challenges_tenant_campaign_idx" ON "fp360_mentor_challenges" USING btree ("tenant_id","campaign_id","status");
CREATE INDEX "fp360_mentor_challenges_entity_idx" ON "fp360_mentor_challenges" USING btree ("tenant_id","entity_id","status");
CREATE INDEX "fp360_mentor_challenges_org_idx" ON "fp360_mentor_challenges" USING btree ("tenant_id","organization_id","status");
CREATE UNIQUE INDEX "fp360_mentor_entities_tenant_agreement_idx" ON "fp360_mentor_entities" USING btree ("tenant_id","agreement_reference");
CREATE INDEX "fp360_mentor_entities_tenant_status_idx" ON "fp360_mentor_entities" USING btree ("tenant_id","agreement_status");
CREATE INDEX "fp360_mentor_entities_owner_org_idx" ON "fp360_mentor_entities" USING btree ("tenant_id","owner_organization_id");
CREATE INDEX "fp360_mentor_entities_linked_org_idx" ON "fp360_mentor_entities" USING btree ("tenant_id","linked_organization_id");
CREATE INDEX "fp360_mentor_evidence_tenant_campaign_idx" ON "fp360_mentor_evidence" USING btree ("tenant_id","campaign_id","created_at");
CREATE INDEX "fp360_mentor_evidence_session_idx" ON "fp360_mentor_evidence" USING btree ("tenant_id","session_id");
CREATE INDEX "fp360_mentor_evidence_challenge_idx" ON "fp360_mentor_evidence" USING btree ("tenant_id","challenge_id");
CREATE INDEX "fp360_mentor_recommendations_tenant_review_idx" ON "fp360_mentor_recommendations" USING btree ("tenant_id","review_id");
CREATE INDEX "fp360_mentor_recommendations_tenant_status_idx" ON "fp360_mentor_recommendations" USING btree ("tenant_id","status");
CREATE INDEX "fp360_mentor_reviews_tenant_challenge_idx" ON "fp360_mentor_reviews" USING btree ("tenant_id","challenge_id","created_at");
CREATE INDEX "fp360_mentor_reviews_entity_idx" ON "fp360_mentor_reviews" USING btree ("tenant_id","entity_id");
CREATE INDEX "fp360_mentor_sessions_tenant_date_idx" ON "fp360_mentor_sessions" USING btree ("tenant_id","scheduled_date","status");
CREATE INDEX "fp360_mentor_sessions_entity_date_idx" ON "fp360_mentor_sessions" USING btree ("tenant_id","entity_id","scheduled_date");
CREATE INDEX "fp360_mentor_sessions_campaign_org_idx" ON "fp360_mentor_sessions" USING btree ("tenant_id","campaign_id","organization_id");
CREATE UNIQUE INDEX "fp360_coord_audit_operation_unique" ON "fp360_coordination_audit" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_coord_audit_campaign_idx" ON "fp360_coordination_audit" USING btree ("tenant_id","campaign_id","created_at");
CREATE INDEX "fp360_coord_audit_center_idx" ON "fp360_coordination_audit" USING btree ("tenant_id","center_id","created_at");
CREATE UNIQUE INDEX "fp360_coord_campaign_operation_unique" ON "fp360_coordination_campaigns" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_coord_campaign_tenant_status_idx" ON "fp360_coordination_campaigns" USING btree ("tenant_id","status","created_at");
CREATE INDEX "fp360_coord_campaign_owner_idx" ON "fp360_coordination_campaigns" USING btree ("tenant_id","owner_center_id");
CREATE UNIQUE INDEX "fp360_coord_event_operation_unique" ON "fp360_coordination_events" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_coord_event_campaign_date_idx" ON "fp360_coordination_events" USING btree ("tenant_id","campaign_id","start_date");
CREATE UNIQUE INDEX "fp360_coord_incident_operation_unique" ON "fp360_coordination_incidents" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_coord_incident_campaign_status_idx" ON "fp360_coordination_incidents" USING btree ("tenant_id","campaign_id","status");
CREATE INDEX "fp360_coord_incident_center_idx" ON "fp360_coordination_incidents" USING btree ("tenant_id","center_id","created_at");
CREATE UNIQUE INDEX "fp360_coord_participant_center_unique" ON "fp360_coordination_participants" USING btree ("tenant_id","campaign_id","center_id");
CREATE INDEX "fp360_coord_participant_center_idx" ON "fp360_coordination_participants" USING btree ("tenant_id","center_id","status");
CREATE UNIQUE INDEX "fp360_coord_task_operation_unique" ON "fp360_coordination_tasks" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_coord_task_campaign_center_idx" ON "fp360_coordination_tasks" USING btree ("tenant_id","campaign_id","center_id","status");
CREATE UNIQUE INDEX "fp360_coord_transfer_operation_unique" ON "fp360_coordination_transfers" USING btree ("tenant_id","operation_id");
CREATE UNIQUE INDEX "fp360_coord_transfer_center_unique" ON "fp360_coordination_transfers" USING btree ("tenant_id","campaign_id","center_id");
CREATE UNIQUE INDEX "fp360_admin_backup_operation_unique" ON "fp360_admin_backup_exercises" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_admin_backup_tenant_created_idx" ON "fp360_admin_backup_exercises" USING btree ("tenant_id","created_at");
CREATE UNIQUE INDEX "fp360_admin_config_version_unique" ON "fp360_admin_config_versions" USING btree ("tenant_id","version");
CREATE INDEX "fp360_admin_config_tenant_created_idx" ON "fp360_admin_config_versions" USING btree ("tenant_id","created_at");
CREATE UNIQUE INDEX "fp360_admin_privilege_operation_unique" ON "fp360_admin_privilege_requests" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_admin_privilege_tenant_status_idx" ON "fp360_admin_privilege_requests" USING btree ("tenant_id","status");
CREATE UNIQUE INDEX "fp360_admin_ai_coordinator_tenant_unique" ON "fp360_admin_ai_coordinator_settings" USING btree ("tenant_id");
CREATE INDEX "fp360_admin_ai_coordinator_updated_idx" ON "fp360_admin_ai_coordinator_settings" USING btree ("tenant_id","updated_at");
CREATE UNIQUE INDEX "fp360_ai_run_operation_unique" ON "fp360_ai_delegation_runs" USING btree ("tenant_id","operation_id");
CREATE INDEX "fp360_ai_run_company_idx" ON "fp360_ai_delegation_runs" USING btree ("tenant_id","organization_id","created_at");
CREATE UNIQUE INDEX "fp360_ai_delegation_company_unique" ON "fp360_ai_delegations" USING btree ("tenant_id","organization_id");
CREATE UNIQUE INDEX "fp360_ai_delegation_service_unique" ON "fp360_ai_delegations" USING btree ("service_actor_id");
CREATE INDEX "fp360_auth_audit_tenant_idx" ON "fp360_auth_audit" USING btree ("tenant_id");
CREATE UNIQUE INDEX "fp360_auth_audit_operation_unique" ON "fp360_auth_audit" USING btree ("tenant_id","operation_id");
CREATE UNIQUE INDEX "fp360_auth_invitation_token_idx" ON "fp360_auth_invitations" USING btree ("token_hash");
CREATE INDEX "fp360_auth_invitation_tenant_idx" ON "fp360_auth_invitations" USING btree ("tenant_id");
CREATE UNIQUE INDEX "fp360_auth_membership_scope_idx" ON "fp360_auth_memberships" USING btree ("user_id","tenant_id");
CREATE INDEX "fp360_auth_membership_tenant_idx" ON "fp360_auth_memberships" USING btree ("tenant_id");
CREATE UNIQUE INDEX "fp360_auth_sessions_token_hash_idx" ON "fp360_auth_sessions" USING btree ("token_hash");
CREATE INDEX "fp360_auth_sessions_user_idx" ON "fp360_auth_sessions" USING btree ("user_id");
CREATE INDEX "fp360_auth_sessions_expiry_idx" ON "fp360_auth_sessions" USING btree ("expires_at");
CREATE UNIQUE INDEX "fp360_auth_users_email_idx" ON "fp360_auth_users" USING btree ("email");
