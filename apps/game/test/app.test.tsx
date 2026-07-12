// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';

/** Boots the real app in jsdom and plays through a practice hand. */
describe('Perfect 21 app', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it('renders the lobby with all four modes', () => {
    render(<App />);
    expect(screen.getByText('PERFECT')).toBeTruthy();
    expect(screen.getByText('Practice')).toBeTruthy();
    expect(screen.getByText('Competitive')).toBeTruthy();
    expect(screen.getByText('Endless')).toBeTruthy();
    expect(screen.getByText('Drill')).toBeTruthy();
    expect(screen.getByText('Unranked')).toBeTruthy();
  });

  it('opens the rules dialog and saves a rule change', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('Table rules'));
    const soft17 = screen.getByDisplayValue('Stands (S17)');
    fireEvent.change(soft17, { target: { value: 'h17' } });
    fireEvent.click(screen.getByText('Save rules'));
    fireEvent.click(screen.getByText('Table rules'));
    expect(screen.getByDisplayValue('Hits (H17)')).toBeTruthy();
  });

  it('plays a practice hand end to end: bet, deal, graded decisions, payout', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('Practice'));

    // Strategy tables build, then the betting console appears with a staged bet.
    await waitFor(() => expect(screen.getByText('PLACE YOUR BET')).toBeTruthy(), {
      timeout: 30000,
    });
    expect(screen.getByText('Balance').parentElement!.textContent).toContain('1,000');

    // The default 5-chip bet is staged, so DEAL is live. Chips hit the felt.
    const deal = screen.getByText('DEAL') as HTMLButtonElement;
    expect(deal.disabled).toBe(false);
    fireEvent.click(deal);
    expect(screen.getByText('Total play').parentElement!.textContent).toContain('5');

    // Play decisions until the round settles (betting console returns).
    for (let i = 0; i < 12; i++) {
      const stand = screen.queryByText('Stand');
      const hit = screen.queryByText('Hit');
      if (!stand && !hit) break;
      fireEvent.click((stand ?? hit)!.closest('button')!);
      // Every decision must produce graded feedback.
      expect(screen.getByText(/Basic strategy:/)).toBeTruthy();
    }
    await waitFor(() => expect(screen.getByText(/REBET|PLACE YOUR BET/)).toBeTruthy(), {
      timeout: 5000,
    });

    // Session stats recorded the round and a result banner reported the payout.
    expect(screen.getByText('Hands').parentElement!.textContent).toContain('1');
    expect(screen.queryAllByText(/YOU WIN|PUSH|−/).length).toBeGreaterThan(0);

    // Rebet is staged automatically, so the loop continues with one click.
    fireEvent.click(screen.getByText('DEAL'));
    await waitFor(
      () =>
        expect(
          screen.queryByText('Stand') ?? screen.queryByText(/REBET|PLACE YOUR BET/)
        ).toBeTruthy(),
      { timeout: 5000 }
    );
  });

  it('stages chips with undo and ×2 before dealing', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('Practice'));
    await waitFor(() => expect(screen.getByText('PLACE YOUR BET')).toBeTruthy(), {
      timeout: 30000,
    });

    // Default stake is 5; add a 25 chip, double it, then undo once: (5+25)*2 - 30 = 30.
    fireEvent.click(screen.getByLabelText('add 25 chip'));
    fireEvent.click(screen.getByTitle('Double bet'));
    fireEvent.click(screen.getByTitle('Undo chip'));
    // The staged stack shows the total on the bet spot.
    expect(screen.getByText('30')).toBeTruthy();
  });

  it('runs drill reps with graded feedback', async () => {
    // Seed a tracked mistake so drill has a weak spot to target.
    localStorage.setItem(
      'perfect21.profile.v1',
      JSON.stringify({
        misses: {
          'h16-10': {
            key: 'h16-10',
            n: 5,
            evLost: 0.4,
            recommended: 'hit',
            chosen: { stand: 5 },
            last: Date.now(),
          },
        },
      })
    );
    render(<App />);
    fireEvent.click(screen.getByText('Drill'));
    await waitFor(() => expect(screen.getByText('MAKE YOUR DECISION')).toBeTruthy(), {
      timeout: 30000,
    });
    expect(screen.getByText(/weak spot/)).toBeTruthy();

    // Any rep: stand is always available; grading feedback must appear.
    fireEvent.click(screen.getByText('Stand').closest('button')!);
    expect(screen.getByText(/Basic strategy:/)).toBeTruthy();

    // NEXT deals a fresh situation.
    fireEvent.click(screen.getByText('NEXT'));
    expect(screen.getByText('MAKE YOUR DECISION')).toBeTruthy();
  });

  it('shows the mistake history with a drill call-to-action', () => {
    localStorage.setItem(
      'perfect21.profile.v1',
      JSON.stringify({
        misses: {
          'h16-10': {
            key: 'h16-10',
            n: 4,
            evLost: 0.3,
            recommended: 'hit',
            chosen: { stand: 4 },
            last: Date.now(),
          },
        },
        handLog: [
          {
            t: Date.now(),
            ranks: [10, 6],
            up: 10,
            chosen: 'stand',
            recommended: 'hit',
            correct: false,
            evLoss: 0.12,
            mode: 'practice',
          },
        ],
      })
    );
    render(<App />);
    fireEvent.click(screen.getByText('History'));
    expect(screen.getByText('hard 16 vs 10')).toBeTruthy();
    expect(screen.getByText('Drill these weak spots')).toBeTruthy();
    expect(screen.getByText('10,6 vs 10')).toBeTruthy();
  });

  it('plays counting mode with a live Hi-Lo count HUD', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('Card Counting'));
    await waitFor(() => expect(screen.getByText('PLACE YOUR BET')).toBeTruthy(), {
      timeout: 30000,
    });

    // Fresh shoe: running count zero, full shoe on the rack.
    expect(screen.getByText('RC').parentElement!.textContent).toContain('+0');
    expect(screen.getByText('TC').parentElement!.textContent).toContain('+0.0');
    expect(screen.getByText('Decks left').parentElement!.textContent).toContain('8.0');

    fireEvent.click(screen.getByText('DEAL'));
    // Cards are on the felt; the count HUD reflects them (any value is fine,
    // but decks remaining must have dropped below a full 8-deck shoe).
    const decks = screen.getByText('Decks left').parentElement!.textContent!;
    expect(decks).not.toContain('8.0');

    // The count can be hidden to practice keeping it yourself.
    fireEvent.click(screen.getByText(/Hide count/));
    expect(screen.queryByText('RC')).toBeNull();
  });

  it('shows a friendly offline notice on the leaderboard without a server', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('Leaderboard'));
    await waitFor(() => expect(screen.getByText(/leaderboard server is unreachable/i)).toBeTruthy(), {
      timeout: 10000,
    });
  });

  it('shows the tip jar with a configuration note when no addresses are set', () => {
    render(<App />);
    fireEvent.click(screen.getByText('♥ Support'));
    expect(screen.getByText('Support Perfect 21')).toBeTruthy();
    expect(screen.getByText(/No tip addresses are configured/i)).toBeTruthy();
  });

  it('gates the admin panel behind a token via #admin', async () => {
    window.location.hash = '#admin';
    render(<App />);
    expect(screen.getByPlaceholderText('Admin token')).toBeTruthy();
    window.location.hash = '';
  });

  it('shows the strategy chart for the active rules', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('Strategy chart'));
    await waitFor(() => expect(screen.getByText('Hard totals')).toBeTruthy(), { timeout: 30000 });
    expect(screen.getByText('Soft totals')).toBeTruthy();
    expect(screen.getByText('Pairs')).toBeTruthy();
  });
});
