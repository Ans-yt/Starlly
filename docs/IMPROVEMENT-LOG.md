# Starlly improvement log

One entry per improvement cycle. Each entry: what was measured, what failed,
what was fixed, how it was verified. Nothing is claimed that wasn't tested.

## Cycle 1 — setup gate latch + one-screen dashboard (2026-10-09)

**Measured** (`npm run build`, server Vitest, Playwright 7 specs at 1280x720,
1440x900, 1920x1080):

- FAIL `visual.spec.ts:69` — after login + `POST /api/data/delete`, the app
  showed the onboarding loading screen instead of the dashboard.
- FAIL (honest check added) — the dashboard scrolled internally at every
  viewport; the funnel and bottom nudges were below the fold at 720p.

**Fixed (test first)**

1. **Gate reopened after Delete-my-data.** `/api/setup/status` recomputed
   `evaluateSetup` from the wiped profile and ignored the `setupCompletedAt`
   latch (only the 503 middleware OR-ed it). Regression test added
   (`server/tests/integration.test.ts`: complete gate → delete → status must
   still report `setupComplete: true`); fix in `server/src/http/routes/setup.ts`:
   the latch now wins, `blocked` is cleared once latched. All 131 server tests
   pass.
2. **One-screen layout is now honest.** `visual.spec.ts` asserts `.main` has no
   inner scroll at all three viewports (previously only the document height was
   checked — a dishonest pass). CSS restructure: the overview is height-bound at
   every viewport (`.main:has(#view-overview)` flex column, dashboard rows use
   fractional minmax), long lists scroll INSIDE their cards (D2), and two
   compression tiers (≤940px, ≤760px) shrink topbar/page-head/hero/chart chrome.
   Verified by probe + Playwright: overflow 0px at 1280x720, 1440x900,
   1920x1080.

**Evidence**: `web/screenshots/dashboard-{1280x720,1440x900,1920x1080}.png`.
7/7 Playwright specs, 131/131 server tests, build clean.
