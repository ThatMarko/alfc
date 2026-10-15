import { isNewerReleaseVersion } from "./releaseVersion";

describe("release version precedence", () => {
  it("only announces newer releases", () => {
    expect(isNewerReleaseVersion("v2.0.1", "2.0.0")).toBe(true);
    expect(isNewerReleaseVersion("v2.10.0", "2.9.0")).toBe(true);
    expect(isNewerReleaseVersion("v1.9.0", "2.0.0")).toBe(false);
    expect(isNewerReleaseVersion("v2.0.0", "2.0.0")).toBe(false);
  });

  it("uses SemVer prerelease precedence and ignores build metadata", () => {
    expect(isNewerReleaseVersion("2.0.0", "2.0.0-rc.1")).toBe(true);
    expect(isNewerReleaseVersion("2.0.0-rc.1", "2.0.0")).toBe(false);
    expect(isNewerReleaseVersion("2.0.0-beta.11", "2.0.0-beta.2")).toBe(true);
    expect(isNewerReleaseVersion("2.0.0-beta.1", "2.0.0-beta")).toBe(true);
    expect(isNewerReleaseVersion("2.0.0+new", "2.0.0+old")).toBe(false);
  });

  it("ignores malformed tags", () => {
    for (const value of [
      "latest",
      "v2",
      "v2.0",
      "2.01.0",
      "2.1.0-01",
      "",
      "999.0.0.1",
    ]) {
      expect(isNewerReleaseVersion(value, "2.0.0")).toBe(false);
    }
  });
});
