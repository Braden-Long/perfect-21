import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Round,
  SessionStats,
  Shoe,
  cardRanks,
  explain,
  getStrategy,
} from '@perfect21/engine';
import type { Action, CellEVs, Recommendation, Strategy } from '@perfect21/engine';
import type { Profile } from './profile';
import { STARTING_BANKROLL, logDecision, recordDecision, saveProfile } from './profile';
import { scheduleSync } from './api';
import { play } from './sound';

export type Mode = 'practice' | 'competitive' | 'endless';
export type TablePhase = 'betting' | 'playing';
export type EndReason = 'mistake' | 'busted';

export const DECISION_SECONDS = 10;
/** Endless runs start on a short stack: bust out or slip once and it's over. */
export const ENDLESS_BANKROLL = 100;
export const CHIP_DENOMS = [1, 5, 25, 100, 500];
export const TABLE_MAX_BET = 500;
const DEFAULT_BET = 5;

export interface Feedback {
  id: number;
  correct: boolean;
  timedOut: boolean;
  chosen: Action;
  recommended: Action;
  explanation: string;
  evs: CellEVs;
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
  bestStreak: number;
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
  /** Staged bet while betting; the round's unit bet while playing. */
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
  const [totalPlay, setTotalPlay] = useState(0);
  const [lastNet, setLastNet] = useState<number | null>(null);
  const [tape, setTape] = useState<boolean[]>([]);

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
  const [theoreticalRTP, setTheoreticalRTP] = useState(1);

  const endlessOver = endReason !== null;
  const bet = tablePhase === 'betting' ? chipStack.reduce((s, v) => s + v, 0) : betRef.current;

  const bump = useCallback(() => setVersion((v) => v + 1), []);

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
    profile.totalRounds++;
    profile.totalNet += summary.net;
    // Return each hand's surviving stake + winnings, in chips. Everything the
    // round consumed was already deducted at deal/double/split time.
    const unitBet = betRef.current;
    const returned = round.hands.reduce((s, h) => s + (h.bet + (h.net ?? 0)) * unitBet, 0);
    const roll = bankrollRef.current + returned;
    setRoll(roll);
    setLastNet(summary.net * unitBet);
    setTablePhase('betting');
    if (mode === 'endless' && roll < 1 && !endedRef.current) {
      endedRef.current = true;
      if (streakRef.current > profile.bestEndless) profile.bestEndless = streakRef.current;
      setEndReason('busted');
    } else if (!endedRef.current) {
      // Re-stage last bet for a one-click rebet, clamped to what's left.
      setChipStack(unitBet >= 1 && unitBet <= roll ? [unitBet] : []);
    }
    // Payout sound lands after the verdict sound has had its say.
    play(roll < 1 ? 'bust' : summary.net > 0 ? 'win' : summary.net === 0 ? 'push' : 'lose', 0.45);
    saveProfile(profile);
    scheduleSync(profile);
  }, [mode, profile, setRoll]);

  const deal = useCallback(() => {
    const strategy = strategyRef.current;
    const shoe = shoeRef.current;
    const stake = chipStack.reduce((s, v) => s + v, 0);
    if (!strategy || !shoe || endlessOver || tablePhase !== 'betting') return;
    if (stake < 1 || stake > bankrollRef.current) return;
    betRef.current = stake;
    play('deal');
    setRoll(bankrollRef.current - stake);
    setTotalPlay((t) => t + stake);
    setLastNet(null);
    const round = new Round(strategy.rules, shoe);
    roundRef.current = round;
    recordedRef.current = false;
    setFeedback(null);
    setTablePhase('playing');
    round.deal();
    settleIfDone();
    bump();
  }, [bump, chipStack, endlessOver, settleIfDone, setRoll, tablePhase]);

  // Build (or fetch cached) strategy tables off the first paint.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    const timer = setTimeout(() => {
      const strategy = getStrategy(profile.rules);
      const rtp = strategy.theoreticalRTP();
      if (cancelled) return;
      strategyRef.current = strategy;
      shoeRef.current = new Shoe(profile.rules.decks);
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
      const correct = !timedOut && chosen === rec.action;
      const evLoss = (rec.evs[rec.action] ?? 0) - (rec.evs[chosen] ?? 0);
      sessionRef.current.addDecision({ correct, evLoss, chosen, recommended: rec.action });
      recordDecision(profile, correct);
      logDecision(profile, rec.cell.key, {
        t: Date.now(),
        ranks: cardRanks(r.activeHand.cards),
        up: r.dealerUp.rank,
        chosen,
        recommended: rec.action,
        correct,
        evLoss,
        mode,
      });
      setTape((prev) => [...prev, correct]);
      profile.totalEVLoss += evLoss;
      const explanation = explain(strategy, cardRanks(r.activeHand.cards), r.dealerUp.rank, rec);
      setFeedback({
        id: ++feedbackIdRef.current,
        correct,
        timedOut,
        chosen,
        recommended: rec.action,
        explanation,
        evs: rec.evs,
      });
      play(correct ? 'correct' : 'incorrect');
      if (correct) {
        streakRef.current++;
      } else if (mode === 'endless') {
        endedRef.current = true;
        if (streakRef.current > profile.bestEndless) profile.bestEndless = streakRef.current;
        setEndReason('mistake');
      } else {
        streakRef.current = 0;
      }
      if (chosen === 'double' || chosen === 'split') {
        play('chip', 0.1);
        setRoll(bankrollRef.current - betRef.current);
        setTotalPlay((t) => t + betRef.current);
      }
      r.act(chosen);
      settleIfDone();
      saveProfile(profile);
      bump();
    },
    [availableNow, bump, endlessOver, mode, profile, recommend, settleIfDone, setRoll]
  );

  const act = useCallback((a: Action) => applyAction(a, false), [applyAction]);

  // --- bet staging ---
  const addChip = useCallback(
    (v: number) => {
      if (tablePhase !== 'betting' || endlessOver) return;
      const total = chipStack.reduce((s, x) => s + x, 0);
      if (total + v > bankrollRef.current || total + v > TABLE_MAX_BET) return;
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
    if (total < 1 || total * 2 > bankrollRef.current || total * 2 > TABLE_MAX_BET) return;
    play('chip');
    setChipStack([...chipStack, total]);
  }, [chipStack, endlessOver, tablePhase]);

  const canRebuy = mode !== 'endless' && tablePhase === 'betting' && bankroll < 1;

  const rebuy = useCallback(() => {
    if (mode === 'endless' || bankrollRef.current >= 1) return;
    profile.rebuys++;
    play('chip');
    setRoll(STARTING_BANKROLL);
    setChipStack([DEFAULT_BET]);
    saveProfile(profile);
  }, [mode, profile, setRoll]);

  // Competitive decision clock: reset whenever a new decision point appears.
  const decisionKey =
    round && round.phase === 'player' && tablePhase === 'playing' && !endlessOver
      ? `${profile.totalRounds}-${round.active}-${round.activeHand.cards.length}-${round.hands.length}`
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
    bestStreak: profile.bestEndless,
    endlessOver,
    endReason,
    tape,
    deadline,
    tablePhase,
    bankroll,
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
      status === 'ready' && tablePhase === 'betting' && !endlessOver && bet >= 1 && bet <= bankroll,
    canRebuy,
    rebuy,
  };
}
