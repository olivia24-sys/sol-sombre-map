import sun from "@/assets/sun.png";
import orange from "@/assets/orange.png";
import flower from "@/assets/flower.png";
import olive from "@/assets/olive.png";
import canya from "@/assets/canya.png";
import vermut from "@/assets/vermut.png";

type Item = { src: string; alt: string; className: string; style?: React.CSSProperties; delay?: number };

const items: Item[] = [
  { src: sun, alt: "", className: "top-[5%] left-[5%] w-20 sm:w-24 spin-slow", style: { ["--r" as any]: "0deg" } },
  { src: orange, alt: "", className: "top-[10%] right-[7%] w-16 sm:w-20 float", style: { ["--r" as any]: "-12deg", animationDelay: "0.5s" } },
  { src: vermut, alt: "", className: "top-[38%] right-[4%] w-16 sm:w-20 float", style: { ["--r" as any]: "8deg", animationDelay: "0.8s" } },
  { src: flower, alt: "", className: "top-[44%] left-[4%] w-14 sm:w-16 float", style: { ["--r" as any]: "10deg", animationDelay: "1s" } },
  { src: olive, alt: "", className: "bottom-[22%] right-[3%] w-24 sm:w-28 float", style: { ["--r" as any]: "-8deg", animationDelay: "1.5s" } },
  { src: canya, alt: "", className: "bottom-[8%] left-[7%] w-16 sm:w-20 float", style: { ["--r" as any]: "6deg", animationDelay: "2s" } },
  { src: sun, alt: "", className: "bottom-[46%] left-[42%] w-10 sm:w-12 spin-slow opacity-70", style: { animationDuration: "60s" } },
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
