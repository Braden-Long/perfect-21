// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminScreen } from '../src/components/AdminScreen';

/**
 * Admin panel against a mocked server: token gate, overview + player table,
 * ban, and the two-step delete (which must never use window.confirm — the
 * app has no native dialogs).
 */

const overview = {
  players: 2,
  banned: 1,
  activeToday: 2,
  decisions: 255,
  accuracy: 0.906,
  rounds: 130,
  net: 2.5,
};

const players = [
  {
    id: 'id-ace',
    name: 'Ace Counter',
    tier: { name: 'Gold', color: '#ffd700' },
    rollingAccuracy: 0.95,
    decisions: 180,
    bestStreak: 34,
    rounds: 90,
    banned: false,
    rulesKey: '8d-s17-all-das1-none-peek1',
    createdAt: 1752900000000,
    updatedAt: 1752990000000,
    email: 'ace@example.com',
    net: 4.5,
    countingTier: { name: 'Silver', color: '#c0c0c0' },
    countingDecisions: 120,
  },
  {
    id: 'id-beta',
    name: 'Beta Tester',
    tier: { name: 'Bronze', color: '#cd7f32' },
    rollingAccuracy: 0.8,
    decisions: 75,
    bestStreak: 9,
    rounds: 40,
    banned: true,
    rulesKey: '8d-s17-all-das1-none-peek1',
    createdAt: 1752900000000,
    updatedAt: 1752990000000,
    email: null,
    net: -2,
    countingTier: null,
    countingDecisions: 0,
  },
];

/** fetch mock: 401 unless the Bearer token matches; records mutation calls. */
function mockServer(token = 'good-token') {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const auth = new Headers(init?.headers).get('authorization');
    calls.push({ url: u, method: init?.method ?? 'GET' });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status });
    if (auth !== `Bearer ${token}`) return json(401, { error: 'bad admin token' });
    if (u.endsWith('/api/admin/overview')) return json(200, overview);
    if (u.endsWith('/api/admin/players')) return json(200, { players });
    if (u.includes('/ban')) return json(200, { updated: true });
    if (init?.method === 'DELETE') return json(200, { deleted: true });
    return json(404, { error: 'nope' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

async function unlock() {
  fireEvent.change(screen.getByPlaceholderText('Admin token'), {
    target: { value: 'good-token' },
  });
  fireEvent.click(screen.getByText('Unlock'));
  await waitFor(() => expect(screen.getByText('Admin panel')).toBeTruthy());
}

describe('Admin panel', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('gates on the token and rejects a bad one', async () => {
    mockServer();
    render(<AdminScreen onBack={() => {}} />);
    expect(screen.getByPlaceholderText('Admin token')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Admin token'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByText('Unlock'));
    await waitFor(() => expect(screen.getByText('Bad admin token.')).toBeTruthy());
  });

  it('unlocks with the right token and shows overview + players', async () => {
    mockServer();
    render(<AdminScreen onBack={() => {}} />);
    await unlock();
    expect(screen.getByText('Community accuracy')).toBeTruthy();
    expect(screen.getByText('90.6%')).toBeTruthy();
    expect(screen.getByText('Community net')).toBeTruthy();
    expect(screen.getByText('Ace Counter')).toBeTruthy();
    expect(screen.getByText('ace@example.com')).toBeTruthy();
    expect(screen.getByText('Silver · 120')).toBeTruthy(); // counting column
    expect(screen.getByText('Unban')).toBeTruthy(); // banned row
  });

  it('bans via POST to the ban endpoint', async () => {
    const calls = mockServer();
    render(<AdminScreen onBack={() => {}} />);
    await unlock();
    fireEvent.click(screen.getByText('Ban'));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith('/api/admin/players/id-ace/ban') && c.method === 'POST')
      ).toBe(true)
    );
  });

  it('deletes only after the inline two-step confirm (no window.confirm)', async () => {
    const calls = mockServer();
    render(<AdminScreen onBack={() => {}} />);
    await unlock();
    const deletes = () => calls.filter((c) => c.method === 'DELETE');
    fireEvent.click(screen.getAllByText('Delete')[0]);
    expect(deletes()).toHaveLength(0); // armed, not fired
    fireEvent.click(screen.getByText('Confirm?'));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].url.endsWith('/api/admin/players/id-ace')).toBe(true);
  });

  it('filters players by name or email', async () => {
    mockServer();
    render(<AdminScreen onBack={() => {}} />);
    await unlock();
    fireEvent.change(screen.getByPlaceholderText('Filter by name or email…'), {
      target: { value: 'ace@' },
    });
    expect(screen.getByText('Ace Counter')).toBeTruthy();
    expect(screen.queryByText('Beta Tester')).toBeNull();
  });
});
