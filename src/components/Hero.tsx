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

  // Everything translates downward as the user scrolls so illustrations
  // travel from section 1 into section 2.
  const dropY = useTransform(scrollYProgress, [0, 1], ["0vh", "95vh"]);

  // Vichy bottle — pours to the right
  const bottleRotate = useTransform(scrollYProgress, [0.05, 0.6], [-6, 70]);
  const bottleX = useTransform(scrollYProgress, [0.05, 0.6], [0, 60]);

  // Estrella caña — tilts toward centre as if catching the pour
  const canyaRotate = useTransform(scrollYProgress, [0.05, 0.6], [8, -45]);
  const canyaX = useTransform(scrollYProgress, [0.05, 0.6], [0, -40]);

  // Vermut — also pours, tilts opposite
  const vermutRotate = useTransform(scrollYProgress, [0.05, 0.6], [8, -55]);
  const vermutX = useTransform(scrollYProgress, [0.05, 0.6], [0, -30]);

  // Sun — arcs across the sky: rises to a peak then sets on the far side
  const sunX = useTransform(scrollYProgress, [0, 0.5, 1], ["0vw", "40vw", "78vw"]);
  const sunArcY = useTransform(scrollYProgress, [0, 0.5, 1], ["0vh", "-8vh", "20vh"]);
  const sunRotate = useTransform(scrollYProgress, [0, 1], [0, 180]);

  return (
    <div ref={wrapperRef} className="relative bg-sun text-foreground">
      {/* ============ SECTION 1 — above the fold ============ */}
      <section className="relative h-screen w-full overflow-hidden">
        {/* Sun — top-left, arcs across the sky as user scrolls */}
        <motion.img
          src={sun}
          alt=""
          aria-hidden
          style={{ x: sunX, y: sunArcY, rotate: sunRotate }}
          className="pointer-events-none absolute top-[8%] left-[4%] w-20 sm:w-24 md:w-28 z-20"
        />

        {/* Vermouth — top right, scroll-tilts as if pouring */}
        <motion.img
          src={vermut}
          alt=""
          aria-hidden
          style={{
            y: dropY,
            x: vermutX,
            rotate: vermutRotate,
            transformOrigin: "30% 90%",
          }}
          className="pointer-events-none absolute top-[10%] right-[6%] w-20 sm:w-28 md:w-32 z-20"
        />

        {/* Bottle — bottom left, scroll-tilts toward the centre */}
        <motion.img
          src={bottle}
          alt="Botella de Vichy Catalán"
          style={{
            y: dropY,
            x: bottleX,
            rotate: bottleRotate,
            transformOrigin: "70% 90%",
          }}
          className="pointer-events-none absolute bottom-[8%] left-[2%] sm:left-[4%] h-[42vh] sm:h-[48vh] max-h-[460px] w-auto z-20"
        />

        {/* Estrella caña — bottom right, scroll-tilts toward the centre */}
        <motion.img
          src={canya}
          alt="Caña de cerveza Estrella"
          style={{
            y: dropY,
            x: canyaX,
            rotate: canyaRotate,
            transformOrigin: "30% 90%",
          }}
          className="pointer-events-none absolute bottom-[10%] right-[3%] sm:right-[6%] h-[28vh] sm:h-[34vh] max-h-[320px] w-auto z-20"
        />

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
          <span aria-hidden className="animate-bounce">↓</span>
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
