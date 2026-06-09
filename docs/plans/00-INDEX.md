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
- [ ] **[Step 19](./19-s3-bucket-consolidation.md)** — Consolidate S3 buckets to `cashight-statements` and `cashight-tfstate` *(1–2h plus verification hold)*

> **Milestone:** Production deployment accessible via Amplify URL.

### Phase 6 — Security hardening

- [ ] **[Step 20](./20-security-hardening.md)** — Harden Next.js, Amplify Hosting, AWS storage, CI, secrets, and privacy controls *(6–10h plus deployment verification)*

> **Milestone:** Production has current dependency remediation, browser security headers, upload/request hardening, WAF, stronger S3/IAM controls, safer runtime secret handling, and repeatable security verification.

### Phase 7 — Dashboard UX refinements

Self-contained presentation-layer improvements (no parser, storage, aggregation, schema, or auth changes). Steps 21, 24, 25, and 26 are independent and can be done in any order or in parallel worktrees; **Step 23 depends on Step 22** because it reuses the `components/ui/pagination.tsx` control introduced there.

- [ ] **[Step 21](./21-kpi-panel-icons.md)** — Add an icon to each KPI panel *(20–30m)*
- [ ] **[Step 22](./22-transactions-table-pagination.md)** — Transactions table pagination (max 10/page) + reusable pagination control *(45–60m)*
- [ ] **[Step 23](./23-statements-table-sort-pagination.md)** — Statements table: sortable Period/Total spend headers + pagination (max 12/page) *(40–60m)* — reuses Step 22's control
- [ ] **[Step 24](./24-chart-vibrancy-and-axis.md)** — Vibrant trend/installment/merchant charts + straight x-axis labels *(45–60m)*
- [ ] **[Step 25](./25-scroll-to-top-button.md)** — Floating scroll-to-top button *(20–30m)*
- [ ] **[Step 26](./26-per-page-loading-skeletons.md)** — Per-page loading skeletons for Statements & Upload *(25–35m)*

> **Milestone:** Dashboard panels have icons, both tables paginate and sort, charts are vibrant with straight axis labels, every page has a loading effect, and a scroll-to-top button is available app-wide.

---

## Step dependencies

```
01 ──┬─▶ 02 ──▶ 03 ──┬─▶ 04 ──┐
     │                │        │
     │                │        ▼
     │                │        05 ──▶ 06 ──▶ 07 ──▶ 08 ──▶ 09 ──▶ 10
     │                │
     └────────────────┘

10 ──▶ 12 ─ 13 ─ 14 ─ 15 ─ 16 ─ 17 ──▶ 18 ──▶ 11 ──▶ 19 ──▶ 20
         (12–16 any order; 17 then 18 last)

20 ──▶ 21 · 24 · 25 · 26   (independent, any order/parallel)
        22 ──▶ 23          (23 reuses 22's pagination control)
```

Most steps are linear, but Step 04 (dashboard) and Step 05 (AI) could be parallelized once Step 03 is done if you want to context-switch. In Phase 4, Steps 12–16 are independent and can be tackled in any order (or parallel worktrees); the auth steps come last (Step 17 Google, then Step 18 Cognito which builds on it) because they gate the finished app, and Step 11 (deploy) comes after everything.

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

### Git workflow — one commit per completed task

From **Phase 7 onward**, commit work **one commit per completed task**. Each step file from Step 21 has a **Commits** section that maps its tasks to commits with ready-to-use [Conventional Commits](https://www.conventionalcommits.org/) messages.

Rules:

- **One commit per task.** Complete a task from the step's Tasks list, then commit it before starting the next. Where two tasks are not independently buildable (e.g. an import-only change and the code that uses it), the step's Commits section groups them into a single commit and says so.
- **Every commit must be green** — `pnpm lint` and `pnpm build` (and `pnpm tsc --noEmit` where types change) pass on each commit, so history stays bisectable.
- **Conventional Commits style**, matching repo history (`feat`, `fix`, `style`, `docs`, `chore`, with an optional scope), e.g. `feat(transactions): paginate table at 10 rows per page`.
- **Append the `Co-Authored-By: Claude` trailer** when the commit is made by Claude Code, per the harness convention.
- Tick the step's checkbox in the progress tracker only after its final commit lands and acceptance criteria pass.

## Reference documents

- [Master implementation plan](./expense-tracker-implementation-plan.md) — the full architecture, design rationale, schemas, and merchant taxonomy
- [Sample statement PDF](#) — the TPBank statement used to validate the parser

---

*Plan v1.0 — 2026-05-29*
