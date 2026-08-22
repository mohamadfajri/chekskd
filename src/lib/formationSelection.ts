export const MAX_COMPARISON_FORMATIONS = 3;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function cleanFormationId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return UUID_PATTERN.test(cleaned) ? cleaned : undefined;
}

export function parseFormationIds(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => cleanFormationId(item))
        .filter(Boolean),
    ),
  ).slice(0, MAX_COMPARISON_FORMATIONS) as string[];
}

export function serializeFormationIds(ids: string[]): string | undefined {
  const cleaned = Array.from(new Set(ids.map((id) => cleanFormationId(id)).filter(Boolean))).slice(
    0,
    MAX_COMPARISON_FORMATIONS,
  ) as string[];
  return cleaned.length ? cleaned.join(",") : undefined;
}
