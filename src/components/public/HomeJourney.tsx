import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import type { UseEmblaCarouselType } from "embla-carousel-react";

const slides = [
  {
    label: "SKD lama",
    image: "/home-slide-skd-2024.png",
    size: [1754, 897],
    crop: [51, 84, 1656, 667],
    button: [124, 597, 452, 98],
    alt: "Nilai SKD lamamu masih bisa bersaing? Contoh nilai SKD 2024: 370 dari 550.",
    action: "Cek Nilai Saya",
    to: "/search",
  },
  {
    label: "Tryout",
    image: "/home-slide-tryout.png",
    size: [1672, 941],
    crop: [42, 102, 1589, 721],
    button: [114, 617, 497, 95],
    alt: "Contoh perbandingan skor tryout 382 dengan nilai SKD 2024 di formasi: 389.",
    action: "Cek Nilai Saya",
    to: "/simulasi-skd",
  },
  {
    label: "Pesaing",
    image: "/home-slide-pesaing.png",
    size: [1672, 941],
    crop: [44, 112, 1584, 693],
    button: [116, 622, 470, 89],
    alt: "Intip nilai pesaing formasi. Contoh nilai Analis SDM: terendah 345, rata-rata 389, tertinggi 452.",
    action: "Lihat Nilai Pesaing",
    to: "/formasi",
    search: { skd: true },
  },
  {
    label: "Formasi",
    image: "/home-slide-rasionalisasi.png",
    size: [1672, 941],
    crop: [46, 87, 1582, 737],
    button: [112, 648, 500, 89],
    alt: "Ilustrasi rasionalisasi formasi dengan contoh kategori peluang tinggi, sedang, dan rendah.",
    action: "Cari Formasi Terbaik",
    to: "/formasi",
  },
] as const;

const percent = (value: number, total: number) => `${(value / total) * 100}%`;

function BannerSlide({ slide }: { slide: (typeof slides)[number] }) {
  const [width, height] = slide.size;
  const [x, y, cropWidth, cropHeight] = slide.crop;
  const [left, top, buttonWidth, buttonHeight] = slide.button;
  const frameStyle = {
    "--banner-width": percent((cropWidth / cropHeight) * 667, 1656),
  } as CSSProperties;
  return (
    <div className="home-banner">
      <div className="home-banner-art" style={frameStyle}>
        <img
          src={slide.image}
          width={width}
          height={height}
          draggable={false}
          alt={slide.alt}
          style={{
            left: percent(-x, cropWidth),
            top: percent(-y, cropHeight),
            width: percent(width, cropWidth),
          }}
        />
        <Link
          to={slide.to}
          search={"search" in slide ? slide.search : { targetFormationId: undefined }}
          className="home-banner-link"
          aria-label={slide.action}
          style={{
            left: percent(left - x, cropWidth),
            top: percent(top - y, cropHeight),
            width: percent(buttonWidth, cropWidth),
            height: percent(buttonHeight, cropHeight),
          }}
        />
      </div>
    </div>
  );
}

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
        <CarouselContent className="ml-0">
          {slides.map((slide, index) => (
            <CarouselItem
              key={slide.label}
              className="home-flow-slide pl-0"
              aria-hidden={index !== active}
              inert={index !== active}
              aria-label={`${index + 1} dari ${slides.length}: ${slide.label}`}
            >
              <BannerSlide slide={slide} />
            </CarouselItem>
          ))}
        </CarouselContent>
        <div className="home-flow-controls">
          <div className="home-flow-nav">
            <button
              type="button"
              aria-label="Slide sebelumnya"
              title="Slide sebelumnya"
              disabled={!api}
              onClick={() => goTo(active - 1)}
            >
              <ArrowLeft className="size-4" aria-hidden />
            </button>
            <span className="home-flow-count font-mono" aria-live="polite">
              {active + 1} / {slides.length}
            </span>
            <button
              type="button"
              aria-label="Slide berikutnya"
              title="Slide berikutnya"
              disabled={!api}
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
