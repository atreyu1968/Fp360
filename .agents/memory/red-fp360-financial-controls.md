---
name: RED FP360 financial controls
description: Boundaries between logistics, invoicing, collections, accounting, and bank reconciliation in the educational ERP.
---

**Rule:** In RED FP360, shipment dispatch, recipient-confirmed quantities, invoicing, collection, accounting, and bank reconciliation are separate simulated stages. Bill only confirmed quantities; open logistics incidents block billing. A recorded collection is not a posted bank balance: only a posted balanced journal entry changes accounting balances. Posted entries are corrected with an authorized linked reversal, not edited. Company-scoped document lists must follow the actor's organization; network-level access requires an authorized supervisor role. Forecasts and financing comparisons do not mutate balances.

**Why:** The product teaches auditable business processes rather than executing real financial operations. Collapsing stages can fabricate evidence, duplicate collections, or expose one company's records to another.

**How to apply:** Preserve these boundaries across future RED FP360 sales, logistics, treasury, accounting, and bank features. Keep simulation controls server-side and retain a traceable event for consequential transitions.
