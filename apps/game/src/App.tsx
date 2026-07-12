import { useCallback, useEffect, useState } from 'react';
import type { Rules } from '@perfect21/engine';
import { Menu } from './components/Menu';
import { Table } from './components/Table';
import { StatsScreen } from './components/StatsScreen';
import { ChartScreen } from './components/ChartScreen';
import { RulesDialog } from './components/RulesDialog';
import { LeaderboardScreen } from './components/LeaderboardScreen';
import { SupportDialog } from './components/SupportDialog';
import { AdminScreen } from './components/AdminScreen';
import { DrillScreen } from './components/DrillScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { RecoverScreen } from './components/RecoverScreen';
import { loadProfile, saveProfile } from './profile';
import { useGame } from './useGame';
import type { Mode } from './useGame';

type Screen =
  | { name: 'menu' }
  | { name: 'game'; mode: Mode }
  | { name: 'drill' }
  | { name: 'history' }
  | { name: 'stats' }
  | { name: 'chart' }
  | { name: 'board' }
  | { name: 'admin' }
  | { name: 'recover'; token: string };

const MODE_HASHES: Record<string, Mode> = {
  '#practice': 'practice',
  '#competitive': 'competitive',
  '#endless': 'endless',
  '#counting': 'counting',
};

function screenForHash(hash: string): Screen | null {
  if (hash === '#admin') return { name: 'admin' };
  if (hash === '#drill') return { name: 'drill' };
  if (hash.startsWith('#recover=')) return { name: 'recover', token: hash.slice('#recover='.length) };
  const mode = MODE_HASHES[hash];
  return mode ? { name: 'game', mode } : null;
}

function GameScreen({ mode, onExit }: { mode: Mode; onExit: () => void }) {
  // Profile is read fresh per mounted game so rule changes apply.
  const [profile] = useState(loadProfile);
  const game = useGame(profile, mode);
  return <Table game={game} mode={mode} onExit={onExit} />;
}

function DrillGameScreen({ onExit }: { onExit: () => void }) {
  const [profile] = useState(loadProfile);
  return <DrillScreen profile={profile} onExit={onExit} />;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => screenForHash(location.hash) ?? { name: 'menu' });
  const [profile, setProfile] = useState(loadProfile);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);

  // The admin panel (…/#admin) and each mode (…/#practice etc.) are bookmarkable.
  useEffect(() => {
    const onHash = () => {
      const next = screenForHash(location.hash);
      if (next) setScreen(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const backToMenu = useCallback(() => {
    if (screenForHash(location.hash)) history.replaceState(null, '', ' ');
    setProfile(loadProfile());
    setScreen({ name: 'menu' });
  }, []);

  const saveRules = useCallback(
    (rules: Rules, countingDecks: number) => {
      const p = { ...profile, rules, countingDecks };
      saveProfile(p);
      setProfile(p);
    },
    [profile]
  );

  switch (screen.name) {
    case 'game':
      return <GameScreen key={screen.mode} mode={screen.mode} onExit={backToMenu} />;
    case 'drill':
      return <DrillGameScreen onExit={backToMenu} />;
    case 'history':
      return (
        <HistoryScreen
          profile={profile}
          onDrill={() => setScreen({ name: 'drill' })}
          onBack={backToMenu}
        />
      );
    case 'stats':
      return <StatsScreen profile={profile} onBack={backToMenu} />;
    case 'chart':
      return <ChartScreen profile={profile} onBack={backToMenu} />;
    case 'board':
      return <LeaderboardScreen profile={profile} onBack={backToMenu} />;
    case 'admin':
      return <AdminScreen onBack={backToMenu} />;
    case 'recover':
      return <RecoverScreen token={screen.token} onDone={backToMenu} />;
    case 'menu':
      return (
        <>
          <Menu
            profile={profile}
            onPlay={(mode) =>
              setScreen(mode === 'drill' ? { name: 'drill' } : { name: 'game', mode })
            }
            onHistory={() => setScreen({ name: 'history' })}
            onStats={() => setScreen({ name: 'stats' })}
            onChart={() => setScreen({ name: 'chart' })}
            onRules={() => setRulesOpen(true)}
            onBoard={() => setScreen({ name: 'board' })}
            onSupport={() => setSupportOpen(true)}
          />
          {rulesOpen && (
            <RulesDialog
              rules={profile.rules}
              countingDecks={profile.countingDecks}
              onSave={saveRules}
              onClose={() => setRulesOpen(false)}
            />
          )}
          {supportOpen && <SupportDialog onClose={() => setSupportOpen(false)} />}
        </>
      );
  }
}
