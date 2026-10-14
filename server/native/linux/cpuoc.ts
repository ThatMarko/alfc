const RAPL_DIRECTORIES = [
  "/sys/devices/virtual/powercap/intel-rapl/intel-rapl:0",
  "/sys/class/powercap/intel-rapl:0",
  "/sys/class/powercap/intel-rapl-mmio:0",
];

let limits: { pl1: string; pl2: string } | undefined;
let poisonedError: Error | undefined;

export async function tuneInit() {
  if (poisonedError) throw poisonedError;
  if (limits) return;
  for (const directory of RAPL_DIRECTORIES) {
    const paths = [0, 1].map(
      (index) => `${directory}/constraint_${index}_power_limit_uw`,
    );
    if (
      !(await Promise.all(paths.map((name) => Bun.file(name).exists()))).every(
        Boolean,
      )
    )
      continue;

    // Constraint indices are driver details; names identify the long- and
    // short-term limits. Older drivers may omit the optional name files.
    const names = await Promise.all(
      [0, 1].map(async (index) => {
        const file = Bun.file(`${directory}/constraint_${index}_name`);
        return (await file.exists()) ? (await file.text()).trim() : "";
      }),
    );
    const longIndex = names.indexOf("long_term");
    const shortIndex = names.indexOf("short_term");
    const pl1 =
      paths[longIndex < 0 && names.every((name) => !name) ? 0 : longIndex];
    const pl2 =
      paths[shortIndex < 0 && names.every((name) => !name) ? 1 : shortIndex];
    if (pl1 && pl2) {
      limits = { pl1, pl2 };
      return;
    }
  }
  throw new Error(
    "Intel RAPL long-term and short-term package limits are unavailable",
  );
}

async function readLimit(path: string) {
  const value = (await Bun.file(path).text()).trim();
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`Invalid RAPL power limit at ${path}`);
  }
  return value;
}

export async function tune(pl1: number, pl2: number) {
  for (const value of [pl1, pl2]) {
    if (!Number.isInteger(value) || value < 0 || value > 200) {
      throw new RangeError(
        "CPU power limits must be integers between 0 and 200 watts",
      );
    }
  }
  await tuneInit();
  if (!limits) throw new Error("Intel RAPL is not initialized");
  const paths = [limits.pl1, limits.pl2];
  const previous = await Promise.all(paths.map(readLimit));
  const requested = [String(pl1 * 1_000_000), String(pl2 * 1_000_000)];
  try {
    for (const [index, path] of paths.entries()) {
      await Bun.write(path, requested[index] ?? "");
    }
    const applied = await Promise.all(paths.map(readLimit));
    if (applied.some((value, index) => value !== requested[index])) {
      throw new Error(
        "The kernel did not apply the requested CPU power limits",
      );
    }
  } catch (error) {
    const errors: unknown[] = [error];
    for (const [index, path] of paths.entries()) {
      try {
        await Bun.write(path, previous[index] ?? "");
      } catch (restoreError) {
        errors.push(restoreError);
      }
    }
    try {
      const restored = await Promise.all(paths.map(readLimit));
      if (restored.some((value, index) => value !== previous[index])) {
        errors.push(
          new Error("The kernel did not restore the previous CPU power limits"),
        );
      }
    } catch (restoreError) {
      errors.push(restoreError);
    }
    const failure = Object.assign(
      new AggregateError(
        errors,
        errors.length > 1
          ? "CPU tuning failed and previous power limits could not be fully restored"
          : "CPU tuning failed; previous power limits restored",
      ),
      { restartRequired: errors.length > 1 },
    );
    if (failure.restartRequired) poisonedError = failure;
    throw failure;
  }
}

export function cpuocCleanup() {}
