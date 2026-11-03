---
name: RED FP360 module integration
description: Product-wide requirement for end-to-end, auditable data flow among ERP modules.
---

RED FP360 modules must connect through scoped, explicit, traceable source references; a route or sidebar link alone is not integration. The active company is the shared UI scope across company-owned modules; company-bound users cannot switch it. Network-wide coordination data without a company association must be clearly labeled as network-wide.

**Why:** The user confirmed on 2 November 2026 that all ERP applications must be properly connected and that the active environment and Dirección must show the correct company's data.

**How to apply:** When changing a module, check source and consumer data contracts, tenant and organization boundaries, approval stages, retries and idempotency, and other consuming modules. Use the shared active-company context for company-owned data, and label intentional network-wide summaries or workflows. Keep deliberately separate states and actions visible rather than automating payments, accounting entries, or filings.
