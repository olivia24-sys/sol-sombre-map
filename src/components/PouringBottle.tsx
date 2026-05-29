import { motion, useScroll, useTransform, MotionValue } from "motion/react";
import { useRef } from "react";
import bottle from "@/assets/bottle.png";

export function PouringBottle() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  // Tilts from 0 to -65deg as user scrolls down through hero
  const rotate = useTransform(scrollYProgress, [0, 0.6], [0, -65]);
  const x = useTransform(scrollYProgress, [0, 0.6], [0, -40]);
  const streamHeight = useTransform(scrollYProgress, [0.15, 0.7], [0, 320]);
  const streamOpacity = useTransform(scrollYProgress, [0.1, 0.2, 0.7], [0, 1, 1]);

  return (
    <div ref={ref} className="relative w-full flex justify-center items-end">
      <div className="relative">
        <motion.img
          src={bottle}
          alt="Botella de Vichy Catalán"
          style={{ rotate, x, transformOrigin: "70% 90%" }}
          className="relative z-10 h-[58vh] max-h-[520px] w-auto drop-shadow-[0_18px_24px_rgba(27,58,140,0.18)]"
        />
        {/* Pouring stream */}
        <motion.div
          style={{ height: streamHeight, opacity: streamOpacity }}
          className="absolute z-0 left-[60%] top-[6%] w-2 sm:w-2.5 rounded-full bg-gradient-to-b from-cobalt/60 via-cobalt/40 to-transparent"
        >
          <Bubbles progress={scrollYProgress} />
        </motion.div>
      </div>
    </div>
  );
}

function Bubbles({ progress }: { progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [0.2, 0.4], [0, 1]);
  return (
    <motion.div style={{ opacity }} className="absolute inset-0">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="absolute left-1/2 -translate-x-1/2 block w-1.5 h-1.5 rounded-full bg-white/90"
          style={{
            top: `${20 + i * 16}%`,
            animation: `bubble-rise 1.8s ${i * 0.3}s ease-out infinite`,
          }}
        />
      ))}
    </motion.div>
  );
}
