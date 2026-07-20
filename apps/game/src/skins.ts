/**
 * Deck skins — cosmetic thank-yous for tips, unlocked by cumulative donation
 * goals (see the server's /api/players/:id/donations). Chips, odds, grading
 * and every game mechanic are untouched by skins, by design.
 *
 * Every skin is a PAIR of decks: reshuffles alternate two physical decks at a
 * real table, so each skin styles both the base deck and its `scene--reddeck`
 * opposite (see styles.css `.skin-*`).
 */

export interface DeckSkin {
  id: string;
  name: string;
  /** Cumulative tips (USD) that unlock it; 0 = always available. */
  goalUsd: number;
  /** One-liner shown in the picker. */
  blurb: string;
}

export const DECK_SKINS: DeckSkin[] = [
  {
    id: 'classic',
    name: 'House Classic',
    goalUsd: 0,
    blurb: 'The standard house decks — casino blue and casino red.',
  },
  {
    id: 'retro',
    name: 'Retro Diner',
    goalUsd: 2,
    blurb: 'Cream faces and sunset stripes; the pair swaps to cool 50s teal.',
  },
  {
    id: 'neon',
    name: 'Neon Nights',
    goalUsd: 4,
    blurb: 'Black cards, synthwave grid backs — magenta deck, cyan deck.',
  },
  {
    id: 'deco',
    name: 'Art Deco',
    goalUsd: 6,
    blurb: 'Ivory faces with gold fan backs, on emerald or on wine.',
  },
  {
    id: 'holo',
    name: 'Holo Foil',
    goalUsd: 8,
    blurb: 'Iridescent foil backs — one deck on obsidian, its twin on silver.',
  },
  {
    id: 'midnight',
    name: 'Midnight Sky',
    goalUsd: 10,
    blurb: 'A starfield after dusk and its dawn-burgundy opposite.',
  },
];

export function skinById(id: string | undefined): DeckSkin {
  return DECK_SKINS.find((s) => s.id === id) ?? DECK_SKINS[0];
}

export function skinUnlocked(skin: DeckSkin, donatedUsd: number): boolean {
  return donatedUsd >= skin.goalUsd;
}

/** The CSS class applied to the table scene ('' for the classic decks). */
export function skinClass(id: string | undefined): string {
  const skin = skinById(id);
  return skin.id === 'classic' ? '' : `skin-${skin.id}`;
}
