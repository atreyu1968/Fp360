---
name: Hacienda official-form scope
description: Jurisdiction split, model applicability, and non-filing constraints for RED FP360 tax templates.
---

RED FP360 Hacienda must separate state taxes (AEAT) from Canary Islands taxes (ATC). The state model set includes 036, 111/190, 115/180, 200, 130/131, 100, and 347. The ATC model set includes 400, 415, 420, 421, and 425. Applicability depends on the organization's legal form, IGIC regime, income-tax method, employees/professional withholdings, business rent, and third-party amounts. The user chose the latest official forms published as educational references for the simulated 2027 exercise.

The AEAT suppressed model 037 effective 2025-02-03; use model 036 instead. Tax forms, dates, calculations, receipts, and payments remain educational: never submit them to a real agency or claim legal validity.

Do not infer AEAT model 347 or state withholding obligations from invoice records whose tax amounts are IGIC. If the state reporting data is not available, mark those obligations for review rather than treating an ATC threshold as an AEAT decision. Keep the ATC IGIC source table separate from AEAT payroll/rent withholding views.

**Why:** The user explicitly required official forms and jurisdiction separation, then identified that ATC and AEAT obligations had been mixed. IGIC invoice records do not establish the separate AEAT reporting scope.

**How to apply:** Preserve AEAT/ATC separation in model catalog, obligation derivation, source data and tabs; mark uncertain applicability for review; refresh official references for future exercises; keep outputs non-official and all submission/payment actions inside the simulation.
