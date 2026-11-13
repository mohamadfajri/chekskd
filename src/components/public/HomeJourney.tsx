import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  ClipboardCheck,
  Crosshair,
  ListFilter,
} from "lucide-react";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import type { UseEmblaCarouselType } from "embla-carousel-react";

const slides = [
  { label: "SKD lama", icon: ClipboardCheck, image: "/home-slide-skd-2024.png" },
  { label: "Tryout", icon: ChartNoAxesColumnIncreasing, image: null },
  { label: "Pesaing", icon: Crosshair, image: null },
  { label: "Formasi", icon: ListFilter, image: null },
] as const;

export function HomeJourney() {
  const [api, setApi] = useState<UseEmblaCarouselType[1]>();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!api) return;
    const sync = () => setActive(api.selectedScrollSnap());
    sync();
    api.on("select", sync).on("reInit", sync);
    return () => {
      api.off("select", sync).off("reInit", sync);
    };
  }, [api]);

  function goTo(index: number) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    api?.scrollTo((index + slides.length) % slides.length, reduceMotion);
  }

  return (
    <section id="cara-kerja" className="home-flow">
      <Carousel
        aria-label="Alur analisis SKD"
        className="home-flow-carousel"
        opts={{ loop: true }}
        setApi={setApi}
      >
        <div className="home-flow-topics" aria-label="Topik ilustrasi" role="group">
          {slides.map(({ label, icon: Icon }, index) => (
            <button
              key={label}
              type="button"
              aria-pressed={index === active}
              onClick={() => goTo(index)}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <CarouselContent className="ml-0">
          {slides.map(({ label, image }, index) => (
            <CarouselItem
              key={label}
              className="home-flow-slide pl-0"
              aria-hidden={index !== active}
              inert={index !== active}
              aria-label={`${index + 1} dari ${slides.length}: ${label}`}
            >
              <div className="home-banner" data-empty={!image}>
                {image && (
                  <>
                    <img
                      src={image}
                      width={1754}
                      height={897}
                      draggable={false}
                      alt="Nilai SKD lamamu masih bisa bersaing? Contoh nilai SKD 2024: 370 dari 550. Pakai nilai lama atau tes ulang?"
                    />
                    <Link
                      to="/search"
                      search={{ targetFormationId: undefined }}
                      className="home-banner-link"
                      aria-label="Cek Nilai Saya"
                    />
                  </>
                )}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <div className="home-flow-controls">
          <div className="home-flow-caption" aria-live="polite">
            {slides[active].image && <span>Angka hanya ilustrasi</span>}
            <span className="sr-only">{slides[active].label}</span>
          </div>
          <div className="home-flow-nav">
            <button
              type="button"
              aria-label="Slide sebelumnya"
              title="Slide sebelumnya"
              onClick={() => goTo(active - 1)}
            >
              <ArrowLeft className="size-4" aria-hidden />
            </button>
            <span className="home-flow-count font-mono">
              {active + 1} / {slides.length}
            </span>
            <button
              type="button"
              aria-label="Slide berikutnya"
              title="Slide berikutnya"
              onClick={() => goTo(active + 1)}
            >
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </Carousel>
    </section>
  );
}
