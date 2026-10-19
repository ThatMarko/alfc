import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const aurDirectory = path.resolve(import.meta.dirname, "../aur");
const ownedCommand =
  "{ path=/usr/lib/alfc/alfc ; argv[]=/usr/lib/alfc/alfc ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }";

describe.skipIf(process.platform === "win32")("AUR service lifecycle", () => {
  let directory: string;
  let log: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "alfc-aur-lifecycle-"));
    log = path.join(directory, "systemctl.log");
    await writeFile(
      path.join(directory, "systemctl"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$ALFC_AUR_TEST_LOG"
case "$1" in
  show)
    [ "$ALFC_AUR_TEST_QUERY_FAIL" != 1 ] || exit 31
    printf 'LoadState=%s\\nFragmentPath=%s\\nDropInPaths=%s\\nActiveState=%s\\n' \\
      "$ALFC_AUR_TEST_LOAD" "$ALFC_AUR_TEST_FRAGMENT" "$ALFC_AUR_TEST_DROPINS" "$ALFC_AUR_TEST_STATE"
    printf '%s\\n' "$ALFC_AUR_TEST_EXEC"
    ;;
  is-active)
    case "$ALFC_AUR_TEST_STATE" in active|reloading) exit 0 ;; *) exit 3 ;; esac
    ;;
  is-enabled) [ "$ALFC_AUR_TEST_ENABLED" = 1 ] ;;
  stop)
    [ "$ALFC_AUR_TEST_STOP_FAIL" != 1 ] || exit 47
    printf 'stopped\\n' > "$ALFC_AUR_TEST_STOPPED"
    ;;
  disable) [ "$ALFC_AUR_TEST_DISABLE_FAIL" != 1 ] || exit 53 ;;
  *) exit 61 ;;
esac
`,
      { mode: 0o755 },
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function run(
    name: "hook" | "scriptlet",
    options: {
      state?: string;
      load?: string;
      fragment?: string;
      dropins?: string;
      exec?: string;
      queryFailure?: boolean;
      stopFailure?: boolean;
      disableFailure?: boolean;
      enabled?: boolean;
    } = {},
  ) {
    const env = {
      ...process.env,
      PATH: directory + path.delimiter + process.env.PATH,
      ALFC_AUR_TEST_LOG: log,
      ALFC_AUR_TEST_STOPPED: path.join(directory, "stopped"),
      ALFC_AUR_TEST_LOAD: options.load ?? "loaded",
      ALFC_AUR_TEST_FRAGMENT:
        options.fragment ?? "/usr/lib/systemd/system/alfc.service",
      ALFC_AUR_TEST_DROPINS: options.dropins ?? "",
      ALFC_AUR_TEST_EXEC: options.exec ?? `ExecStart=${ownedCommand}`,
      ALFC_AUR_TEST_STATE: options.state ?? "active",
      ALFC_AUR_TEST_QUERY_FAIL: options.queryFailure ? "1" : "0",
      ALFC_AUR_TEST_STOP_FAIL: options.stopFailure ? "1" : "0",
      ALFC_AUR_TEST_DISABLE_FAIL: options.disableFailure ? "1" : "0",
      ALFC_AUR_TEST_ENABLED: options.enabled ? "1" : "0",
    };
    if (name === "scriptlet") {
      return execute(
        "bash",
        [
          "-c",
          'source "$1"; pre_remove',
          "alfc-aur-fixture",
          path.join(aurDirectory, "alfc.install"),
        ],
        { env },
      );
    }
    const hook = await readFile(
      path.join(aurDirectory, "alfc-stop-service.hook"),
      "utf8",
    );
    // Execute the hook's installed entrypoint from source with only systemctl
    // replaced. No actual package database, service manager, or hardware runs.
    const entrypoint = hook.match(/^Exec = (.+)$/m)?.[1];
    expect(entrypoint).toBe("/usr/lib/alfc/alfc-package-stop");
    return execute(
      "sh",
      [path.join(aurDirectory, path.basename(entrypoint!))],
      {
        env,
      },
    );
  }

  it.each([
    "active",
    "reloading",
    "activating",
    "deactivating",
    "inactive",
    "failed",
  ])("waits for a stop even when the loaded service is %s", async (state) => {
    await run("hook", { state });
    expect(await readFile(path.join(directory, "stopped"), "utf8")).toBe(
      "stopped\n",
    );
    const commands = (await readFile(log, "utf8")).trim().split("\n");
    expect(commands).toEqual([
      "show alfc.service --property=LoadState,FragmentPath,ExecStart",
      "stop alfc.service",
    ]);
  });

  it("allows policy drop-ins that preserve the effective owned command", async () => {
    await run("hook", {
      dropins:
        "/usr/lib/systemd/system/service.d/10-timeout-abort.conf /etc/systemd/system/alfc.service.d/environment.conf",
    });
    expect(await readFile(log, "utf8")).toContain("stop alfc.service\n");
  });

  it.each([
    { fragment: "/etc/systemd/system/alfc.service" },
    { fragment: "/run/systemd/system/alfc.service" },
    {
      exec: "ExecStart={ path=/opt/alfc/alfc ; argv[]=/opt/alfc/alfc ; ignore_errors=no ; pid=12 }",
    },
    {
      exec: `ExecStart=${ownedCommand.replace("argv[]=/usr/lib/alfc/alfc ;", "argv[]=/usr/lib/alfc/alfc --foreign ;")}`,
    },
    { exec: `ExecStart=${ownedCommand}\nExecStart=${ownedCommand}` },
    { exec: `ExecStart=${ownedCommand} ${ownedCommand}` },
    { exec: "" },
    { load: "not-found", fragment: "", exec: "" },
    { queryFailure: true },
  ])("refuses unverified or replaced service identity: %j", async (options) => {
    await expect(run("hook", options)).rejects.toMatchObject({ code: 1 });
    expect(await readFile(log, "utf8")).not.toContain("stop alfc.service");
    await expect(readFile(path.join(directory, "stopped"))).rejects.toThrow();
  });

  it("propagates the stop failure for AbortOnFail without deregistering", async () => {
    await expect(run("hook", { stopFailure: true })).rejects.toMatchObject({
      code: 47,
    });
    expect(await readFile(log, "utf8")).not.toContain("disable");
    await expect(readFile(path.join(directory, "stopped"))).rejects.toThrow();
  });

  it.each(["activating", "deactivating"])(
    "does not skip the fallback stop while %s",
    async (state) => {
      await run("scriptlet", { state, enabled: true });
      expect((await readFile(log, "utf8")).trim().split("\n")).toEqual([
        "stop alfc",
        "is-enabled --quiet alfc",
        "disable alfc",
      ]);
    },
  );

  it("preserves the fallback stop failure instead of disabling the service", async () => {
    await expect(
      run("scriptlet", { stopFailure: true, enabled: true }),
    ).rejects.toMatchObject({ code: 47 });
    expect((await readFile(log, "utf8")).trim()).toBe("stop alfc");
  });

  it("reports the fallback deregistration failure after the stop", async () => {
    await expect(
      run("scriptlet", { disableFailure: true, enabled: true }),
    ).rejects.toMatchObject({ code: 53 });
    expect(await readFile(path.join(directory, "stopped"), "utf8")).toBe(
      "stopped\n",
    );
  });
});
