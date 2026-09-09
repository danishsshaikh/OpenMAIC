import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandConfig } from '@/lib/branding/brand-config';

describe('MIT ADT brand config', () => {
  it('centralizes the temporary product name and institution identity', () => {
    expect(brandConfig.productName).toBe('MIT ADT Teaching AI');
    expect(brandConfig.institutionFullName).toBe('MIT Art, Design and Technology University');
    expect(brandConfig.productDescription).toContain('faculty-facing');
  });

  it('wires major visible product identity through the brand layer', () => {
    const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');
    const authShell = readFileSync(join(process.cwd(), 'components/auth/auth-shell.tsx'), 'utf8');
    const home = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8');
    const sidebar = readFileSync(join(process.cwd(), 'components/stage/scene-sidebar.tsx'), 'utf8');

    expect(layout).toContain('brandConfig.productName');
    expect(authShell).toContain('BrandWordmark');
    expect(home).toContain('BrandWordmark');
    expect(sidebar).toContain('BrandWordmark');
  });

  it('keeps OpenMAIC attribution available', () => {
    expect(brandConfig.openSource.attribution).toContain('OpenMAIC by THU-MAIC');
    expect(brandConfig.openSource.endorsementCaveat).toContain('does not imply endorsement');
  });
});
