"use client";

import { useEffect, useRef } from "react";

/**
 * SignalField — the brand's living visual world.
 *
 * A quiet field of points (companies). Every so often one IGNITES: a buying
 * moment. The point flares, an expanding ring radiates out, and thin lines reach
 * to its nearest neighbours before it settles back into the field. That is the
 * whole product as a picture: most of the market is dark, and the craft is
 * catching the one that just lit up.
 *
 * Themed by `accent` (any hex). Fills its positioned parent. Honors
 * prefers-reduced-motion by drawing a calm static field with a few moments
 * already lit, and never starting the animation loop. Pauses when off-screen or
 * on a hidden tab so it costs nothing when unseen.
 */

interface Props {
  /** Accent hex, e.g. "#4f46e5". Drives the ignition color. */
  accent: string;
  /** Rough points per 100k px^2. Default tuned for hero-sized areas. */
  density?: number;
  /** Seconds between ignitions (lower = livelier). Default 1.1. */
  cadence?: number;
  /** 0..1 baseline dot brightness. Default 0.18. */
  calm?: number;
  className?: string;
  style?: React.CSSProperties;
}

interface Point {
  x: number;
  y: number;
  r: number;
  tw: number; // twinkle phase
}

interface Pulse {
  x: number;
  y: number;
  t: number; // 0..1 life
  neighbors: { x: number; y: number }[];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const int = parseInt(n, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export function SignalField({
  accent,
  density = 4.2,
  cadence = 1.1,
  calm = 0.18,
  className,
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const [ar, ag, ab] = hexToRgb(accent);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let points: Point[] = [];
    const pulses: Pulse[] = [];
    let w = 0;
    let h = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let running = false;
    let lastSpawn = 0;
    let start = 0;

    function build() {
      const rect = canvas!.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(220, Math.max(24, Math.round((w * h) / 100000 * density * 100)));
      points = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.8 + Math.random() * 1.4,
        tw: Math.random() * Math.PI * 2,
      }));
    }

    function nearest(px: number, py: number, k: number) {
      return points
        .map((p) => ({ p, d: (p.x - px) ** 2 + (p.y - py) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(1, k + 1)
        .map(({ p }) => ({ x: p.x, y: p.y }));
    }

    function ignite() {
      const p = points[Math.floor(Math.random() * points.length)];
      if (!p) return;
      pulses.push({ x: p.x, y: p.y, t: 0, neighbors: nearest(p.x, p.y, 2) });
      if (pulses.length > 14) pulses.shift();
    }

    function drawDots(time: number) {
      for (const p of points) {
        const tw = reduce ? 0 : Math.sin(time * 0.0012 + p.tw) * 0.5 + 0.5;
        const a = calm * (0.6 + tw * 0.5);
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${ar},${ag},${ab},${a})`;
        ctx!.fill();
      }
    }

    function drawPulse(pu: Pulse) {
      const ease = 1 - Math.pow(1 - pu.t, 3); // ease-out-cubic
      const radius = 4 + ease * 46;
      const ringA = (1 - pu.t) * 0.5;
      // expanding ring
      ctx!.beginPath();
      ctx!.arc(pu.x, pu.y, radius, 0, Math.PI * 2);
      ctx!.strokeStyle = `rgba(${ar},${ag},${ab},${ringA})`;
      ctx!.lineWidth = 1.2;
      ctx!.stroke();
      // connective lines to neighbours (fade with life)
      const lineA = (1 - pu.t) * 0.35;
      for (const n of pu.neighbors) {
        ctx!.beginPath();
        ctx!.moveTo(pu.x, pu.y);
        ctx!.lineTo(n.x, n.y);
        ctx!.strokeStyle = `rgba(${ar},${ag},${ab},${lineA})`;
        ctx!.lineWidth = 0.7;
        ctx!.stroke();
      }
      // bright core
      const coreA = (1 - pu.t) * 0.9 + 0.1;
      const g = ctx!.createRadialGradient(pu.x, pu.y, 0, pu.x, pu.y, 7);
      g.addColorStop(0, `rgba(${ar},${ag},${ab},${coreA})`);
      g.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
      ctx!.beginPath();
      ctx!.arc(pu.x, pu.y, 7, 0, Math.PI * 2);
      ctx!.fillStyle = g;
      ctx!.fill();
    }

    function frame(now: number) {
      if (!running) return;
      if (!start) start = now;
      const time = now - start;
      ctx!.clearRect(0, 0, w, h);
      drawDots(time);
      if (now - lastSpawn > cadence * 1000) {
        ignite();
        lastSpawn = now;
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        pulses[i].t += 0.010;
        if (pulses[i].t >= 1) pulses.splice(i, 1);
        else drawPulse(pulses[i]);
      }
      raf = requestAnimationFrame(frame);
    }

    function staticDraw() {
      ctx!.clearRect(0, 0, w, h);
      drawDots(0);
      // a few moments already lit, so the still frame still tells the story
      for (let i = 0; i < 3; i++) {
        const p = points[Math.floor((points.length / 3) * i + 1)];
        if (p) drawPulse({ x: p.x, y: p.y, t: 0.32, neighbors: nearest(p.x, p.y, 2) });
      }
    }

    function play() {
      if (running || reduce) return;
      running = true;
      start = 0;
      lastSpawn = 0;
      raf = requestAnimationFrame(frame);
    }
    function pause() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
    }

    build();
    if (reduce) staticDraw();
    else play();

    const ro = new ResizeObserver(() => {
      build();
      if (reduce) staticDraw();
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(
      ([e]) => {
        if (reduce) return;
        if (e.isIntersecting) play();
        else pause();
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    const onVis = () => {
      if (reduce) return;
      if (document.hidden) pause();
      else play();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      pause();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [accent, density, cadence, calm]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ display: "block", width: "100%", height: "100%", ...style }}
    />
  );
}
