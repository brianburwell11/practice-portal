---
title: "Dev/Prod Sandbox Separation Plan"
description: "Give the local dev server its own R2 bucket so admin edits can't break production."
pubDate: "Apr 18 2026"
tags: ["infrastructure", "cloudflare", "r2", "planning"]
---

# Dev/Prod Sandbox Separation Plan

## Context

Today the local dev server and the production GitHub Pages build both read from the **same** R2 bucket. The dev server additionally has write credentials (via `vite-plugin-config-api.ts`), so any admin edit made locally — renaming a song, changing a band's colors, running a delete — takes effect on production immediately. One recent refactor broke production for a few minutes because a schema change happened to land mid-edit.

Production is a static, read-only GitHub Pages site: all admin UI is tree-shaken out (`import.meta.env.DEV` gating in `main.tsx`, `App.tsx`, `AdminRibbon.tsx`). So the only writer is the local dev server. The fix is to point the dev server at a **different** R2 bucket.

---

## Approach: two buckets

Simplest durable separation: a dedicated `practice-portal-dev` bucket for local dev.

- **Local dev**: reads + writes `practice-portal-dev`. `.env` specifies this bucket.
- **Production**: continues to read from the existing bucket. `deploy.yml` already hardcodes the prod public URL — no change needed there.
- **Promotion** (dev → prod) is a manual, explicit step (rclone sync or a small script).

Alternative considered: prefix-based separation inside one bucket (dev writes to `dev/...`). Rejected — still shares credentials, a misconfigured key still hits the root. The two-bucket model fails closed.

---

## Phases

### Phase 1 — Create the dev bucket
- [ ] Create a new R2 bucket in the Cloudflare dashboard (suggested name: `practice-portal-dev`).
- [ ] Enable public access on the dev bucket (so the browser can fetch `registry.json`, audio stems, etc. during local dev).
- [ ] Record the dev bucket's public URL (`pub-<hash>.r2.dev`).
- [ ] Create a scoped API token with R2 read+write on just this new bucket — separate from whatever token currently grants access to the prod bucket.

### Phase 2 — Switch local `.env` to the dev bucket
- [ ] Back up the current `.env` (it has prod credentials).
- [ ] Update local `.env` so `R2_BUCKET`, `R2_PUBLIC_URL`, and `VITE_R2_PUBLIC_URL` point to the **dev** bucket; swap `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` to the dev-scoped token.
- [ ] Leave `R2_ENDPOINT` as-is (same Cloudflare account, same endpoint).
- [ ] Restart `npm run dev` and confirm the BandPicker loads from the dev bucket (initially empty — expected).
- [ ] Confirm `https://<prod-url>/` is unaffected and still shows the live data.

### Phase 3 — Seed the dev bucket with a snapshot of prod
So you can actually test features against realistic data.
- [ ] Install `rclone` (one-time).
- [ ] Configure two rclone remotes: `r2-prod` and `r2-dev`, each pointing at the respective bucket.
- [ ] `rclone sync r2-prod: r2-dev:` to copy everything over.
- [ ] Verify in local dev that all bands, songs, setlists appear as expected.

### Phase 4 — Visual "DEV SANDBOX" indicator
Belt-and-suspenders so there's no chance of thinking you're editing prod.
- [ ] Add a thin banner at the top of the page (above the header) in `src/App.tsx` and `src/components/band/BandPicker.tsx`, rendered only when `import.meta.env.DEV` is true.
- [ ] Text: "DEV SANDBOX — {R2_PUBLIC_URL host}". Styled with a clearly "unfinished" look (striped background, small text) so it can't be mistaken for product chrome.
- [ ] Optionally, pull the host out of `VITE_R2_PUBLIC_URL` so the banner auto-updates if the env changes.

### Phase 5 — Document the promotion flow
Once dev-tested changes are ready for production.
- [ ] Add a short `scripts/promote-to-prod.sh` that runs `rclone sync r2-dev: r2-prod:` with a confirmation prompt.
- [ ] Document the per-object alternative: `rclone copy r2-dev:{bandId}/ r2-prod:{bandId}/` to promote a single band.
- [ ] Note the dangerous case: deleting a band locally and then running a full sync will also delete it in prod. For deletes, either promote manually or use `rclone copyto` selectively.

### Phase 6 (optional) — Per-env bootstrap safety
- [ ] In `vite-plugin-config-api.ts`, add a startup log line that prints the current `R2_BUCKET` so every `npm run dev` session announces which bucket it's about to mutate.
- [ ] Consider refusing to start if `R2_BUCKET` contains the prod bucket name unless an explicit `I_KNOW_THIS_IS_PROD=1` env var is set.

---

## Verification

After Phase 2:
1. Open local dev → edit a band's colors via the ribbon → save.
2. Open production in another tab and hard-refresh.
3. Production's colors should be unchanged. The local dev tab shows the new colors.

After Phase 3:
1. Local dev should show every band, song, and setlist that exists in prod.

After Phase 4:
1. Local dev clearly shows the "DEV SANDBOX" banner; prod does not.

---

## Out of scope (for now)

- Moving `.env` out of the repo (it's currently not gitignored — a separate security cleanup).
- Automating dev→prod promotion in CI. Manual rclone is fine until the friction actually bites.
- Per-PR preview buckets. The existing `preview.yml` workflow is read-only anyway, so it's not a data-corruption risk.
