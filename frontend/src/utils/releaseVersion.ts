type Version = { core: bigint[]; prerelease: string[] };

function parseVersion(value: string): Version | null {
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value,
    );
  if (!match) return null;
  const core = match.slice(1, 4).map((part) => BigInt(part));
  const prerelease = match[4]?.split(".") ?? [];
  if (
    prerelease.some(
      (part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"),
    )
  )
    return null;
  return { core, prerelease };
}

// SemVer precedence ignores build metadata and compares numeric identifiers
// numerically. A different tag can still be older than the running build.
export function isNewerReleaseVersion(
  latest: string,
  current: string,
): boolean {
  const candidate = parseVersion(latest);
  const installed = parseVersion(current);
  if (!candidate || !installed) return false;
  for (let index = 0; index < 3; index++) {
    const next = candidate.core[index];
    const previous = installed.core[index];
    if (next !== undefined && previous !== undefined && next !== previous)
      return next > previous;
  }
  if (candidate.prerelease.length === 0) return installed.prerelease.length > 0;
  if (installed.prerelease.length === 0) return false;
  for (
    let index = 0;
    index < Math.max(candidate.prerelease.length, installed.prerelease.length);
    index++
  ) {
    const next = candidate.prerelease[index];
    const previous = installed.prerelease[index];
    if (next === undefined) return false;
    if (previous === undefined) return true;
    if (next === previous) continue;
    const nextNumeric = /^\d+$/.test(next);
    const previousNumeric = /^\d+$/.test(previous);
    if (nextNumeric && previousNumeric) return BigInt(next) > BigInt(previous);
    if (nextNumeric !== previousNumeric) return !nextNumeric;
    return next > previous;
  }
  return false;
}
