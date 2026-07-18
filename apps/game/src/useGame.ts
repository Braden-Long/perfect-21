import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTION_LABEL,
  INSURANCE_INDEX,
  Round,
  SessionStats,
  Shoe,
  betRamp,
  cardRanks,
  countCards,
  counterEdge,
  explain,
  getStrategy,
  indexPlay,
  trueCount,
} from '@perfect21/engine';
import type { Action, CellEVs, Recommendation, Rules, Strategy } from '@perfect21/engine';
import type { Profile } from './profile';
import {
  STARTING_BANKROLL,
  logDecision,
  recordCountingDecision,
  recordDecision,
  saveProfile,
} from './profile';
import { cellLabel } from './drill';
import { scheduleSync } from './api';
import { play } from './sound';
import { checkAchievements } from './achievements';
import type { Achievement } from './achievements';

export type Mode = 'practice' | 'competitive' | 'endless' | 'counting';
export type TablePhase = 'betting' | 'playing';
export type EndReason = 'mistake' | 'busted';

export const DECISION_SECONDS = 10;
/** Endless runs start on a short stack: bust out or slip once and it's over. */
export const ENDLESS_BANKROLL = 100;
export const CHIP_DENOMS = [1, 5, 25, 100, 500];
/** Table limits, per betting spot. Below the minimum you can't play — rebuy or bust. */
export const TABLE_MIN_BET = 5;
export const TABLE_MAX_BET = 500;
const DEFAULT_BET = TABLE_MIN_BET;
/** How many betting spots a player can spread across (practice/counting only). */
export const MAX_TABLE_SEATS = 3;
/** Counting mode's betting unit: the 5-chip table minimum. Spread is graded in these. */
export const COUNTING_UNIT = TABLE_MIN_BET;

export interface Feedback {
  id: number;
  correct: boolean;
  timedOut: boolean;
  chosen: Action;
  recommended: Action;
  explanation: string;
  /** Live EVs when the verdict is an action call; empty for insurance calls. */
  evs: Partial<CellEVs>;
  /** Custom verdict headline (deviation and insurance calls); replaces the basic-strategy line. */
  headline?: string;
}

export interface Game {
  status: 'loading' | 'ready';
  round: Round | null;
  version: number;
  session: SessionStats;
  feedback: Feedback | null;
  available: Action[];
  act: (a: Action) => void;
  recommend: () => Recommendation | null;
  theoreticalRTP: number;
  streak: number;
  /** Best endless-run streak on record (the game-over screen's yardstick). */
  bestEndless: number;
  endlessOver: boolean;
  endReason: EndReason | null;
  /** This session's graded decisions in order — the HUD ✓/✗ tape. */
  tape: boolean[];
  /** Epoch ms when the current decision times out (competitive mode). */
  deadline: number | null;
  // --- chips ---
  tablePhase: TablePhase;
  /** Play chips available right now (persistent roll, or the endless run stack). */
  bankroll: number;
  /** Betting spots in play this round (each posts the same bet). */
  seats: number;
  setSeats: (n: number) => void;
  /** Multi-spot play is a practice/counting luxury; scored modes stay one seat. */
  canMultiSeat: boolean;
  /** Staged bet while betting; the round's unit bet while playing. Per spot. */
  bet: number;
  /** The unit bet of the round on the table (survives into the next betting phase). */
  roundBet: number;
  /** Chips pushed across the line this session (initial bets + doubles + splits). */
  totalPlay: number;
  /** Net chips from the last settled round, for the win banner. */
  lastNet: number | null;
  addChip: (v: number) => void;
  undoChip: () => void;
  clearBet: () => void;
  doubleStake: () => void;
  deal: () => void;
  canDeal: boolean;
  canRebuy: boolean;
  rebuy: () => void;
  // --- card counting mode ---
  /** The rules actually on the table (counting mode deals its own shoe). */
  rules: Rules;
  /** Hi-Lo running count of every card visible so far this shoe. */
  rc: number;
  /** True count: rc / decks remaining. */
  tc: number;
  decksLeft: number;
  /** Decks physically left in the shoe (no fresh-shoe HUD override) — drives the shoe visual. */
  shoeDecksLeft: number;
  /** True right after a reshuffle, until the next deal. */
  freshShoe: boolean;
  /** The cut card is out: the next deal reshuffles, so the count resets to 0. */
  shufflePending: boolean;
  /** The counter's live edge for the rules in play: base edge + 0.5% per TC. */
  edge: number;
  /** Answer the insurance offer (counting mode, ace up). */
  insure: (take: boolean) => void;
  /** Freshly unlocked achievements, queued oldest-first for the toast. */
  unlocked: Achievement[];
  /** Pop the toast queue once the front achievement has been shown. */
  shiftUnlocked: () => void;
  /** Cumulative chip P&L after each settled round this session; starts at [0]. */
  pnlSeries: number[];
  /** Winning / losing rounds in the current live-stats window. */
  pnlWins: number;
  pnlLosses: number;
  /** Re-baseline the live-stats panel (chart + counts) without touching real stats. */
  resetPnl: () => void;
}

export function useGame(profile: Profile, mode: Mode): Game {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [version, setVersion] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [endReason, setEndReason] = useState<EndReason | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [tablePhase, setTablePhase] = useState<TablePhase>('betting');
  const [bankroll, setBankroll] = useState(() =>
    mode === 'endless' ? ENDLESS_BANKROLL : profile.bankroll
  );
  const [chipStack, setChipStack] = useState<number[]>([]);
  const canMultiSeat = mode === 'practice' || mode === 'counting';
  const [seats, setSeatsState] = useState(1);
  const seatsRef = useRef(1);
  const [totalPlay, setTotalPlay] = useState(0);
  const [lastNet, setLastNet] = useState<number | null>(null);
  const [tape, setTape] = useState<boolean[]>([]);
  const [unlocked, setUnlocked] = useState<Achievement[]>([]);
  const [pnlSeries, setPnlSeries] = useState<number[]>([0]);
  const [pnlWins, setPnlWins] = useState(0);
  const [pnlLosses, setPnlLosses] = useState(0);

  const strategyRef = useRef<Strategy | null>(null);
  const shoeRef = useRef<Shoe | null>(null);
  const roundRef = useRef<Round | null>(null);
  const sessionRef = useRef(new SessionStats());
  const recordedRef = useRef(false);
  const streakRef = useRef(0);
  const feedbackIdRef = useRef(0);
  const bankrollRef = useRef(bankroll);
  const betRef = useRef(0);
  const endedRef = useRef(false);
  /** Hi-Lo count of everything folded in from finished rounds this shoe. */
  const baseRCRef = useRef(0);
  const [freshShoe, setFreshShoe] = useState(false);
  const counting = mode === 'counting';
  // Counting deals its own shoe: few decks is where counting actually pays.
  const tableRules = useMemo<Rules>(
    () =>
      counting
        ? { ...profile.rules, decks: profile.countingDecks as Rules['decks'] }
        : profile.rules,
    [counting, profile.rules, profile.countingDecks]
  );

  /** Count contribution of the cards currently face-up on the table. */
  const visibleCount = (r: Round | null): number => {
    if (!r) return 0;
    let n = 0;
    for (const h of r.hands) n += countCards(h.cards);
    n += countCards(r.holeRevealed ? r.dealerCards : r.dealerCards.slice(0, 1));
    return n;
  };
  const [theoreticalRTP, setTheoreticalRTP] = useState(1);

  const endlessOver = endReason !== null;
  const bet = tablePhase === 'betting' ? chipStack.reduce((s, v) => s + v, 0) : betRef.current;

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Anything earned before this session (or before the feature shipped) is
  // granted quietly — toasts are for the moment something new happens.
  useEffect(() => {
    checkAchievements(profile);
  }, [profile]);

  /** Run the unlock checks and queue any fresh trophies for the toast. */
  const pushUnlocks = useCallback(() => {
    const fresh = checkAchievements(profile);
    if (fresh.length > 0) setUnlocked((u) => [...u, ...fresh]);
  }, [profile]);
  const shiftUnlocked = useCallback(() => setUnlocked((u) => u.slice(1)), []);
  const resetPnl = useCallback(() => {
    setPnlSeries([0]);
    setPnlWins(0);
    setPnlLosses(0);
  }, []);

  // Every graded call — play, bet check, insurance — feeds one streak. A miss
  // breaks it; callers that must freeze it instead (endless: the run ends and
  // the game-over screen shows the final count) skip the call on a miss.
  const bumpStreak = useCallback(
    (correct: boolean) => {
      if (correct) {
        streakRef.current++;
        if (streakRef.current > profile.bestCallStreak) {
          profile.bestCallStreak = streakRef.current;
        }
      } else {
        streakRef.current = 0;
      }
    },
    [profile]
  );

  const setRoll = useCallback(
    (value: number) => {
      bankrollRef.current = value;
      setBankroll(value);
      if (mode !== 'endless') {
        profile.bankroll = value;
      }
    },
    [mode, profile]
  );

  const settleIfDone = useCallback(() => {
    const round = roundRef.current;
    if (!round || round.phase !== 'settled' || recordedRef.current) return;
    recordedRef.current = true;
    const summary = round.summary();
    sessionRef.current.addRound(summary);
    // Every seat is one initial bet — that's the unit all RTP math is quoted
    // in. Counting tables book their own results so learning the count never
    // skews the basic-strategy RTP stats.
    if (counting) {
      profile.countingRounds += round.seats;
      profile.countingNet += summary.net;
    } else {
      profile.totalRounds += round.seats;
      profile.totalNet += summary.net;
    }
    // Everything is face-up now — fold this round into the running count.
    baseRCRef.current += visibleCount(round);
    // Return each hand's surviving stake + winnings, in chips. Everything the
    // round consumed was already deducted at deal/double/split time.
    const unitBet = betRef.current;
    const returned =
      round.hands.reduce((s, h) => s + (h.bet + (h.net ?? 0)) * unitBet, 0) +
      (round.insured ? (round.insuranceNet + 0.5 * round.seats) * unitBet : 0);
    const roll = bankrollRef.current + returned;
    setRoll(roll);
    const netChips = summary.net * unitBet;
    setLastNet(netChips);
    setPnlSeries((s) => [...s, s[s.length - 1] + netChips]);
    if (netChips > 0) setPnlWins((w) => w + 1);
    else if (netChips < 0) setPnlLosses((l) => l + 1);
    setTablePhase('betting');
    if (mode === 'endless' && roll < TABLE_MIN_BET && !endedRef.current) {
      // Can't cover the table minimum: the run is over.
      endedRef.current = true;
      if (streakRef.current > profile.bestEndless) profile.bestEndless = streakRef.current;
      setEndReason('busted');
    } else if (!endedRef.current) {
      // Re-stage last bet for a one-click rebet, clamped to what's left.
      setChipStack(
        unitBet >= TABLE_MIN_BET && unitBet * seatsRef.current <= roll ? [unitBet] : []
      );
    }
    // Payout sound lands after the verdict sound has had its say.
    play(
      roll < TABLE_MIN_BET ? 'bust' : summary.net > 0 ? 'win' : summary.net === 0 ? 'push' : 'lose',
      0.45
    );
    saveProfile(profile);
    scheduleSync(profile);
  }, [mode, profile, setRoll]);

  const deal = useCallback(() => {
    const strategy = strategyRef.current;
    const shoe = shoeRef.current;
    const stake = chipStack.reduce((s, v) => s + v, 0);
    const seatsN = canMultiSeat ? seatsRef.current : 1;
    if (!strategy || !shoe || endlessOver || tablePhase !== 'betting') return;
    if (stake < TABLE_MIN_BET || stake * seatsN > bankrollRef.current) return;
    betRef.current = stake;
    play('deal');

    // Counting mode: the bet IS a decision. Grade the stake against the ramp
    // at the true count the player saw while betting (0 when the cut card is
    // out — the HUD warns that the next deal reshuffles).
    let betFeedback: Feedback | null = null;
    if (counting) {
      const tcAtBet = shoe.needsShuffle ? 0 : trueCount(baseRCRef.current, shoe.remaining);
      const ramp = betRamp(tcAtBet, tableRules.decks);
      const minChips = ramp.minUnits * COUNTING_UNIT;
      const maxChips = ramp.maxUnits * COUNTING_UNIT;
      // Short stacks can't be asked to bet chips they don't have.
      const allIn =
        bankrollRef.current < minChips * seatsN &&
        stake === Math.floor(bankrollRef.current / seatsN);
      const correct = (stake >= minChips && stake <= maxChips) || allIn;
      const edgeNow = counterEdge(theoreticalRTP - 1, tcAtBet);
      const tcStr = `${tcAtBet >= 0 ? '+' : ''}${tcAtBet.toFixed(1)}`;
      const edgeStr = `${edgeNow >= 0 ? '+' : ''}${(edgeNow * 100).toFixed(1)}%`;
      const units = (n: number) => `${n} unit${n === 1 ? '' : 's'} (${n * COUNTING_UNIT})`;
      const perSpot = seatsN > 1 ? ' per spot' : '';
      recordCountingDecision(profile, correct, 'bet');
      setTape((prev) => [...prev, correct]);
      // Bet checks are graded calls: they feed (or break) the streak too.
      bumpStreak(correct);
      betFeedback = {
        id: ++feedbackIdRef.current,
        correct,
        timedOut: false,
        chosen: 'stand',
        recommended: 'stand',
        headline: `Bet check: TC ${tcStr} calls for ${units(ramp.units)}${perSpot} — you bet ${stake}${perSpot}`,
        explanation:
          ramp.units === 1
            ? edgeNow < 0
              ? `Your edge at TC ${tcStr} is ${edgeStr} — the shoe belongs to the house, so feed it the table minimum and wait. A counter's money is made by betting small without the edge and big with it.`
              : `At TC ${tcStr} your edge is ${edgeStr} — this rule set is generous off the top, but the ramp still keys off the count: table minimum until it climbs past +1, then ~2 units per point.`
            : `At TC ${tcStr} your edge is about ${edgeStr}. The ramp is ~2 units per true count above +1, capped at a 1–${ramp.spread} spread in a ${tableRules.decks}-deck game — anything from ${ramp.minUnits} to ${ramp.maxUnits} units is sound here.`,
        evs: {},
      };
      play(correct ? 'correct' : 'incorrect', 0.3);
      saveProfile(profile);
    }

    if (shoe.needsShuffle) {
      // Round.deal() is about to reshuffle: the count starts over.
      baseRCRef.current = 0;
      setFreshShoe(true);
    } else {
      setFreshShoe(false);
    }
    setRoll(bankrollRef.current - stake * seatsN);
    setTotalPlay((t) => t + stake * seatsN);
    setLastNet(null);
    const round = new Round(strategy.rules, shoe, {
      offerInsurance: counting && strategy.rules.peek,
      seats: seatsN,
    });
    roundRef.current = round;
    recordedRef.current = false;
    setFeedback(betFeedback);
    setTablePhase('playing');
    round.deal();
    settleIfDone();
    pushUnlocks();
    bump();
  }, [bump, bumpStreak, canMultiSeat, chipStack, counting, endlessOver, profile, pushUnlocks, settleIfDone, setRoll, tablePhase, tableRules, theoreticalRTP]);

  const setSeats = useCallback(
    (n: number) => {
      if (!canMultiSeat || tablePhase !== 'betting') return;
      const clamped = Math.min(Math.max(Math.round(n), 1), MAX_TABLE_SEATS);
      seatsRef.current = clamped;
      setSeatsState(clamped);
    },
    [canMultiSeat, tablePhase]
  );

  // Build (or fetch cached) strategy tables off the first paint.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    const timer = setTimeout(() => {
      const strategy = getStrategy(tableRules);
      const rtp = strategy.theoreticalRTP();
      if (cancelled) return;
      strategyRef.current = strategy;
      shoeRef.current = new Shoe(tableRules.decks);
      setTheoreticalRTP(rtp);
      setStatus('ready');
      const opening = Math.min(DEFAULT_BET, bankrollRef.current);
      if (opening >= 1) setChipStack([opening]);
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const round = roundRef.current;

  // Doubling/splitting puts fresh chips on the table — hide them when broke,
  // and grade against what the player could actually afford.
  const availableNow = useCallback((): Action[] => {
    const r = roundRef.current;
    if (!r || endlessOver) return [];
    return r
      .availableActions()
      .filter((a) => (a !== 'double' && a !== 'split') || bankrollRef.current >= betRef.current);
  }, [endlessOver]);

  const available = useMemo<Action[]>(
    () => availableNow(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availableNow, endlessOver, version, bankroll]
  );

  const recommend = useCallback((): Recommendation | null => {
    const strategy = strategyRef.current;
    const r = roundRef.current;
    if (!strategy || !r || r.phase !== 'player') return null;
    const actions = availableNow();
    if (actions.length === 0) return null;
    return strategy.recommend(cardRanks(r.activeHand.cards), r.dealerUp.rank, actions);
  }, [availableNow]);

  const applyAction = useCallback(
    (chosen: Action, timedOut: boolean) => {
      const strategy = strategyRef.current;
      const r = roundRef.current;
      if (!strategy || !r || r.phase !== 'player' || endlessOver) return;
      if (!availableNow().includes(chosen)) return;
      const rec = recommend();
      if (!rec) return;

      // In counting mode the graded target is the index play, not raw basic.
      let expected = rec.action;
      let headline: string | undefined;
      let explanation = explain(strategy, cardRanks(r.activeHand.cards), r.dealerUp.rank, rec);
      if (counting) {
        const shoe = shoeRef.current!;
        const tcNow = trueCount(baseRCRef.current + visibleCount(r), shoe.remaining);
        const playNow = indexPlay(rec.cell.key, tcNow, rec.action, availableNow(), tableRules);
        expected = playNow.action;
        const tcStr = `${tcNow >= 0 ? '+' : ''}${tcNow.toFixed(1)}`;
        if (playNow.deviation && expected !== rec.action) {
          const idx = playNow.deviation.index;
          const idxStr = `${idx >= 0 ? '+' : ''}${idx}`;
          headline = `Counter's play: ${ACTION_LABEL[expected].toUpperCase()} — ${cellLabel(
            rec.cell.key
          )} index is ${idxStr}, TC is ${tcStr}`;
          explanation =
            `The count overrides the book here. ${
              playNow.triggered
                ? `At TC ${tcStr} (index ${idxStr}) the rich shoe makes ${ACTION_LABEL[expected].toLowerCase()} the profitable play`
                : `Below the ${idxStr} index (TC ${tcStr}) the play reverts to ${ACTION_LABEL[expected].toLowerCase()}`
            } — basic strategy alone would ${ACTION_LABEL[rec.action].toLowerCase()}. ` +
            `(Illustrious 18 / Fab 4, Hi-Lo, multi-deck baseline.)`;
        } else if (playNow.deviation && chosen === playNow.deviation.above && chosen !== expected) {
          explanation += ` The ${cellLabel(rec.cell.key)} index is ${
            playNow.deviation.index >= 0 ? '+' : ''
          }${playNow.deviation.index} — the count (TC ${tcStr}) isn't there yet.`;
        }
      }

      const correct = !timedOut && chosen === expected;
      // EV bookkeeping stays basic-strategy-honest: deviations aren't in the CD model.
      const evLoss = expected === rec.action ? (rec.evs[rec.action] ?? 0) - (rec.evs[chosen] ?? 0) : 0;
      sessionRef.current.addDecision({ correct, evLoss, chosen, recommended: expected });
      if (counting) {
        recordCountingDecision(profile, correct);
      } else {
        recordDecision(profile, correct);
        profile.totalEVLoss += evLoss;
      }
      logDecision(
        profile,
        rec.cell.key,
        {
          t: Date.now(),
          ranks: cardRanks(r.activeHand.cards),
          up: r.dealerUp.rank,
          chosen,
          recommended: expected,
          correct,
          evLoss,
          mode,
        },
        // Counting misses are index misses — keep them out of the basic drill.
        !counting
      );
      setTape((prev) => [...prev, correct]);
      setFeedback({
        id: ++feedbackIdRef.current,
        correct,
        timedOut,
        chosen,
        recommended: expected,
        explanation,
        evs: rec.evs,
        headline,
      });
      play(correct ? 'correct' : 'incorrect');
      if (!correct && mode === 'endless') {
        // The run is over — freeze the streak for the game-over screen.
        endedRef.current = true;
        if (streakRef.current > profile.bestEndless) profile.bestEndless = streakRef.current;
        setEndReason('mistake');
      } else {
        bumpStreak(correct);
      }
      if (chosen === 'double' || chosen === 'split') {
        play('chip', 0.1);
        setRoll(bankrollRef.current - betRef.current);
        setTotalPlay((t) => t + betRef.current);
      }
      r.act(chosen);
      settleIfDone();
      saveProfile(profile);
      pushUnlocks();
      bump();
    },
    [availableNow, bump, bumpStreak, endlessOver, mode, profile, pushUnlocks, recommend, settleIfDone, setRoll, tableRules]
  );

  const act = useCallback((a: Action) => applyAction(a, false), [applyAction]);

  // --- bet staging ---
  const addChip = useCallback(
    (v: number) => {
      if (tablePhase !== 'betting' || endlessOver) return;
      const total = chipStack.reduce((s, x) => s + x, 0);
      const perSpotCap = Math.min(TABLE_MAX_BET, Math.floor(bankrollRef.current / seatsRef.current));
      if (total + v > perSpotCap) return;
      play('chip');
      setChipStack([...chipStack, v]);
    },
    [chipStack, endlessOver, tablePhase]
  );

  const undoChip = useCallback(() => {
    if (tablePhase !== 'betting' || chipStack.length === 0) return;
    play('chip');
    setChipStack(chipStack.slice(0, -1));
  }, [chipStack, tablePhase]);

  const clearBet = useCallback(() => {
    if (tablePhase !== 'betting') return;
    setChipStack([]);
  }, [tablePhase]);

  const doubleStake = useCallback(() => {
    if (tablePhase !== 'betting' || endlessOver) return;
    const total = chipStack.reduce((s, x) => s + x, 0);
    const perSpotCap = Math.min(TABLE_MAX_BET, Math.floor(bankrollRef.current / seatsRef.current));
    if (total < 1 || total * 2 > perSpotCap) return;
    play('chip');
    setChipStack([...chipStack, total]);
  }, [chipStack, endlessOver, tablePhase]);

  // Below the table minimum there's no legal bet left — offer the rebuy.
  const canRebuy = mode !== 'endless' && tablePhase === 'betting' && bankroll < TABLE_MIN_BET;

  // Once the cut card is out, the next deal reshuffles. Every mode gets the
  // ceremony (the engine's cut card rides at 75% penetration everywhere);
  // during the betting phase the counting HUD (and the bet check) must
  // reflect the fresh shoe, not the stale count of the shoe being retired.
  const shufflePending = tablePhase === 'betting' && (shoeRef.current?.needsShuffle ?? false);
  const cardsLeft = shufflePending
    ? tableRules.decks * 52
    : shoeRef.current?.remaining ?? tableRules.decks * 52;
  const rcNow =
    counting && !shufflePending
      ? baseRCRef.current + (round && !recordedRef.current ? visibleCount(round) : 0)
      : 0;

  const rebuy = useCallback(() => {
    if (mode === 'endless' || bankrollRef.current >= 1) return;
    profile.rebuys++;
    play('chip');
    setRoll(STARTING_BANKROLL);
    setChipStack([DEFAULT_BET]);
    saveProfile(profile);
    pushUnlocks();
  }, [mode, profile, pushUnlocks, setRoll]);

  /** Insurance call (counting mode): graded against the +3 index, costs half the bet. */
  const insure = useCallback(
    (take: boolean) => {
      const r = roundRef.current;
      const shoe = shoeRef.current;
      if (!r || !shoe || r.phase !== 'insurance') return;
      const tcNow = trueCount(baseRCRef.current + visibleCount(r), shoe.remaining);
      const shouldTake = tcNow >= INSURANCE_INDEX;
      const correct = take === shouldTake;
      const tcStr = `${tcNow >= 0 ? '+' : ''}${tcNow.toFixed(1)}`;
      sessionRef.current.addDecision({
        correct,
        evLoss: 0,
        chosen: take ? 'stand' : 'hit',
        recommended: shouldTake ? 'stand' : 'hit',
      });
      recordCountingDecision(profile, correct, 'insurance');
      setTape((prev) => [...prev, correct]);
      bumpStreak(correct);
      setFeedback({
        id: ++feedbackIdRef.current,
        correct,
        timedOut: false,
        chosen: 'stand',
        recommended: 'stand',
        headline: `Insurance: ${shouldTake ? 'TAKE it' : 'decline'} — index +${INSURANCE_INDEX}, TC is ${tcStr}${
          correct ? '' : take ? ' (you took it)' : ' (you declined)'
        }`,
        explanation: shouldTake
          ? `At TC ${tcStr} the shoe is so ten-rich that the hole card is a ten often enough to make the 2:1 payout profitable. This is the single most valuable index play in the game.`
          : `Insurance pays 2:1 but needs the hole card to be a ten more than 1 time in 3. At TC ${tcStr} it isn't — insurance is a losing bet until TC reaches +${INSURANCE_INDEX}.`,
        evs: {},
      });
      play(correct ? 'correct' : 'incorrect');
      if (take) {
        // Insurance is half the bet on every spot in play.
        const cost = 0.5 * betRef.current * r.seats;
        play('chip', 0.1);
        setRoll(bankrollRef.current - cost);
        setTotalPlay((t) => t + cost);
      }
      r.takeInsurance(take);
      settleIfDone();
      saveProfile(profile);
      pushUnlocks();
      bump();
    },
    [bump, bumpStreak, profile, pushUnlocks, settleIfDone, setRoll]
  );

  // Competitive decision clock: reset whenever a new decision point appears.
  const decisionKey =
    round && round.phase === 'player' && tablePhase === 'playing' && !endlessOver
      ? `${profile.totalRounds + profile.countingRounds}-${round.active}-${round.activeHand.cards.length}-${round.hands.length}`
      : null;

  useEffect(() => {
    if (mode !== 'competitive' || decisionKey === null) {
      setDeadline(null);
      return;
    }
    const until = Date.now() + DECISION_SECONDS * 1000;
    setDeadline(until);
    const timer = setTimeout(() => {
      const r = roundRef.current;
      if (!r || r.phase !== 'player') return;
      const actions = availableNow();
      applyAction(actions.includes('stand') ? 'stand' : actions[0], true);
    }, DECISION_SECONDS * 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, decisionKey]);

  return {
    status,
    round,
    version,
    session: sessionRef.current,
    feedback,
    available,
    act,
    recommend,
    theoreticalRTP,
    streak: streakRef.current,
    bestEndless: profile.bestEndless,
    endlessOver,
    endReason,
    tape,
    deadline,
    tablePhase,
    bankroll,
    seats: canMultiSeat ? seats : 1,
    setSeats,
    canMultiSeat,
    bet,
    roundBet: betRef.current,
    totalPlay,
    lastNet,
    addChip,
    undoChip,
    clearBet,
    doubleStake,
    deal,
    canDeal:
      status === 'ready' &&
      tablePhase === 'betting' &&
      !endlessOver &&
      bet >= TABLE_MIN_BET &&
      bet * (canMultiSeat ? seats : 1) <= bankroll,
    canRebuy,
    rebuy,
    rules: tableRules,
    rc: rcNow,
    tc: counting ? trueCount(rcNow, cardsLeft) : 0,
    decksLeft: cardsLeft / 52,
    shoeDecksLeft: (shoeRef.current?.remaining ?? tableRules.decks * 52) / 52,
    freshShoe,
    shufflePending,
    edge: counting ? counterEdge(theoreticalRTP - 1, trueCount(rcNow, cardsLeft)) : 0,
    insure,
    unlocked,
    shiftUnlocked,
    pnlSeries,
    pnlWins,
    pnlLosses,
    resetPnl,
  };
}
