# Perfect 21 — Project Requirements

## Concept
A first-person blackjack strategy trainer (visually/UX inspired by Evolution Gaming's First
Person Blackjack) that teaches optimal basic strategy under configurable rule sets. This is
explicitly a math/education tool — no real-money wagering, no gambling mechanics. The point is
to learn and be ranked on decision accuracy, not to simulate casino play for its own sake.

## Rules Source of Truth
Strategy charts must be derived from
`https://www.blackjackinfo.com/blackjack-basic-strategy-engine/` using its URL query parameters
(`numdecks`, `soft17`, `dbl`, `das`, `surr`, `peek`). The game's supported rule variants should
map directly to this engine's parameter space. Initial default configuration: 8 decks, S17,
DAS, No Surrender, Peek, Double Any Two.

## Platform
- Must compile and run on macOS in the near term.
- Architecture should not preclude a future Windows build.
- Long-term: multiplayer/competitive features require a backend server, so keep client and
  game-logic layers cleanly separated from day one, even if the server doesn't exist yet.

## Core Gameplay Loop
- First-person visual presentation of a blackjack table.
- After every player decision (hit/stand/double/split/surrender), show an info popup indicating
  whether the decision matched basic strategy for the active rule set, and why.
- Track and display player statistics per game/session, including:
  - Theoretical RTP for the active rule variant
  - Actual RTP based on the cards dealt (luck-based outcome)
  - Expected RTP given the player's actual decisions (i.e., theoretical RTP adjusted for the
    player's deviation from optimal play)
  - The player's deviation % from optimal strategy

## Game Modes
1. **Practice Mode** — hints enabled, no time pressure, meant for learning.
2. **Competitive Mode** — ranked based on decision accuracy against basic strategy; appropriate
   time constraints per decision.
3. **Endless Mode** — play continues until the first incorrect decision, then ends.

## Ranking & Stats
- Users should have a persistent rank based on historical decision accuracy.
- Stats should be visible and meaningful to the user, not just buried in a log.

## Explicitly Out of Scope (for now)
- No real-money wagering of any kind.
- No card counting mode yet — planned for a future commit, not this one.

## Explicitly In Scope for Future Planning (don't build yet, but don't architect against it)
- Cross-device play via a backend server, with competitive ranking synced across users.
