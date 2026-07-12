# Perfect 21

A first-person blackjack **basic-strategy trainer**, delivered as a website. This is math, not
gambling: no wagering, no bankroll mechanics — you're scored purely on whether each decision
matches optimal basic strategy for the table rules in play.

![modes](https://img.shields.io/badge/modes-practice%20%C2%B7%20competitive%20%C2%B7%20endless-d8b36c)

> **Why web-first?** A trainer lives on frictionless access — "click this link" converts far
> better than "install a Steam app". The competitive layer (global leaderboard) needs a server
> either way, and tip-only monetization doesn't fit Steam's paid model. The Electron shell in
> `apps/desktop` still works and keeps a future Steam release open, but the website is the
> product.

## What it does

- **First-person table** in the style of Evolution's First Person Blackjack: dealer up top,
  your fanned hand at the bottom, hit/stand/double/split/surrender at your fingertips
  (keyboard: `H` `S` `D` `P` `R`, space to deal).
- **Every decision is graded** against basic strategy the instant you make it, with a popup
  explaining *why* the correct play is correct — plus the live expected value of every action
  you could have taken, computed for the exact cards on the table.
- **Configurable rules** matching the parameter space of the
  [BlackjackInfo basic strategy engine](https://www.blackjackinfo.com/blackjack-basic-strategy-engine/)
  (the project's source of truth): decks (1–8), S17/H17, double any-two / 9–11 / 10–11,
  DAS, no/late/early surrender, peek/ENHC. Default: 8 decks, S17, DAS, no surrender, peek.
- **Strategy is derived, not hardcoded.** The engine computes dealer outcome distributions and
  composition-dependent action EVs for any rule combination and generates the chart from first
  principles. The test suite pins the output to the BlackjackInfo charts.
- **Meaningful stats**: theoretical RTP for your rules, actual RTP (what the cards paid — luck),
  your expected RTP (theory minus the EV your mistakes gave away), and deviation-from-optimal %.
- **Persistent rank** from your rolling decision accuracy: Bronze → Silver → Gold → Platinum →
  Diamond → **Perfect 21** (a full 200-decision window without a single miss).
- **Global leaderboard**: claim a display name (no account, no email — a credential stays in
  your browser) and your rank, rolling accuracy, and best endless streak sync automatically.
  Fully optional; the game works offline/statically without it.
- **Tip-only monetization**: no ads, no paywall, no wagering. A Support dialog shows the
  site owner's crypto tip jars (configured in `apps/game/src/config.ts`; hidden until set).

### Modes

| Mode | Rules |
| --- | --- |
| **Practice** | No pressure, optional hints, feedback on every decision |
| **Competitive** | 10 seconds per decision; timeouts grade as errors; rank on the line |
| **Endless** | One wrong decision ends the run — longest streak wins |

## Running it

```bash
npm install
npm run dev        # game client at http://localhost:5173 (API proxied to :8721)
npm run server     # API + leaderboard server at http://localhost:8721
npm start          # production: build client, serve site + API from one process
npm run desktop    # optional native macOS window (Electron)
npm test           # engine + server + UI test suite
```

### Production deployment

One process serves everything (site + API + SQLite storage) — any small VPS or container host
works:

```bash
ADMIN_TOKEN=pick-something-long PORT=8721 npm start
# or
docker build -t perfect21 . && docker run -p 8721:8721 -e ADMIN_TOKEN=... -v p21data:/data perfect21
```

- **Admin panel**: visit `https://your-site/#admin` and enter the `ADMIN_TOKEN`. Overview
  stats, player list, ban/unban, delete. Admin routes are disabled entirely if the env var
  isn't set.
- **Tip jar**: put your addresses in `apps/game/src/config.ts` and rebuild. Empty entries are
  hidden. (Addresses only — never private keys.)
- **Database**: single SQLite file (`DB_PATH`, default `apps/server/data/perfect21.db`), via
  Node's built-in `node:sqlite` — no native modules to compile.
- The client also works fully static (GitHub Pages etc.): leaderboard UI degrades to an
  offline notice, everything else is untouched.

## Architecture

```
packages/engine    Pure TypeScript, zero dependencies. Cards/shoe, round state machine,
                   EV calculator + strategy derivation, stats/RTP math, rank ladder,
                   plain-language explanations. No DOM, no UI — imported verbatim by both
                   the client and the server.
apps/game          Vite + React client. First-person table, modes, feedback, charts,
                   stats, leaderboard, admin panel, tip jar, local profile persistence.
apps/server        Express + node:sqlite. Leaderboard/player sync API with server-side
                   validation and rank computation, admin API, serves the built client.
apps/desktop       Optional Electron shell (kept for a possible Steam release).
docs/              Requirements and design notes.
```

The client/engine split is deliberate: the server imports `@perfect21/engine` (e.g. rank
computation runs server-side on submitted decision histories), and it's the foundation for
stronger server-side verification later. Grading is currently client-computed and
server-validated for consistency (monotonic counters, bounded values) — honest-player-grade,
not anticheat-grade; the admin panel exists to prune anything that looks wrong.

### Trust & privacy model

- No accounts, no email, no passwords: joining the leaderboard mints a random id + secret
  stored in your browser's localStorage. Lose the browser profile, lose the name — acceptable
  for a tip-jar-funded trainer.
- The server stores only: display name, decision/win counters, the rolling 200-decision
  correctness window, and a rules key. No IPs are persisted.

### How strategy derivation works

For each chart cell (hard 4–20, soft 13–20, pairs × dealer 2–A) the engine:

1. Removes the visible cards from the shoe and computes the dealer's final-total distribution
   by recursion over compositions (conditioned on no dealer blackjack in peek games).
2. Computes EV of stand/hit/double/split/surrender — hit chains via memoized recursion with
   shoe depletion, dealer-distribution shifts from each drawn card via first-order
   effect-of-removal corrections, no-peek games charging the full stake against dealer BJ.
3. Picks the argmax, records a fallback (for when double/split/surrender aren't available),
   and exposes the whole EV table to the UI for the feedback popups.

Theoretical RTP comes from enumerating all starting deals and applying the derived chart —
which is also what makes "your expected RTP" honest: every mistake's exact EV cost is
subtracted from theory.

## Roadmap

- **Card counting mode** (planned next): running/true count drills, deviation indices (Illustrious 18).
- **Server-side decision verification**: replay submitted hands through the engine for
  anticheat-grade leaderboards; cross-device identity via export/import of the local credential.
- Insurance decisions (grade "never take insurance" — trivially correct but worth teaching).
- Multi-seat play and richer table presentation.
- **Steam packaging** (optional, shell already works): app ID, steamworks.js achievements,
  Windows build via electron-builder.

## License / disclaimer

Educational tool. No real-money play, and nothing here constitutes gambling advice. Strategy
tables are mathematically derived; verify any real-world use against the
[BlackjackInfo engine](https://www.blackjackinfo.com/blackjack-basic-strategy-engine/) yourself.
