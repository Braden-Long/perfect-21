import { useCallback, useEffect, useRef, useState } from 'react';
import { explain, getStrategy } from '@perfect21/engine';
import type { Action, Strategy } from '@perfect21/engine';
import type { Feedback } from './useGame';
import type { Profile } from './profile';
import { logDecision, saveProfile } from './profile';
import { dealDrillHand, drillActions } from './drill';
import type { DrillHand } from './drill';
import { play } from './sound';

export interface Drill {
  status: 'loading' | 'ready';
  hand: DrillHand | null;
  phase: 'decide' | 'review';
  available: Action[];
  feedback: Feedback | null;
  act: (a: Action) => void;
  next: () => void;
  reps: number;
  correct: number;
  streak: number;
  /** Remaining tracked weak spots (drives the "leaks left" counter). */
  missCount: number;
}

/**
 * Flashcard reps against the strategy engine. Decisions here update the
 * mistake memory and hand log but not the rank window, the bankroll, or the
 * leaderboard — drilling a weakness must never punish the player.
 */
export function useDrill(profile: Profile): Drill {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [hand, setHand] = useState<DrillHand | null>(null);
  const [phase, setPhase] = useState<'decide' | 'review'>('decide');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [reps, setReps] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [streak, setStreak] = useState(0);
  const strategyRef = useRef<Strategy | null>(null);
  const feedbackIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const strategy = getStrategy(profile.rules);
      if (cancelled) return;
      strategyRef.current = strategy;
      setHand(dealDrillHand(profile, null));
      setStatus('ready');
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const available = hand && phase === 'decide' ? drillActions(profile.rules, hand.ranks) : [];

  const act = useCallback(
    (chosen: Action) => {
      const strategy = strategyRef.current;
      if (!strategy || !hand || phase !== 'decide') return;
      const actions = drillActions(profile.rules, hand.ranks);
      if (!actions.includes(chosen)) return;
      const rec = strategy.recommend([...hand.ranks], hand.up, actions);
      const ok = chosen === rec.action;
      const evLoss = (rec.evs[rec.action] ?? 0) - (rec.evs[chosen] ?? 0);
      logDecision(profile, rec.cell.key, {
        t: Date.now(),
        ranks: [...hand.ranks],
        up: hand.up,
        chosen,
        recommended: rec.action,
        correct: ok,
        evLoss,
        mode: 'drill',
      });
      saveProfile(profile);
      setFeedback({
        id: ++feedbackIdRef.current,
        correct: ok,
        timedOut: false,
        chosen,
        recommended: rec.action,
        explanation: explain(strategy, [...hand.ranks], hand.up, rec),
        evs: rec.evs,
      });
      play(ok ? 'correct' : 'incorrect');
      setReps((n) => n + 1);
      if (ok) setCorrect((n) => n + 1);
      setStreak((n) => (ok ? n + 1 : 0));
      setPhase('review');
    },
    [hand, phase, profile]
  );

  const next = useCallback(() => {
    if (phase !== 'review' || !hand) return;
    play('deal');
    setHand(dealDrillHand(profile, hand.cellKey));
    setFeedback(null);
    setPhase('decide');
  }, [hand, phase, profile]);

  return {
    status,
    hand,
    phase,
    available,
    feedback,
    act,
    next,
    reps,
    correct,
    streak,
    missCount: Object.keys(profile.misses).length,
  };
}
