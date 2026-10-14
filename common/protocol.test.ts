import { isFanControlActivity, isState } from "./protocol";

function snapshot() {
  return {
    protocolVersion: "1.1",
    cpuFanTable: [[40, 15]],
    gpuFanTable: [[50, 20]],
    doFixedSpeed: false,
    fixedPercentage: 50,
    gpuBoost: true,
    pl1: 37,
    pl2: 106,
    isFanControlAvailable: false,
    isCpuTuningAvailable: false,
    isGpuBoostAvailable: false,
  };
}

describe("protocol boundary decoding", () => {
  it("accepts current and compatible additive snapshots", () => {
    expect(isState(snapshot())).toBe(true);
    expect(isState({ ...snapshot(), restartRequired: true })).toBe(true);
    expect(isState({ ...snapshot(), protocolVersion: "1.0" })).toBe(true);
    expect(
      isState({ ...snapshot(), protocolVersion: "1.20", futureFeature: true }),
    ).toBe(true);
    expect(
      isState({
        ...snapshot(),
        isFanControlAvailable: undefined,
        isCpuTuningAvailable: undefined,
        isGpuBoostAvailable: undefined,
      }),
    ).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { ...snapshot(), protocolVersion: "2.0" },
    { ...snapshot(), protocolVersion: "1.1junk" },
    { ...snapshot(), doFixedSpeed: "false" },
    { ...snapshot(), isFanControlAvailable: null },
    { ...snapshot(), restartRequired: "true" },
    { ...snapshot(), pl1: 200.5 },
    { ...snapshot(), fixedPercentage: -1 },
    { ...snapshot(), cpuFanTable: [] },
    { ...snapshot(), gpuFanTable: [[111, 50]] },
    {
      ...snapshot(),
      gpuFanTable: [
        [80, 50],
        [40, 15],
      ],
    },
  ])("rejects malformed or incompatible state %#", (value) => {
    expect(isState(value)).toBe(false);
  });

  it("shares fractional fan curve rules with the backend", () => {
    expect(isState({ ...snapshot(), cpuFanTable: [[40.5, 15.5]] })).toBe(true);
  });

  const activity = {
    appliedSpeed: 0,
    avgCPUTemp: 0,
    avgGPUTemp: 50,
    target: 0,
    sensorFailure: false,
  };

  it("accepts zero values, failed applications, and legacy telemetry", () => {
    expect(isFanControlActivity(activity)).toBe(true);
    expect(isFanControlActivity({ ...activity, appliedSpeed: null })).toBe(
      true,
    );
    expect(
      isFanControlActivity({ ...activity, sensorFailure: undefined }),
    ).toBe(true);
  });

  it.each([
    null,
    {},
    { ...activity, appliedSpeed: 101 },
    { ...activity, avgCPUTemp: null },
    { ...activity, avgGPUTemp: Number.NaN },
    { ...activity, target: Number.POSITIVE_INFINITY },
    { ...activity, sensorFailure: "false" },
  ])("rejects invalid telemetry %#", (value) => {
    expect(isFanControlActivity(value)).toBe(false);
  });
});
