import { afterEach, describe, expect, it, vi } from 'vitest';

const originalRenderServiceUrl = process.env.RENDER_SERVICE_URL;

afterEach(() => {
  if (originalRenderServiceUrl == null) {
    delete process.env.RENDER_SERVICE_URL;
  } else {
    process.env.RENDER_SERVICE_URL = originalRenderServiceUrl;
  }
  vi.resetModules();
  vi.clearAllMocks();
});

describe('official render-service configuration', () => {
  it('keeps MP4 rendering unavailable when RENDER_SERVICE_URL is unset', async () => {
    delete process.env.RENDER_SERVICE_URL;

    const service = await import('@/lib/server/render-service');

    expect(service.getRenderServiceUrl()).toBeNull();
    expect(service.resolveRenderServiceUrl()).toEqual({ error: 'not_configured' });
    await expect(service.checkRenderServiceHealth()).resolves.toBe(false);
  });

  it('trims configured render-service URLs and probes health', async () => {
    process.env.RENDER_SERVICE_URL = ' http://127.0.0.1:9000/// ';
    const proxyFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock('@/lib/server/proxy-fetch', () => ({ proxyFetch }));

    const service = await import('@/lib/server/render-service');

    expect(service.getRenderServiceUrl()).toBe('http://127.0.0.1:9000');
    expect(service.resolveRenderServiceUrl()).toEqual({ url: 'http://127.0.0.1:9000' });
    await expect(service.checkRenderServiceHealth()).resolves.toBe(true);
    expect(proxyFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9000/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
