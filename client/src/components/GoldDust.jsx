import { useEffect, useRef } from "react";

/**
 * Gold dust drifting up the signed-out brand panel.
 *
 * Specks rise slowly, sway, and twinkle; any two that pass close enough
 * are joined by a faint gold thread; and they drift gently away from the
 * pointer, so the panel answers the person looking at it.
 *
 * Drawn on a canvas rather than as dozens of animated elements, so it
 * stays smooth. It pauses whenever the tab is hidden, stops while the
 * panel is not on screen (a phone hides it), and anybody whose system
 * asks for reduced motion gets one still frame instead.
 */
const LINK_DISTANCE = 110;
const POINTER_RADIUS = 130;

export default function GoldDust() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let specks = [];
    let frame = 0;
    const pointer = { x: -9999, y: -9999 };

    const spawn = (anywhere) => {
      const big = Math.random() < 0.14;
      return {
        x: Math.random() * width,
        y: anywhere ? Math.random() * height : height + 12,
        r: big ? 1.5 + Math.random() * 1.5 : 0.6 + Math.random() * 0.9,
        big,
        vx: (Math.random() - 0.5) * 0.14,
        vy: -(0.08 + Math.random() * 0.24),
        phase: Math.random() * Math.PI * 2,
        twinkle: 0.0012 + Math.random() * 0.0022,
        // Mostly Altrium gold, some paler yellow for depth.
        rgb: Math.random() < 0.72 ? "251, 191, 36" : "255, 226, 120",
      };
    };

    const draw = (time) => {
      ctx.clearRect(0, 0, width, height);

      // Threads between neighbours first, so the specks sit on top.
      for (let i = 0; i < specks.length; i++) {
        const a = specks[i];
        for (let j = i + 1; j < specks.length; j++) {
          const b = specks[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < LINK_DISTANCE) {
            ctx.strokeStyle = "rgba(251, 191, 36, " + ((1 - d / LINK_DISTANCE) * 0.16).toFixed(3) + ")";
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const s of specks) {
        const glow = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(s.phase + time * s.twinkle));
        if (s.big) {
          // A soft halo round the larger specks - the "glint".
          const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 6);
          halo.addColorStop(0, "rgba(" + s.rgb + ", " + (0.35 * glow).toFixed(3) + ")");
          halo.addColorStop(1, "rgba(" + s.rgb + ", 0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(" + s.rgb + ", " + (0.35 + 0.6 * glow).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const step = (time) => {
      for (const s of specks) {
        s.x += s.vx + Math.sin(time * 0.0005 + s.phase) * 0.06;
        s.y += s.vy;

        // Drift away from the pointer, gently.
        const dx = s.x - pointer.x;
        const dy = s.y - pointer.y;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < POINTER_RADIUS) {
          const push = (1 - d / POINTER_RADIUS) * 0.9;
          s.x += (dx / d) * push;
          s.y += (dy / d) * push;
        }

        if (s.y < -12) Object.assign(s, spawn(false));
        if (s.x < -12) s.x = width + 12;
        if (s.x > width + 12) s.x = -12;
      }
      draw(time);
      frame = requestAnimationFrame(step);
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const start = () => {
      if (still || frame || document.hidden || width === 0) return;
      frame = requestAnimationFrame(step);
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (width === 0 || height === 0) {
        stop();
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(24, Math.min(90, Math.round((width * height) / 11000)));
      specks = Array.from({ length: count }, () => spawn(true));
      if (still) draw(0);
      else start();
    };

    const onMove = (event) => {
      const rect = host.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
    };
    const onLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      observer.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="gold-dust" aria-hidden="true" />;
}
