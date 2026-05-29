import { useRef, useState } from "react";
import { ArrowRight, Calendar, Clock } from "lucide-react";
import { motion, useScroll, useTransform, useMotionValue, type MotionValue } from "motion/react";
import bottle from "@/assets/bottle.png";
import sun from "@/assets/sun.png";

type Props = {
  onSubmit: (when: Date) => void;
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function nowStr() {
  return new Date().toTimeString().slice(0, 5);
}

/* ---------- Inline SVG glasses (so we can fill them on scroll) ---------- */

function BeerGlass({ fill }: { fill: MotionValue<number> }) {
  // liquid rises from y=150 (empty) to y=22 (full)
  const liquidY = useTransform(fill, [0, 1], [150, 22]);
  const foamY = useTransform(fill, [0, 1], [152, 24]);
  const foamOpacity = useTransform(fill, [0, 0.08], [0, 1]);
  const bubble1Y = useTransform(fill, [0.2, 1], [150, 30]);
  const bubble2Y = useTransform(fill, [0.4, 1], [150, 50]);

  return (
    <svg viewBox="0 0 110 160" className="w-full h-full" aria-hidden>
      <defs>
        <clipPath id="beer-interior">
          <path d="M18 18 L92 18 L86 146 Q86 150 82 150 L28 150 Q24 150 24 146 Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#beer-interior)">
        <motion.rect x="0" width="110" y={liquidY} height="200" fill="#F5B017" />
        <motion.circle cx="40" cy={bubble1Y} r="2" fill="rgba(255,255,255,0.7)" />
        <motion.circle cx="68" cy={bubble2Y} r="1.5" fill="rgba(255,255,255,0.7)" />
        <motion.g style={{ opacity: foamOpacity }}>
          <motion.ellipse cx="55" cy={foamY} rx="34" ry="6" fill="#FFF8E7" />
          <motion.ellipse cx="42" cy={useTransform(foamY, (v) => v - 3)} rx="10" ry="5" fill="#FFFDF4" />
          <motion.ellipse cx="68" cy={useTransform(foamY, (v) => v - 4)} rx="9" ry="5" fill="#FFFDF4" />
        </motion.g>
      </g>
      {/* glass outline */}
      <path
        d="M18 18 L92 18 L86 146 Q86 152 80 152 L30 152 Q24 152 24 146 Z"
        fill="none"
        stroke="#1a1a1a"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line x1="18" y1="18" x2="92" y2="18" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" />
      <line x1="32" y1="30" x2="29" y2="130" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function VermouthGlass({ fill }: { fill: MotionValue<number> }) {
  const liquidY = useTransform(fill, [0, 1], [118, 32]);
  const iceY = useTransform(fill, [0.18, 0.42], [-30, 60]);
  const iceOp = useTransform(fill, [0.18, 0.24], [0, 1]);
  const orangeY = useTransform(fill, [0.4, 0.62], [-30, 78]);
  const orangeOp = useTransform(fill, [0.4, 0.46], [0, 1]);
  const oliveY = useTransform(fill, [0.6, 0.85], [-40, 52]);
  const oliveOp = useTransform(fill, [0.6, 0.66], [0, 1]);
  const stickY1 = useTransform(oliveY, (v) => v - 38);

  return (
    <svg viewBox="0 0 120 135" className="w-full h-full" aria-hidden>
      <defs>
        <clipPath id="vermut-interior">
          <path d="M18 18 L102 18 L100 116 Q100 122 94 122 L26 122 Q20 122 20 116 Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#vermut-interior)">
        <motion.rect x="0" width="120" y={liquidY} height="200" fill="#7A1818" />
        {/* ice cube */}
        <motion.rect
          x="42"
          width="26"
          height="22"
          y={iceY}
          fill="rgba(220,240,250,0.7)"
          stroke="rgba(255,255,255,0.9)"
          strokeWidth="1.5"
          rx="2"
          style={{ opacity: iceOp }}
        />
        {/* orange slice */}
        <motion.g style={{ opacity: orangeOp }}>
          <motion.circle cx="78" cy={orangeY} r="11" fill="#FF8C2A" stroke="#C95A0F" strokeWidth="1.5" />
          <motion.circle cx="78" cy={orangeY} r="6" fill="none" stroke="#FFD89A" strokeWidth="1" />
        </motion.g>
        {/* olive on stick */}
        <motion.g style={{ opacity: oliveOp }}>
          <motion.line x1="52" x2="52" y1={stickY1} y2={oliveY} stroke="#3d2817" strokeWidth="1.8" strokeLinecap="round" />
          <motion.ellipse cx="52" cy={oliveY} rx="6" ry="7" fill="#5A7A2E" stroke="#2d4318" strokeWidth="1.2" />
        </motion.g>
      </g>
      {/* glass outline */}
      <path
        d="M18 18 L102 18 L100 116 Q100 124 92 124 L28 124 Q20 124 20 116 Z"
        fill="none"
        stroke="#1a1a1a"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line x1="26" y1="28" x2="26" y2="108" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/* ---------------------------------- Hero ---------------------------------- */

export function Hero({ onSubmit }: Props) {
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState(nowStr());

  const wrapperRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: wrapperRef,
    offset: ["start start", "end end"],
  });

  // Section 1 is 200vh + section 2 ~100vh => total ~300vh.
  // Fill the glasses from very early scroll to ~end of section 1 (≈ 0.6 of wrapper).
  const glassFill = useTransform(scrollYProgress, [0.02, 0.6], [0, 1]);

  // Small Vichy bottles slide in around 80% through section 1 (≈ 0.5–0.62 wrapper).
  const bottleLeftX = useTransform(scrollYProgress, [0.5, 0.65], [-320, 0]);
  const bottleRightX = useTransform(scrollYProgress, [0.5, 0.65], [320, 0]);
  const bottleOpacity = useTransform(scrollYProgress, [0.5, 0.6], [0, 1]);

  // Static full fill for the section-2 header row glasses
  const fullFill = useMotionValue(1);

  return (
    <div ref={wrapperRef} className="relative bg-sun text-foreground">
      {/* ===== Sun — animated arc on page load, then rests ===== */}
      <motion.div
        className="fixed z-0 pointer-events-none w-20 sm:w-24 md:w-28 aspect-square"
        style={{ marginLeft: "-3rem", marginTop: "-3rem" }}
        initial={{ left: "8vw", top: "78vh", opacity: 0 }}
        animate={{
          left: ["8vw", "50vw", "88vw"],
          top: ["78vh", "8vh", "68vh"],
          opacity: [0, 1, 1, 1],
        }}
        transition={{
          duration: 2.5,
          ease: "easeInOut",
          times: [0, 0.5, 1],
          opacity: { duration: 0.4, times: [0, 0.2, 0.5, 1] },
        }}
      >
        <motion.img
          src={sun}
          alt=""
          aria-hidden
          className="w-full h-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 2.5, ease: "easeInOut" }}
        />
      </motion.div>

      {/* ============ SECTION 1 — hero, tall so we can fill on scroll ============ */}
      <section className="relative h-[200vh] w-full">
        <div className="sticky top-0 h-screen w-full flex flex-col items-center justify-center px-5 overflow-hidden">
          <h1 className="font-display font-bold leading-[0.9] text-foreground text-[20vw] sm:text-8xl md:text-9xl text-center">
            ¿Hay <span className="text-terracotta">Sol</span>?
          </h1>
          <p className="mt-3 text-base sm:text-lg md:text-xl font-medium text-foreground/80 text-center">
            Encuentra tu terraza en Barcelona
          </p>

          {/* Two glasses side by side */}
          <div className="mt-8 sm:mt-10 flex items-end justify-center gap-6 sm:gap-10">
            <div className="w-24 sm:w-28 md:w-32 h-36 sm:h-40 md:h-44">
              <BeerGlass fill={glassFill} />
            </div>
            <div className="w-24 sm:w-28 md:w-32 h-32 sm:h-36 md:h-40">
              <VermouthGlass fill={glassFill} />
            </div>
          </div>

          {/* Scroll hint */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-xs font-medium text-foreground/60">
            <span>Scroll</span>
            <span aria-hidden className="animate-bounce">↓</span>
          </div>
        </div>
      </section>

      {/* ============ SECTION 2 — drink row + CTAs ============ */}
      <section className="relative min-h-screen w-full flex flex-col items-center px-5 py-12">
        {/* 4-element header row: bottle · beer · vermouth · bottle */}
        <div className="flex items-end justify-center gap-3 sm:gap-5 mb-10 sm:mb-12 overflow-hidden w-full">
          <motion.img
            src={bottle}
            alt="Botella de Vichy Catalán"
            style={{ x: bottleLeftX, opacity: bottleOpacity }}
            className="pointer-events-none h-28 sm:h-32 md:h-36 w-auto"
          />
          <div className="w-20 sm:w-24 md:w-28 h-32 sm:h-36 md:h-40">
            <BeerGlass fill={fullFill} />
          </div>
          <div className="w-20 sm:w-24 md:w-28 h-28 sm:h-32 md:h-36">
            <VermouthGlass fill={fullFill} />
          </div>
          <motion.img
            src={bottle}
            alt="Botella de Vichy Catalán"
            style={{ x: bottleRightX, opacity: bottleOpacity }}
            className="pointer-events-none h-28 sm:h-32 md:h-36 w-auto"
          />
        </div>

        {/* CTA column — always on top */}
        <div className="relative z-10 w-full max-w-[420px]">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-foreground text-center">
            ¿Cuándo buscas <span className="text-terracotta">sol</span>?
          </h2>

          <div className="mt-8 w-full space-y-4">
            <button
              onClick={() => onSubmit(new Date())}
              className="group w-full rounded-full bg-foreground text-background py-5 px-6 text-lg font-display font-semibold shadow-[0_6px_0_rgba(0,0,0,0.15)] active:translate-y-[2px] active:shadow-[0_4px_0_rgba(0,0,0,0.15)] transition-all flex items-center justify-center gap-2 hover:bg-terracotta"
            >
              Ahora mismo
              <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
            </button>

            <div className="flex items-center gap-3 text-sm font-medium text-foreground/70 before:h-px before:flex-1 before:bg-foreground/20 after:h-px after:flex-1 after:bg-foreground/20">
              o elige
            </div>

            <div className="flex gap-2">
              <label className="flex-1 flex items-center gap-2 rounded-full bg-background/80 backdrop-blur px-4 py-3 border border-foreground/10">
                <Calendar className="size-4 text-cobalt" />
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-transparent text-sm font-medium outline-none"
                />
              </label>
              <label className="w-[110px] flex items-center gap-2 rounded-full bg-background/80 backdrop-blur px-4 py-3 border border-foreground/10">
                <Clock className="size-4 text-cobalt" />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full bg-transparent text-sm font-medium outline-none"
                />
              </label>
            </div>

            <button
              onClick={() => {
                const d = new Date(`${date}T${time}`);
                onSubmit(isNaN(d.getTime()) ? new Date() : d);
              }}
              className="group w-full rounded-full bg-terracotta text-primary-foreground py-4 px-6 text-base font-display font-semibold shadow-[0_6px_0_rgba(0,0,0,0.15)] active:translate-y-[2px] active:shadow-[0_4px_0_rgba(0,0,0,0.15)] transition-all flex items-center justify-center gap-2 hover:bg-coral"
            >
              Ver el sol
              <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
