# Practice Portal

A practice tool for bands, live at **https://practiceportal.app**.

Each song is split into stems, one audio file per part, so a musician can solo, mute or turn down any part and play along with the rest of the band. Sheet music and lyrics scroll in time with the audio, tempo slows down without changing pitch, and bands keep set lists for their gigs. Bands have Owners, Managers, Editors and Members, sign-in is with Google, and new bands are Members only.

## Stack

- **App:** React, TypeScript, Vite, Tailwind, zustand (`src/`)
- **Server:** Node (`server/`), Postgres via Drizzle (`server/db/`), media on Cloudflare R2
- **Hosting:** Fly.io (`fly.toml`, `Dockerfile`)
- **Docs:** an Astro site in `docs/`, with design notes, plans and decisions

## Develop

```sh
npm install
npm run dev          # Vite dev server with the API
npm run build        # type-check and build the app
npm run build:server # bundle the server into dist-server/
```

Server checks live in `scripts/verify-*.ts`. Run them against a scratch Postgres with R2 blanked, not the shared database: see the comment at the top of each script.

## Deploy

```sh
npm run build        # catch type errors locally first
fly deploy --ha=false # the Dockerfile builds the app and server itself
```

`brianburwell11.github.io/practice-portal` is retired and only redirects here (`gh-pages-redirect/`).
