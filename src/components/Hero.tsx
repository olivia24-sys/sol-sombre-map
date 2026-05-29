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

  // Glasses arc from mid-left to mid-right as the user scrolls.
  const canyaX = useTransform(scrollYProgress, [0, 1], ["6vw", "62vw"]);
  const canyaY = useTransform(scrollYProgress, [0, 0.5, 1], ["48vh", "18vh", "52vh"]);
  const canyaRotate = useTransform(scrollYProgress, [0, 1], [-12, 22]);

  const vermutX = useTransform(scrollYProgress, [0, 1], ["18vw", "78vw"]);
  const vermutY = useTransform(scrollYProgress, [0, 0.5, 1], ["55vh", "26vh", "46vh"]);
  const vermutRotate = useTransform(scrollYProgress, [0, 1], [10, -18]);

  // Vichy bottles slide in from the left and right edges near the end.
  const bottleLeftX = useTransform(scrollYProgress, [0.65, 0.92], ["-45vw", "0vw"]);
  const bottleRightX = useTransform(scrollYProgress, [0.65, 0.92], ["45vw", "0vw"]);

  return (
    <div ref={wrapperRef} className="relative bg-sun text-foreground overflow-hidden">
      {/* Sun — arc across the sky on page load, then rests */}
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

      {/* Glasses arcing across the screen with scroll */}
      <motion.img
        src={canya}
        alt="Caña de cerveza Estrella"
        style={{ left: canyaX, top: canyaY, rotate: canyaRotate }}
        className="fixed z-0 pointer-events-none w-24 sm:w-28 md:w-32 -translate-x-1/2 -translate-y-1/2"
      />
      <motion.img
        src={vermut}
        alt="Copa de vermut"
        style={{ left: vermutX, top: vermutY, rotate: vermutRotate }}
        className="fixed z-0 pointer-events-none w-24 sm:w-28 md:w-32 -translate-x-1/2 -translate-y-1/2"
      />

      {/* Vichy bottles slide in from left/right edges */}
      <motion.img
        src={bottle}
        alt="Botella de Vichy Catalán"
        style={{ x: bottleLeftX }}
        className="fixed z-0 pointer-events-none left-0 top-1/2 -translate-y-1/2 h-40 sm:h-48 md:h-56 w-auto"
      />
      <motion.img
        src={bottle}
        alt="Botella de Vichy Catalán"
        style={{ x: bottleRightX }}
        className="fixed z-0 pointer-events-none right-0 top-1/2 -translate-y-1/2 h-40 sm:h-48 md:h-56 w-auto"
      />

      {/* SECTION 1 — title above the fold */}
      <section className="relative h-screen w-full">
        <div className="relative z-10 mx-auto flex h-full max-w-5xl flex-col items-center justify-center px-5 text-center">
          <h1 className="font-display font-bold leading-[0.9] text-foreground text-[20vw] sm:text-8xl md:text-9xl">
            ¿Hay <span className="text-terracotta">Sol</span>?
          </h1>
          <p className="mt-4 text-base sm:text-lg md:text-xl font-medium text-foreground/80">
            Encuentra tu terraza en Barcelona
          </p>
        </div>

        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1 text-xs font-medium text-foreground/60">
          <span>Scroll</span>
          <span aria-hidden className="animate-bounce">↓</span>
        </div>
      </section>

      {/* SECTION 2 — CTAs */}
      <section className="relative min-h-screen w-full flex items-center justify-center px-5 py-12">
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
