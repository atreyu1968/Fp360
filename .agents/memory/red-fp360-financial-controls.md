---
name: RED FP360 financial controls
description: Boundaries between logistics, invoicing, collections, accounting, and bank reconciliation in the educational ERP.
---

**Rule:** In RED FP360, shipment dispatch, recipient-confirmed quantities, customer returns, invoicing, collection, accounting, and bank reconciliation are separate simulated stages. Bill only confirmed quantities; open logistics incidents block billing. Return approval and receipt do not change stock or invoices; any rectification remains a separate request until its own authorized workflow. A recorded collection is not a posted bank balance: only a posted balanced journal entry changes accounting balances. Posted entries are corrected with an authorized linked reversal, not edited. Company-scoped document lists must follow the actor's organization; network-level access requires an authorized supervisor role. Forecasts and financing comparisons do not mutate balances.

**Why:** The product teaches auditable business processes rather than executing real financial operations. Collapsing stages can fabricate evidence, duplicate collections, or expose one company's records to another.

**How to apply:** Preserve these boundaries across future RED FP360 sales, logistics, customer-service returns, treasury, accounting, and bank features. Keep simulation controls server-side and retain a traceable event for consequential transitions.

Orders are scoped to their buyer and participating suppliers: buyers see their full order, suppliers see their assigned product lines plus network-level lines with no assigned supplier, and internal unit costs are visible only to the supplier or an authorized network supervisor. Order creation and confirmation belong to the buyer; dispatch belongs to the supplier.

**Why:** Multiple simulated companies share one network, so tenant-level filtering alone exposes counterparties' commercial records and internal margins.

**How to apply:** Apply organization scope to order lists, dashboard summaries, detail responses, and retries. Keep network-wide access limited to administrators and network-level teachers.
