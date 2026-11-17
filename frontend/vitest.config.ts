import { defineConfig } from 'vitest/config';

// `dateKeyOf` converts a UTC instant into the viewer's local day, so the suite
// must run in a known zone or the timed case is non-deterministic. Setting TZ
// here (before the worker processes fork) pins it; `pool: 'forks'` guarantees
// each worker is a fresh process that reads TZ at startup.
process.env.TZ = 'America/New_York';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // `node`, not `jsdom`: the logic under test is pure date maths and its
    // import graph touches the DOM only inside try/catch closures, never at
    // load. Avoiding jsdom also avoids the undici it drags in. `pool: 'forks'`
    // keeps the pinned TZ above honest (a fresh process per worker).
    environment: 'node',
    pool: 'forks',
  },
});
