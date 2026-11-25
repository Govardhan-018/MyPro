import { describe, it, expect } from 'vitest';
import { normalizeRenderBase } from '../src/config/env';

/**
 * Scheduled emails failed with "Render refused the send (404)": render.yaml
 * fills RENDER_API_URL from the core's bare host, but every core route lives
 * under /api/v1. Any of these forms must reach the same API root.
 */
describe('normalizeRenderBase', () => {
  const root = 'https://mypro-km2k.onrender.com/api/v1';
  it.each([
    'https://mypro-km2k.onrender.com',
    'https://mypro-km2k.onrender.com/',
    'mypro-km2k.onrender.com',
    'https://mypro-km2k.onrender.com/api/v1',
    'https://mypro-km2k.onrender.com/api/v1/',
    '  https://mypro-km2k.onrender.com/API/V1  ',
  ])('%s → the /api/v1 root', (raw) => {
    expect(normalizeRenderBase(raw)?.toLowerCase()).toBe(root.toLowerCase());
  });
  it('unset stays unset', () => {
    expect(normalizeRenderBase('')).toBeNull();
    expect(normalizeRenderBase(undefined)).toBeNull();
  });
});
