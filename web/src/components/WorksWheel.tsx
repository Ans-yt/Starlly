// WorksWheel — adapted from the owner's provided TypeScript component (a
// portfolio wheel) into the Starlly loading screen. Three intro cards sit in a
// ring around the wordmark; the first notch of input blows the ring open into a
// vertical drum, exactly like the original. Plain CSS replaces the original's
// utility classes; card faces carry the intro copy instead of cover images.
//
// At rest the work sits in a ring around a title. Turning carries a card round
// to the front (drum state). One number — turn — read by a single rAF pass.
import * as React from "react";

export interface WorksWheelItem {
  title: string;
  body: string;
  /** Icon name from the app sprite (icons.svg symbols). */
  icon: string;
}

export interface WorksWheelProps {
  items: WorksWheelItem[];
  /** Sits in the middle of the ring. */
  label?: string;
  className?: string;
}

// Geometry (tuned against the owner's original constants).
const CARD_H = 0.34; // front card height, of the stage
const CARD_MAX_W = 0.42; // ... but never wider than this much of the stage
const CARD_RATIO = 1.45; // card width / height
const STEP = 40; // degrees between cards on the drum
const DRUM = 2.1; // drum radius, in card heights
const LENS = 2.7; // perspective distance
const RING_R = 1.12; // ring radius
const BOW = 1.82; // side-on arc radius
const TITLE = 0.09; // ring label size
const CULL = 1.6;

const WHEEL_UNITS = 900;
const DRAG_UNITS = 420;
const SETTLE = 140;
const EASE = 0.12;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** How far left the arc has carried something that has turned drumDeg off the front. */
const bowAt = (drumDeg: number, bow: number) => -bow * (1 - Math.cos(rad(drumDeg)));

function place(
  ringDeg: number,
  drumDeg: number,
  ringR: number,
  drumR: number,
  bow: number,
  m: number,
): string {
  return (
    `translateX(${m * bowAt(drumDeg, bow)}px) ` +
    `rotateZ(${(1 - m) * ringDeg}deg) translateY(${-(1 - m) * ringR}px) ` +
    `rotateX(${m * drumDeg}deg) translateZ(${m * drumR}px)`
  );
}

export function WorksWheel({ items, label = "starlly.", className }: WorksWheelProps) {
  const stageRef = React.useRef<HTMLDivElement>(null);
  const wheelRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef<(HTMLElement | null)[]>([]);
  const labelRef = React.useRef<HTMLDivElement>(null);
  const titleRef = React.useRef<HTMLDivElement>(null);

  const turn = React.useRef(0);
  const target = React.useRef(0);
  const [active, setActive] = React.useState(0);
  const [stage, setStage] = React.useState({ w: 0, h: 0 });

  const count = items.length;
  // Turn positions: 0 = closed ring, then 1..count front each card in turn.
  // The input clamp must allow reaching the LAST card (t = count).
  const last = Math.max(count - 1, 0);
  const maxTurn = Math.max(count, 1);

  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);

  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const read = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const metrics = React.useMemo(() => {
    const { w, h } = stage;
    const cardW = Math.min(h * CARD_H * CARD_RATIO, w * CARD_MAX_W);
    const cardH = cardW / CARD_RATIO;
    const ringR = cardH * RING_R;
    const ringScale = count
      ? clamp((((2 * Math.PI * ringR) / count) * 0.82) / (cardW || 1), 0.16, 1)
      : 1;
    return {
      cardW,
      cardH,
      ringR,
      ringScale,
      drumR: cardH * DRUM,
      bow: cardH * BOW,
      depth: cardH * LENS,
      title: cardH * TITLE,
    };
  }, [stage, count]);

  React.useEffect(() => {
    if (!stage.h) return;
    let frame = 0;
    const { ringR, ringScale, drumR, bow } = metrics;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const gap = target.current - turn.current;
      if (Math.abs(gap) < 0.0005) turn.current = target.current;
      else turn.current += gap * (reduced ? 1 : EASE);

      const t = turn.current;
      const m = clamp(t, 0, 1);
      const pos = Math.max(0, t - 1);

      if (wheelRef.current) {
        wheelRef.current.style.transform = `translateZ(${-m * drumR}px)`;
      }

      for (let i = 0; i < count; i++) {
        const d = i - pos;
        const drumDeg = d * STEP;
        const card = cardRefs.current[i];
        if (card) {
          card.style.transform = place(d * (360 / count), drumDeg, ringR, drumR, bow, m);
          card.style.opacity = m > 0.5 && Math.abs(d) > CULL ? "0" : "1";
          card.style.zIndex = String(Math.round(100 - Math.abs(d) * 2));
          // The front card reads normally; the ring copies stay small.
          const face = card.firstElementChild as HTMLElement | null;
          if (face) face.style.transform = `scale(${lerp(ringScale, 1, m)})`;
          card.style.pointerEvents = m > 0.5 && Math.abs(d) > 0.45 ? "none" : "auto";
        }
      }

      if (labelRef.current) labelRef.current.style.opacity = String(1 - m);
      if (titleRef.current) titleRef.current.style.opacity = String(m);
      const near = clamp(Math.round(pos), 0, last);
      setActive((prev) => (prev === near ? prev : near));
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [metrics, stage.h, count, last, reduced]);

  const to = React.useCallback(
    (next: number) => {
      target.current = clamp(next, 0, maxTurn);
    },
    [maxTurn],
  );

  const drag = React.useRef<number | null>(null);
  const settling = React.useRef(0);
  const wheelAccum = React.useRef(0);

  return (
    <section aria-label={label} className={`wheel ${className ?? ""}`}>
      <div
        ref={stageRef}
        tabIndex={0}
        role="listbox"
        aria-label={label}
        aria-activedescendant={`works-wheel-${active}`}
        className="wheel-stage"
        style={{ perspective: `${metrics.depth}px` }}
        onPointerDown={(event) => {
          drag.current = event.clientY;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current === null) return;
          to(target.current + (drag.current - event.clientY) / DRAG_UNITS);
          drag.current = event.clientY;
        }}
        onPointerUp={() => {
          drag.current = null;
          if (target.current > 1) to(Math.round(target.current));
        }}
        onWheel={(event) => {
          // Accumulate scroll delta; each WHEEL_UNITS worth steps one card.
          wheelAccum.current += event.deltaY;
          const steps = Math.trunc(wheelAccum.current / WHEEL_UNITS);
          if (steps !== 0) {
            wheelAccum.current -= steps * WHEEL_UNITS;
            to(Math.round(target.current) + steps);
          }
          event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowRight") to(Math.round(target.current) + 1);
          else if (event.key === "ArrowUp" || event.key === "ArrowLeft") to(Math.round(target.current) - 1);
          else return;
          event.preventDefault();
        }}
      >
        <div ref={wheelRef} className="wheel-ring">
          {items.map((item, i) => (
            <div
              key={item.title}
              id={`works-wheel-${i}`}
              role="option"
              aria-selected={i === active}
              ref={(node: HTMLDivElement | null) => {
                cardRefs.current[i] = node;
              }}
              className="wheel-card"
              style={{
                width: metrics.cardW,
                height: metrics.cardH,
                marginLeft: -metrics.cardW / 2,
                marginTop: -metrics.cardH / 2,
              }}
            >
              <span className="wheel-card-face">
                <span className="wheel-card-icon">
                  <svg className="icon" style={{ width: 26, height: 26 }} aria-hidden="true">
                    <use href={`#i-${item.icon}`} />
                  </svg>
                </span>
                <strong>{item.title}</strong>
                <span className="wheel-card-body">{item.body}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Ring label and front-card title trade places across the transition. */}
      <div ref={labelRef} className="wheel-label" style={{ fontSize: metrics.title }}>
        {label}
      </div>
      <div ref={titleRef} className="wheel-front-title" style={{ fontSize: metrics.title }}>
        {items[active]?.title}
      </div>

      <div className="wheel-dots" aria-hidden="true">
        {items.map((item, i) => (
          <button
            key={item.title}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => to(i)}
            className={i === active ? "wheel-dot active" : "wheel-dot"}
          />
        ))}
      </div>
    </section>
  );
}

export default WorksWheel;
