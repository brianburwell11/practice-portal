---
title: "Git Workflow & Deployment Guide"
description: "Our feature branch workflow with automatic GitHub Pages deploys, PR preview environments, and the base path system that makes it all work."
pubDate: "Apr 10 2026"
tags: ["deployment", "github-pages", "git", "guide"]
---

# Git Workflow & Deployment

This project uses a **feature branch** workflow. All changes go through a pull request before landing on `main`. Pushing to `main` triggers an automatic deploy to GitHub Pages.

## Quick reference

```
main  ← always deployed to https://brianburwell11.github.io/practice-portal/
  └── feature branches ← your working branches, merged via PR
```

## Day-to-day workflow

### 1. Start a feature branch

```sh
git checkout main
git pull
git checkout -b my-feature
```

Name branches descriptively: `add-tempo-slider`, `fix-audio-sync`, `update-band-colors`.

### 2. Make commits

```sh
git add <files>
git commit -m "what you changed and why"
```

Commit as often as you like. Small, focused commits are easier to review and revert.

### 3. Push and open a pull request

```sh
git push -u origin my-feature
gh pr create --title "Add tempo slider" --body "Description of changes"
```

Or push and use the link GitHub prints to open the PR in your browser.

### 4. Preview your changes

When you open (or update) a PR, the **PR Preview** workflow automatically:
- Builds your branch
- Deploys it to `https://brianburwell11.github.io/practice-portal/pr/<number>/`
- Posts a comment on the PR with the preview link

Use this to verify everything works before merging.

### 5. Merge

Once you're happy with the preview:

```sh
gh pr merge
```

Or click "Merge pull request" on GitHub. This merges your branch into `main` and triggers the production deploy.

### 6. Clean up

```sh
git checkout main
git pull
git branch -d my-feature
```

GitHub offers to delete the remote branch after merge — accept it.

## What happens automatically

| Event | Workflow | What it does |
|-------|----------|-------------|
| Push to `main` | `deploy.yml` | Builds and deploys to GitHub Pages root |
| PR opened/updated | `preview.yml` | Builds and deploys a preview to `/pr/<number>/` |
| PR closed | `preview-cleanup.yml` | Removes the preview directory |

## Initial setup (one-time)

After the first push to `main` that includes the workflows:

1. Go to your repo on GitHub: **Settings > Pages**
2. Set source to **"Deploy from a branch"**
3. Select branch: **`gh-pages`** / folder: **`/ (root)`**
4. Save

The first deploy workflow run will create the `gh-pages` branch automatically.

## How the base path works

GitHub Pages serves the site at `/practice-portal/` (not root). The Vite `base` config is set via the `VITE_BASE_PATH` environment variable at build time:

- **Local dev** (`npm run dev`): defaults to `/` — no prefix needed
- **Production**: set to `/practice-portal/` by the deploy workflow
- **PR previews**: set to `/practice-portal/pr/<number>/` by the preview workflow

All runtime asset fetches use the `assetUrl()` helper from `src/utils/url.ts`, which prepends `import.meta.env.BASE_URL` to paths. If you add new `fetch()` calls for static assets, use this helper:

```ts
import { assetUrl } from '../utils/url';

fetch(assetUrl('audio/manifest.json'));
// In dev:     /audio/manifest.json
// In prod:    /practice-portal/audio/manifest.json
// In preview: /practice-portal/pr/42/audio/manifest.json
```

## Tips

- **Never commit directly to `main`**. Always use a feature branch + PR so you get a preview.
- **Keep PRs focused**. One feature or fix per PR makes reviews and reverts easier.
- **Pull before branching**. Always `git pull` on `main` before creating a new branch to avoid merge conflicts.
- **Audio files are large**. GitHub Pages has a 1 GB site size limit. Songs served from Cloudflare R2 (via `audioBasePath` in config) don't count against this.
