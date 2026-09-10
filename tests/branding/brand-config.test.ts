import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandConfig } from '@/lib/branding/brand-config';

describe('MIT ADT brand config', () => {
  it('centralizes the Sahaya product name and institution identity', () => {
    expect(brandConfig.productName).toBe('Sahaya');
    expect(brandConfig.shortName).toBe('Sahaya');
    expect(brandConfig.productDescriptor).toBe('AI Teaching Studio');
    expect(brandConfig.institutionFullName).toBe('MIT Art, Design and Technology University');
    expect(brandConfig.productDescription).toContain('AI Teaching Studio');
    expect(brandConfig.visualIdentity.palette.primary).toBe('#5B1FA8');
    expect(brandConfig.visualIdentity.palette.secondary).toBe('#C02672');
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

  it('records dome product asset provenance', () => {
    const mark = readFileSync(join(process.cwd(), 'public/branding/sahaya-mark.svg'), 'utf8');
    expect(mark).toContain('Dome of the Rock');
    expect(mark).toContain('https://www.svgrepo.com/svg/82472/dome-of-the-rock');
    expect(mark).toContain('License: CC0');
    expect(mark).toContain('generic dome motif');
    expect(mark).toContain('not an official depiction');
  });

  it('keeps OpenMAIC attribution available', () => {
    expect(brandConfig.openSource.attribution).toContain('OpenMAIC by THU-MAIC');
    expect(brandConfig.openSource.endorsementCaveat).toContain('does not imply endorsement');
  });
});
