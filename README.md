# Perfect 21

A first-person blackjack **basic-strategy trainer**. This is math, not gambling: no wagering,
no bankroll mechanics — you're scored purely on whether each decision matches optimal basic
strategy for the table rules in play.

![modes](https://img.shields.io/badge/modes-practice%20%C2%B7%20competitive%20%C2%B7%20endless-d8b36c)

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

### Modes

| Mode | Rules |
| --- | --- |
| **Practice** | No pressure, optional hints, feedback on every decision |
| **Competitive** | 10 seconds per decision; timeouts grade as errors; rank on the line |
| **Endless** | One wrong decision ends the run — longest streak wins |

## Running it

```bash
npm install
npm run dev        # web build at http://localhost:5173
npm run desktop    # native macOS window (Electron)
npm test           # engine + UI test suite
```

## Architecture

```
packages/engine    Pure TypeScript, zero dependencies. Cards/shoe, round state machine,
                   EV calculator + strategy derivation, stats/RTP math, rank ladder,
                   plain-language explanations. No DOM, no UI — this is the layer a future
                   multiplayer server imports verbatim.
apps/game          Vite + React client. First-person table, modes, feedback, charts,
                   stats, local profile persistence.
apps/desktop       Electron shell for the macOS (and later Windows) build.
docs/              Requirements and design notes.
```

The client/engine split is deliberate: competitive multiplayer needs a server that can verify
decision grading server-side, so all game logic lives in `@perfect21/engine` with no browser
dependencies. A Node backend can `import { Round, getStrategy } from '@perfect21/engine'` and
replay/verify any client claim.

### Why web tech + Electron for a Steam game?

Evolution's First Person Blackjack — the visual reference — is itself an HTML5 game. Web tech
gets us the macOS build now, the Windows build for free, a plain website build for free
(`apps/game/dist` is deployable as-is), and one TypeScript codebase shared with the future
server. For Steam: package `apps/desktop` with electron-builder and integrate
[steamworks.js](https://github.com/ceifa/steamworks.js) for achievements/leaderboards when a
Steam app ID exists (`npm run dist -w @perfect21/desktop` already produces the installers).

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
- **Backend server**: accounts, synced ranks, cross-device play, verified leaderboards.
- **Steam packaging**: app ID, steamworks.js achievements/leaderboards, Windows build.
- Insurance decisions (grade "never take insurance" — trivially correct but worth teaching).
- Multi-seat play and richer table presentation.

## License / disclaimer

Educational tool. No real-money play, and nothing here constitutes gambling advice. Strategy
tables are mathematically derived; verify any real-world use against the
[BlackjackInfo engine](https://www.blackjackinfo.com/blackjack-basic-strategy-engine/) yourself.
