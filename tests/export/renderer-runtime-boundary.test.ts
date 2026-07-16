import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

describe('renderer runtime build boundary', () => {
  it('rebuilds @openmaic/renderer before normal root dev and build entry points', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts['build:workspace']).toContain('pnpm --filter @openmaic/dsl build');
    expect(pkg.scripts['build:workspace']).toContain('pnpm --filter @openmaic/renderer build');
    expect(pkg.scripts['build:workspace:runtime']).toContain('pnpm --filter @openmaic/dsl build');
    expect(pkg.scripts['build:workspace:runtime']).toContain(
      'pnpm --filter @openmaic/renderer build:runtime',
    );
    expect(pkg.scripts.dev).toMatch(/^pnpm run build:workspace:runtime && next dev$/);
    expect(pkg.scripts.build).toMatch(
      /^pnpm run build:workspace && node scripts\/assert-vendor-maic-importer\.mjs && next build$/,
    );

    const rendererPkg = JSON.parse(
      readFileSync(join(repoRoot, 'packages/@openmaic/renderer/package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(rendererPkg.scripts['build:runtime']).toBe(
      'node scripts/generate-fonts-css.mjs && node scripts/build-rollup.mjs && tsc --emitDeclarationOnly --declarationDir dist',
    );
  });

  it('exposes the static spotlight implementation through the public renderer package output', async () => {
    const resolvedSnapshot = await import.meta.resolve('@openmaic/renderer/snapshot');
    expect(resolvedSnapshot).toContain('/packages/@openmaic/renderer/dist/snapshot/index.js');

    const distRoot = join(repoRoot, 'packages/@openmaic/renderer/dist');
    const jsFiles = collectJsFiles(distRoot);
    const spotlightChunks = jsFiles
      .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
      .filter(({ source }) => source.includes('data-openmaic-static-spotlight'));

    expect(spotlightChunks.length).toBeGreaterThan(0);
    expect(
      spotlightChunks.some(({ source }) => source.includes('data-openmaic-static-spotlight-dim')),
    ).toBe(true);
    expect(
      spotlightChunks.some(({ source }) => source.includes('getStaticSpotlightDimRects')),
    ).toBe(true);
    expect(
      spotlightChunks.some(({ source }) => source.includes('getStaticSpotlightFocusRect')),
    ).toBe(true);
    expect(spotlightChunks.some(({ source }) => source.includes('9999px'))).toBe(false);
  });
});

function collectJsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectJsFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith('.js')) return [fullPath];
    return [];
  });
}
