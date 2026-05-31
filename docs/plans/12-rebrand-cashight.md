# Step 12 — Rebrand to "Cashight"

> Replace the working title "Expense tracker" with the product name **Cashight** everywhere it appears in the UI and docs.

**Estimated effort:** 15 minutes
**Prerequisites:** Step 10 (app is built)
**Phase:** 4 — Pre-deployment feature pass

---

## Goal

Every user-facing reference to the app reads **Cashight**. The browser tab, the dashboard header, and the docs lead with the product name. No functional change.

## Tasks

1. **Browser metadata** — `app/layout.tsx`:
   - `metadata.title` → `"Cashight"`
   - `metadata.description` → something like `"Cashight — parse, categorize, and track spending from your credit card statements."`

2. **Dashboard header** — `app/page.tsx:54`: change the `<h1>` from `Expense tracker` to `Cashight`.

3. **README** — `README.md`: lead the description with the name, e.g. `**Cashight** is a personal expense tracker that turns **TPBank credit card PDF statements** into a categorized dashboard…`. Keep the descriptive phrase "expense tracker" as a *description*, not the title.

4. **CLAUDE.md** — update the opening sentence so the project is named Cashight (the phrase "personal expense tracker" can stay as a description).

> Leave the `docs/plans/*` historical files and `00-INDEX.md`'s "Expense Tracker implementation plan" reference as-is — those are internal plan docs, not product surface. (The index title is updated in Step 17 / the index edit, optional.)

## Files affected

- `app/layout.tsx` — modify (`title`, `description`)
- `app/page.tsx` — modify (`<h1>`)
- `README.md` — modify (lead sentence)
- `CLAUDE.md` — modify (opening sentence)

## Acceptance criteria

- `grep -rin "expense tracker" app/` returns **no** matches.
- Running `pnpm dev`, the browser tab title reads "Cashight" and the dashboard header reads "Cashight".
- `pnpm build` succeeds.

## Notes & gotchas

- This is purely cosmetic — no logic, no new dependencies. Do it first so every subsequent screenshot/test shows the right name.

## Next step

[Step 13 — Dark / light mode toggle](./13-dark-mode-toggle.md)
