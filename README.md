# Perfect 21

A first-person blackjack **basic-strategy trainer**, delivered as a website. This is math, not
gambling: you bet **play chips** that are worthless by design, and you're scored on whether each
decision matches optimal basic strategy for the table rules in play. The bankroll exists to make
the math visceral — you watch variance move it while the stats screen shows what your decisions
were actually worth.

![modes](https://img.shields.io/badge/modes-practice%20%C2%B7%20competitive%20%C2%B7%20endless-d8b36c)

> **Why web-first?** A trainer lives on frictionless access — "click this link" converts far
> better than "install a Steam app". The competitive layer (global leaderboard) needs a server
> either way, and tip-only monetization doesn't fit Steam's paid model. The Electron shell in
> `apps/desktop` still works and keeps a future Steam release open, but the website is the
> product.

## What it does

- **Full-viewport first-person table** in the style of Evolution's First Person Blackjack:
  the felt fills the screen, chip rack and shoe up top, rule lettering printed on the felt,
  dealer cards top-center and your fanned hand low-center with total badges, a betting spot
  with a chip selector (undo / ×2 / DEAL), and colored decision squares. Keyboard: `H` `S`
  `D` `P` `R` for actions, `1`–`5` to stage chips, space to deal.
- **A play-chip bankroll** (1,000 chips, persistent in practice/competitive) with real table
  limits: 5-chip minimum, 500 maximum per spot. Every bet, double and split moves real chips;
  dropping below the minimum offers a rebuy — and counts it, because even perfect play faces
  a house edge. No real money exists anywhere in the system.
- **Multi-spot play** in practice and counting modes: spread the same bet across up to three
  betting spots, played right to left with the camera easing in on whichever hand is acting —
  scored modes (competitive/endless) stay single-seat so runs stay comparable.
- **A live shoe you can read**: a clear acrylic shoe holds the pack on edge — it lengthens
  with the deck count, visibly depletes as cards are dealt, the roller weight advances behind
  it, and the red cut card rides at the 75% penetration mark: when it reaches the mouth, the
  next deal reshuffles (hover for the exact card count). Every card is dealt *out of the
  shoe* — it flies to its seat in casino order and flips over mid-flight — and settled hands
  are swept into the discard tray, where the pile of face-down cards grows to match the
  shoe. Every fresh table opens with a skippable shuffle animation — and when the cut card
  comes out, it's pulled onto the discards in front of you, the dealt-out shoe runs empty
  (the pusher slides to the mouth), and the next DEAL shuffles in the alternate deck —
  casino-style, the backs swap between blue and red every reshuffle.
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
  Counting tables keep an entirely separate ledger (their own hands, net, RTP and per-skill
  accuracy behind a toggle) — learning to count never drags down your basic-strategy record.
- **A streak fire**: ten straight correct calls light a flame in the HUD with your run count
  burning inside it — and it gets hotter as the streak grows (amber → orange-red → crimson →
  blue-white at 50+). Works in every mode, drills included; counting mode's bet checks and
  insurance calls feed it too. At the tables your longest streak is tracked as a permanent
  statistic — drill flashcards keep the flame session-only, since drills never touch stats.
- **Persistent rank** from your rolling decision accuracy: Bronze → Silver → Gold → Platinum →
  Diamond → **Perfect 21** (a full 200-decision window without a single miss).
- **Global leaderboard**: claim a display name — no signup wall, you're playing in seconds —
  and your rank, rolling accuracy, and best endless streak sync automatically. Fully
  optional; the game works offline/statically without it.
- **Optional account via email magic links (no passwords)**: attach an email to your name and
  your entire profile (bankroll, rank window, mistake memory) is recoverable on any device —
  clearing the browser can't erase you. Recovery links are single-use, expire in 15 minutes,
  and are heavily rate-limited; the server never stores a password, only the email. A copyable
  offline recovery code covers self-hosted setups without SMTP.
- **Tip-only monetization**: no ads, no paywall, no wagering. A Support dialog shows the
  site owner's crypto tip jars (configured in `apps/game/src/config.ts`; hidden until set).

### Modes

| Mode | Rules |
| --- | --- |
| **Practice** | No pressure, optional hints, feedback on every decision |
| **Competitive** | 10 seconds per decision; timeouts grade as errors; rank on the line |
| **Endless** | A 100-chip run: one wrong decision **or busting out** ends it — longest streak wins |
| **Drill** | Flashcard reps dealt from *your own mistake history* — no chips, pure decisions |
| **Card Counting** | Its own few-deck shoe (default: double deck). Hi-Lo count HUD with your live edge, graded bet spread, Illustrious 18 / Fab 4 index plays, insurance at TC ≥ +3 — its own rank |
| **Learn to Count** | Counting fundamentals, no chips or rank: tag cards at speed, keep the count through a rapid deal (up to a full-deck countdown), convert RC → true count in your head |

Modes are deep-linkable (`/#practice`, `/#competitive`, `/#endless`, `/#drill`, `/#counting`,
`/#learn`).

### Card counting mode

Counting mode deals **its own shoe** — a double-deck pitch game by default (configurable in
Table rules: 1/2/6/8 decks), because counters hunt few decks and deep penetration: in a deeply
dealt double-deck game you hold the edge on roughly a quarter of your hands, while an 8-deck
shoe's true count barely moves. The cut card sits at 75% penetration, and the HUD warns when
it's out so you never bet into a shuffle blind.

The HUD shows the Hi-Lo running count, exact true count (RC ÷ decks remaining), decks left and
**your live edge** (the engine's true base edge for the rules in play + 0.5% per true count) —
all hideable, so you can keep the count yourself and check. The count is computed from the
actual dealt shoe (hole card counted only once revealed), so impossible counts can't occur.

**Every bet is graded.** Betting the count is where counting turns into money: 1 unit is the
5-chip table minimum, and the ramp is ~2 units per true count above +1 — which reproduces the
classic taught spreads (1–8 in pitch games, 1–12 in shoes, max around TC +5/+6) — with half a
true count of tolerance, since spreads are famously more art than science. Flat-betting a hot
shoe, or pushing chips into a negative one, is a graded miss like any other.

Play decisions are graded against the **index play**, not raw basic strategy: Schlesinger's
Illustrious 18 and Fab 4 (surrender games), with insurance offered on every ace and graded
against the +3 index. Getting the basic-strategy answer while missing the index counts as a
miss — the feedback explains both layers. Indices are the standard multi-deck S17 baseline
(the 11 vs A index is skipped under H17, where basic already doubles). Counting mode has a
**separate rank and leaderboard** fed by all three skills — index plays, bet spread, insurance
— broken out individually on the stats screen, and either rank can be reset independently.

New to counting? **Learn to Count** (`/#learn`) drills the fundamentals in isolation, the way
counters actually train: tag single cards against the clock, hold the running count through a
rapid-fire deal at four speeds (including the classic full-deck countdown with one card held
back, where a balanced deck betrays the hidden card), and convert running counts to true
counts in your head. No chips, no rank — pure reps.

### Mistake memory

Every graded decision feeds a per-cell mistake ledger (e.g. "hard 16 vs 10: missed 5×,
usually stands, 42% of a bet given up") and a rolling hand history. The **History** screen
shows both; **Drill** samples your leaks by frequency × EV severity (75% targeted, 25%
chart coverage) and each correct rep decays the record until the leak is considered healed
(~3 reps per miss). Drill reps update the mistake memory but never your rank, bankroll, or
the leaderboard — practicing a weakness is never punished. A ✓/✗ tape of the session's
decisions runs in the table HUD.

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

To enable email account recovery, add SMTP credentials (any transactional provider — Resend,
Postmark, SES, Mailgun — hands you these) and the public origin used in links:

```bash
SMTP_URL="smtps://user:pass@smtp.example.com:465" \
MAIL_FROM="Perfect 21 <no-reply@your-domain>" \
PUBLIC_URL="https://your-domain" \
ADMIN_TOKEN=... npm start
```

Leave them unset and the email UI hides itself — everything else works.

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

- No passwords, ever: joining the leaderboard mints a random id + secret stored in your
  browser's localStorage; optionally attaching an email upgrades that to a recoverable
  account via single-use magic links. Email is the only personal datum stored, it's used
  solely for recovery, and it's never shown publicly.
- The server stores: display name, decision/win counters, the rolling 200-decision
  correctness window, a rules key, an opaque profile snapshot (for recovery), and the
  optional email. No IPs are persisted.

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

- **Server-side decision verification**: replay submitted hands through the engine for
  anticheat-grade leaderboards.
- Wonging (sitting out negative shoes) and back-counting drills in counting mode.
- Multi-seat play and richer table presentation.
- **Steam packaging** (optional, shell already works): app ID, steamworks.js achievements,
  Windows build via electron-builder.

## License / disclaimer

Educational tool. No real-money play — chips are play tokens with no value, cannot be bought,
sold, or cashed out — and nothing here constitutes gambling advice. Strategy
tables are mathematically derived; verify any real-world use against the
[BlackjackInfo engine](https://www.blackjackinfo.com/blackjack-basic-strategy-engine/) yourself.
