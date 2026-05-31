# Implementation Plan — Step-by-Step Index

Step-by-step breakdown of the [Expense Tracker implementation plan](./expense-tracker-implementation-plan.md). Each step is a self-contained unit of work with clear acceptance criteria.

**Total estimated effort:** 18–28 hours across 11 steps, plus a Phase 4 feature pass (Steps 12–17) before deployment.

---

## Progress tracker

Tick off as you complete each step.

### Phase 1 — MVP (single statement, in-memory)

- [ ] **[Step 01](./01-project-setup.md)** — Project scaffolding & data schemas *(1–2h)*
- [ ] **[Step 02](./02-pdf-parser-and-categorization.md)** — TPBank PDF parser + categorization rules *(3–4h)*
- [ ] **[Step 03](./03-parse-api-and-upload-ui.md)** — `/api/parse` route + upload UI *(2h)*
- [ ] **[Step 04](./04-dashboard-charts.md)** — KPI cards, charts, transaction table *(3–4h)*
- [ ] **[Step 05](./05-ai-summary.md)** — Gemini integration + summary card *(2h)*

> **Milestone:** Upload sample PDF → see complete dashboard + AI summary.

### Phase 2 — Persistence & multi-period views

- [ ] **[Step 06](./06-s3-infrastructure.md)** — S3 bucket via Terraform *(1–2h)*
- [ ] **[Step 07](./07-storage-layer.md)** — Storage abstraction + `/api/statements` CRUD *(2–3h)*
- [ ] **[Step 08](./08-aggregation-engine.md)** — Monthly / quarterly / yearly rollups *(2h)*
- [ ] **[Step 09](./09-period-selector.md)** — Period selector + multi-period dashboard *(2–3h)*

> **Milestone:** Upload 3+ statements, switch between month/quarter/year views.

### Phase 3 — Polish

- [ ] **[Step 10](./10-polish.md)** — Error states, empty states, responsive design *(2h)*

> **Milestone:** App feels finished for all in-app states.

### Phase 4 — Feature pass (before deployment)

Self-contained enhancements requested before going live. Mostly independent — Steps 12–16 can be done in any order; do the **auth steps last** (Step 17 Google, then Step 18 Cognito, which builds on it) since they gate the now-complete app. All must land before Step 11.

- [ ] **[Step 12](./12-rebrand-cashight.md)** — Rebrand "Expense tracker" → "Cashight" *(15m)*
- [ ] **[Step 13](./13-dark-mode-toggle.md)** — Dark / light mode toggle *(30–45m)*
- [ ] **[Step 14](./14-transactions-category-filter.md)** — Transactions table: filter by category *(30–45m)*
- [ ] **[Step 15](./15-software-subscriptions-card.md)** — "Software & Subscriptions" KPI card *(15–20m)*
- [ ] **[Step 16](./16-password-protected-pdf.md)** — Handle password-protected PDF statements *(45–60m)*
- [ ] **[Step 17](./17-google-auth.md)** — Google authentication, single allowed user *(2–3h)*
- [ ] **[Step 18](./18-cognito-authentication.md)** — AWS Cognito as a second login option *(2–3h)* — builds on Step 17

> **Milestone:** Cashight is branded, themeable, filterable, and access-controlled (Google + Cognito).

### Phase 5 — Deployment

- [ ] **[Step 11](./11-amplify-deployment.md)** — Deploy to AWS Amplify *(1–2h)* — env-var checklist must include `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAIL`, `PDF_PASSWORD`, `AUTH_COGNITO_ID`, `AUTH_COGNITO_SECRET`, `AUTH_COGNITO_ISSUER`

> **Milestone:** Production deployment accessible via Amplify URL.

---

## Step dependencies

```
01 ──┬─▶ 02 ──▶ 03 ──┬─▶ 04 ──┐
     │                │        │
     │                │        ▼
     │                │        05 ──▶ 06 ──▶ 07 ──▶ 08 ──▶ 09 ──▶ 10
     │                │
     └────────────────┘

10 ──▶ 12 ─ 13 ─ 14 ─ 15 ─ 16 ─ 17 ──▶ 18 ──▶ 11
         (12–16 any order; 17 then 18 last)
```

Most steps are linear, but Step 04 (dashboard) and Step 05 (AI) could be parallelized once Step 03 is done if you want to context-switch. In Phase 4, Steps 12–16 are independent and can be tackled in any order (or parallel worktrees); Step 17 (auth) comes last because it gates the finished app, and Step 11 (deploy) comes after everything.

## How to use this plan

Each step file follows the same structure:

1. **Goal** — what "done" means
2. **Prerequisites** — which previous steps must be complete
3. **Tasks** — numbered checklist of concrete actions
4. **Files affected** — exact paths to create or modify
5. **Acceptance criteria** — how to verify the step is complete
6. **Notes & gotchas** — things to watch out for
7. **Next step** — link to what comes after

Treat estimates as rough guides. Some steps will go faster, others slower depending on how much you yak-shave on UI polish.

## Reference documents

- [Master implementation plan](./expense-tracker-implementation-plan.md) — the full architecture, design rationale, schemas, and merchant taxonomy
- [Sample statement PDF](#) — the TPBank statement used to validate the parser

---

*Plan v1.0 — 2026-05-29*
