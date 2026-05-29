import sun from "@/assets/sun.png";
import orange from "@/assets/orange.png";
import flower from "@/assets/flower.png";
import olive from "@/assets/olive.png";
import canya from "@/assets/canya.png";

type Item = { src: string; alt: string; className: string; style?: React.CSSProperties; delay?: number };

const items: Item[] = [
  { src: sun, alt: "", className: "top-[6%] left-[6%] w-20 sm:w-24 spin-slow", style: { ["--r" as any]: "0deg" } },
  { src: orange, alt: "", className: "top-[12%] right-[8%] w-16 sm:w-20 float", style: { ["--r" as any]: "-12deg", animationDelay: "0.5s" } },
  { src: flower, alt: "", className: "top-[42%] left-[4%] w-14 sm:w-16 float", style: { ["--r" as any]: "10deg", animationDelay: "1s" } },
  { src: olive, alt: "", className: "bottom-[20%] right-[2%] w-24 sm:w-28 float", style: { ["--r" as any]: "-8deg", animationDelay: "1.5s" } },
  { src: canya, alt: "", className: "bottom-[8%] left-[8%] w-16 sm:w-20 float", style: { ["--r" as any]: "6deg", animationDelay: "2s" } },
  { src: sun, alt: "", className: "bottom-[44%] right-[6%] w-12 sm:w-14 spin-slow opacity-80", style: { animationDuration: "60s" } },
];

export function ScatteredIllustrations() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((it, i) => (
        <img
          key={i}
          src={it.src}
          alt={it.alt}
          loading="lazy"
          className={`absolute ${it.className} drop-shadow-[0_6px_0_rgba(26,26,26,0.08)]`}
          style={it.style}
        />
      ))}
    </div>
  );
}
