import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rename,
  stat,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("Windows service wrapper configuration", () => {
  it("includes the pinned WinSW copyright notice in both Windows builders", async () => {
    const notice = await readFile(
      path.join(import.meta.dirname, "WinSW-LICENSE.txt"),
    );
    // Exact bytes from winsw/winsw v2.12.0 LICENSE.txt, matching the wrapper.
    expect(createHash("sha256").update(notice).digest("hex")).toBe(
      "1cdf703c10a70e5973bf3acf2a5eeabe7746237155b92db2034aeae26fdf7802",
    );
    const localBuilder = await readFile(
      path.join(repositoryRoot, "build.bat"),
      "utf8",
    );
    expect(localBuilder).toContain(
      "copy bootstrap\\WinSW-LICENSE.txt dist\\alfc\\WinSW-LICENSE.txt || exit /b 1",
    );
    const workflow = await readFile(
      path.join(repositoryRoot, ".github/workflows/release.yml"),
      "utf8",
    );
    expect(workflow).toContain("winsw/releases/download/v2.12.0/WinSW-x64.exe");
    expect(workflow).toContain(
      'cp bootstrap/WinSW-LICENSE.txt "${RELEASE_DIR}/WinSW-LICENSE.txt"',
    );
  });

  it("keeps foreground startup attached and avoids premature browser launch in Windows entrypoints", async () => {
    const source = await readFile(
      path.join(import.meta.dirname, "scripts/run.bat"),
      "utf8",
    );
    expect(source).toMatch(
      /^echo Open http:\/\/localhost:5522 after the server reports startup finished\.$/m,
    );
    const installer = await readFile(
      path.join(import.meta.dirname, "scripts/install.bat"),
      "utf8",
    );
    for (const entrypoint of [source, installer]) {
      expect(entrypoint).not.toMatch(/^\s*start\b/im);
      expect(entrypoint).toContain("http://localhost:5522");
    }
    expect(source).toMatch(/^alfc\.exe\s*$/m);
  });

  it("uses WinSW v2.12 shutdown settings that allow the 12-second BIOS handoff", async () => {
    const config = await readFile(
      path.join(import.meta.dirname, "scripts/alfc-service.xml"),
      "utf8",
    );
    // WinSW XML names are case-sensitive; use each v2.12 spelling exactly.
    expect(config).toMatch(
      /<stopparentprocessfirst>\s*true\s*<\/stopparentprocessfirst>/,
    );
    const timeout = /<stoptimeout>\s*(\d+)\s*sec\s*<\/stoptimeout>/.exec(
      config,
    );
    expect(Number(timeout?.[1])).toBeGreaterThanOrEqual(15);
    expect(config).not.toMatch(/<stopParentFirst>|<stopTimeout>/);
    expect(config).toMatch(/<workingdirectory>%BASE%<\/workingdirectory>/);
    const supported: Record<string, readonly string[]> = {
      service: [],
      id: [],
      name: [],
      description: [],
      executable: [],
      workingdirectory: [],
      delayedAutoStart: [],
      stopparentprocessfirst: [],
      stoptimeout: [],
      log: ["mode"],
      sizeThreshold: [],
      keepFiles: [],
      onfailure: ["action", "delay"],
      resetfailure: [],
      env: ["name", "value"],
    };
    const uncommented = config.replace(/<!--[\s\S]*?-->/g, "");
    for (const match of uncommented.matchAll(
      /<\/?([A-Za-z][\w-]*)\b([^<>]*)>/g,
    )) {
      const elementName = match[1] ?? "";
      expect(
        Object.hasOwn(supported, elementName),
        `Unsupported WinSW element: ${elementName}`,
      ).toBe(true);
      const attributes = supported[elementName];
      expect(
        attributes,
        `Unsupported WinSW element: ${elementName}`,
      ).toBeDefined();
      for (const attribute of (match[2] ?? "").matchAll(
        /([A-Za-z][\w-]*)\s*=\s*(?:"[^"]*"|'[^']*')/g,
      )) {
        expect(
          attributes,
          `Unsupported attribute on <${elementName}>`,
        ).toContain(attribute[1]);
      }
    }
  });
});

describe.skipIf(process.platform !== "win32")(
  "isolated Windows service management",
  () => {
    let wrapperDirectory: string;
    let directory: string;
    let release: string;
    let log: string;
    let stateFile: string;

    beforeAll(async () => {
      wrapperDirectory = await mkdtemp(
        path.join(os.tmpdir(), "alfc-windows-wrapper-"),
      );
      const source = path.join(wrapperDirectory, "wrapper.ts");
      await writeFile(
        source,
        `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const executable = path.basename(process.execPath).toLowerCase();
// Replace administrator detection and SCM queries before they reach the host.
if (executable === "powershell.exe") {
  if (process.argv.some(argument => argument.includes("Get-ItemProperty"))) {
    process.exit(process.env.ALFC_TEST_FOREIGN_SERVICE === "1" || process.env.ALFC_TEST_IDENTITY_FAIL === "1" ? 1 : 0);
  }
  if (process.env.ALFC_TEST_ELEVATION_FAIL === "1") {
    const probe = process.argv.includes("-NonInteractive");
    appendFileSync(process.env.ALFC_TEST_LOG, probe ? "admin-check\\n" : "elevate\\n");
    process.exit(probe ? 1 : 17);
  }
  process.exit(0);
}
if (executable === "sc.exe") {
  if (process.env.ALFC_TEST_QUERY_FAIL === "1") process.exit(5);
  if (readFileSync(process.env.ALFC_TEST_STATE, "utf8") === "deleted") {
    // Bun's process.exit narrows status to eight bits. SCM uses Win32 DWORD
    // errors, including ERROR_SERVICE_DOES_NOT_EXIST (1060).
    const { dlopen, FFIType } = await import("bun:ffi");
    const kernel = dlopen("kernel32.dll", {
      ExitProcess: { args: [FFIType.u32], returns: FFIType.void },
    });
    kernel.symbols.ExitProcess(1060);
    throw new Error("ExitProcess unexpectedly returned");
  }
  process.exit(0);
}
if (executable !== "alfc-service.exe") process.exit(90);
const command = process.argv[2];
const stateFile = process.env.ALFC_TEST_STATE;
appendFileSync(process.env.ALFC_TEST_LOG, command + "\\n");
const state = readFileSync(stateFile, "utf8");
switch (command) {
  case "stop":
    // WinSW 2.12 stop returns with the service still stopping.
    writeFileSync(stateFile, "stopping");
    break;
  case "stopwait":
    if (process.env.ALFC_TEST_STOP_FAIL === "1") process.exit(7);
    await Bun.sleep(25);
    writeFileSync(stateFile, "stopped");
    break;
  case "uninstall":
    if (process.env.ALFC_TEST_UNINSTALL_FAIL === "1") process.exit(12);
    // WinSW reports success even when deletion must await shutdown.
    writeFileSync(stateFile, state === "stopped" ? "deleted" : "delete-pending");
    break;
  case "install":
    if (state !== "deleted") process.exit(9);
    writeFileSync(stateFile, "installed");
    break;
  case "start":
    if (state !== "installed") process.exit(10);
    writeFileSync(stateFile, "running");
    break;
  default:
    process.exit(11);
}
`,
      );
      await execute(
        "bun",
        [
          "build",
          "--compile",
          source,
          "--outfile",
          path.join(wrapperDirectory, "wrapper.exe"),
        ],
        { cwd: wrapperDirectory, timeout: 20_000, windowsHide: true },
      );
    }, 25_000);

    afterAll(async () => {
      if (wrapperDirectory)
        await rm(wrapperDirectory, { recursive: true, force: true });
    });

    beforeEach(async () => {
      directory = await mkdtemp(
        path.join(os.tmpdir(), "alfc-windows-service-"),
      );
      release = path.join(directory, "release with space's");
      log = path.join(directory, "commands.log");
      stateFile = path.join(directory, "state");
      await mkdir(release);
      for (const name of ["powershell.exe", "sc.exe", "alfc-service.exe"])
        await copyFile(
          path.join(wrapperDirectory, "wrapper.exe"),
          path.join(release, name),
        );
      for (const name of ["install.bat", "uninstall.bat", "run.bat"])
        await copyFile(
          path.join(import.meta.dirname, "scripts", name),
          path.join(release, name),
        );
      await writeFile(path.join(release, "alfc.exe"), "fixture");
      await copyFile(
        path.join(import.meta.dirname, "scripts/alfc-service.xml"),
        path.join(release, "alfc-service.xml"),
      );
      await writeFile(path.join(release, "WmiDll.dll"), "fixture");
      await mkdir(path.join(release, "frontend"));
      await writeFile(path.join(release, "frontend/index.html"), "fixture");
      await writeFile(
        path.join(release, "alfc.config.json"),
        '{"user":"preserve"}',
      );
      await writeFile(stateFile, "running");
    });

    afterEach(async () => {
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    function run(
      name: string,
      failures: {
        stop?: boolean;
        uninstall?: boolean;
        elevation?: boolean;
        query?: boolean;
        foreign?: boolean;
        identity?: boolean;
      } = {},
    ) {
      const result = execute(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/c", name],
        {
          cwd: release,
          env: {
            ...process.env,
            PATH: release + path.delimiter + process.env.PATH,
            ALFC_TEST_LOG: log,
            ALFC_TEST_STATE: stateFile,
            ALFC_TEST_STOP_FAIL: failures.stop ? "1" : "0",
            ALFC_TEST_UNINSTALL_FAIL: failures.uninstall ? "1" : "0",
            ALFC_TEST_ELEVATION_FAIL: failures.elevation ? "1" : "0",
            ALFC_TEST_QUERY_FAIL: failures.query ? "1" : "0",
            ALFC_TEST_FOREIGN_SERVICE: failures.foreign ? "1" : "0",
            ALFC_TEST_IDENTITY_FAIL: failures.identity ? "1" : "0",
          },
          timeout: 10_000,
          windowsHide: true,
        },
      );
      result.child.stdin?.end("\r\n");
      return result.catch((error: unknown) => {
        if (error instanceof Error) {
          const failure = error as Error & { stdout?: string; stderr?: string };
          failure.message += `\nstdout:\n${failure.stdout ?? ""}\nstderr:\n${failure.stderr ?? ""}`;
        }
        throw error;
      });
    }

    async function runWithoutWaiting(name: string) {
      const script = path.join(release, name);
      const source = await readFile(script, "utf8");
      await writeFile(script, source.replace(" stopwait ", " stop "));
      try {
        return await run(name);
      } finally {
        await writeFile(script, source);
      }
    }

    async function resetService() {
      await writeFile(stateFile, "running");
      await rm(log);
    }

    it("waits for shutdown before replacing the existing service", async () => {
      // The old non-waiting command leaves the service marked for deletion,
      // so attempting to install its replacement fails.
      await expect(runWithoutWaiting("install.bat")).rejects.toMatchObject({
        code: 1,
      });
      expect(await readFile(stateFile, "utf8")).toBe("delete-pending");
      await resetService();
      await run("install.bat");
      expect(await readFile(log, "utf8")).toBe(
        "stopwait\nuninstall\ninstall\nstart\n",
      );
      expect(await readFile(stateFile, "utf8")).toBe("running");
    }, 25_000);

    it("waits for shutdown before reporting the installation safe to delete", async () => {
      const premature = await runWithoutWaiting("uninstall.bat");
      expect(premature.stdout).toContain("You can delete the alfc folder now.");
      expect(await readFile(stateFile, "utf8")).toBe("delete-pending");
      await resetService();
      const { stdout } = await run("uninstall.bat");
      expect(await readFile(log, "utf8")).toBe("stopwait\nuninstall\n");
      expect(await readFile(stateFile, "utf8")).toBe("deleted");
      expect(stdout).toContain("You can delete the alfc folder now.");
    }, 25_000);

    it("installs a new service without attempting to stop a missing service", async () => {
      await writeFile(stateFile, "deleted");
      await run("install.bat");
      expect(await readFile(log, "utf8")).toBe("install\nstart\n");
      expect(await readFile(stateFile, "utf8")).toBe("running");
    }, 15_000);

    it("preserves the native SCM missing-service exit status", async () => {
      await writeFile(stateFile, "deleted");
      await expect(
        execute(path.join(release, "sc.exe"), ["query", "alfc"], {
          env: { ...process.env, ALFC_TEST_STATE: stateFile },
          timeout: 10_000,
          windowsHide: true,
        }),
      ).rejects.toMatchObject({ code: 1060 });
      await expect(readFile(log)).rejects.toThrow();
    }, 15_000);

    it.each([
      "alfc.exe",
      "alfc-service.exe",
      "alfc-service.xml",
      "WmiDll.dll",
      "frontend/index.html",
    ])(
      "rejects a release missing %s before touching a service",
      async (name) => {
        await rm(path.join(release, name));
        await expect(run("install.bat")).rejects.toMatchObject({ code: 1 });
        await expect(readFile(log)).rejects.toThrow();
        expect(await readFile(stateFile, "utf8")).toBe("running");
      },
      15_000,
    );

    it.each(["alfc.exe", "WmiDll.dll", "frontend/index.html"])(
      "rejects a directory substituted for release file %s before service access",
      async (name) => {
        await rm(path.join(release, name));
        await mkdir(path.join(release, name));
        await expect(run("install.bat")).rejects.toMatchObject({ code: 1 });
        await expect(readFile(log)).rejects.toThrow();
        expect(await readFile(stateFile, "utf8")).toBe("running");
      },
      15_000,
    );

    it.each(["install.bat", "uninstall.bat"])(
      "refuses %s when SCM cannot be queried",
      async (name) => {
        await expect(run(name, { query: true })).rejects.toMatchObject({
          code: 5,
        });
        await expect(readFile(log)).rejects.toThrow();
        expect(await readFile(stateFile, "utf8")).toBe("running");
      },
      15_000,
    );

    it.each(["install.bat", "uninstall.bat"])(
      "refuses %s for a foreign service or unavailable identity",
      async (name) => {
        for (const failure of [{ foreign: true }, { identity: true }]) {
          await expect(run(name, failure)).rejects.toMatchObject({ code: 1 });
          await expect(readFile(log)).rejects.toThrow();
          expect(await readFile(stateFile, "utf8")).toBe("running");
        }
      },
      15_000,
    );

    it("preserves settings through reinstallation and repeated removal", async () => {
      await run("install.bat");
      await run("uninstall.bat");
      const { stdout } = await run("uninstall.bat");
      expect(stdout).toContain("service is already absent");
      expect(await readFile(log, "utf8")).toBe(
        "stopwait\nuninstall\ninstall\nstart\nstopwait\nuninstall\n",
      );
      expect(
        await readFile(path.join(release, "alfc.config.json"), "utf8"),
      ).toBe('{"user":"preserve"}');
    }, 25_000);

    it.each([
      { name: "owned quoted wrapper", image: "owned", query: "0", status: 0 },
      {
        name: "case-insensitive owned path",
        image: "case",
        query: "0",
        status: 0,
      },
      { name: "foreign executable", image: "foreign", query: "0", status: 1 },
      {
        name: "foreign wrapper arguments",
        image: "arguments",
        query: "0",
        status: 1,
      },
      {
        name: "ambiguous unquoted path",
        image: "unquoted",
        query: "0",
        status: 1,
      },
      {
        name: "relative wrapper path",
        image: "relative",
        query: "0",
        status: 1,
      },
      {
        name: "unreadable service identity",
        image: "unreadable",
        query: "0",
        status: 1,
      },
      {
        name: "foreign XML service ID",
        image: "owned",
        query: "0",
        status: 1,
        xml: "<service><id>foreign</id></service>",
      },
      {
        name: "malformed XML",
        image: "owned",
        query: "0",
        status: 1,
        xml: "<service>",
      },
      {
        name: "absent service without a registry read",
        image: "unreadable",
        query: "1060",
        status: 0,
      },
    ])(
      "executes the real PowerShell identity guard for $name",
      async (fixture) => {
        const guards = await Promise.all(
          ["install.bat", "uninstall.bat"].map(async (name) => {
            const source = await readFile(path.join(release, name), "utf8");
            return /^powershell -NoProfile -NonInteractive -Command "(.*Get-ItemProperty.*)"\r?$/m.exec(
              source,
            )?.[1];
          }),
        );
        expect(guards[0]).toBeDefined();
        expect(guards[1]).toBe(guards[0]);
        if (fixture.xml)
          await writeFile(path.join(release, "alfc-service.xml"), fixture.xml);
        // Run the installed PowerShell interpreter, replacing only the registry
        // boundary. No host SCM query, registry read, UAC, or service mutation.
        const script = `function Get-ItemProperty {
  param($LiteralPath, $Name, $ErrorAction)
  if ($env:ALFC_TEST_IMAGE -eq 'unreadable') { throw 'fixture identity read failed' }
  $wrapper = [IO.Path]::GetFullPath($env:ALFC_WRAPPER_PATH)
  [Console]::Error.WriteLine(('fixture raw wrapper: ' + $env:ALFC_WRAPPER_PATH + '; normalized wrapper: ' + $wrapper))
  switch ($env:ALFC_TEST_IMAGE) {
    'case' { $wrapper = $wrapper.ToUpperInvariant() }
    'foreign' { $wrapper = Join-Path (Split-Path $wrapper) 'foreign.exe' }
    'relative' { $wrapper = 'alfc-service.exe' }
  }
  $image = [string][char]34 + $wrapper + [char]34
  if ($env:ALFC_TEST_IMAGE -eq 'arguments') { $image += ' --foreign-config' }
  if ($env:ALFC_TEST_IMAGE -eq 'unquoted') { $image = $wrapper }
  [pscustomobject]@{ ImagePath = $image }
}
${guards[0]}`;
        let status = 0;
        let diagnostic = "";
        try {
          await execute(
            path.join(
              process.env.SystemRoot ?? "C:\\Windows",
              "System32/WindowsPowerShell/v1.0/powershell.exe",
            ),
            ["-NoProfile", "-NonInteractive", "-Command", script],
            {
              cwd: release,
              env: {
                ...process.env,
                ALFC_WRAPPER_PATH: path.join(release, "alfc-service.exe"),
                ALFC_QUERY_STATUS: fixture.query,
                ALFC_TEST_IMAGE: fixture.image,
              },
              timeout: 10_000,
              windowsHide: true,
            },
          );
        } catch (error) {
          const failure = error as {
            code?: number | string;
            stdout?: string;
            stderr?: string;
          };
          status = Number(failure.code);
          diagnostic = `stdout:\n${failure.stdout ?? ""}\nstderr:\n${failure.stderr ?? ""}`;
        }
        expect(status, diagnostic).toBe(fixture.status);
        await expect(readFile(log)).rejects.toThrow();
      },
      15_000,
    );

    it.each(["install.bat", "uninstall.bat", "run.bat"])(
      "propagates the elevation command failure from %s without service access",
      async (name) => {
        let failure: unknown;
        try {
          await run(name, { elevation: true });
        } catch (error) {
          failure = error;
        }
        expect(await readFile(log, "utf8")).toBe("admin-check\nelevate\n");
        expect(await readFile(stateFile, "utf8")).toBe("running");
        expect(
          failure,
          "the delegated failure must reach cmd /c",
        ).toMatchObject({
          code: 17,
        });
      },
      15_000,
    );

    it.each(["install.bat", "uninstall.bat"])(
      "aborts %s if shutdown cannot complete",
      async (name) => {
        await expect(run(name, { stop: true })).rejects.toMatchObject({
          code: 1,
          stdout: expect.not.stringContaining(
            "You can delete the alfc folder now.",
          ),
        });
        expect(await readFile(log, "utf8")).toBe("stopwait\n");
        expect(await readFile(stateFile, "utf8")).toBe("running");
      },
      15_000,
    );

    it.each(["install.bat", "uninstall.bat"])(
      "aborts %s if the stopped service cannot be removed",
      async (name) => {
        await expect(run(name, { uninstall: true })).rejects.toMatchObject({
          code: 1,
          stdout: expect.not.stringContaining(
            "You can delete the alfc folder now.",
          ),
        });
        expect(await readFile(log, "utf8")).toBe("stopwait\nuninstall\n");
        expect(await readFile(stateFile, "utf8")).toBe("stopped");
      },
      15_000,
    );
  },
);

describe.skipIf(process.platform === "win32")(
  "isolated Linux service management",
  () => {
    let directory: string;
    let release: string;
    let installed: string;
    let log: string;
    let commandDir: string;
    let initSystem: "systemd" | "openrc";

    async function script(name: string): Promise<string> {
      const source = await readFile(
        path.join(import.meta.dirname, "scripts/linux", name),
        "utf8",
      );
      const rebased = source
        .replace('if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then', "if false; then")
        .replaceAll("/opt/alfc", installed)
        .replaceAll("/usr/bin/alfc", path.join(directory, "usr/bin/alfc"))
        .replaceAll("/etc/", path.join(directory, "etc") + "/")
        .replaceAll(
          "/run/systemd/system",
          path.join(directory, "run/systemd/system"),
        )
        .replaceAll("/proc/acpi/call", path.join(directory, "proc/acpi/call"));
      const target = path.join(release, name);
      await writeFile(target, rebased, { mode: 0o755 });
      return target;
    }

    async function prepare(init: "systemd" | "openrc") {
      initSystem = init;
      directory = await mkdtemp(path.join(os.tmpdir(), "alfc-installer-"));
      release = path.join(directory, "release");
      installed = path.join(directory, "opt/alfc");
      log = path.join(directory, "commands.log");
      commandDir = path.join(directory, "commands");
      for (const relative of [
        "release/frontend",
        "release/omarchy/module",
        "release/plasmoid/package/contents/ui",
        "opt/alfc/frontend",
        "opt/alfc/omarchy",
        "usr/bin",
        "etc/systemd/system",
        "etc/init.d",
        "proc/acpi",
        "commands",
      ]) {
        await mkdir(path.join(directory, relative), { recursive: true });
      }
      if (init === "systemd")
        await mkdir(path.join(directory, "run/systemd/system"), {
          recursive: true,
        });
      await writeFile(
        path.join(
          directory,
          init === "systemd"
            ? "etc/systemd/system/alfc.service"
            : "etc/init.d/alfc",
        ),
        init === "systemd"
          ? `[Service]\nExecStart=${installed}/alfc\n`
          : `#!/sbin/openrc-run\ncommand="${installed}/alfc"\n`,
      );
      if (init === "openrc") {
        await mkdir(path.join(directory, "etc/runlevels/default"), {
          recursive: true,
        });
        await symlink(
          path.join(directory, "etc/init.d/alfc"),
          path.join(directory, "etc/runlevels/default/alfc"),
        );
      }
      await writeFile(path.join(directory, "proc/acpi/call"), "");
      await writeFile(path.join(installed, "alfc"), "old-binary");
      await writeFile(
        path.join(installed, "alfc.config.json"),
        '{"user":"preserve"}',
        { mode: 0o600 },
      );
      await writeFile(path.join(installed, "frontend/old.js"), "old asset");
      await writeFile(
        path.join(installed, "omarchy/obsolete.qml"),
        "old module",
      );
      await symlink(
        path.join(installed, "alfc"),
        path.join(directory, "usr/bin/alfc"),
      );
      await writeFile(path.join(release, "alfc"), "new-binary");
      await writeFile(path.join(release, "alfc.config.json"), "default config");
      await writeFile(path.join(release, "frontend/new.js"), "new asset");
      await writeFile(path.join(release, "frontend/index.html"), "new entry");
      await writeFile(path.join(release, "omarchy/install.sh"), "user helper", {
        mode: 0o755,
      });
      await writeFile(
        path.join(release, "omarchy/module/Widget.qml"),
        "new module",
      );
      await writeFile(
        path.join(release, "plasmoid/install.sh"),
        "user helper",
        { mode: 0o700 },
      );
      await writeFile(
        path.join(release, "plasmoid/package/contents/ui/Protocol.js"),
        await readFile(
          path.join(repositoryRoot, "plasmoid/package/contents/ui/Protocol.js"),
        ),
        { mode: 0o600 },
      );
      await writeFile(
        path.join(release, "alfc.service"),
        await readFile(
          path.join(import.meta.dirname, "scripts/linux/alfc.service"),
        ),
      );
      await script("uninstall.sh");
      await script("run.sh");
      const mock = `#!/bin/sh
printf '%s\\n' "$0 $*" >> "$ALFC_TEST_LOG"
if [ "$1" = show ]; then
  [ "$ALFC_TEST_SHOW_FAIL" != 1 ] || exit 31
  if [ -n "$ALFC_TEST_FOREIGN_SERVICE" ]; then
    printf 'LoadState=loaded\\nFragmentPath=%s\\nDropInPaths=\\n' "$ALFC_TEST_FOREIGN_SERVICE"
  elif [ -f "$ALFC_TEST_SERVICE_FILE" ]; then
    printf 'LoadState=loaded\\nFragmentPath=%s\\nExecStart={ path=%s/alfc ; argv[]=%s/alfc ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0 }\\n' "$ALFC_TEST_SERVICE_FILE" "$ALFC_TEST_INSTALLED" "$ALFC_TEST_INSTALLED"
  else
    printf 'LoadState=not-found\\nFragmentPath=\\nDropInPaths=\\n'
  fi
  exit 0
fi
case " $* " in
  *" is-active "*|*" is-enabled "*) [ -f "$ALFC_TEST_SERVICE_FILE" ] || exit 3 ;;
  *" stop "*)
    printf 'stopped:%s\\n' "$(cat "$ALFC_TEST_INSTALLED/alfc")" >> "$ALFC_TEST_LOG"
    [ "$ALFC_TEST_STOP_FAIL" != 1 ] || exit 1
    ;;
  *" restart "*)
    [ "$ALFC_TEST_RESTART_FAIL" != 1 ] || exit 8
    printf 'started:%s\\n' "$(cat "$ALFC_TEST_INSTALLED/alfc")" >> "$ALFC_TEST_LOG"
    ;;
  *" disable "*|*" del "*)
    [ "$ALFC_TEST_DISABLE_FAIL" != 1 ] || exit 23
    ;;
esac
case "$0 $*" in
  *"rc-update add "*) ln -sf "$ALFC_TEST_SERVICE_FILE" "$ALFC_TEST_RUNLEVEL_LINK" ;;
  *"rc-update del "*) rm -f "$ALFC_TEST_RUNLEVEL_LINK" ;;
esac
exit 0
`;
      for (const name of ["systemctl", "rc-service", "rc-update"])
        await writeFile(path.join(commandDir, name), mock, { mode: 0o755 });
    }

    async function run(
      name: string,
      options: {
        stop?: boolean;
        restart?: boolean;
        disable?: boolean;
        show?: boolean;
        foreignService?: string;
        args?: string[];
      } = {},
    ) {
      return execute(
        "bash",
        [
          "-c",
          'umask 077; exec bash "$@"',
          "alfc-installer-fixture",
          await script(name),
          ...(options.args ?? []),
        ],
        {
          env: {
            ...process.env,
            PATH: commandDir + path.delimiter + process.env.PATH,
            ALFC_TEST_LOG: log,
            ALFC_TEST_INSTALLED: installed,
            ALFC_TEST_STOP_FAIL: options.stop ? "1" : "0",
            ALFC_TEST_RESTART_FAIL: options.restart ? "1" : "0",
            ALFC_TEST_DISABLE_FAIL: options.disable ? "1" : "0",
            ALFC_TEST_SHOW_FAIL: options.show ? "1" : "0",
            ALFC_TEST_FOREIGN_SERVICE: options.foreignService ?? "",
            ALFC_TEST_RUNLEVEL_LINK: path.join(
              directory,
              "etc/runlevels/default/alfc",
            ),
            ALFC_TEST_SERVICE_FILE: path.join(
              directory,
              initSystem === "systemd"
                ? "etc/systemd/system/alfc.service"
                : "etc/init.d/alfc",
            ),
          },
          timeout: 5000,
        },
      );
    }

    afterEach(async () => {
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    it.each(["systemd", "openrc"] as const)(
      "upgrades %s only after stopping and preserves configuration",
      async (init) => {
        await prepare(init);
        await run("install.sh");
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "new-binary",
        );
        expect(
          await readFile(path.join(installed, "alfc.config.json"), "utf8"),
        ).toBe('{"user":"preserve"}');
        expect(
          (await stat(path.join(installed, "alfc.config.json"))).mode & 0o777,
        ).toBe(0o600);
        await expect(
          readFile(path.join(installed, "frontend/old.js")),
        ).rejects.toThrow();
        expect(
          await readFile(path.join(installed, "frontend/new.js"), "utf8"),
        ).toBe("new asset");
        await expect(
          readFile(path.join(installed, "omarchy/obsolete.qml")),
        ).rejects.toThrow();
        expect(
          await readFile(
            path.join(installed, "omarchy/module/Widget.qml"),
            "utf8",
          ),
        ).toBe("new module");
        expect(
          (await stat(path.join(installed, "omarchy/install.sh"))).mode & 0o777,
        ).toBe(0o755);
        for (const name of ["", "omarchy", "omarchy/module"])
          expect((await stat(path.join(installed, name))).mode & 0o777).toBe(
            0o755,
          );
        expect(
          (await stat(path.join(installed, "omarchy/module/Widget.qml"))).mode &
            0o777,
        ).toBe(0o644);
        expect(
          (await stat(path.join(installed, "plasmoid/install.sh"))).mode &
            0o777,
        ).toBe(0o755);
        expect(
          (
            await stat(
              path.join(installed, "plasmoid/package/contents/ui/Protocol.js"),
            )
          ).mode & 0o777,
        ).toBe(0o644);
        expect(await readFile(log, "utf8")).toMatch(
          /stopped:old-binary[\s\S]*started:new-binary/,
        );
        expect(
          (
            await stat(
              path.join(
                directory,
                init === "systemd"
                  ? "etc/systemd/system/alfc.service"
                  : "etc/init.d/alfc",
              ),
            )
          ).mode & 0o777,
        ).toBe(init === "systemd" ? 0o644 : 0o755);
        if (init === "openrc")
          expect(
            await readFile(path.join(directory, "etc/init.d/alfc"), "utf8"),
          ).toContain('retry="TERM/15/KILL/5"');
        await run("uninstall.sh");
        expect(
          await readFile(path.join(installed, "alfc.config.json"), "utf8"),
        ).toBe('{"user":"preserve"}');
        await expect(readFile(path.join(installed, "alfc"))).rejects.toThrow();
      },
    );

    it.each(["systemd", "openrc"] as const)(
      "aborts %s upgrade and uninstall if the running service cannot stop",
      async (init) => {
        await prepare(init);
        await expect(run("install.sh", { stop: true })).rejects.toMatchObject({
          code: 1,
        });
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old-binary",
        );
        expect(
          await readFile(path.join(installed, "frontend/old.js"), "utf8"),
        ).toBe("old asset");
        await expect(run("uninstall.sh", { stop: true })).rejects.toMatchObject(
          {
            code: 1,
          },
        );
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old-binary",
        );
      },
    );

    it.each(["systemd", "openrc"] as const)(
      "installs a fresh %s service and explicitly purges its configuration",
      async (init) => {
        await prepare(init);
        await rm(installed, { recursive: true });
        const command = path.join(directory, "usr/bin/alfc");
        await rm(command);
        await rm(
          path.join(
            directory,
            init === "systemd"
              ? "etc/systemd/system/alfc.service"
              : "etc/init.d/alfc",
          ),
        );
        await run("install.sh");
        expect(await readFile(log, "utf8")).not.toContain("stopped:");
        expect(await readFile(log, "utf8")).toContain("started:new-binary");
        expect(
          await readFile(path.join(installed, "alfc.config.json"), "utf8"),
        ).toBe("default config");
        expect((await stat(path.join(installed, "alfc"))).mode & 0o777).toBe(
          0o755,
        );
        expect(await readlink(command)).toBe(path.join(installed, "alfc"));
        await run("uninstall.sh", { args: ["--purge"] });
        await expect(stat(installed)).rejects.toThrow();
        await expect(readlink(command)).rejects.toThrow();
      },
    );

    it.each(["systemd", "openrc"] as const)(
      "reports %s restart failure without claiming a successful installation",
      async (init) => {
        await prepare(init);
        await expect(
          run("install.sh", { restart: true }),
        ).rejects.toMatchObject({
          code: 8,
          stdout: expect.not.stringContaining("UI available"),
        });
        expect(
          await readFile(path.join(installed, "alfc.config.json"), "utf8"),
        ).toBe('{"user":"preserve"}');
        expect(await readFile(log, "utf8")).not.toContain("started:");
      },
    );

    it.each(["systemd", "openrc"] as const)(
      "retires omitted optional desktop resources during a %s upgrade",
      async (init) => {
        await prepare(init);
        await rm(path.join(release, "omarchy"), { recursive: true });
        await run("install.sh");
        await expect(stat(path.join(installed, "omarchy"))).rejects.toThrow();
        expect(
          await readFile(path.join(installed, "alfc.config.json"), "utf8"),
        ).toBe('{"user":"preserve"}');
      },
    );

    it.each(["frontend", "run.sh"])(
      "rejects a release with an incorrect %s type before stopping the service",
      async (name) => {
        await prepare("systemd");
        await rm(path.join(release, name), { recursive: true });
        if (name === "frontend")
          await writeFile(path.join(release, name), "not a directory");
        else await mkdir(path.join(release, name));
        await expect(run("install.sh")).rejects.toMatchObject({ code: 1 });
        await expect(readFile(log)).rejects.toThrow();
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old-binary",
        );
      },
    );

    it.each([
      { init: "systemd", entry: "missing" },
      { init: "systemd", entry: "directory" },
      { init: "openrc", entry: "missing" },
      { init: "openrc", entry: "directory" },
    ] as const)(
      "rejects a $entry frontend entry before changing a working $init installation",
      async ({ init, entry }) => {
        await prepare(init);
        const index = path.join(release, "frontend/index.html");
        await rm(index);
        if (entry === "directory") await mkdir(index);
        await expect(run("install.sh")).rejects.toMatchObject({ code: 1 });
        await expect(readFile(log)).rejects.toThrow();
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old-binary",
        );
        expect(
          await readFile(path.join(installed, "frontend/old.js"), "utf8"),
        ).toBe("old asset");
      },
    );

    it.each(["systemd", "openrc"] as const)(
      "refuses a symlinked %s installation root before service or foreign-file changes",
      async (init) => {
        await prepare(init);
        const foreign = path.join(directory, "foreign");
        await rename(installed, foreign);
        await symlink(foreign, installed);
        for (const name of ["install.sh", "uninstall.sh"]) {
          await expect(run(name)).rejects.toMatchObject({ code: 1 });
          expect(await readFile(path.join(foreign, "alfc"), "utf8")).toBe(
            "old-binary",
          );
          await expect(readFile(log)).rejects.toThrow();
        }
      },
    );

    it.each(["alfc", "run.sh", "uninstall.sh", "alfc.config.json", "service"])(
      "refuses a symlinked managed %s destination before install changes",
      async (name) => {
        await prepare("systemd");
        const target =
          name === "service"
            ? path.join(directory, "etc/systemd/system/alfc.service")
            : path.join(installed, name);
        await rm(target, { force: true });
        const foreign = path.join(directory, "foreign-file");
        await writeFile(foreign, "foreign content", { mode: 0o600 });
        await symlink(foreign, target);
        await expect(run("install.sh")).rejects.toMatchObject({ code: 1 });
        expect(await readFile(foreign, "utf8")).toBe("foreign content");
        expect((await stat(foreign)).mode & 0o777).toBe(0o600);
        await expect(readFile(log)).rejects.toThrow();
      },
    );

    it.each(["systemd", "openrc"] as const)(
      "refuses a symlinked %s service during removal",
      async (init) => {
        await prepare(init);
        const target = path.join(
          directory,
          init === "systemd"
            ? "etc/systemd/system/alfc.service"
            : "etc/init.d/alfc",
        );
        await rm(target);
        const foreign = path.join(directory, "foreign-service");
        await writeFile(foreign, "foreign service");
        await symlink(foreign, target);
        await expect(run("uninstall.sh")).rejects.toMatchObject({ code: 1 });
        expect(await readFile(foreign, "utf8")).toBe("foreign service");
        await expect(readFile(log)).rejects.toThrow();
      },
    );

    it("reports AUR pre-remove shutdown failure without disabling the running service", async () => {
      await prepare("systemd");
      await expect(
        execute(
          "bash",
          [
            "-c",
            'source "$1"; pre_remove',
            "alfc-aur-hook-test",
            path.join(repositoryRoot, "aur/alfc.install"),
          ],
          {
            env: {
              ...process.env,
              PATH: commandDir + path.delimiter + process.env.PATH,
              ALFC_TEST_LOG: log,
              ALFC_TEST_INSTALLED: installed,
              ALFC_TEST_SERVICE_FILE: path.join(
                directory,
                "etc/systemd/system/alfc.service",
              ),
              ALFC_TEST_STOP_FAIL: "1",
            },
          },
        ),
      ).rejects.toMatchObject({ code: 1 });
      expect(await readFile(log, "utf8")).not.toContain("disable");
      expect(
        await readFile(path.join(installed, "alfc.config.json"), "utf8"),
      ).toBe('{"user":"preserve"}');
    });

    it("protects another installation's command and rejects incomplete releases before stopping", async () => {
      await prepare("systemd");
      await rm(path.join(directory, "usr/bin/alfc"));
      await symlink("/usr/lib/alfc/alfc", path.join(directory, "usr/bin/alfc"));
      await expect(run("install.sh")).rejects.toMatchObject({ code: 1 });
      expect(await readlink(path.join(directory, "usr/bin/alfc"))).toBe(
        "/usr/lib/alfc/alfc",
      );
      await rm(path.join(release, "frontend"), { recursive: true });
      await expect(run("install.sh")).rejects.toMatchObject({ code: 1 });
      await expect(readFile(log)).rejects.toThrow();
      expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
        "old-binary",
      );
    });

    it.each(["systemd", "openrc"] as const)(
      "refuses %s removal when the command belongs to another installation",
      async (init) => {
        await prepare(init);
        const command = path.join(directory, "usr/bin/alfc");
        await rm(command);
        await symlink("/usr/lib/alfc/alfc", command);
        await expect(run("uninstall.sh")).rejects.toMatchObject({ code: 1 });
        expect(await readlink(command)).toBe("/usr/lib/alfc/alfc");
        await expect(readFile(log)).rejects.toThrow();
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old-binary",
        );
        expect(
          await readFile(
            path.join(
              directory,
              init === "systemd"
                ? "etc/systemd/system/alfc.service"
                : "etc/init.d/alfc",
            ),
            "utf8",
          ),
        ).toContain(`${installed}/alfc`);
      },
    );

    it.each(["systemd", "openrc"] as const)(
      "refuses a foreign regular %s service even when the command link is missing",
      async (init) => {
        await prepare(init);
        await rm(path.join(directory, "usr/bin/alfc"));
        const service = path.join(
          directory,
          init === "systemd"
            ? "etc/systemd/system/alfc.service"
            : "etc/init.d/alfc",
        );
        const foreign =
          init === "systemd"
            ? "[Service]\nExecStart=/usr/lib/foreign-controller/daemon\n"
            : '#!/sbin/openrc-run\ncommand="/usr/lib/foreign-controller/daemon"\n';
        await writeFile(service, foreign);
        for (const name of ["install.sh", "uninstall.sh"]) {
          await expect(run(name)).rejects.toMatchObject({ code: 1 });
          expect(await readFile(service, "utf8")).toBe(foreign);
          expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
            "old-binary",
          );
          await expect(readFile(log)).rejects.toThrow();
        }
      },
    );

    it.each(["install.sh", "uninstall.sh"])(
      "refuses %s when systemd resolves the service to a vendor unit",
      async (name) => {
        await prepare("systemd");
        await rm(path.join(directory, "usr/bin/alfc"));
        await rm(path.join(directory, "etc/systemd/system/alfc.service"));
        await expect(
          run(name, { foreignService: "/usr/lib/systemd/system/alfc.service" }),
        ).rejects.toMatchObject({ code: 1 });
        expect(await readFile(log, "utf8")).not.toMatch(
          /\b(stop|disable|restart|daemon-reload)\b/,
        );
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old-binary",
        );
      },
    );

    it.each(["systemd", "openrc"] as const)(
      "reports %s deregistration failure and keeps the stopped installation for retry",
      async (init) => {
        await prepare(init);
        await expect(
          run("uninstall.sh", { disable: true }),
        ).rejects.toMatchObject({
          code: 23,
          stdout: expect.not.stringContaining("ALFC uninstalled."),
        });
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old-binary",
        );
        expect(
          await readFile(path.join(installed, "alfc.config.json"), "utf8"),
        ).toBe('{"user":"preserve"}');
        const commands = await readFile(log, "utf8");
        expect(commands).toContain("stopped:old-binary");
        expect(commands).not.toContain("daemon-reload");
        await run("uninstall.sh");
        await expect(readFile(path.join(installed, "alfc"))).rejects.toThrow();
      },
    );

    it.each(["install.sh", "uninstall.sh"])(
      "aborts %s before mutation when systemd identity cannot be queried",
      async (name) => {
        await prepare("systemd");
        await expect(run(name, { show: true })).rejects.toMatchObject({
          code: 31,
        });
        expect(await readFile(log, "utf8")).not.toMatch(
          /\b(stop|disable|restart|daemon-reload)\b/,
        );
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old-binary",
        );
      },
    );

    it.each(["install.sh", "uninstall.sh"])(
      "refuses %s when the OpenRC default registration points to a foreign service",
      async (name) => {
        await prepare("openrc");
        const registration = path.join(directory, "etc/runlevels/default/alfc");
        const foreign = path.join(directory, "etc/init.d/foreign-service");
        await writeFile(foreign, "foreign startup entry");
        await rm(registration);
        await symlink(foreign, registration);
        await expect(run(name)).rejects.toMatchObject({ code: 1 });
        expect(await readlink(registration)).toBe(foreign);
        expect(await readFile(foreign, "utf8")).toBe("foreign startup entry");
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old-binary",
        );
        await expect(readFile(log)).rejects.toThrow();
      },
    );

    it("accepts an owned relative OpenRC default-runlevel link", async () => {
      await prepare("openrc");
      const registration = path.join(directory, "etc/runlevels/default/alfc");
      await rm(registration);
      await symlink("../../init.d/alfc", registration);
      await run("install.sh");
      await rm(registration);
      await symlink("../../init.d/alfc", registration);
      await run("uninstall.sh");
      await expect(readlink(registration)).rejects.toThrow();
      expect(
        await readFile(path.join(installed, "alfc.config.json"), "utf8"),
      ).toBe('{"user":"preserve"}');
    });

    it.each(["systemd", "openrc"] as const)(
      "keeps %s removal idempotent after its service registration is gone",
      async (init) => {
        await prepare(init);
        if (init === "openrc")
          await rm(path.join(directory, "etc/runlevels/default/alfc"));
        await run("uninstall.sh");
        await run("uninstall.sh");
        await expect(readFile(path.join(installed, "alfc"))).rejects.toThrow();
        expect(
          await readFile(path.join(installed, "alfc.config.json"), "utf8"),
        ).toBe('{"user":"preserve"}');
        const commands = await readFile(log, "utf8");
        if (init === "openrc") expect(commands).not.toContain(" del ");
        else expect(commands.match(/ disable /g)).toHaveLength(1);
      },
    );

    it("stages the Windows wrapper with its exact notice in the release workflow", async () => {
      directory = await mkdtemp(path.join(os.tmpdir(), "alfc-windows-stage-"));
      const fixtureFiles = [
        "server/dist/alfc.exe",
        "server/native/windows/wmidll/WmiDll.dll",
        "frontend/build/index.html",
        "alfc.config.json",
        "WinSW-x64.exe",
        "bootstrap/scripts/install.bat",
        "bootstrap/scripts/uninstall.bat",
        "bootstrap/scripts/run.bat",
        "bootstrap/scripts/alfc-service.xml",
        "README.md",
        "common/PROTOCOL.md",
        "plasmoid/README.md",
        "plasmoid/package/contents/ui/Protocol.js",
        "omarchy/install.sh",
        "omarchy/uninstall.sh",
        "omarchy/manage.py",
        "omarchy/module/Widget.qml",
        "aur/README.md",
        "assets/screenshot.png",
      ];
      for (const name of fixtureFiles) {
        const target = path.join(directory, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, name);
      }
      await copyFile(
        path.join(repositoryRoot, "LICENSE"),
        path.join(directory, "LICENSE"),
      );
      await copyFile(
        path.join(import.meta.dirname, "WinSW-LICENSE.txt"),
        path.join(directory, "bootstrap/WinSW-LICENSE.txt"),
      );
      const workflow = await readFile(
        path.join(repositoryRoot, ".github/workflows/release.yml"),
        "utf8",
      );
      const assembly = workflow.match(
        / {6}- name: Assemble Windows release\n[\s\S]*? {8}run: \|\n([\s\S]*?)(?=\n {6}- name:)/,
      )?.[1];
      expect(assembly).toBeDefined();
      await execute("bash", ["-c", assembly!.replace(/^ {10}/gm, "")], {
        cwd: directory,
        env: { ...process.env, ALFC_RELEASE_VERSION: "v2.0.0" },
        timeout: 5000,
      });
      const stage = path.join(directory, "alfc-v2.0.0-windows-x64");
      expect(await readFile(path.join(stage, "alfc-service.exe"), "utf8")).toBe(
        "WinSW-x64.exe",
      );
      expect(await readFile(path.join(stage, "WinSW-LICENSE.txt"))).toEqual(
        await readFile(path.join(import.meta.dirname, "WinSW-LICENSE.txt")),
      );
      expect(await readFile(path.join(stage, "LICENSE"))).toEqual(
        await readFile(path.join(repositoryRoot, "LICENSE")),
      );
    });

    it("packages outside the archive input and includes service, UI, widget, and documentation", async () => {
      directory = await mkdtemp(path.join(os.tmpdir(), "alfc-package-"));
      commandDir = path.join(directory, "commands");
      const files = [
        "server/dist/alfc",
        "frontend/build/index.html",
        "alfc.config.json",
        "LICENSE",
        "LINUX.md",
        "README.md",
        "RELEASING.md",
        "SECURITY.md",
        "assets/screenshot.png",
        "common/PROTOCOL.md",
        "common/COMPATIBILITY.md",
        "aur/README.md",
        "plasmoid/package/metadata.json",
        "plasmoid/package/contents/ui/Protocol.js",
        "plasmoid/install.sh",
        "plasmoid/uninstall.sh",
        "plasmoid/DEPENDENCIES.md",
        "plasmoid/README.md",
        "omarchy/install.sh",
        "omarchy/uninstall.sh",
        "omarchy/manage.py",
        "omarchy/module/Widget.qml",
        "omarchy/module/Backend.qml",
        "bootstrap/scripts/linux/install.sh",
        "bootstrap/scripts/linux/uninstall.sh",
        "bootstrap/scripts/linux/run.sh",
        "bootstrap/scripts/linux/alfc.service",
      ];
      for (const name of files) {
        await mkdir(path.dirname(path.join(directory, name)), {
          recursive: true,
        });
        await writeFile(
          path.join(directory, name),
          name === "bootstrap/scripts/linux/alfc.service" ||
            name === "plasmoid/package/contents/ui/Protocol.js"
            ? await readFile(path.join(repositoryRoot, name), "utf8")
            : "fixture",
        );
      }
      await mkdir(commandDir, { recursive: true });
      await writeFile(path.join(commandDir, "bun"), "#!/bin/sh\nexit 0\n", {
        mode: 0o755,
      });
      const source = await readFile(
        path.join(repositoryRoot, "build.sh"),
        "utf8",
      );
      await writeFile(path.join(directory, "build.sh"), source);
      await execute("bash", [path.join(directory, "build.sh")], {
        cwd: os.tmpdir(),
        env: {
          ...process.env,
          PATH: commandDir + path.delimiter + process.env.PATH,
        },
      });
      const { stdout } = await execute("tar", [
        "-tzf",
        path.join(directory, "dist/alfc.tar.gz"),
      ]);
      for (const name of [
        "alfc",
        "frontend/index.html",
        "install.sh",
        "alfc.service",
        "plasmoid/package/metadata.json",
        "plasmoid/package/contents/ui/Protocol.js",
        "omarchy/install.sh",
        "omarchy/uninstall.sh",
        "omarchy/manage.py",
        "omarchy/module/Widget.qml",
        "omarchy/module/Backend.qml",
        "LINUX.md",
        "RELEASING.md",
        "SECURITY.md",
        "assets/screenshot.png",
        "common/PROTOCOL.md",
        "common/COMPATIBILITY.md",
        "aur/README.md",
      ])
        expect(stdout).toContain("alfc/" + name);
      expect(stdout).not.toContain("alfc.tar.gz");
      const packageDir = path.join(directory, "pkg");
      await execute("bash", [
        "-c",
        'source "$1"; pkgdir="$2"; srcdir="$4"; cd "$3"; ln -s "$3/dist/alfc" "alfc-v$pkgver-linux-x64"; package',
        "alfc-package-test",
        path.join(repositoryRoot, "aur/PKGBUILD"),
        packageDir,
        directory,
        path.join(repositoryRoot, "aur"),
      ]);
      expect(
        (await stat(path.join(packageDir, "usr/lib/alfc/plasmoid/install.sh")))
          .mode & 0o777,
      ).toBe(0o755);
      for (const [source, target, mode] of [
        [
          "alfc-stop-service.hook",
          "usr/share/libalpm/hooks/alfc-stop-service.hook",
          0o644,
        ],
        ["alfc-package-stop", "usr/lib/alfc/alfc-package-stop", 0o755],
      ] as const) {
        expect(await readFile(path.join(packageDir, target))).toEqual(
          await readFile(path.join(repositoryRoot, "aur", source)),
        );
        expect((await stat(path.join(packageDir, target))).mode & 0o777).toBe(
          mode,
        );
      }
      const hook = await readFile(
        path.join(packageDir, "usr/share/libalpm/hooks/alfc-stop-service.hook"),
        "utf8",
      );
      expect(hook).toMatch(/^Operation = Upgrade$/m);
      expect(hook).toMatch(/^Operation = Remove$/m);
      expect(hook).toMatch(/^When = PreTransaction$/m);
      expect(hook).toMatch(/^AbortOnFail$/m);
      expect(hook).toMatch(/^Exec = \/usr\/lib\/alfc\/alfc-package-stop$/m);
      expect(await readlink(path.join(packageDir, "usr/bin/alfc"))).toBe(
        "/usr/lib/alfc/alfc",
      );
      expect(
        (await stat(path.join(packageDir, "usr/lib/alfc/omarchy/install.sh")))
          .mode & 0o777,
      ).toBe(0o755);
      for (const name of ["Widget.qml", "Backend.qml"])
        expect(
          await readFile(
            path.join(packageDir, "usr/lib/alfc/omarchy/module", name),
            "utf8",
          ),
        ).toBe("fixture");
      expect(
        await readFile(
          path.join(
            packageDir,
            "usr/lib/alfc/plasmoid/package/contents/ui/Protocol.js",
          ),
          "utf8",
        ),
      ).toBe(
        await readFile(
          path.join(repositoryRoot, "plasmoid/package/contents/ui/Protocol.js"),
          "utf8",
        ),
      );
      expect(
        await readFile(
          path.join(packageDir, "usr/lib/systemd/system/alfc.service"),
          "utf8",
        ),
      ).toBe(
        (
          await readFile(
            path.join(repositoryRoot, "bootstrap/scripts/linux/alfc.service"),
            "utf8",
          )
        ).replaceAll("@@INSTALL_DIR@@", "/usr/lib/alfc"),
      );
      for (const name of [
        "common/PROTOCOL.md",
        "aur/README.md",
        "plasmoid/README.md",
        "assets/screenshot.png",
      ]) {
        expect(
          await readFile(
            path.join(packageDir, "usr/share/doc/alfc-bin", name),
            "utf8",
          ),
        ).toBe("fixture");
      }
      await rm(path.join(directory, "dist/alfc/alfc.service"));
      const incompletePackageDir = path.join(directory, "incomplete-pkg");
      await expect(
        execute("bash", [
          "-e",
          "-c",
          'source "$1"; pkgdir="$2"; srcdir="$4"; cd "$3"; package',
          "alfc-package-test",
          path.join(repositoryRoot, "aur/PKGBUILD"),
          incompletePackageDir,
          directory,
          path.join(repositoryRoot, "aur"),
        ]),
      ).rejects.toMatchObject({ code: 1 });
      await expect(
        stat(
          path.join(
            incompletePackageDir,
            "usr/lib/systemd/system/alfc.service",
          ),
        ),
      ).rejects.toThrow();
    });
  },
);
