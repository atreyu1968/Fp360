---
name: RED FP360 module integration
description: Product-wide requirement for end-to-end, auditable data flow among ERP modules.
---

RED FP360 modules must connect through scoped, explicit, traceable source references; a route or sidebar link alone is not integration.

**Why:** The user confirmed on 2 November 2026 that ultimately all ERP applications must be properly connected.

**How to apply:** When changing a module, check source and consumer data contracts, tenant and organization boundaries, approval stages, retries and idempotency, and other consuming modules. Keep deliberately separate states and actions visible rather than automating payments, accounting entries, or filings.
