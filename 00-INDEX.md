# Implementation Plan — Step-by-Step Index

Step-by-step breakdown of the [Expense Tracker implementation plan](./expense-tracker-implementation-plan.md). Each step is a self-contained unit of work with clear acceptance criteria.

**Total estimated effort:** 18–28 hours across 11 steps.

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

### Phase 3 — Polish & deployment

- [ ] **[Step 10](./10-polish.md)** — Error states, empty states, responsive design *(2h)*
- [ ] **[Step 11](./11-amplify-deployment.md)** — Deploy to AWS Amplify *(1–2h)*

> **Milestone:** Production deployment accessible via Amplify URL.

---

## Step dependencies

```
01 ──┬─▶ 02 ──▶ 03 ──┬─▶ 04 ──┐
     │                │        │
     │                │        ▼
     │                │        05 ──▶ 06 ──▶ 07 ──▶ 08 ──▶ 09 ──▶ 10 ──▶ 11
     │                │
     └────────────────┘
```

Most steps are linear, but Step 04 (dashboard) and Step 05 (AI) could be parallelized once Step 03 is done if you want to context-switch.

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
