import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";

async function loadCoverage(): Promise<{
  year: number;
  pusat: number;
  daerah: number;
  other: number;
}> {
  const response = await fetch("/api/manual-skd");
  if (!response.ok) throw new Error("Cakupan pembanding belum tersedia.");
  return response.json();
}

export function SkdCoverageNote({ className = "" }: { className?: string }) {
  const { data } = useQuery({
    queryKey: ["skd-comparison-coverage"],
    queryFn: loadCoverage,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const scope =
    data && !data.other && (data.pusat || data.daerah)
      ? data.pusat && data.daerah
        ? " Saat ini tersedia pembanding dari instansi pusat dan daerah."
        : ` Saat ini pembanding yang tersedia hanya dari instansi ${data.pusat ? "pusat" : "daerah"}.`
      : "";
  return (
    <p
      className={`flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2.5 text-sm leading-5 text-muted-foreground ${className}`}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <span>
        Pembanding memakai hasil SKD {data?.year ?? 2024} terverifikasi.{scope}
      </span>
    </p>
  );
}
