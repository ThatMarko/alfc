import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import {
  isFanControlActivity,
  isFanTable,
  isState,
  isSupportedProtocolVersion,
} from "../../common/protocol";

const UI_DIR = path.resolve(
  import.meta.dirname,
  "../../plasmoid/package/contents/ui",
);

function readQml(fileName: string): string {
  return readFileSync(path.join(UI_DIR, fileName), "utf8");
}

describe("KDE Plasma 6 widget QML contract", () => {
  const qmlFiles = readdirSync(UI_DIR).filter((f) => f.endsWith(".qml"));

  it("includes all 12 pure QML UI files with pragma ComponentBehavior: Bound", () => {
    expect(qmlFiles.length).toBe(12);
    for (const file of qmlFiles) {
      const content = readQml(file);
      expect(content.startsWith("pragma ComponentBehavior: Bound")).toBe(true);
    }
  });

  it("uses a 32-bit-safe activityAgeMs bound, 10s stale timeout, and separate requestId in BackendConnection.qml", () => {
    const backend = readQml("BackendConnection.qml");
    expect(backend).not.toContain("Number.MAX_SAFE_INTEGER");
    expect(backend).toContain("2147483647");
    expect(backend).toContain("property int activityStaleTimeout: 10000");
    expect(backend).toContain("requestId: requestId");
    expect(backend).toContain("root.responseRequestId(data)");
  });

  it("surfaces sensorFailure through the shared acknowledged-command tooltip and both representations", () => {
    const mainQml = readQml("main.qml");
    const toolTipQml = readQml("BackendToolTip.qml");
    const compactQml = readQml("CompactRepresentation.qml");
    const fullQml = readQml("FullRepresentation.qml");

    expect(mainQml).toContain("BackendToolTip {");
    expect(mainQml).toContain("toolTipSubText: backendToolTip.text");
    expect(toolTipQml).toContain(
      "Sensor error — last acknowledged fan command %1%",
    );
    expect(toolTipQml).toContain("Sensor error — fan output unconfirmed");
    expect(toolTipQml).not.toContain("fans at fail-safe maximum");
    expect(mainQml).toContain(
      "visible: !root.hasActivity || root.sensorFailure",
    );
    expect(compactQml).toContain("sensorFailure");
    expect(fullQml).toContain("if (sensorFailure)");
  });

  it("enforces 0-110 C temperature and 0-100% speed validation in FanTableEditor.qml", () => {
    const editorQml = readQml("FanTableEditor.qml");
    expect(editorQml).toContain("temp < 0 || temp > 110");
    expect(editorQml).toContain("speed < 0 || speed > 100");
  });

  it("keeps the Qt protocol guards aligned with the backend and web client", () => {
    // Execute the shipped helper, instead of testing strings in its source.
    // The Qt-specific URL semantics are covered by plasmoid/tst_*.qml at runtime.
    const script = readQml("Protocol.js").replace(/^\.pragma library\s*/, "");
    const widget = runInNewContext(
      `${script}\n({ isState, isActivity, isFanTable, supportsProtocolVersion })`,
    ) as {
      isState(value: unknown): boolean;
      isActivity(value: unknown): boolean;
      isFanTable(value: unknown): boolean;
      supportsProtocolVersion(value: unknown): boolean;
    };
    const state = {
      protocolVersion: "1.1",
      cpuFanTable: [
        [0, 0],
        [65.5, 80.25],
        [110, 100],
      ],
      gpuFanTable: [
        [40, 30],
        [90, 100],
      ],
      doFixedSpeed: false,
      fixedPercentage: 50,
      gpuBoost: false,
      pl1: 37,
      pl2: 106,
    };
    const malformed = [null, [], {}, 0, "1.1"];
    const states = [
      state,
      ...malformed,
      { ...state, protocolVersion: "1.99" },
      { ...state, protocolVersion: "2.0" },
      { ...state, isFanControlAvailable: false },
      { ...state, isFanControlAvailable: "false" },
      { ...state, restartRequired: true },
      { ...state, restartRequired: "true" },
      { ...state, fixedPercentage: 50.5 },
      { ...state, pl1: -1 },
      {
        ...state,
        gpuFanTable: [
          [40, 30],
          [40, 100],
        ],
      },
    ];
    for (const value of states) {
      expect(widget.isState(value)).toBe(isState(value));
    }
    for (const value of [
      "1.0",
      "1.1",
      "1.99",
      "1.1.0",
      "1.1\n",
      "1.00",
      "1garbage",
      "2.0",
      ...malformed,
    ]) {
      expect(widget.supportsProtocolVersion(value)).toBe(
        isSupportedProtocolVersion(value),
      );
    }
    for (const value of [
      state.cpuFanTable,
      [],
      [[111, 30]],
      [[0, -1]],
      [
        [0, 0],
        [0, 100],
      ],
      ...malformed,
    ]) {
      expect(widget.isFanTable(value)).toBe(isFanTable(value));
    }
    const activity = {
      appliedSpeed: 0,
      target: 0,
      avgCPUTemp: 0,
      avgGPUTemp: 65.5,
    };
    for (const value of [
      activity,
      { ...activity, appliedSpeed: null, sensorFailure: true },
      { ...activity, target: 101 },
      { ...activity, avgCPUTemp: NaN },
      { ...activity, avgCPUTemp: null },
      { ...activity, sensorFailure: "false" },
      ...malformed,
    ]) {
      expect(widget.isActivity(value)).toBe(isFanControlActivity(value));
    }
  });
});
