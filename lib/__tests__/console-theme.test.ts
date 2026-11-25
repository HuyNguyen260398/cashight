import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { consoleTheme } from '../../app/components/console/console-theme';
import { GENERATED_THEME_PATH, renderConsoleThemeCss } from '../../scripts/generate-console-theme';

const root = path.resolve(__dirname, '../..');

describe('console theme', () => {
  it('squares every themeable corner', () => {
    const radiusTokens = Object.entries(consoleTheme.tokens).filter(([name]) => name.startsWith('borderRadius'));
    expect(radiusTokens.length).toBeGreaterThan(20);
    for (const [, value] of radiusTokens) expect(value).toBe('0px');
  });

  it('has an up-to-date generated stylesheet (run `pnpm theme:generate`)', () => {
    const css = renderConsoleThemeCss();
    expect(css).toContain('#121212');
    expect(css).toContain('awsui-dark-mode');
    expect(readFileSync(GENERATED_THEME_PATH, 'utf8')).toBe(css);
  });

  it('overrides container shadow properties that Cloudscape still defines', () => {
    // globals.css overrides Cloudscape-internal custom properties (they are not
    // themeable tokens). If an upgrade renames them, the override silently stops
    // working — fail here instead.
    const baseTheme = readFileSync(
      path.join(root, 'node_modules/@cloudscape-design/components/internal/base-theme/styles.scoped.css'),
      'utf8',
    );
    const globals = readFileSync(path.join(root, 'app/globals.css'), 'utf8');
    const overridden = [...new Set(globals.match(/--shadow-[a-z0-9-]+(?=:)/g) ?? [])];
    expect(overridden.length).toBeGreaterThan(0);
    for (const name of overridden) expect(baseTheme, name).toContain(`${name}:`);
  });
});
