import orange from "@/assets/orange.png";
import olive from "@/assets/olive.png";

type Item = { src: string; alt: string; className: string; style?: React.CSSProperties };

// Scatter only the small accents around the title (bottle, canya, vermut are
// rendered separately so they can be scroll-animated).
const items: Item[] = [
  {
    src: orange,
    alt: "",
    className: "top-[12%] left-[6%] w-16 sm:w-20 md:w-24 float",
    style: { ["--r" as any]: "-10deg", animationDelay: "0.4s" },
  },
  {
    src: olive,
    alt: "",
    className: "bottom-[14%] left-[4%] w-24 sm:w-32 md:w-40 float",
    style: { ["--r" as any]: "-6deg", animationDelay: "1.2s" },
  },
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
          className={`absolute ${it.className}`}
          style={it.style}
        />
      ))}
    </div>
  );
}
