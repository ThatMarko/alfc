// A valid curve may use adjacent IEEE-754 temperatures. Inserting a midpoint
// must never round back to an existing row and create a duplicate temperature.
export function fanTableInsertionTemperature(
  table: readonly (readonly [string, string, ...unknown[]])[],
  row: number,
): number | null {
  const raw = table[row]?.[0];
  if (raw === undefined || raw.trim() === "") return null;
  const current = Number(raw);
  if (!Number.isFinite(current) || current <= 0 || current > 110) return null;
  if (row === 0) return current / 2;
  const previousRaw = table[row - 1]?.[0];
  if (previousRaw === undefined || previousRaw.trim() === "") return null;
  const previous = Number(previousRaw);
  if (!Number.isFinite(previous) || previous < 0 || previous >= current)
    return null;
  const midpoint = previous + (current - previous) / 2;
  return midpoint > previous && midpoint < current ? midpoint : null;
}
