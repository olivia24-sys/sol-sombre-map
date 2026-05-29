import { useRef, useState } from "react";
import { ArrowRight, Calendar, Clock } from "lucide-react";
import { motion } from "motion/react";
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

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.3 },
  transition: { duration: 0.6, ease: "easeOut" as const },
};

export function Hero({ onSubmit }: Props) {
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState(nowStr());
  const heroRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={heroRef} className="relative bg-sun text-foreground overflow-hidden">
      {/* SECTION 1 — hero */}
      <section className="relative h-screen w-full overflow-hidden">
        {/* Sun — arcs across the sky on page load in a half-circle, then rests upper-right */}
        <motion.img
          src={sun}
          alt=""
          aria-hidden
          className="absolute z-0 pointer-events-none w-20 sm:w-24 md:w-28 aspect-square"
          style={{ marginLeft: "-3rem", marginTop: "-3rem" }}
          initial={{ left: "8vw", top: "78vh", opacity: 0, rotate: 0 }}
          animate={{
            // Half-circle arc sampled at 9 points (cos/sin from 180° → 0°)
            left: ["8vw", "13vw", "26vw", "44vw", "50vw", "56vw", "74vw", "85vw", "82vw"],
            top: ["78vh", "47vh", "22vh", "10vh", "8vh", "10vh", "16vh", "17vh", "18vh"],
            opacity: [0, 1, 1, 1, 1, 1, 1, 1, 1],
            rotate: 360,
          }}
          transition={{
            duration: 2.5,
            ease: "easeInOut",
            opacity: { duration: 0.4 },
          }}
        />


        <div className="relative z-10 mx-auto flex h-full max-w-5xl flex-col items-center justify-center px-5 text-center">
          <h1 className="font-display font-bold leading-[0.9] text-foreground text-[20vw] sm:text-8xl md:text-9xl">
            ¿Hay <span className="text-terracotta">Sol</span>?
          </h1>
          <p className="mt-4 text-base sm:text-lg md:text-xl font-medium text-foreground/80">
            Encuentra tu terraza en Barcelona
          </p>

          {/* Beer + Vermouth glasses, slide up + fade in on scroll into view */}
          <motion.div
            {...fadeUp}
            className="mt-10 flex items-end justify-center gap-6 sm:gap-8"
          >
            <img
              src={canya}
              alt="Caña de cerveza Estrella"
              className="h-28 w-28 sm:h-32 sm:w-32 md:h-36 md:w-36 object-contain"
            />
            <img
              src={vermut}
              alt="Copa de vermut"
              className="h-28 w-28 sm:h-32 sm:w-32 md:h-36 md:w-36 object-contain"
            />
          </motion.div>
        </div>

        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1 text-xs font-medium text-foreground/60">
          <span>Scroll</span>
          <span aria-hidden className="animate-bounce">
            ↓
          </span>
        </div>
      </section>

      {/* SECTION 2 — CTAs with four-drink row at bottom */}
      <section className="relative min-h-screen w-full flex flex-col items-center justify-center px-5 py-12 gap-12">
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

        <motion.div
          {...fadeUp}
          className="flex items-end justify-center gap-4 sm:gap-6"
        >

          <img src={bottle} alt="Botella de Vichy Catalán" className="h-20 w-20 sm:h-24 sm:w-24 md:h-28 md:w-28 object-contain" />
          <img src={canya} alt="Caña de cerveza Estrella" className="h-20 w-20 sm:h-24 sm:w-24 md:h-28 md:w-28 object-contain" />
          <img src={vermut} alt="Copa de vermut" className="h-20 w-20 sm:h-24 sm:w-24 md:h-28 md:w-28 object-contain" />
          <img src={bottle} alt="Botella de Vichy Catalán" className="h-20 w-20 sm:h-24 sm:w-24 md:h-28 md:w-28 object-contain" />
        </motion.div>
      </section>

    </div>
  );
}
