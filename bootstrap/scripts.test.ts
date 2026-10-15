import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readlink,
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

describe.skipIf(process.platform === "win32")(
  "isolated Linux service management",
  () => {
    let directory: string;
    let release: string;
    let installed: string;
    let log: string;
    let commandDir: string;

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
      directory = await mkdtemp(path.join(os.tmpdir(), "alfc-installer-"));
      release = path.join(directory, "release");
      installed = path.join(directory, "opt/alfc");
      log = path.join(directory, "commands.log");
      commandDir = path.join(directory, "commands");
      for (const relative of [
        "release/frontend",
        "opt/alfc/frontend",
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
        "old service",
      );
      await writeFile(path.join(directory, "proc/acpi/call"), "");
      await writeFile(path.join(installed, "alfc"), "old-binary");
      await writeFile(
        path.join(installed, "alfc.config.json"),
        '{"user":"preserve"}',
      );
      await writeFile(path.join(installed, "frontend/old.js"), "old asset");
      await symlink(
        path.join(installed, "alfc"),
        path.join(directory, "usr/bin/alfc"),
      );
      await writeFile(path.join(release, "alfc"), "new-binary");
      await writeFile(path.join(release, "alfc.config.json"), "default config");
      await writeFile(path.join(release, "frontend/new.js"), "new asset");
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
case " $* " in
  *" stop "*)
    printf 'stopped:%s\\n' "$(cat "$ALFC_TEST_INSTALLED/alfc")" >> "$ALFC_TEST_LOG"
    [ "$ALFC_TEST_STOP_FAIL" != 1 ] || exit 1
    ;;
  *" restart "*) printf 'started:%s\\n' "$(cat "$ALFC_TEST_INSTALLED/alfc")" >> "$ALFC_TEST_LOG" ;;
esac
exit 0
`;
      for (const name of ["systemctl", "rc-service", "rc-update"])
        await writeFile(path.join(commandDir, name), mock, { mode: 0o755 });
    }

    async function run(name: string, failStop = false) {
      return execute("bash", [await script(name)], {
        env: {
          ...process.env,
          PATH: commandDir + path.delimiter + process.env.PATH,
          ALFC_TEST_LOG: log,
          ALFC_TEST_INSTALLED: installed,
          ALFC_TEST_STOP_FAIL: failStop ? "1" : "0",
        },
        timeout: 5000,
      });
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
        await expect(
          readFile(path.join(installed, "frontend/old.js")),
        ).rejects.toThrow();
        expect(
          await readFile(path.join(installed, "frontend/new.js"), "utf8"),
        ).toBe("new asset");
        expect(await readFile(log, "utf8")).toMatch(
          /stopped:old-binary[\s\S]*started:new-binary/,
        );
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
        await expect(run("install.sh", true)).rejects.toMatchObject({
          code: 1,
        });
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old-binary",
        );
        expect(
          await readFile(path.join(installed, "frontend/old.js"), "utf8"),
        ).toBe("old asset");
        await expect(run("uninstall.sh", true)).rejects.toMatchObject({
          code: 1,
        });
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old-binary",
        );
      },
    );

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
        "plasmoid/install.sh",
        "plasmoid/uninstall.sh",
        "plasmoid/DEPENDENCIES.md",
        "plasmoid/README.md",
        "bootstrap/scripts/linux/install.sh",
        "bootstrap/scripts/linux/uninstall.sh",
        "bootstrap/scripts/linux/run.sh",
        "bootstrap/scripts/linux/alfc.service",
      ];
      for (const name of files) {
        await mkdir(path.dirname(path.join(directory, name)), {
          recursive: true,
        });
        await writeFile(path.join(directory, name), "fixture");
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
        'source "$1"; pkgdir="$2"; cd "$3"; ln -s "$3/dist/alfc" "alfc-v$pkgver-linux-x64"; package',
        "alfc-package-test",
        path.join(repositoryRoot, "aur/PKGBUILD"),
        packageDir,
        directory,
      ]);
      expect(
        (await stat(path.join(packageDir, "usr/lib/alfc/plasmoid/install.sh")))
          .mode & 0o777,
      ).toBe(0o755);
      expect(await readlink(path.join(packageDir, "usr/bin/alfc"))).toBe(
        "/usr/lib/alfc/alfc",
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
    });
  },
);
