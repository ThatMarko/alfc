const PL1_PATH =
  "/sys/devices/virtual/powercap/intel-rapl/intel-rapl:0/constraint_0_power_limit_uw";
const PL2_PATH =
  "/sys/devices/virtual/powercap/intel-rapl/intel-rapl:0/constraint_1_power_limit_uw";

export async function tuneInit() {}

export async function tune(pl1: number, pl2: number) {
  await Bun.write(PL1_PATH, String(pl1 * 1000000));
  await Bun.write(PL2_PATH, String(pl2 * 1000000));
}
