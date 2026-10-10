// Loading intro: Ask, Understand and Act arrive in their own responsive slots.
// The video keeps its four-second opening; entrance uses compositor animations
// rather than reading card geometry on every frame. Controls keep their behavior.
import * as React from "react";

export interface IntroItem {
  title: string;
  body: string;
  /** Icon name from the app's inline sprite (#i-<name> in index.html). */
  icon: string;
}

const VIDEO_ONLY_MS = 4000;
const GAP = 180;
const ENTRANCE_MS = 760;
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

  // Keep the opening video, then reveal the cards once per mount.
  React.useEffect(() => {
    if (reduced) {
      setPhase("ready");
      return;
    }
    if (phase !== "video") return;
    const timer = window.setTimeout(() => setPhase("cards"), VIDEO_ONLY_MS);
    return () => window.clearTimeout(timer);
  }, [reduced, phase]);

  // Each card moves within its own layout slot, so paths never cross.
  // Native animations handle the stagger without a JS loop or layout reads.
  React.useEffect(() => {
    if (phase !== "cards" || reduced) return;
    let cancelled = false;
    const animations = cardRefs.current.slice(0, count).flatMap((card, index) => {
      if (!card) return [];
      return [card.animate([
        { opacity: 0, transform: "translate3d(0, 14px, 0) scale(.97)" },
        { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
      ], {
        duration: ENTRANCE_MS,
        delay: index * GAP,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "both",
      })];
    });
    void Promise.all(animations.map(animation => animation.finished))
      .then(() => { if (!cancelled) setPhase("ready"); })
      .catch(() => { /* Cancellation on unmount or reduced-motion change. */ });
    return () => {
      cancelled = true;
      animations.forEach(animation => animation.cancel());
    };
  }, [phase, reduced, count]);

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
      <div className="intro-logo-chip">{logo}</div>
      <h1 className="intro-headline">{headline}</h1>

      <div
        className="intro-stage"
        tabIndex={0}
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
