import { useId, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  normalizeCatalogSearch,
  type CatalogLevel,
  type CatalogResponse,
} from "@/lib/formationCatalog";

const groups = [
  { level: "pusat", label: "Instansi pusat", keywords: ["pusat"] },
  { level: "daerah", label: "Instansi daerah (Pemda)", keywords: ["daerah pemda"] },
  { level: null, label: "Instansi lainnya", keywords: [] },
] as const;

function institutionFilter(value: string, search: string, keywords?: string[]) {
  const name = normalizeCatalogSearch([value, ...(keywords ?? [])].join(" "));
  const words = normalizeCatalogSearch(search).split(" ");
  return words.every((word) => name.includes(word)) ? 1 : 0;
}

export function CatalogInstitutionPicker({
  institutions,
  level,
  value,
  onChange,
  fieldClass,
}: {
  institutions: CatalogResponse["institutions"] | undefined;
  level?: CatalogLevel;
  value?: string;
  onChange: (value?: string) => void;
  fieldClass: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  function select(name?: string) {
    setOpen(false);
    if (name !== value) onChange(name);
  }

  return (
    <div className="grid min-w-0 gap-1 text-xs font-semibold">
      <label id={`${id}-label`} htmlFor={id}>
        Instansi
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-labelledby={`${id}-label ${id}-value`}
            className={`${fieldClass} flex items-center justify-between gap-2 text-left font-normal disabled:opacity-50`}
            title={value ?? "Semua instansi"}
            disabled={!institutions}
          >
            <span id={`${id}-value`} className="truncate">
              {value ?? "Semua instansi"}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label="Pilih instansi"
          align="start"
          className="w-[max(20rem,var(--radix-popover-trigger-width))] max-w-[var(--radix-popover-content-available-width)] p-0"
        >
          <Command label="Cari instansi" filter={institutionFilter}>
            <CommandInput placeholder="Cari instansi" maxLength={120} />
            <CommandList className="max-h-[min(300px,calc(var(--radix-popover-content-available-height)-3rem))] overscroll-contain">
              <CommandEmpty>Instansi tidak ditemukan.</CommandEmpty>
              <CommandGroup>
                <CommandItem value="Semua instansi" onSelect={() => select()}>
                  <Check className={!value ? "text-primary" : "invisible"} aria-hidden />
                  Semua instansi
                </CommandItem>
              </CommandGroup>
              {groups
                .filter((group) => !level || group.level === level)
                .map((group) => {
                  const options = institutions?.filter((item) => item.level === group.level) ?? [];
                  return options.length ? (
                    <CommandGroup key={group.label} heading={group.label}>
                      {options.map(({ name }) => (
                        <CommandItem
                          key={name}
                          value={name}
                          keywords={[
                            ...group.keywords,
                            name.replace(
                              /^Pemerintah (Provinsi|Kabupaten|Kota)\b/i,
                              (_, kind: string) =>
                                ({ provinsi: "Pemprov", kabupaten: "Pemkab", kota: "Pemkot" })[
                                  kind.toLowerCase()
                                ] ?? kind,
                            ),
                          ]}
                          className="items-start"
                          onSelect={() => select(name)}
                        >
                          <Check
                            className={name === value ? "text-primary" : "invisible"}
                            aria-hidden
                          />
                          <span className="min-w-0 break-words">{name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null;
                })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
