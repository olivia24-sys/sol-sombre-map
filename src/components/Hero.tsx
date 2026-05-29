import { useRef, useState } from "react";
import { ArrowRight, Calendar, Clock } from "lucide-react";
import { motion, useScroll, useTransform } from "motion/react";
import bottle from "@/assets/bottle.png";
import canya from "@/assets/canya.png";
import vermut from "@/assets/vermut.png";
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

export function Hero({ onSubmit }: Props) {
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState(nowStr());

  const wrapperRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: wrapperRef,
    offset: ["start start", "end end"],
  });

  // Vichy bottle — capped pour, frozen after halfway through the hero scroll
  const bottleRotate = useTransform(scrollYProgress, [0.05, 0.5, 1], [-6, -35, -35]);

  // Estrella caña — capped receiving tilt, frozen after halfway
  const canyaRotate = useTransform(scrollYProgress, [0.05, 0.5, 1], [8, 30, 30]);

  // Vermut — gentle pour, also finishes by halfway
  const vermutRotate = useTransform(scrollYProgress, [0.05, 0.5, 1], [8, -35, -35]);

  // Sun stays horizontally locked; only a tiny natural emphasis on scroll
  const sunScale = useTransform(scrollYProgress, [0, 0.5, 1], [1, 1.1, 1.05]);

  return (
    <div ref={wrapperRef} className="bg-sun text-foreground">
      {/* ============ SECTION 1 — above the fold ============ */}
      <section className="relative h-screen w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <motion.img
            src={sun}
            alt=""
            aria-hidden
            style={{ scale: sunScale }}
            className="absolute top-[8%] left-[4%] w-20 sm:w-24 md:w-28 z-20"
          />
          <motion.img
            src={vermut}
            alt=""
            aria-hidden
            style={{ rotate: vermutRotate, transformOrigin: "30% 90%" }}
            className="absolute top-[10%] right-[6%] w-20 sm:w-28 md:w-32 z-20"
          />
          <motion.img
            src={bottle}
            alt="Botella de Vichy Catalán"
            style={{ rotate: bottleRotate, transformOrigin: "70% 90%" }}
            className="absolute top-[50vh] left-[2%] sm:left-[4%] h-[42vh] sm:h-[48vh] max-h-[460px] w-auto z-20"
          />
          <motion.img
            src={canya}
            alt="Caña de cerveza Estrella"
            style={{ rotate: canyaRotate, transformOrigin: "30% 90%" }}
            className="absolute top-[62vh] right-[3%] sm:right-[6%] h-[28vh] sm:h-[34vh] max-h-[320px] w-auto z-20"
          />
        </div>

        {/* Title block */}

        <div className="relative z-10 mx-auto flex h-full max-w-5xl flex-col items-center justify-center px-5 text-center">
          <h1 className="font-display font-bold leading-[0.9] text-foreground text-[22vw] sm:text-8xl md:text-9xl">
            ¿Hay <span className="text-terracotta">Sol</span>?
          </h1>
          <p className="mt-4 text-base sm:text-lg md:text-xl font-medium text-foreground/80">
            Encuentra tu terraza en Barcelona
          </p>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1 text-xs font-medium text-foreground/60">
          <span>Scroll</span>
          <span aria-hidden className="animate-bounce">
            ↓
          </span>
        </div>
      </section>

      {/* ============ SECTION 2 — revealed on scroll ============ */}
      <section className="relative min-h-screen w-full flex items-center justify-center px-5 py-12">
        <div className="relative z-10 w-full max-w-md">
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
