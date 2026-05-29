import { useState } from "react";
import { ArrowRight, Calendar, Clock } from "lucide-react";
import { ScatteredIllustrations } from "./Illustrations";
import { PouringBottle } from "./PouringBottle";

type Props = {
  onSubmit: (when: Date) => void;
};

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function nowStr() {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

export function Hero({ onSubmit }: Props) {
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState(nowStr());

  return (
    <section className="relative min-h-screen w-full bg-sun text-foreground overflow-hidden">
      <ScatteredIllustrations />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center px-5 pt-12 pb-10 md:grid md:grid-cols-2 md:gap-10 md:pt-20">
        {/* Bottle column (desktop left) */}
        <div className="order-2 md:order-1 mt-2 md:mt-0 flex items-end justify-center w-full">
          <PouringBottle />
        </div>

        {/* Text + inputs column */}
        <div className="order-1 md:order-2 flex flex-col items-center md:items-start text-center md:text-left w-full max-w-md">
          <h1 className="font-display text-[18vw] leading-[0.9] sm:text-7xl md:text-8xl font-bold text-foreground">
            ¿Hay <span className="text-terracotta">Sol</span>?
          </h1>
          <p className="mt-4 text-base sm:text-lg font-medium text-foreground/80">
            Encuentra tu terraza en Barcelona
          </p>

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
      </div>

      {/* scroll hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 text-xs font-medium text-foreground/60 animate-bounce">
        Scroll ↓
      </div>
    </section>
  );
}
