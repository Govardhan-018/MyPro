import { describe, it, expect, beforeEach } from 'vitest';
import { forgetRenderApiBase, resolveRenderApiBase } from '../src/common/render-api';

/**
 * The agent calls the core at the address the core announced for itself
 * (node_status, node = 'render'), not a hand-set RENDER_API_URL — a wrong host
 * there made every scheduled email fail with a 404 from Render's edge.
 */
function admin(detail: unknown) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: detail === undefined ? null : { detail } }) }) }),
    }),
  } as never;
}

describe('resolveRenderApiBase', () => {
  beforeEach(() => forgetRenderApiBase());

  it('uses the address the core announced', async () => {
    expect(await resolveRenderApiBase(admin({ api_url: 'https://mypro-km2k.onrender.com/api/v1' }))).toBe(
      'https://mypro-km2k.onrender.com/api/v1',
    );
  });

  it('normalises an announced origin without the prefix', async () => {
    expect(await resolveRenderApiBase(admin({ api_url: 'https://mypro-km2k.onrender.com' }))).toBe(
      'https://mypro-km2k.onrender.com/api/v1',
    );
  });
});
