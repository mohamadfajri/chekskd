import { useEffect, useId, useRef, useState } from "react";
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
  type CatalogPickerOption,
} from "@/lib/formationCatalog";

const RENDER_BATCH = 80;

const pickerText = {
  education: { name: "Pendidikan", noun: "pendidikan", placeholder: "Cari jenjang atau jurusan" },
  jobs: { name: "Jabatan", noun: "jabatan", placeholder: "Cari jabatan" },
} as const;

export function CatalogOptionPicker({
  mode,
  value,
  onChange,
  fieldClass,
}: {
  mode: keyof typeof pickerText;
  value?: string;
  onChange: (value?: string) => void;
  fieldClass: string;
}) {
  const { name, noun, placeholder } = pickerText[mode];
  const all = `Semua ${noun}`;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [window, setWindow] = useState({ search: "", size: RENDER_BATCH });
  const list = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const normalized = normalizeCatalogSearch(input);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(normalized), 220);
    return () => clearTimeout(timer);
  }, [normalized]);
  const options = useQuery({
    queryKey: ["catalog-picker", mode, search],
    queryFn: async ({ signal }): Promise<CatalogPickerOption[]> => {
      const params = new URLSearchParams({ mode, q: search });
      const response = await fetch(`/api/formation-catalog?${params}`, { signal });
      if (!response.ok) throw new Error(`Pilihan ${noun} belum dapat dimuat.`);
      return (await response.json()).options;
    },
    enabled: open && search === normalized,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const busy = normalized !== search || options.isPending;
  const items = busy ? [] : (options.data ?? []);
  const size = window.search === search ? window.size : RENDER_BATCH;
  const hasMore = items.length > size;
  useEffect(() => {
    if (!open || !hasMore || !list.current || !sentinel.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setWindow({ search, size: size + RENDER_BATCH });
      },
      { root: list.current, rootMargin: "0px 0px 140px 0px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [open, hasMore, search, size]);
  useEffect(() => {
    list.current?.scrollTo({ top: 0 });
  }, [search]);
  const selected = mode === "education" ? normalizeCatalogSearch(value ?? "") : value;
  const displayValue = value && (mode === "education" ? catalogEducationLabel(value) : value);
  function select(next?: string) {
    setOpen(false);
    if (next !== value) onChange(next);
  }
  return (
    <div className="grid min-w-0 gap-1 text-xs font-semibold">
      <label id={`${id}-label`} htmlFor={id}>
        {name}
      </label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setInput("");
            setSearch("");
            setWindow({ search: "", size: RENDER_BATCH });
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-labelledby={`${id}-label ${id}-value`}
            title={displayValue}
            className={`${fieldClass} flex items-center justify-between gap-2 text-left font-normal`}
          >
            <span id={`${id}-value`} className="truncate">
              {displayValue || all}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={`Pilih ${noun}`}
          align="start"
          className="w-[max(19rem,var(--radix-popover-trigger-width))] max-w-[var(--radix-popover-content-available-width)] p-0"
        >
          <Command label={`Cari ${noun}`} shouldFilter={false}>
            <CommandInput
              value={input}
              onValueChange={setInput}
              placeholder={placeholder}
              maxLength={120}
            />
            <CommandList
              ref={list}
              className="max-h-[min(300px,calc(var(--radix-popover-content-available-height)-3rem))] overscroll-contain"
            >
              <CommandGroup>
                {!normalized && (
                  <CommandItem value="all" onSelect={() => select()}>
                    <Check className={!value ? "text-primary" : "invisible"} aria-hidden />
                    {all}
                  </CommandItem>
                )}
                {items.slice(0, size).map(({ value: key, label }) => (
                  <CommandItem
                    key={key}
                    value={`${mode}:${key}`}
                    onSelect={() => select(mode === "education" ? label : key)}
                    className="items-start"
                  >
                    <Check
                      className={key === selected ? "text-primary" : "invisible"}
                      aria-hidden
                    />
                    <span className="min-w-0 break-words">{label}</span>
                  </CommandItem>
                ))}
                {mode === "education" &&
                  normalized &&
                  !busy &&
                  !items.some(({ value: key }) => key === normalized) && (
                    <CommandItem
                      value="free-text"
                      onSelect={() => select(input.trim())}
                      className="items-start"
                    >
                      <span className="min-w-0 break-words">Cari “{input.trim()}”</span>
                    </CommandItem>
                  )}
              </CommandGroup>
              {hasMore && <div ref={sentinel} className="h-px" aria-hidden />}
              {busy ? (
                <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
                  Memuat {noun}...
                </p>
              ) : options.isError ? (
                <button
                  type="button"
                  className="px-3 py-2 text-left text-sm text-primary"
                  onClick={() => void options.refetch()}
                >
                  Muat ulang {noun}
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
