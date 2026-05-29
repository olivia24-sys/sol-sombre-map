import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Clock, Pencil, X, ExternalLink, Sun, TreePine } from "lucide-react";

type Terrace = {
  id: string;
  name: string;
  address: string;
  x: number; // %
  y: number; // %
  sun: boolean;
};

const TERRACES: Terrace[] = [
  { id: "1", name: "Bar Calders", address: "Carrer del Parlament, 25", x: 28, y: 62, sun: true },
  { id: "2", name: "El Xampanyet", address: "Carrer de Montcada, 22", x: 58, y: 44, sun: false },
  { id: "3", name: "Quimet & Quimet", address: "Carrer del Poeta Cabanyes, 25", x: 22, y: 74, sun: true },
  { id: "4", name: "La Vermu", address: "Carrer de Robadors, 12", x: 44, y: 58, sun: true },
  { id: "5", name: "Bodega 1900", address: "Carrer de Tamarit, 91", x: 18, y: 56, sun: false },
  { id: "6", name: "Café del Born", address: "Plaça Comercial, 10", x: 64, y: 50, sun: true },
  { id: "7", name: "Bar Mut", address: "Carrer de Pau Claris, 192", x: 52, y: 28, sun: false },
  { id: "8", name: "Granja Petitbo", address: "Passeig de Sant Joan, 82", x: 68, y: 32, sun: true },
  { id: "9", name: "Bar Salvatge", address: "Carrer de Sant Pere Més Alt, 68", x: 56, y: 38, sun: true },
  { id: "10", name: "El Sortidor", address: "Plaça del Sortidor, 5", x: 30, y: 80, sun: false },
  { id: "11", name: "La Confitería", address: "Carrer de Sant Pau, 128", x: 36, y: 52, sun: true },
  { id: "12", name: "Bar del Pla", address: "Carrer de Montcada, 2", x: 60, y: 48, sun: false },
  { id: "13", name: "Federal Café", address: "Carrer del Parlament, 39", x: 26, y: 66, sun: true },
  { id: "14", name: "Bormuth", address: "Carrer del Rec, 31", x: 62, y: 46, sun: true },
];

function formatWhen(d: Date) {
  const isToday = new Date().toDateString() === d.toDateString();
  const time = d.toTimeString().slice(0, 5);
  if (isToday) return `Ahora · ${time}`;
  const day = d.toLocaleDateString("es-ES", { weekday: "long" });
  return `${day.charAt(0).toUpperCase() + day.slice(1)} · ${time}`;
}

type Props = {
  when: Date;
  onEdit: () => void;
};

export function MapView({ when, onEdit }: Props) {
  const [selected, setSelected] = useState<Terrace | null>(null);

  return (
    <section className="relative w-full h-screen overflow-hidden bg-muted">
      {/* Mock map */}
      <div className="absolute inset-0 mock-map" />
      {/* Subtle streets overlay */}
      <svg className="absolute inset-0 w-full h-full opacity-50" preserveAspectRatio="none" viewBox="0 0 100 100">
        <g stroke="#a89e88" strokeWidth="0.3" fill="none">
          <path d="M0,30 L100,25" />
          <path d="M0,55 L100,60" />
          <path d="M0,80 L100,78" />
          <path d="M25,0 L30,100" />
          <path d="M55,0 L52,100" />
          <path d="M78,0 L80,100" />
          <path d="M10,10 L90,90" strokeWidth="0.2" />
        </g>
      </svg>

      {/* Time pill */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 md:left-6 md:translate-x-0">
        <button
          onClick={onEdit}
          className="flex items-center gap-2 rounded-full bg-foreground text-background pl-4 pr-3 py-2.5 shadow-lg font-display font-semibold text-sm hover:bg-terracotta transition-colors"
        >
          <Clock className="size-4" />
          {formatWhen(when)}
          <span className="ml-1 grid place-items-center size-6 rounded-full bg-background/15">
            <Pencil className="size-3" />
          </span>
        </button>
      </div>

      {/* Legend */}
      <div className="absolute top-4 right-4 z-20 hidden sm:flex flex-col gap-1.5 rounded-2xl bg-background/90 backdrop-blur px-3 py-2 shadow-md text-xs font-medium">
        <span className="flex items-center gap-2"><span className="size-3 rounded-full bg-dot-sun ring-2 ring-foreground/10" /> Sol</span>
        <span className="flex items-center gap-2"><span className="size-3 rounded-full bg-dot-shade ring-2 ring-foreground/10" /> Sombra</span>
      </div>

      {/* Dots */}
      {TERRACES.map((t) => (
        <button
          key={t.id}
          onClick={() => setSelected(t)}
          aria-label={t.name}
          className="absolute z-10 -translate-x-1/2 -translate-y-1/2 group"
          style={{ left: `${t.x}%`, top: `${t.y}%` }}
        >
          <span
            className={`block size-5 sm:size-6 rounded-full ring-4 ring-background shadow-[0_2px_6px_rgba(0,0,0,0.25)] transition-transform group-hover:scale-125 ${
              t.sun ? "bg-dot-sun" : "bg-dot-shade"
            } ${selected?.id === t.id ? "scale-125 ring-foreground" : ""}`}
          />
          {t.sun && (
            <span className="absolute inset-0 rounded-full bg-dot-sun animate-ping opacity-40" />
          )}
        </button>
      ))}

      {/* Bottom sheet */}
      <AnimatePresence>
        {selected && (
          <motion.div
            key={selected.id}
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute z-30 bottom-0 left-0 right-0 md:left-6 md:bottom-6 md:right-auto md:w-80 rounded-t-3xl md:rounded-3xl bg-background shadow-[0_-8px_30px_rgba(0,0,0,0.15)] p-5 pb-7"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`grid place-items-center size-9 rounded-full ${
                    selected.sun ? "bg-dot-sun text-foreground" : "bg-dot-shade text-background"
                  }`}
                >
                  {selected.sun ? <Sun className="size-5" /> : <TreePine className="size-5" />}
                </span>
                <span className="font-display font-semibold text-sm">
                  {selected.sun ? "En el sol" : "En la sombra"}
                </span>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="grid place-items-center size-8 rounded-full hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="size-4" />
              </button>
            </div>
            <h2 className="mt-3 font-display text-2xl font-bold leading-tight">{selected.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{selected.address}</p>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                selected.name + ", " + selected.address + ", Barcelona"
              )}`}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 font-display font-semibold text-terracotta hover:text-coral"
            >
              Como llegar
              <ExternalLink className="size-4" />
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
