import { useCallback, useState } from 'react';
import type { Rules } from '@perfect21/engine';
import { Menu } from './components/Menu';
import { Table } from './components/Table';
import { StatsScreen } from './components/StatsScreen';
import { ChartScreen } from './components/ChartScreen';
import { RulesDialog } from './components/RulesDialog';
import { loadProfile, saveProfile } from './profile';
import { useGame } from './useGame';
import type { Mode } from './useGame';

type Screen = { name: 'menu' } | { name: 'game'; mode: Mode } | { name: 'stats' } | { name: 'chart' };

function GameScreen({ mode, onExit }: { mode: Mode; onExit: () => void }) {
  // Profile is read fresh per mounted game so rule changes apply.
  const [profile] = useState(loadProfile);
  const game = useGame(profile, mode);
  return <Table game={game} mode={mode} profile={profile} onExit={onExit} />;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [profile, setProfile] = useState(loadProfile);
  const [rulesOpen, setRulesOpen] = useState(false);

  const backToMenu = useCallback(() => {
    setProfile(loadProfile());
    setScreen({ name: 'menu' });
  }, []);

  const saveRules = useCallback(
    (rules: Rules) => {
      const p = { ...profile, rules };
      saveProfile(p);
      setProfile(p);
    },
    [profile]
  );

  switch (screen.name) {
    case 'game':
      return <GameScreen key={screen.mode} mode={screen.mode} onExit={backToMenu} />;
    case 'stats':
      return <StatsScreen profile={profile} onBack={backToMenu} />;
    case 'chart':
      return <ChartScreen profile={profile} onBack={backToMenu} />;
    case 'menu':
      return (
        <>
          <Menu
            profile={profile}
            onPlay={(mode) => setScreen({ name: 'game', mode })}
            onStats={() => setScreen({ name: 'stats' })}
            onChart={() => setScreen({ name: 'chart' })}
            onRules={() => setRulesOpen(true)}
          />
          {rulesOpen && (
            <RulesDialog rules={profile.rules} onSave={saveRules} onClose={() => setRulesOpen(false)} />
          )}
        </>
      );
  }
}
