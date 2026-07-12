# Perfect 21 — dev notes

Blackjack basic-strategy trainer. npm workspaces monorepo, TypeScript strict everywhere.

## Commands
- `npm test` — vitest (engine math + jsdom UI smoke tests)
- `npm run dev` — Vite dev server for the game client
- `npm run build` — typecheck + production build of the client
- `npm run desktop` — build client, open Electron shell (`--smoke` flag loads and exits)

## Layout
- `packages/engine` — pure TS game logic, **no DOM/browser APIs** (future server imports it).
  Ranks are numbers 1–10 (1=ace, 10=any ten-value). Chart keys: `h16-10`, `s18-3`, `p8-1`
  (hard/soft/pair, `-<dealer upcard>`; ace column is `-1`).
- `apps/game` — React client. Engine is aliased to source (`@perfect21/engine` → engine/src)
  in vite.config.ts, root vitest.config.ts, and tsconfig paths — keep the three in sync.
- `apps/desktop` — Electron shell, loads `apps/game/dist`.

## Invariants
- The strategy source of truth is the blackjackinfo.com engine; `strategy.test.ts` pins the
  derived charts to it. If an EV-model change flips a chart cell, the site is right — dig in.
- EVs/RTP are quoted per initial bet. In-play EVs are conditioned on no dealer blackjack in
  peek games and unconditional in no-peek games.
- Strategy build is ~1s per rule set (cached in-process by `getStrategy`); never call it in a
  render path without the deferred/loading pattern (see `useStrategy`).
- No real-money mechanics anywhere — this is an education tool by design (see docs/REQUIREMENTS.md).
