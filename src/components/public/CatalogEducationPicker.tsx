import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  catalogEducationLabel,
  normalizeCatalogSearch,
  type CatalogEducationOption,
} from "@/lib/formationCatalog";

export function CatalogEducationPicker({
  value,
  onChange,
  fieldClass,
}: {
  value?: string;
  onChange: (value?: string) => void;
  fieldClass: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const normalized = normalizeCatalogSearch(input);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(normalized), 220);
    return () => clearTimeout(timer);
  }, [normalized]);
  const options = useQuery({
    queryKey: ["catalog-education", search],
    queryFn: async ({ signal }): Promise<CatalogEducationOption[]> => {
      const params = new URLSearchParams({ mode: "education", q: search });
      const response = await fetch(`/api/formation-catalog?${params}`, { signal });
      if (!response.ok) throw new Error("Pilihan pendidikan belum dapat dimuat.");
      return (await response.json()).options;
    },
    enabled: open && search === normalized,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const busy = normalized !== search || options.isPending;
  const items = busy ? [] : (options.data ?? []);
  const selected = normalizeCatalogSearch(value ?? "");
  function select(next?: string) {
    setOpen(false);
    if (next !== value) onChange(next);
  }
  return (
    <div className="grid min-w-0 gap-1 text-xs font-semibold">
      <label id={`${id}-label`} htmlFor={id}>
        Pendidikan
      </label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setInput("");
            setSearch("");
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-labelledby={`${id}-label ${id}-value`}
            title={value && catalogEducationLabel(value)}
            className={`${fieldClass} flex items-center justify-between gap-2 text-left font-normal`}
          >
            <span id={`${id}-value`} className="truncate">
              {value ? catalogEducationLabel(value) : "Semua pendidikan"}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label="Pilih pendidikan"
          align="start"
          className="w-[max(19rem,var(--radix-popover-trigger-width))] max-w-[var(--radix-popover-content-available-width)] p-0"
        >
          <Command label="Cari pendidikan" shouldFilter={false}>
            <CommandInput
              value={input}
              onValueChange={setInput}
              placeholder="Cari jenjang atau jurusan"
              maxLength={120}
            />
            <CommandList className="max-h-[min(300px,calc(var(--radix-popover-content-available-height)-3rem))] overscroll-contain">
              <CommandGroup>
                {!normalized && (
                  <CommandItem value="all" onSelect={() => select()}>
                    <Check className={!value ? "text-primary" : "invisible"} aria-hidden />
                    Semua pendidikan
                  </CommandItem>
                )}
                {items.map(({ value: key, label }) => (
                  <CommandItem
                    key={key}
                    value={`education:${key}`}
                    onSelect={() => select(label)}
                    className="items-start"
                  >
                    <Check
                      className={key === selected ? "text-primary" : "invisible"}
                      aria-hidden
                    />
                    <span className="min-w-0 break-words">{label}</span>
                  </CommandItem>
                ))}
                {normalized && !busy && !items.some(({ value: key }) => key === normalized) && (
                  <CommandItem
                    value="free-text"
                    onSelect={() => select(input.trim())}
                    className="items-start"
                  >
                    <span className="min-w-0 break-words">Cari “{input.trim()}”</span>
                  </CommandItem>
                )}
              </CommandGroup>
              {busy ? (
                <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
                  Memuat pendidikan...
                </p>
              ) : options.isError ? (
                <button
                  type="button"
                  className="px-3 py-2 text-left text-sm text-primary"
                  onClick={() => void options.refetch()}
                >
                  Muat ulang pendidikan
                </button>
              ) : (
                !items.length && (
                  <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
                    Tidak ada pilihan yang cocok.
                  </p>
                )
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
