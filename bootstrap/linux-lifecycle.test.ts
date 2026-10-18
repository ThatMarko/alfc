import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

describe.skipIf(process.platform === "win32")(
  "isolated Linux service lifecycle",
  () => {
    let directory: string;
    let installed: string;
    let release: string;
    let commands: string;
    let log: string;
    const runlevels = ["default", "boot", "custom", ".custom", "..backup"];

    function registration(runlevel: string) {
      return path.join(directory, "etc/runlevels", runlevel, "alfc");
    }

    beforeEach(async () => {
      directory = await mkdtemp(path.join(os.tmpdir(), "alfc-runlevels-"));
      installed = path.join(directory, "opt/alfc");
      release = path.join(directory, "release");
      commands = path.join(directory, "commands");
      log = path.join(directory, "commands.log");
      for (const relative of [
        "opt/alfc",
        "release/frontend",
        "commands",
        "usr/bin",
        "etc/init.d",
        "etc/runlevels/default",
        "etc/runlevels/boot",
        "etc/runlevels/custom",
        "etc/runlevels/.custom",
        "etc/runlevels/..backup",
        "proc/acpi",
      ])
        await mkdir(path.join(directory, relative), { recursive: true });
      await writeFile(path.join(installed, "alfc"), "old executable");
      await writeFile(
        path.join(installed, "alfc.config.json"),
        '{"owned":"settings"}',
      );
      await writeFile(path.join(release, "alfc"), "new executable");
      await writeFile(path.join(release, "alfc.config.json"), "defaults");
      await writeFile(path.join(release, "frontend/index.html"), "frontend");
      await writeFile(path.join(directory, "proc/acpi/call"), "");
      await writeFile(
        path.join(directory, "etc/init.d/alfc"),
        `#!/sbin/openrc-run\ncommand="${installed}/alfc"\n`,
      );
      await symlink(
        path.join(installed, "alfc"),
        path.join(directory, "usr/bin/alfc"),
      );
      for (const runlevel of runlevels)
        await symlink("../../init.d/alfc", registration(runlevel));
      for (const name of ["install.sh", "uninstall.sh", "run.sh"]) {
        const source = await readFile(
          path.join(import.meta.dirname, "scripts/linux", name),
          "utf8",
        );
        await writeFile(
          path.join(release, name),
          source
            .replace(
              'if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then',
              "if false; then",
            )
            .replaceAll("/opt/alfc", installed)
            .replaceAll("/usr/bin/alfc", path.join(directory, "usr/bin/alfc"))
            .replaceAll("/etc/", path.join(directory, "etc") + "/")
            .replaceAll(
              "/run/systemd/system",
              path.join(directory, "run/systemd/system"),
            )
            .replaceAll(
              "/proc/acpi/call",
              path.join(directory, "proc/acpi/call"),
            ),
        );
      }
      // These command substitutes cannot touch host services. rc-update models
      // individual runlevel entries, including a failure after earlier removals.
      await writeFile(
        path.join(commands, "rc-service"),
        '#!/bin/sh\nprintf "rc-service %s\\n" "$*" >> "$ALFC_TEST_LOG"\n',
        { mode: 0o755 },
      );
      await writeFile(
        path.join(commands, "rc-update"),
        `#!/bin/sh
printf 'rc-update %s\\n' "$*" >> "$ALFC_TEST_LOG"
if [ "$1" = del ]; then
  [ "$3" != "$ALFC_TEST_FAIL_RUNLEVEL" ] || exit 23
  rm -f "$ALFC_TEST_ROOT/etc/runlevels/$3/$2"
fi
`,
        { mode: 0o755 },
      );
    });

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    function run(name: string, failedRunlevel = "") {
      return execute("bash", [path.join(release, name)], {
        env: {
          ...process.env,
          PATH: commands + path.delimiter + process.env.PATH,
          ALFC_TEST_ROOT: directory,
          ALFC_TEST_LOG: log,
          ALFC_TEST_FAIL_RUNLEVEL: failedRunlevel,
        },
        timeout: 5000,
      });
    }

    async function useSystemd(execStarts: string[]) {
      await mkdir(path.join(directory, "run/systemd/system"), {
        recursive: true,
      });
      await mkdir(path.join(directory, "etc/systemd/system"), {
        recursive: true,
      });
      await writeFile(
        path.join(directory, "etc/systemd/system/alfc.service"),
        `[Service]\nExecStart=${installed}/alfc\n`,
      );
      await writeFile(
        path.join(release, "alfc.service"),
        await readFile(
          path.join(import.meta.dirname, "scripts/linux/alfc.service"),
        ),
      );
      await writeFile(
        path.join(directory, "effective-exec"),
        execStarts.map((value) => `ExecStart=${value}\n`).join(""),
      );
      await writeFile(
        path.join(commands, "systemctl"),
        `#!/bin/sh
printf 'systemctl %s\\n' "$*" >> "$ALFC_TEST_LOG"
if [ "$1" = show ]; then
  printf 'LoadState=loaded\\nFragmentPath=%s/etc/systemd/system/alfc.service\\n' "$ALFC_TEST_ROOT"
  printf 'DropInPaths=/usr/lib/systemd/system/service.d/10-timeout-policy.conf\\n'
  cat "$ALFC_TEST_ROOT/effective-exec"
fi
`,
        { mode: 0o755 },
      );
    }

    function commandProperty(executable: string, argument = executable) {
      // systemd v257 systemctl-show.c prints one ExecStart= record per command.
      return `{ path=${executable} ; argv[]=${argument} ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0 }`;
    }

    it("removes all owned startup registrations and supports a repeated uninstall", async () => {
      const first = await run("uninstall.sh");
      expect(first.stdout).toContain("ALFC uninstalled.");
      for (const runlevel of runlevels)
        await expect(readlink(registration(runlevel))).rejects.toMatchObject({
          code: "ENOENT",
        });
      expect(await readFile(log, "utf8")).toContain("rc-service alfc stop");
      expect(
        await readFile(path.join(installed, "alfc.config.json"), "utf8"),
      ).toBe('{"owned":"settings"}');
      await run("uninstall.sh");
    });

    it.each(["install.sh", "uninstall.sh"])(
      "refuses %s when a non-default runlevel belongs to another service",
      async (name) => {
        const foreign = path.join(directory, "etc/init.d/foreign-controller");
        await writeFile(foreign, "foreign service");
        for (const runlevel of ["boot", ".custom", "..backup"]) {
          await rm(registration(runlevel));
          await symlink(foreign, registration(runlevel));
          await expect(run(name)).rejects.toMatchObject({ code: 1 });
          await expect(readFile(log, "utf8")).rejects.toMatchObject({
            code: "ENOENT",
          });
          expect(await readlink(registration(runlevel))).toBe(foreign);
          expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
            "old executable",
          );
          await rm(registration(runlevel));
          await symlink("../../init.d/alfc", registration(runlevel));
        }
      },
    );

    it("retains files on a later runlevel deregistration failure and succeeds on retry", async () => {
      await expect(run("uninstall.sh", "custom")).rejects.toMatchObject({
        code: 23,
      });
      expect(await readFile(log, "utf8")).toContain("rc-update del alfc boot");
      expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
        "old executable",
      );
      expect(await readlink(registration("custom"))).toBe("../../init.d/alfc");
      await run("uninstall.sh");
      for (const runlevel of runlevels)
        await expect(readlink(registration(runlevel))).rejects.toMatchObject({
          code: "ENOENT",
        });
    });

    it("preserves owned custom runlevel membership on upgrade", async () => {
      await run("install.sh");
      for (const runlevel of ["boot", "custom"])
        expect(await readlink(registration(runlevel))).toBe(
          "../../init.d/alfc",
        );
      expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
        "new executable",
      );
    });

    it.each(["direct", "source alias", "install parent alias"])(
      "refuses a release inside the installation before deleting its source (%s)",
      async (alias) => {
        const nested = path.join(installed, "frontend/release");
        await mkdir(path.dirname(nested));
        await rename(release, nested);
        if (alias === "source alias") await symlink(nested, release);
        else release = nested;
        if (alias === "install parent alias") {
          const physicalOpt = path.join(directory, "physical-opt");
          await rename(path.join(directory, "opt"), physicalOpt);
          await symlink(physicalOpt, path.join(directory, "opt"));
        }
        await expect(run("install.sh")).rejects.toMatchObject({ code: 1 });
        await expect(readFile(log, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old executable",
        );
        expect(
          await readFile(path.join(nested, "frontend/index.html"), "utf8"),
        ).toBe("frontend");
      },
    );

    it.each(["install.sh", "uninstall.sh"])(
      "refuses %s when the effective systemd executable was overridden",
      async (name) => {
        await useSystemd([
          commandProperty("/usr/lib/foreign-controller/daemon"),
        ]);
        await expect(run(name)).rejects.toMatchObject({ code: 1 });
        expect(await readFile(log, "utf8")).not.toMatch(
          /systemctl (stop|disable|daemon-reload|enable|restart)\b/,
        );
        expect(await readFile(path.join(installed, "alfc"), "utf8")).toBe(
          "old executable",
        );
      },
    );

    it.each(["install.sh", "uninstall.sh"])(
      "refuses %s when systemd reports multiple start commands",
      async (name) => {
        await useSystemd([
          commandProperty(`${installed}/alfc`),
          commandProperty("/usr/lib/foreign-controller/daemon"),
        ]);
        await expect(run(name)).rejects.toMatchObject({ code: 1 });
        expect(await readFile(log, "utf8")).not.toMatch(
          /systemctl (stop|disable|daemon-reload|enable|restart)\b/,
        );
      },
    );

    it.each(["install.sh", "uninstall.sh"])(
      "refuses %s when a drop-in changes the effective arguments",
      async (name) => {
        await useSystemd([
          commandProperty(
            `${installed}/alfc`,
            `${installed}/alfc --foreign-mode`,
          ),
        ]);
        await expect(run(name)).rejects.toMatchObject({ code: 1 });
        expect(await readFile(log, "utf8")).not.toMatch(
          /systemctl (stop|disable|daemon-reload|enable|restart)\b/,
        );
      },
    );

    it.each(["install.sh", "uninstall.sh"])(
      "refuses %s when the effective command cannot establish ownership",
      async (name) => {
        await useSystemd([]);
        await expect(run(name)).rejects.toMatchObject({ code: 1 });
        expect(await readFile(log, "utf8")).not.toMatch(
          /systemctl (stop|disable|daemon-reload|enable|restart)\b/,
        );
      },
    );

    it("accepts harmless systemd policy drop-ins with the owned effective command", async () => {
      await useSystemd([commandProperty(`${installed}/alfc`)]);
      await run("install.sh");
      await run("uninstall.sh");
      expect(
        await readFile(path.join(installed, "alfc.config.json"), "utf8"),
      ).toBe('{"owned":"settings"}');
    });
  },
);
