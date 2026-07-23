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
  your expected RTP (theory minus the EV your mistakes gave away), deviation-from-optimal %,
  lifetime P&L, and a **Luck** figure — actual net minus what your play and the rules actually
  earned you, so you can see how much of your result was the deck and how much was you.
  Counting tables keep an entirely separate ledger (their own hands, net, RTP and per-skill
  accuracy behind a toggle) — learning to count never drags down your basic-strategy record.
- **A Live Stats panel** at the table: a draggable, closable modal (bottom-right by default,
  toggled from the HUD) with net gain, wins, played and losses, and a stake-style area chart
  that redraws each round — green above the zero line, red below. The same panel is a fixed
  fixture in the simulator.
- **A streak fire**: ten straight correct calls light a flame in the HUD with your run count
  burning inside it — and it gets hotter as the streak grows (amber → orange-red → crimson →
  blue-white at 50+). Works in every mode, drills included; counting mode's bet checks and
  insurance calls feed it too. At the tables your longest streak is tracked as a permanent
  statistic — drill flashcards keep the flame session-only, since drills never touch stats.
- **A hand calculator**: tap in any hand and the dealer's upcard and get the book's answer
  under your exact table rules — optimal action, the why, and the live EV of every available
  play. Pure lookup, touches no stats.
- **A strategy simulator**: headless virtual players hit hundreds of thousands of hands with
  no animation, a discipline slider from perfect play down to coin-flip, and a skill sweep
  that plots RTP against adherence so you can *see* how much basic strategy is worth. Speed
  control, its own P&L chart, and — like the calculator — it never touches your stats.
- **Achievements**: sixteen trophies for the moments that matter — streak tiers, rank
  milestones, counting skills, surviving a rebuy. Unlocks toast at the table and live on the
  stats screen; all of them derive from real table play (drills can't farm them).
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
- **Deck skins as donation goals**: five cosmetic skins beyond the house classic — Retro
  Diner, Neon Nights, Art Deco, Holo Foil, Midnight Sky — each a matched *pair* of decks, so
  reshuffles keep alternating two backs the way the blue/red house decks do. Cumulative tips
  in SOL or USDC unlock them ($2 / $4 / $6 / $8 / $10): link the Solana wallet you donate
  from and the server reads the chain itself (via Helius) — the transaction *is* the receipt,
  nothing to redeem. Strictly cosmetic: same cards, same odds, same grading, and the credited
  total never goes down (a SOL price dip can't revoke a skin).

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

#### Recommended: Railway

The checked-in `railway.json` makes Railway build the root `Dockerfile`, probe
`/api/health`, and restart a failed process. Railway's Hobby plan is the lowest-friction
production option for this SQLite architecture: it starts at $5/month including usage.
Render's free service is not safe for this app because its filesystem is ephemeral; a paid
Render service plus disk is also a valid, slightly more expensive alternative.

1. Register `playperfect21.com` with
   [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) (about $10/year;
   verify availability and checkout price before buying).
2. In Railway, create a project from this GitHub repository. It will detect `railway.json`
   and the root `Dockerfile`.
3. Add a Railway volume to the service with mount path **`/data`**. The `VOLUME` line in the
   Dockerfile documents the path but does not provision Railway storage for you. Do not launch
   the leaderboard without this volume.
4. Open Railway's Variables tab and paste the core variables from
   `.env.railway.example`. Railway supplies `PORT`; do not override it.

   ```bash
   DB_PATH=/data/perfect21.db
   PUBLIC_URL=https://playperfect21.com
   TRUST_PROXY=1
   ADMIN_TOKEN=replace-with-output-of-openssl-rand-base64-48
   ```

   Generate the token locally with `openssl rand -base64 48`. Never commit the resulting
   value. Leave the optional SMTP and Solana variables out until their real credentials are
   ready; placeholder values would make those integrations appear enabled but fail at runtime.
5. Generate a temporary Railway domain and confirm
   `https://<railway-domain>/api/health` returns `{"ok":true,...}`.
6. Add `playperfect21.com` (and optionally `www.playperfect21.com`) under Railway
   **Networking → Custom Domain**. Add the exact CNAME records Railway displays to Cloudflare
   DNS. Keep those records **DNS only** (gray cloud), because `TRUST_PROXY=1` is intentionally
   configured for Railway's single reverse-proxy hop. Set `PUBLIC_URL` to the canonical domain
   only, with no trailing slash.
7. Under the Railway volume, schedule a daily backup. Backups are incremental and billed at
   the same low per-GB rate as volume storage. Keep the service at one replica: its SQLite
   database and in-memory throttles are deliberately single-instance.
8. After the custom-domain certificate is active, test `/#admin`, create or sync a leaderboard
   profile, redeploy once, and confirm the profile survives the redeploy.

The expected baseline cost as of July 2026 is about **$70/year**: roughly $5/month for Railway
plus roughly $10/year for a `.com`, before unusual traffic or compute overages. A fully free
static deployment is possible, but account sync, recovery, leaderboard, admin, and
donation-goal tracking will be offline.

To enable email account recovery, add SMTP credentials (any transactional provider — Resend,
Postmark, SES, Mailgun — hands you these) and the public origin used in links:

```bash
SMTP_URL="smtps://user:pass@smtp.example.com:465" \
MAIL_FROM="Perfect 21 <no-reply@your-domain>" \
PUBLIC_URL="https://your-domain" \
ADMIN_TOKEN=... npm start
```

Leave them unset and the email UI hides itself — everything else works.

For the recommended free Resend tier, verify `mail.playperfect21.com` in Resend using the DNS
records it supplies, create a sending API key, then add these Railway variables:

```bash
SMTP_URL="smtps://resend:YOUR_RESEND_API_KEY@smtp.resend.com:465"
MAIL_FROM="Perfect 21 <recovery@mail.playperfect21.com>"
PUBLIC_URL="https://playperfect21.com"
```

The free tier currently allows 3,000 transactional emails per month and 100 per day. DNS
verification records belong in Cloudflare; the Resend API key belongs only in Railway.

To enable the deck-skin donation goals, point the server at your Solana tip wallet and a
[Helius](https://helius.dev) API key (the free tier is plenty):

```bash
HELIUS_API_KEY="your-helius-key" \
SOLANA_TIP_ADDRESS="YourTipWalletAddress..." \
ADMIN_TOKEN=... npm start
```

The server scans transfers into that wallet (native SOL and USDC, via Helius' parsed
transaction API; SOL valued at the live CoinGecko price), players link the address they send
from, and skins unlock off the cumulative total. Unset → the whole skins-goal UI hides itself
and only the free classic decks show as available. (Addresses only — the server never needs,
and must never see, a private key.)

Create the Helius key in its dashboard, then put the key and the **public receiving address**
in Railway. Helius' free tier currently includes one million credits per month. Never put a
wallet private key or seed phrase in Railway, `.env.railway.example`, or client config.

- **Admin panel**: visit `https://your-site/#admin` and enter the `ADMIN_TOKEN`. Overview
  stats, player list (including linked wallets and credited donations), ban/unban, delete.
  Admin routes are disabled entirely if the env var isn't set.
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
  browser's localStorage (the server keeps only a hash of it); optionally attaching an email
  upgrades that to a recoverable account via single-use magic links, and claiming a link
  rotates the secret so whoever holds the email owns the account. Email is used solely for
  recovery and never shown publicly.
- The server stores: display name, decision/win counters, the rolling 200-decision
  correctness window, a rules key, an opaque profile snapshot (for recovery), the optional
  email, and — if you use the skins goals — your linked Solana address and credited donation
  total. Wallets and emails are never shown publicly. No IPs are persisted.

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
- Richer table presentation (multi-seat play shipped — see multi-spot above).
- More deck skins as the donation goals grow.
- **Steam packaging** (optional, shell already works): app ID, steamworks.js achievements,
  Windows build via electron-builder.

## License / disclaimer

Copyright (C) 2026 Braden Long.

Perfect 21 is free software under the
[GNU Affero General Public License v3.0 or later](LICENSE).

Educational tool. No real-money play — chips are play tokens with no value, cannot be bought,
sold, or cashed out — and nothing here constitutes gambling advice. Strategy
tables are mathematically derived; verify any real-world use against the
[BlackjackInfo engine](https://www.blackjackinfo.com/blackjack-basic-strategy-engine/) yourself.
