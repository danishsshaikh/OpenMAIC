import { test, expect } from '../fixtures/base';

test.describe('renderer snapshot effects', () => {
  test('static spotlight keeps the target brighter than the dimmed slide', async ({
    page,
  }, testInfo) => {
    await page.goto('/eval/spotlight-snapshot');
    await page.waitForFunction(() => window.__spotlightSnapshotReady === true);

    const result = await page.evaluate(async () => {
      if (!window.__renderSpotlightSnapshot) {
        throw new Error('spotlight snapshot helper is unavailable');
      }
      return await window.__renderSpotlightSnapshot();
    });

    expect(result.dataUrlLength).toBeGreaterThan(1000);
    expect(result.base.width).toBe(400);
    expect(result.base.height).toBe(225);
    expect(result.spotlight.width).toBe(400);
    expect(result.spotlight.height).toBe(225);
    expect(result.spotlightAtOrigin.width).toBe(400);
    expect(result.spotlightFarOffset.width).toBe(400);

    await testInfo.attach('base-slide.png', {
      body: dataUrlToBuffer(result.base.dataUrl),
      contentType: 'image/png',
    });
    await testInfo.attach('spotlight-slide.png', {
      body: dataUrlToBuffer(result.spotlight.dataUrl),
      contentType: 'image/png',
    });

    for (const sample of [
      ...result.base.targetSamples,
      ...result.base.lowerTargetSamples,
      ...result.base.dimmedCardSamples,
      ...result.base.outsideSamples,
    ]) {
      expect(sample.a).toBe(255);
      expect(sample.luminance).toBeGreaterThan(220);
    }
    for (const sample of [
      ...result.spotlight.targetSamples,
      ...result.spotlight.lowerTargetSamples,
      ...result.spotlight.dimmedCardSamples,
      ...result.spotlight.outsideSamples,
    ]) {
      expect(sample.a).toBe(255);
    }
    for (const sample of result.spotlight.focusEdgeSamples) {
      expect(sample.a).toBe(255);
      expect(sample.luminance).toBeGreaterThan(220);
    }

    expect(result.spotlight.targetLuminance).toBeGreaterThan(result.base.targetLuminance - 12);
    expect(result.spotlight.lowerTargetLuminance).toBeGreaterThan(
      result.base.lowerTargetLuminance - 12,
    );
    expect(result.spotlight.focusEdgeLuminance).toBeGreaterThan(result.base.targetLuminance - 12);
    expect(result.spotlight.dimmedCardLuminance).toBeLessThan(result.base.dimmedCardLuminance - 80);
    expect(result.spotlight.outsideLuminance).toBeLessThan(result.base.outsideLuminance - 80);
    const outsideRegions = Object.values(result.spotlight.outsideRegionLuminance);
    expect(Math.max(...outsideRegions) - Math.min(...outsideRegions)).toBeLessThan(10);
    expect(result.spotlight.seamStats.horizontalMaxDelta).toBeLessThan(16);
    expect(result.spotlight.seamStats.verticalMaxDelta).toBeLessThan(16);
    expect(result.mountEquivalenceMaxDelta).toBeLessThan(2);
    expect(result.afterSpotlightBase.dataUrl).toBe(result.base.dataUrl);
    expect(result.spotlight.dataUrl).not.toBe(result.base.dataUrl);
    expect(result.spotlight.targetLuminance).toBeGreaterThan(
      result.spotlight.outsideLuminance + 100,
    );
    expect(result.spotlight.targetLuminance).toBeGreaterThan(200);
    expect(result.spotlight.outsideLuminance).toBeLessThan(170);
  });
});

function dataUrlToBuffer(dataUrl: string): Buffer {
  const [, base64] = dataUrl.split(',');
  return Buffer.from(base64, 'base64');
}
