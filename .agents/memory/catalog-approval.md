---
name: Catalog approval and stock retries
description: Decisions for catalog publication, legacy scenarios and safe stock adjustments.
---

New references must start unpublished; existing demo references remain published only to preserve the original scenario.

**Why:** the functional product dossier requires approval before B2B publication, but introducing approval must not make the existing demonstration unusable.

**How to apply:** future imports, duplication tools and service catalogs must not inherit the legacy database default as permission to auto-publish. Changes to prices or simulated taxes require renewed approval without rewriting historical document snapshots.

Reuse a stock adjustment's operation ID when retrying the same logical submission after an uncertain network result.

**Why:** retrying an already committed adjustment with a new ID would apply its units twice.

**How to apply:** keep the ID stable while the form remains open; a genuinely new adjustment needs a new ID. Reusing an ID with different content must fail rather than silently changing the prior operation.
