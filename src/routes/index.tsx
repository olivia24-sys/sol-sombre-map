import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Hero } from "@/components/Hero";
import { MapView } from "@/components/MapView";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "¿Hay Sol? — Encuentra tu terraza al sol en Barcelona" },
      {
        name: "description",
        content:
          "Mira qué terrazas de Barcelona estarán al sol o a la sombra a la hora que elijas. Hecho con amor en Barcelona.",
      },
      { property: "og:title", content: "¿Hay Sol?" },
      {
        property: "og:description",
        content: "Encuentra tu terraza al sol o a la sombra en Barcelona.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [when, setWhen] = useState<Date | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (when && mapRef.current) {
      mapRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [when]);

  const handleEdit = () => {
    // Scroll to the date/time CTA (Section 2 inside Hero), not the hero top.
    const sections = heroRef.current?.querySelectorAll("section");
    const target = sections && sections.length > 1 ? sections[1] : heroRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main>
      <div ref={heroRef}>
        <Hero onSubmit={(d) => setWhen(d)} />
      </div>
      {when && (
        <div ref={mapRef}>
          <MapView when={when} onEdit={handleEdit} />
        </div>
      )}
    </main>
  );
}
