import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The production server serves the client with a strict CSP (`CSP` in
 * apps/server/src/app.ts): every resource must be self-hosted. The Vite dev
 * server does NOT send that policy, so an external font/image/stylesheet
 * added to the client works in dev and breaks only in production. This scan
 * catches that divergence at test time.
 *
 * Scope: HTML resource attributes and CSS url()/@import — the realistic
 * accidental additions. JS is not scanned: bundled string literals include
 * legitimate external *navigation* links (e.g. blackjackinfo.com), which CSP
 * resource directives don't govern, and telling a fetch apart from a link
 * statically isn't worth the false positives.
 */
const dist = join(__dirname, '../dist');

describe.skipIf(!existsSync(dist))('built bundle vs production CSP', () => {
  it('index.html loads no external resources', () => {
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    // src/href attributes pointing at another origin (protocol-relative too).
    const external = [...html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+["']/gi)];
    expect(external.map((m) => m[0])).toEqual([]);
  });

  it('built CSS references no external urls or imports', () => {
    const assets = join(dist, 'assets');
    const cssFiles = readdirSync(assets).filter((f) => f.endsWith('.css'));
    expect(cssFiles.length).toBeGreaterThan(0);
    for (const f of cssFiles) {
      const css = readFileSync(join(assets, f), 'utf8');
      expect(css).not.toMatch(/url\(\s*["']?\s*(https?:)?\/\//i);
      expect(css).not.toMatch(/@import/i);
    }
  });
});
