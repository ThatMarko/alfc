import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const UI_DIR = path.resolve(
  import.meta.dirname,
  "../../plasmoid/package/contents/ui",
);

function readQml(fileName: string): string {
  return readFileSync(path.join(UI_DIR, fileName), "utf8");
}

describe("KDE Plasma 6 widget QML contract", () => {
  const qmlFiles = readdirSync(UI_DIR).filter((f) => f.endsWith(".qml"));

  it("includes all 11 pure QML UI files with pragma ComponentBehavior: Bound", () => {
    expect(qmlFiles.length).toBe(11);
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
    expect(backend).toContain("data.requestId || data.methodId");
  });

  it("surfaces sensorFailure across main.qml, CompactRepresentation.qml, and FullRepresentation.qml", () => {
    const mainQml = readQml("main.qml");
    const compactQml = readQml("CompactRepresentation.qml");
    const fullQml = readQml("FullRepresentation.qml");

    expect(mainQml).toContain("Sensor error — fixed fan speed active");
    expect(mainQml).toContain("Sensor error — fans at fail-safe maximum");
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
});
