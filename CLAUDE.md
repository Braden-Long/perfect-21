# Perfect 21 — dev notes

Blackjack basic-strategy trainer. npm workspaces monorepo, TypeScript strict everywhere.

**Product decision (2026-07): web-first.** The website is the product; Electron/Steam is a
kept-open option, not the target. Monetization is tip-jar only (`apps/game/src/config.ts`).

## Commands
- `npm test` — vitest (engine math + server API + jsdom UI smoke tests)
- `npm run dev` — Vite dev server for the game client (proxies `/api` → :8721)
- `npm run server` — API/leaderboard server (env: `PORT`, `DB_PATH`, `ADMIN_TOKEN`;
  email recovery needs `SMTP_URL` + `MAIL_FROM` + `PUBLIC_URL`, hidden otherwise)
- `npm run build` — typecheck + production build of the client
- `npm start` — production: build client + serve site/API from apps/server
- `npm run desktop` — build client, open Electron shell (`--smoke` flag loads and exits)

## Layout
- `packages/engine` — pure TS game logic, **no DOM/browser APIs** (server imports it).
  Ranks are numbers 1–10 (1=ace, 10=any ten-value). Chart keys: `h16-10`, `s18-3`, `p8-1`
  (hard/soft/pair, `-<dealer upcard>`; ace column is `-1`).
- `apps/game` — React client. Engine is aliased to source (`@perfect21/engine` → engine/src)
  in vite.config.ts, root vitest.config.ts, and tsconfig paths — keep the three in sync.
  All server calls go through `src/api.ts` and must degrade gracefully offline/static.
- `apps/server` — Express + `node:sqlite` (built-in; requires vitest ≥3 to resolve).
  Admin panel lives in the client at `#admin`, authed by `ADMIN_TOKEN` bearer header.
- `apps/desktop` — Electron shell, loads `apps/game/dist`.

## Invariants
- The strategy source of truth is the blackjackinfo.com engine; `strategy.test.ts` pins the
  derived charts to it. If an EV-model change flips a chart cell, the site is right — dig in.
- Counting deviations (engine/counting.ts) are Schlesinger's Illustrious 18 + Fab 4, verified
  against gamblingcalc.com's deviations calculator: multi-deck S17 baseline, TC = RC ÷ decks
  remaining (exact, no flooring), trigger at TC ≥ index, insurance index +3. 11vA is s17Only.
  Counting-mode grading targets the index play; misses there must never feed the basic drill,
  and EV bookkeeping stays basic-only (deviations aren't in the CD model). Counting rounds/net
  book into profile.countingRounds/countingNet — totalRounds/totalNet and every lifetime RTP
  stat are basic-strategy-only (the stats screen splits the two behind a toggle).
- Counting mode deals its own shoe (`profile.countingDecks`, default 2 — NOT `rules.decks`)
  and grades every initial bet against `betRamp`: 1 unit = 5 chips, ~2 units per TC above +1,
  spread capped at 8 (1–2 decks) / 12 (3+ decks), ±½ TC tolerance. Grade bets at the TC the
  bettor saw: with the cut card out (`shufflePending`) the HUD and the grade both use the
  fresh-shoe count of 0. Live edge = theoretical RTP − 1 + 0.5% per TC. The three counting
  skills (index plays / bets / insurance) share one rank window but keep split counters.
- EVs/RTP are quoted per initial bet. In-play EVs are conditioned on no dealer blackjack in
  peek games and unconditional in no-peek games.
- Strategy build is ~1s per rule set (cached in-process by `getStrategy`); never call it in a
  render path without the deferred/loading pattern (see `useStrategy`).
- Mistake memory lives in the profile (`misses` keyed by chart cell key from
  `Recommendation.cell.key`, plus a capped `handLog`). Drill mode (drill.ts/useDrill.ts) is
  flashcards, not rounds: it synthesizes cards per cell, grades one decision, and must never
  touch rank/bankroll/leaderboard; correct reps decay misses (~3 to heal one). The Learn to
  Count trainer (CountTrainer.tsx, `#learn`) is the same deal for counting fundamentals —
  session-only stats, touches nothing in the profile.
- The chip bankroll is a **client-side layer** (useGame.ts): the engine stays unit-based
  (initial bet = 1 per seat) so EV/RTP math is untouched; chips = units × the round's bet, and
  server sync still sends unit-based `net`. Endless runs use an ephemeral 100-chip stack; the
  persistent roll lives in `profile.bankroll`. Table limits: TABLE_MIN_BET=5 per spot (deal
  refused below it; rebuy/endless-bust trigger under it), TABLE_MAX_BET=500.
- Multi-seat (`Round` opts.seats ≤ MAX_SEATS=3, casino deal order, seat 0 = rightmost, splits
  inherit `hand.seat`) is practice/counting only — competitive and endless stay single-seat by
  design. Every seat is one initial bet: profile.totalRounds += seats, RoundSummary.initialBet
  = seats, insurance is ±0.5 × seats. The felt zoom (Table.tsx transform-origin) follows
  `round.activeHand.seat`; keep giant-ellipse CSS cheap to rasterize (no repeating gradients
  or spread shadows on it — it froze screenshot rasterization once already).
- No real-money mechanics anywhere — chips are valueless play tokens, never purchasable.
  This is an education tool by design (see docs/REQUIREMENTS.md).
