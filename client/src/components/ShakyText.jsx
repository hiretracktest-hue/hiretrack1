import { useEffect, useRef } from "react";

/**
 * A headline whose letters notice the pointer.
 *
 * Every letter is its own element. When the pointer comes near, the
 * letters close to it tremble, lean and step away from it, the nearest
 * catching the light; move off and they settle back into the word.
 *
 * Screen readers are given the sentence as one plain label, not a
 * spelling-out of letters. The movement runs only while something is
 * actually moving, and not at all for anyone whose system asks for
 * reduced motion.
 */
const RADIUS = 160; // how close the pointer has to be, in px
const PUSH = 28; // how far the nearest letter steps away
const SHAKE = 7; // how hard it trembles

export default function ShakyText({ lead, accent }) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    const chars = [...root.querySelectorAll(".shaky-char")];
    const state = chars.map(() => ({ x: 0, y: 0, r: 0, s: 1 }));
    const pointer = { x: 0, y: 0, active: false };
    // Listen on the whole panel, so the letters feel the pointer coming
    // towards them, not only once it is on top of them.
    const host = root.closest(".auth-brand") || root;
    let frame = 0;

    const tick = () => {
      const box = root.getBoundingClientRect();
      const px = pointer.x - box.left;
      const py = pointer.y - box.top;
      let busy = false;

      chars.forEach((el, i) => {
        // offsetLeft/Top ignore transforms, so this is where the letter
        // sits in the word, not where it has been pushed to.
        const cx = el.offsetLeft + el.offsetWidth / 2;
        const cy = el.offsetTop + el.offsetHeight / 2;
        const dx = cx - px;
        const dy = cy - py;
        const d = Math.hypot(dx, dy) || 1;
        const st = state[i];

        let tx = 0;
        let ty = 0;
        let tr = 0;
        let ts = 1;
        const near = pointer.active && d < RADIUS;
        if (near) {
          const f = 1 - d / RADIUS;
          tx = (dx / d) * PUSH * f * f + (Math.random() - 0.5) * SHAKE * f;
          ty = (dy / d) * PUSH * f * f + (Math.random() - 0.5) * SHAKE * f;
          tr = (Math.random() - 0.5) * 18 * f;
          ts = 1 + 0.14 * f;
          busy = true;
        }

        st.x += (tx - st.x) * 0.3;
        st.y += (ty - st.y) * 0.3;
        st.r += (tr - st.r) * 0.3;
        st.s += (ts - st.s) * 0.3;
        if (Math.abs(st.x) > 0.05 || Math.abs(st.y) > 0.05 || Math.abs(st.r) > 0.05 || Math.abs(st.s - 1) > 0.002) {
          busy = true;
        }

        el.style.transform =
          "translate3d(" + st.x.toFixed(2) + "px," + st.y.toFixed(2) + "px,0) rotate(" +
          st.r.toFixed(2) + "deg) scale(" + st.s.toFixed(3) + ")";
        el.classList.toggle("is-near", near && d < RADIUS * 0.55);
      });

      frame = busy ? requestAnimationFrame(tick) : 0;
    };

    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const onMove = (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      wake();
    };
    const onLeave = () => {
      pointer.active = false;
      wake();
    };

    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  let n = 0; // running letter count, for the gold glint's ripple
  const words = (text, gold) =>
    text.split(" ").map((word, w) => (
      <span key={(gold ? "g" : "w") + w}>
        {w > 0 && " "}
        <span className={"shaky-word" + (gold ? " is-gold" : "")}>
          {[...word].map((ch, i) => (
            <span key={i} className="shaky-char" style={{ "--n": n++ }}>
              {ch}
            </span>
          ))}
        </span>
      </span>
    ));

  return (
    <h2 ref={ref} className="shaky" aria-label={lead + " " + accent}>
      <span aria-hidden="true">
        {words(lead, false)} {words(accent, true)}
      </span>
    </h2>
  );
}
