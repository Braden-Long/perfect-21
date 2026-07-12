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
import { recordDecision, saveProfile } from './profile';

export type Mode = 'practice' | 'competitive' | 'endless';

export const DECISION_SECONDS = 10;

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
  dealNext: () => void;
  recommend: () => Recommendation | null;
  theoreticalRTP: number;
  streak: number;
  bestStreak: number;
  endlessOver: boolean;
  /** Epoch ms when the current decision times out (competitive mode). */
  deadline: number | null;
}

export function useGame(profile: Profile, mode: Mode): Game {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [version, setVersion] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [endlessOver, setEndlessOver] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);

  const strategyRef = useRef<Strategy | null>(null);
  const shoeRef = useRef<Shoe | null>(null);
  const roundRef = useRef<Round | null>(null);
  const sessionRef = useRef(new SessionStats());
  const recordedRef = useRef(false);
  const streakRef = useRef(0);
  const feedbackIdRef = useRef(0);
  const [theoreticalRTP, setTheoreticalRTP] = useState(1);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const settleIfDone = useCallback(() => {
    const round = roundRef.current;
    if (!round || round.phase !== 'settled' || recordedRef.current) return;
    recordedRef.current = true;
    const summary = round.summary();
    sessionRef.current.addRound(summary);
    profile.totalRounds++;
    profile.totalNet += summary.net;
    saveProfile(profile);
  }, [profile]);

  const dealNext = useCallback(() => {
    const strategy = strategyRef.current;
    const shoe = shoeRef.current;
    if (!strategy || !shoe || endlessOver) return;
    const round = new Round(strategy.rules, shoe);
    roundRef.current = round;
    recordedRef.current = false;
    setFeedback(null);
    round.deal();
    settleIfDone();
    bump();
  }, [bump, endlessOver, settleIfDone]);

  // Build (or fetch cached) strategy tables off the first paint, then deal.
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
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === 'ready' && !roundRef.current) dealNext();
  }, [status, dealNext]);

  const round = roundRef.current;
  const available = useMemo<Action[]>(
    () => (round && !endlessOver ? round.availableActions() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round, endlessOver, version]
  );

  const recommend = useCallback((): Recommendation | null => {
    const strategy = strategyRef.current;
    const r = roundRef.current;
    if (!strategy || !r || r.phase !== 'player') return null;
    const actions = r.availableActions();
    if (actions.length === 0) return null;
    return strategy.recommend(cardRanks(r.activeHand.cards), r.dealerUp.rank, actions);
  }, []);

  const applyAction = useCallback(
    (chosen: Action, timedOut: boolean) => {
      const strategy = strategyRef.current;
      const r = roundRef.current;
      if (!strategy || !r || r.phase !== 'player' || endlessOver) return;
      const rec = recommend();
      if (!rec) return;
      const correct = !timedOut && chosen === rec.action;
      const evLoss = (rec.evs[rec.action] ?? 0) - (rec.evs[chosen] ?? 0);
      sessionRef.current.addDecision({ correct, evLoss, chosen, recommended: rec.action });
      recordDecision(profile, correct);
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
      if (correct) {
        streakRef.current++;
      } else if (mode === 'endless') {
        if (streakRef.current > profile.bestEndless) profile.bestEndless = streakRef.current;
        setEndlessOver(true);
      } else {
        streakRef.current = 0;
      }
      r.act(chosen);
      settleIfDone();
      saveProfile(profile);
      bump();
    },
    [bump, endlessOver, mode, profile, recommend, settleIfDone]
  );

  const act = useCallback((a: Action) => applyAction(a, false), [applyAction]);

  // Competitive decision clock: reset whenever a new decision point appears.
  const decisionKey = round && round.phase === 'player' && !endlessOver
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
      const actions = r.availableActions();
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
    dealNext,
    recommend,
    theoreticalRTP,
    streak: streakRef.current,
    bestStreak: profile.bestEndless,
    endlessOver,
    deadline,
  };
}
