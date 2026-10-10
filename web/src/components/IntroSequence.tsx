// IntroSequence — the loading screen's card show (pass A of the owner's spec).
//
// Timeline: 0–4 s video only (the sequence renders nothing but stays mounted);
// at 4 s the three cards (Ask, Understand, Act) fly in one after another
// (450 ms apart) along the path from the owner's sketch — enter upper-left,
// sweep right, curve down, loop the bottom-centre hook — then settle into
// three resting slots; after they settle the headline, dots and Start button
// fade in and the cards start cycling (one focused, others recede).
//
// Text never rotates: only translate/scale/opacity animate, and the flight
// places whole cards (the glass panel with the text inside moves rigidly).
import * as React from "react";

export interface IntroItem {
  title: string;
  body: string;
  /** Icon name from the app's inline sprite (#i-<name> in index.html). */
  icon: string;
}

// Path and resting slots in the owner's sketch space (1040 x 490), scaled to
// the live stage size.
const REF = { w: 1040, h: 490 };
const PATH_D =
  "M5 98 C120 96 240 120 300 145 C335 165 340 215 335 238 C315 270 305 320 315 345 C335 375 380 392 425 378 C455 365 460 335 445 322";
const SLOTS = [
  { x: 522, y: 150 },
  { x: 420, y: 278 },
  { x: 610, y: 265 },
];

const VIDEO_ONLY_MS = 4000; // I1: nothing but the video for the first 4 s
const GAP = 450; // I2: cards arrive 450 ms apart
const FLIGHT_T = 2600; // flight duration per card
const AUTO_MS = 5000; // I3: auto-advance every 5 s
const IDLE_MS = 8000; // I3: resume 8 s after the last interaction
const SWIPE_PX = 40; // I4: touch-swipe threshold

type Phase = "video" | "cards" | "ready";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export function IntroSequence({
  items,
  headline,
  logo,
  buttonLabel,
  onStart,
}: {
  items: IntroItem[];
  headline: string;
  logo: React.ReactNode;
  buttonLabel: string;
  onStart: () => void;
}) {
  const count = items.length;
  const [reduced, setReduced] = React.useState(prefersReducedMotion);
  const [phase, setPhase] = React.useState<Phase>(() => (prefersReducedMotion() ? "ready" : "video"));
  const [active, setActive] = React.useState(0);

  const stageRef = React.useRef<HTMLDivElement>(null);
  const pathRef = React.useRef<SVGPathElement>(null);
  const cardRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const activeRef = React.useRef(0);
  const advanceTimer = React.useRef<number | undefined>(undefined);
  const idleTimer = React.useRef<number | undefined>(undefined);
  const pausedRef = React.useRef(false);
  const swipeStart = React.useRef<{ x: number; y: number } | null>(null);
  const swiped = React.useRef(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  // I1 → I2: video-only, then the cards mount and fly.
  React.useEffect(() => {
    if (reduced) {
      setPhase("ready");
      return;
    }
    const t = window.setTimeout(() => setPhase("cards"), VIDEO_ONLY_MS);
    return () => window.clearTimeout(t);
  }, [reduced]);

  const placeAtSlots = React.useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const sx = stage.clientWidth / REF.w;
    const sy = stage.clientHeight / REF.h;
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const slot = SLOTS[i] ?? SLOTS[SLOTS.length - 1];
      el.style.transform = `translate(${slot.x * sx - el.offsetWidth / 2}px, ${slot.y * sy - el.offsetHeight / 2}px)`;
    });
  }, []);

  // I2: the flight (adapted from the owner's flyCards). Cancels cleanly if the
  // user clicks Start mid-flight.
  React.useEffect(() => {
    if (phase !== "cards" || reduced) return;
    const stage = stageRef.current;
    const path = pathRef.current;
    if (!stage || !path) return;
    let len = 0;
    try {
      len = path.getTotalLength();
    } catch {
      len = 0;
    }
    const sx = stage.clientWidth / REF.w;
    const sy = stage.clientHeight / REF.h;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const place = (el: HTMLElement, x: number, y: number) =>
      (el.style.transform = `translate(${x * sx - el.offsetWidth / 2}px, ${y * sy - el.offsetHeight / 2}px)`);
    const start = performance.now();
    let raf = 0;
    let cancelled = false;
    const frame = (now: number) => {
      if (cancelled) return;
      let done = true;
      cardRefs.current.forEach((el, i) => {
        if (!el) return;
        const t = Math.min(Math.max((now - start - i * GAP) / FLIGHT_T, 0), 1);
        el.style.opacity = t > 0 ? "1" : "0";
        const e = ease(t);
        if (len > 0) {
          if (e < 0.85) {
            const pt = path.getPointAtLength((e / 0.85) * len);
            place(el, pt.x, pt.y);
          } else {
            // last 15%: glide from the path end to the resting slot
            const end = path.getPointAtLength(len);
            const k = (e - 0.85) / 0.15;
            place(el, end.x + (SLOTS[i].x - end.x) * k, end.y + (SLOTS[i].y - end.y) * k);
          }
        } else {
          place(el, SLOTS[i].x, SLOTS[i].y);
        }
        if (t < 1) done = false;
      });
      if (done) {
        setPhase("ready");
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [phase, reduced]);

  // Keep the resting slots pinned to the scaled sketch coordinates on resize.
  React.useEffect(() => {
    if (phase !== "ready") return;
    placeAtSlots();
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => placeAtSlots());
    ro.observe(stage);
    return () => ro.disconnect();
  }, [phase, placeAtSlots]);

  // I3: focus cycling.
  const go = React.useCallback(
    (i: number) => {
      const n = ((i % count) + count) % count;
      activeRef.current = n;
      setActive(n);
    },
    [count],
  );

  const arm = React.useCallback(() => {
    window.clearInterval(advanceTimer.current);
    if (pausedRef.current || reduced) return;
    advanceTimer.current = window.setInterval(() => go(activeRef.current + 1), AUTO_MS);
  }, [go, reduced]);

  const pause = React.useCallback(() => {
    pausedRef.current = true;
    window.clearInterval(advanceTimer.current);
  }, []);

  // Resume only after IDLE_MS of no interaction (hover leave, blur, tab visible).
  const scheduleResume = React.useCallback(() => {
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      pausedRef.current = false;
      arm();
    }, IDLE_MS);
  }, [arm]);

  React.useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) pause();
      else scheduleResume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(advanceTimer.current);
      window.clearTimeout(idleTimer.current);
    };
  }, [pause, scheduleResume]);

  // Start cycling once the cards have settled (not under reduced motion).
  React.useEffect(() => {
    if (phase !== "ready" || reduced) return;
    pausedRef.current = false;
    arm();
    return () => window.clearInterval(advanceTimer.current);
  }, [phase, reduced, arm]);

  const next = React.useCallback(() => {
    go(activeRef.current + 1);
    arm();
  }, [go, arm]);
  const prev = React.useCallback(() => {
    go(activeRef.current - 1);
    arm();
  }, [go, arm]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      prev();
    }
  };

  const onPointerDown = (event: React.PointerEvent) => {
    swipeStart.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      swiped.current = true; // swallow the click that follows a swipe
      window.setTimeout(() => {
        swiped.current = false;
      }, 150);
      if (dx < 0) next();
      else prev();
    }
  };

  const onCardClick = (i: number) => {
    if (swiped.current) return;
    if (i !== activeRef.current) {
      go(i);
      arm();
    }
  };

  return (
    <div
      className="intro-sequence"
      data-phase={phase}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onFocus={pause}
      onBlur={scheduleResume}
    >
      {/* measurement-only copy of the sketch path (geometry APIs need a live element) */}
      <svg className="intro-path" aria-hidden="true" focusable="false">
        <path ref={pathRef} d={PATH_D} fill="none" stroke="none" />
      </svg>

      <div className="intro-logo-chip">{logo}</div>
      <h1 className="intro-headline">{headline}</h1>

      <div
        className="intro-stage"
        ref={stageRef}
        role="listbox"
        aria-label="What Starlly does"
        onPointerEnter={pause}
        onPointerLeave={scheduleResume}
      >
        {phase !== "video" &&
          items.map((item, i) => (
            <div
              key={item.title}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              id={`intro-card-${i}`}
              role="option"
              aria-selected={i === active}
              className={`intro-card${phase === "ready" ? (i === active ? " is-active" : " is-receding") : ""}`}
              onClick={() => onCardClick(i)}
            >
              <div className="intro-card-inner">
                <svg className="icon intro-card-icon" aria-hidden="true">
                  <use href={`#i-${item.icon}`} />
                </svg>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </div>
            </div>
          ))}
      </div>

      <div className="intro-controls" onPointerEnter={pause} onPointerLeave={scheduleResume}>
        <button type="button" className="intro-arrow" aria-label="Previous card" onClick={prev}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="intro-dots">
          {items.map((item, i) => (
            <button
              key={item.title}
              type="button"
              className="intro-dot"
              aria-current={i === active ? "true" : "false"}
              aria-label={`Show card ${i + 1}: ${item.title}`}
              onClick={() => {
                go(i);
                arm();
              }}
            />
          ))}
        </div>
        <button type="button" className="intro-arrow" aria-label="Next card" onClick={next}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <button type="button" className="loading-start" onClick={onStart}>
        {buttonLabel}
        <svg className="intro-start-arrow" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h14M13 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
