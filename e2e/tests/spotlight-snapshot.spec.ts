import { test, expect } from '../fixtures/base';

test.describe('renderer snapshot effects', () => {
  test('static spotlight keeps the target brighter than the dimmed slide', async ({ page }) => {
    await page.goto('/eval/spotlight-snapshot');
    await page.waitForFunction(() => window.__spotlightSnapshotReady === true);

    const result = await page.evaluate(async () => {
      if (!window.__renderSpotlightSnapshot) {
        throw new Error('spotlight snapshot helper is unavailable');
      }
      return await window.__renderSpotlightSnapshot();
    });

    expect(result.dataUrlLength).toBeGreaterThan(1000);
    expect(result.target.a).toBe(255);
    expect(result.outside.a).toBe(255);
    expect(result.target.luminance).toBeGreaterThan(result.outside.luminance + 120);
    expect(result.target.r).toBeGreaterThan(230);
    expect(result.target.g).toBeGreaterThan(230);
    expect(result.target.b).toBeGreaterThan(230);
    expect(result.outside.r).toBeLessThan(120);
    expect(result.outside.g).toBeLessThan(120);
    expect(result.outside.b).toBeLessThan(120);
  });
});
