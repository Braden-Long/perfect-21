// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';

/** Boots the real app in jsdom and plays through a practice hand. */
describe('Perfect 21 app', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it('renders the lobby with all three modes', () => {
    render(<App />);
    expect(screen.getByText('PERFECT')).toBeTruthy();
    expect(screen.getByText('Practice')).toBeTruthy();
    expect(screen.getByText('Competitive')).toBeTruthy();
    expect(screen.getByText('Endless')).toBeTruthy();
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

  it('plays a practice hand end to end with graded feedback', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('Practice'));

    // Strategy tables build, then the first round is dealt.
    await waitFor(() => expect(screen.getByText('DEALER')).toBeTruthy(), { timeout: 30000 });

    // Play decisions until the round settles (deal button appears).
    for (let i = 0; i < 12; i++) {
      const stand = screen.queryByText('Stand');
      const hit = screen.queryByText('Hit');
      if (!stand && !hit) break;
      fireEvent.click(stand ?? hit!);
      // Every decision must produce graded feedback.
      expect(screen.getByText(/Basic strategy:/)).toBeTruthy();
    }
    await waitFor(() => expect(screen.getByText('DEAL')).toBeTruthy(), { timeout: 5000 });

    // Session stats recorded the round.
    expect(screen.getByText('Hands').parentElement!.textContent).toContain('1');

    // Deal another round to prove the loop continues.
    fireEvent.click(screen.getByText('DEAL'));
    await waitFor(
      () => expect(screen.queryByText('Stand') ?? screen.queryByText('DEAL')).toBeTruthy(),
      { timeout: 5000 }
    );
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
