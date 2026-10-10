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

## Cycle 3 — intro screen per the owner's pass-A spec (2026-10-09)

**Measured** (`npx playwright test` against the built bundle, screenshots
eyeballed at every step, all 5 viewports):

- FAIL the pass-A rubric: no video-only phase (the wheel showed immediately),
  no flight, no cycling carousel, no 44px dots/arrows/keyboard/swipe controls,
  the "Starlly" wordmark overlapped the wheel, the sub-line carried approval
  language and a stray "Setup takes about two minutes…" hint, the logo was an
  `<img>` wordmark instead of the inline arc-orbit mark.
- FAIL legibility (found by LOOKING at `intro-5s.png` / `intro-8s.png`): the
  glass cards were near-white on the bright video wordmark — text unreadable.
  Root causes found by computed-style probe: (1) light `rgba(255,255,255,.08)`
  glass over bright letters; (2) mockup.css already styled a light
  `.intro-card` panel, which leaked onto the outer flight card.

**Fixed**

1. **`web/src/components/IntroSequence.tsx` (new)** — exact pass-A timeline:
   0–4 s video only (I1); three cards fly in 450 ms apart along the owner's
   sketch path (SVG `getPointAtLength` in sketch space 1040x490, last 15%
   glides to the resting slots, ease-out cubic) (I2); settle → headline, dots,
   arrows and Start button fade in; cycling carousel (auto-advance 5 s, pause
   on hover/focus/hidden tab, resume after 8 s idle) (I3); controls: prev/next
   arrows, 3 dots on 44px hit areas, ArrowLeft/Right, touch swipe, click a
   receding card to bring it forward (I4). Text never rotates — only
   translate/scale/opacity. Reduced motion (I7): no flight, resting layout
   immediately, no auto-advance, poster frame instead of autoplay video,
   controls still work. WorksWheel deleted.
2. **Legibility over the video (I5)** — dark glass card panels
   (`rgba(20,16,29,.62)` + blur; receding cards nearly opaque), outer card
   reset against mockup.css's old light `.intro-card` rule, focused card
   scale 1.05 vs receding 0.85.
3. **Exact copy + logo (I6, I8)** — headline "Collect more Google reviews.
   Learn from every word of feedback.", the three exact card texts, button
   label "Start setup" / "Continue setup" (partly done) / "Open dashboard"
   (setup complete). Approval language and the two-minutes hint removed. Logo
   is the real `assets/logo-a-arc-orbit.svg` inlined as `LogoMark` (background
   rect removed, ink `currentColor`) inside a 22px-radius glass chip.
4. **New `00-intro.spec.ts` (11 tests)** — frame captures at ~0/3/5/8 s
   (`web/screenshots/intro-*.png`), video-only assertions, controls cycling,
   scrollHeight ≤ clientHeight + no-rotation check at ALL 5 viewports
   (1280x720, 1440x900, 1920x1080, 768x1024, 390x844), exact copy, reduced
   motion. `flows.spec.ts` waits for the settled phase before clicking Start.

**Evidence**: `web/screenshots/intro-{0s,3s,5s,8s}.png` (also
`intro-3s-768x1024.png`, `intro-8s-390x844.png` for the new viewports).
18/18 Playwright tests, 131/131 server tests, build clean, running app serves
the new bundle.
