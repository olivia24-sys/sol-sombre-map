import { useRef, useState, type ReactNode } from "react";
import { ArrowRight, Calendar, Clock } from "lucide-react";
import { motion, type MotionValue, useScroll, useTransform } from "motion/react";
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

type DrinkStyle = {
  left: MotionValue<string>;
  top: MotionValue<string>;
  rotate: MotionValue<number>;
};

type AnimatedDrinkProps = {
  src: string;
  alt: string;
  fill: MotionValue<number>;
  positionStyle: DrinkStyle;
  className?: string;
  children?: ReactNode;
};

function AnimatedDrink({
  src,
  alt,
  fill,
  positionStyle,
  className = "",
  children,
}: AnimatedDrinkProps) {
  const fillClip = useTransform(fill, (value) => `inset(${Math.max(0, 100 - value * 100)}% 0 0 0)`);

  return (
    <motion.div
      style={positionStyle}
      className={`fixed z-[1] pointer-events-none -translate-x-1/2 -translate-y-1/2 ${className}`}
    >
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 h-full w-full object-contain opacity-35 grayscale saturate-0 brightness-125 contrast-75"
      />
      <motion.div className="absolute inset-0 overflow-hidden" style={{ clipPath: fillClip }}>
        <img src={src} alt="" aria-hidden className="h-full w-full object-contain" />
      </motion.div>
      {children}
    </motion.div>
  );
}

function VermouthAddIns({ fill }: { fill: MotionValue<number> }) {
  const iceOpacity = useTransform(fill, [0.15, 0.28], [0, 1]);
  const iceOneY = useTransform(fill, [0.15, 0.45], [-92, 2]);
  const iceTwoY = useTransform(fill, [0.22, 0.52], [-112, 7]);
  const orangeOpacity = useTransform(fill, [0.42, 0.58], [0, 1]);
  const orangeY = useTransform(fill, [0.42, 0.64], [-86, 0]);
  const oliveOpacity = useTransform(fill, [0.62, 0.78], [0, 1]);
  const oliveY = useTransform(fill, [0.62, 0.88], [-104, 0]);

  return (
    <div className="absolute inset-0 pointer-events-none">
      <motion.span
        style={{ opacity: iceOpacity, y: iceOneY, rotate: 18 }}
        className="absolute left-[41%] top-[48%] h-4 w-4 rounded-sm border border-background/80 bg-background/50 backdrop-blur-[1px]"
      />
      <motion.span
        style={{ opacity: iceOpacity, y: iceTwoY, rotate: -24 }}
        className="absolute left-[53%] top-[51%] h-5 w-5 rounded-sm border border-background/80 bg-background/45 backdrop-blur-[1px]"
      />
      <motion.span
        style={{ opacity: orangeOpacity, y: orangeY, rotate: -18 }}
        className="absolute left-[56%] top-[42%] h-8 w-8 rounded-full border-[5px] border-terracotta bg-sun"
      />
      <motion.span
        style={{ opacity: oliveOpacity, y: oliveY, rotate: -28 }}
        className="absolute left-[34%] top-[35%] h-[74px] w-[3px] origin-bottom rounded-full bg-foreground/80"
      >
        <span className="absolute -left-[7px] top-2 h-4 w-4 rounded-full bg-dot-shade ring-2 ring-background/70" />
      </motion.span>
    </div>
  );
}

export function Hero({ onSubmit }: Props) {
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState(nowStr());

  const wrapperRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: wrapperRef,
    offset: ["start start", "end end"],
  });

  const glassFill = useTransform(scrollYProgress, [0.06, 0.96], [0, 1]);

  // One pair of glasses: empty below the title, then filled and parked as section 2's header.
  const canyaX = useTransform(scrollYProgress, [0, 1], ["44vw", "47vw"]);
  const canyaY = useTransform(scrollYProgress, [0, 1], ["68vh", "14vh"]);
  const canyaRotate = useTransform(scrollYProgress, [0, 1], [0, -4]);

  const vermutX = useTransform(scrollYProgress, [0, 1], ["56vw", "53vw"]);
  const vermutY = useTransform(scrollYProgress, [0, 1], ["68vh", "14vh"]);
  const vermutRotate = useTransform(scrollYProgress, [0, 1], [0, 4]);

  // Vichy bottles slide in from the left and right edges to complete the header row.
  const bottleLeftX = useTransform(scrollYProgress, [0.62, 1], ["-58vw", "0vw"]);
  const bottleRightX = useTransform(scrollYProgress, [0.62, 1], ["58vw", "0vw"]);

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

      {/* One animated drink pair, filling while the page scrolls normally */}
      <AnimatedDrink
        src={canya}
        alt="Caña de cerveza Estrella"
        fill={glassFill}
        positionStyle={{ left: canyaX, top: canyaY, rotate: canyaRotate }}
        className="h-24 w-24 sm:h-28 sm:w-28 md:h-32 md:w-32"
      />
      <AnimatedDrink
        src={vermut}
        alt="Copa de vermut"
        fill={glassFill}
        positionStyle={{ left: vermutX, top: vermutY, rotate: vermutRotate }}
        className="h-24 w-24 sm:h-28 sm:w-28 md:h-32 md:w-32"
      >
        <VermouthAddIns fill={glassFill} />
      </AnimatedDrink>

      {/* Vichy bottles slide in from left/right edges */}
      <motion.img
        src={bottle}
        alt="Botella de Vichy Catalán"
        style={{ x: bottleLeftX }}
        className="fixed z-[1] pointer-events-none left-[32vw] top-[14vh] h-24 w-24 -translate-x-1/2 -translate-y-1/2 object-contain sm:left-[40vw] sm:h-28 sm:w-28 md:left-[42vw] md:h-32 md:w-32"
      />
      <motion.img
        src={bottle}
        alt="Botella de Vichy Catalán"
        style={{ x: bottleRightX }}
        className="fixed z-[1] pointer-events-none left-[68vw] top-[14vh] h-24 w-24 -translate-x-1/2 -translate-y-1/2 object-contain sm:left-[60vw] sm:h-28 sm:w-28 md:left-[58vw] md:h-32 md:w-32"
      />

      {/* SECTION 1 — title above the fold */}
      <section className="relative h-screen w-full">
        <div className="relative z-10 mx-auto flex h-full max-w-5xl flex-col items-center justify-center px-5 pb-40 text-center sm:pb-44">
          <h1 className="font-display font-bold leading-[0.9] text-foreground text-[20vw] sm:text-8xl md:text-9xl">
            ¿Hay <span className="text-terracotta">Sol</span>?
          </h1>
          <p className="mt-4 text-base sm:text-lg md:text-xl font-medium text-foreground/80">
            Encuentra tu terraza en Barcelona
          </p>
        </div>

        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1 text-xs font-medium text-foreground/60">
          <span>Scroll</span>
          <span aria-hidden className="animate-bounce">
            ↓
          </span>
        </div>
      </section>

      {/* SECTION 2 — CTAs */}
      <section className="relative min-h-screen w-full flex items-start justify-center px-5 pb-12 pt-56 sm:pt-60">
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
