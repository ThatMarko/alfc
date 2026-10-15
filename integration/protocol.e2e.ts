import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import type { FanControlActivity, State } from "../common/types";

const repository = path.resolve(import.meta.dirname, "..");
const initialState: State = {
  protocolVersion: "1.1",
  cpuFanTable: [
    [40, 15],
    [83, 50],
    [88, 100],
  ],
  gpuFanTable: [
    [40, 15],
    [78, 50],
    [83, 100],
  ],
  gpuBoost: true,
  pl1: 37,
  pl2: 106,
  doFixedSpeed: true,
  fixedPercentage: 50,
};

type Event = {
  event: string;
  id?: number;
  state?: State;
  activity?: FanControlActivity;
  ready?: boolean;
  pending?: number;
  fresh?: boolean;
  ok?: boolean;
  error?: string;
  requestId?: string;
  families?: string[];
  calls?: { method: string; args?: Record<string, number> }[];
};

class JsonProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly events: Event[] = [];
  diagnostics = "";
  private sequence = 0;
  private exited = false;
  private exit: Promise<void>;
  private label: string;

  constructor(command: string, args: string[], fixture = false) {
    this.label = path.basename(args[0] ?? command);
    this.child = spawn(command, args, {
      cwd: repository,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "pipe",
    });
    this.exit = new Promise((resolve) => {
      this.child.once("exit", () => {
        this.exited = true;
        resolve();
      });
      this.child.once("error", (error) => {
        this.exited = true;
        this.diagnostics += String(error);
        resolve();
      });
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.diagnostics = (this.diagnostics + chunk.toString()).slice(-16_000);
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        const event = JSON.parse(line) as Event & { alfcFixture?: boolean };
        if (!fixture || event.alfcFixture === true) this.events.push(event);
      } catch (_) {
        this.diagnostics = (this.diagnostics + line + "\n").slice(-16_000);
      }
    });
  }

  async wait(predicate: (event: Event) => boolean, after = 0): Promise<Event> {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const found = this.events.slice(after).find(predicate);
      if (found) return found;
      if (this.exited)
        throw new Error(
          `Integration child exited unexpectedly:\n${this.diagnostics}`,
        );
      await delay(20);
    }
    throw new Error(
      `Integration event timeout. Recent events: ${JSON.stringify(this.events.slice(-6))}\n${this.diagnostics}`,
    );
  }

  command(command: Record<string, unknown>) {
    const id = ++this.sequence;
    this.child.stdin.write(JSON.stringify({ ...command, id }) + "\n");
    return this.wait((event) => event.event === "reply" && event.id === id);
  }

  async close(graceful: boolean) {
    if (this.exited) {
      expect(this.child.exitCode, this.diagnostics).toBe(0);
      return;
    }
    try {
      if (graceful) await this.command({ op: "stop" });
      else this.child.stdin.end();
      await Promise.race([this.exit, delay(3000)]);
    } finally {
      if (!this.exited) this.child.kill("SIGKILL");
      await this.exit;
    }
    expect(
      this.child.exitCode,
      `${this.label} must exit naturally (signal: ${this.child.signalCode ?? "none"})\n${this.diagnostics}`,
    ).toBe(0);
  }
}

async function sandbox() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "alfc-cross-client-"));
  await Promise.all([
    cp(path.join(repository, "server"), path.join(directory, "server"), {
      recursive: true,
      filter: (source) =>
        !["dist", "node_modules"].includes(path.basename(source)),
    }),
    cp(path.join(repository, "common"), path.join(directory, "common"), {
      recursive: true,
    }),
    symlink(
      path.join(repository, "node_modules"),
      path.join(directory, "node_modules"),
      "junction",
    ),
    writeFile(
      path.join(directory, "alfc.config.json"),
      JSON.stringify(initialState),
    ),
  ]);
  await symlink(
    path.join(repository, "server/node_modules"),
    path.join(directory, "server/node_modules"),
    "junction",
  );
  return directory;
}

async function cleanup(
  directory: string,
  qt?: JsonProcess,
  fixture?: JsonProcess,
  primaryError?: unknown,
) {
  const errors: unknown[] = [];
  try {
    const results = await Promise.allSettled([
      qt?.close(false),
      fixture?.close(true),
    ]);
    for (const result of results) {
      if (result.status === "rejected") errors.push(result.reason);
    }
  } finally {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    if (primaryError !== undefined) errors.unshift(primaryError);
    throw new AggregateError(
      errors,
      [
        "Integration cleanup failed; collected errors:",
        ...errors.map(String),
      ].join("\n"),
      { cause: primaryError ?? errors[0] },
    );
  }
}

async function startFixture(directory: string) {
  const fixture = new JsonProcess(
    process.env.ALFC_BUN_EXECUTABLE ?? "bun",
    [
      path.join(repository, "integration/protocol-fixture.ts"),
      directory,
      path.join(repository, "frontend/build"),
    ],
    true,
  );
  try {
    const ready = await fixture.wait((event) => event.event === "ready");
    // This tier intentionally requires both families; the existing listener
    // unit tier independently verifies hosts where only IPv4 is available.
    expect(ready.families).toEqual(["127.0.0.1", "::1"]);
    return fixture;
  } catch (error) {
    try {
      await fixture.close(false);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Fixture startup failed: ${String(error)}\nCleanup failed: ${String(cleanupError)}`,
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

async function startQt(endpoint: string) {
  const qt = new JsonProcess(process.env.ALFC_QT_PYTHON ?? "python3", [
    path.join(repository, "integration/qt_client.py"),
    endpoint,
  ]);
  try {
    await qt.wait(
      (event) => event.event === "snapshot" && event.ready === true,
    );
    return qt;
  } catch (error) {
    try {
      await qt.close(false);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Qt startup failed: ${String(error)}\nCleanup failed: ${String(cleanupError)}`,
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

async function qtRequest(qt: JsonProcess, command: Record<string, unknown>) {
  const reply = await qt.command({ op: "send", ...command });
  return qt.wait(
    (event) =>
      event.event === "finished" && event.requestId === reply.requestId,
  );
}

test("production web and Qt clients share authoritative state, errors, admitted writes and recovery", async ({
  page,
}) => {
  const directory = await sandbox();
  let fixture: JsonProcess | undefined;
  let qt: JsonProcess | undefined;
  const errors: string[] = [];
  let primaryError: unknown;
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    fixture = await startFixture(directory);
    qt = await startQt("ws://[::1]:5522/ws/");
    await page.route("https://api.github.com/**", (route) =>
      route.fulfill({ status: 404, body: "{}" }),
    );
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    await page.goto("http://127.0.0.1:5522/");
    const fixed = page.getByLabel("Fixed fan speed percentage");
    await expect(fixed).toHaveValue("50");
    await expect(fixed).toBeEnabled();
    // Both clients subscribe through their actual setup code, not a test send.
    await qt.wait(
      (event) => event.event === "snapshot" && event.fresh === true,
    );
    await expect(page.getByText("48°C", { exact: true })).toBeVisible();

    const pl1 = page.getByLabel("PL1 power limit in watts");
    const curve = page.getByLabel("CPU temperature for row 1");
    await pl1.fill("62");
    await curve.fill("41.5");
    expect(
      (
        await qtRequest(qt, {
          kind: "set",
          methodId: "129",
          methodName: "SetAIBoostStatus",
          data: { Data: 0 },
        })
      ).ok,
    ).toBe(true);
    await expect(
      page.getByRole("checkbox", { name: "GPU Boost" }),
    ).not.toBeChecked();
    await expect(pl1).toHaveValue("62");
    await expect(curve).toHaveValue("41.5");

    await fixed.fill("66");
    await page
      .getByRole("form", { name: "Fixed speed preset" })
      .getByRole("button", { name: "Apply" })
      .click();
    await qt.wait((event) => event.state?.fixedPercentage === 66);
    expect(
      (await qtRequest(qt, { kind: "tune", data: { pl1: -1, pl2: 60 } })).error,
    ).toMatch(/^INVALID_RANGE:/);
    expect(
      (await qtRequest(qt, { kind: "fixedpercentage", data: 68 })).ok,
    ).toBe(true);
    await expect(fixed).toHaveValue("68");

    await fixture.command({ op: "hold-next-write" });
    const heldAt = fixture.events.length;
    const pending = await qt.command({
      op: "send",
      kind: "fixedpercentage",
      data: 71,
    });
    await fixture.wait((event) => event.event === "write-held", heldAt);
    await qt.command({ op: "reconnect" });
    const interrupted = await qt.wait(
      (event) =>
        event.event === "finished" && event.requestId === pending.requestId,
    );
    expect(interrupted.ok).toBe(false);
    expect(interrupted.error).toMatch(/reset before the request completed/);
    const reconnectedAt = qt.events.length;
    await fixture.command({ op: "release-write" });
    await expect(fixed).toHaveValue("71");
    await qt.wait(
      (event) => event.ready === true && event.state?.fixedPercentage === 71,
      reconnectedAt,
    );
    // Barrier through the real mutation queue after reconnect. An accidental
    // queued resend would execute before this request and show in the log.
    expect(
      (await qtRequest(qt, { kind: "fixedpercentage", data: 72 })).ok,
    ).toBe(true);
    const inspection = await fixture.command({ op: "inspect" });
    expect(
      inspection.calls?.filter(
        (call) =>
          call.method === "SetFixedFanSpeed" &&
          call.args?.Data === Math.ceil((71 / 100) * 229),
      ),
    ).toHaveLength(1);
    expect(
      qt.events.filter(
        (event) =>
          event.event === "finished" && event.requestId === pending.requestId,
      ),
    ).toHaveLength(1);
    await expect(pl1).toHaveValue("62");
    await expect(curve).toHaveValue("41.5");

    await fixture.command({ op: "fail-cpu" });
    expect(
      (await qtRequest(qt, { kind: "tune", data: { pl1: 45, pl2: 100 } }))
        .error,
    ).toMatch(/^RESTART_REQUIRED:/);
    await qt.wait(
      (event) =>
        event.state?.isCpuTuningAvailable === false &&
        event.state.restartRequired === true,
    );
    await expect(pl1).toHaveCount(0);
    await expect(page.getByText(/CPU Tuning is not available/)).toBeVisible();
    await expect(fixed).toBeEnabled();
    expect(
      (await qtRequest(qt, { kind: "fixedpercentage", data: 74 })).ok,
    ).toBe(true);
    await expect(fixed).toHaveValue("74");
    await fixture.command({ op: "fail-wmi" });
    await qt.wait(
      (event) =>
        event.state?.isFanControlAvailable === false &&
        event.state.isGpuBoostAvailable === false,
    );
    await expect(fixed).toBeDisabled();
    expect(
      (await qtRequest(qt, { kind: "fixedpercentage", data: 75 })).error,
    ).toMatch(/^UNSUPPORTED_FEATURE:/);
    expect(errors).toEqual([]);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await page.close();
    await cleanup(directory, qt, fixture, primaryError);
    if (fixture) {
      const stopped = fixture.events.find((event) => event.event === "stopped");
      const tail = stopped?.calls?.slice(-4).map((call) => call.method);
      expect(tail).toEqual([
        "SetFixedFanStatus",
        "SetAutoFanStatus",
        "wmiCleanup",
        "cpuocCleanup",
      ]);
    }
  }
});

test("real persistence failure broadcasts active state, restart reads durable settings and clears runtime failures", async () => {
  const directory = await sandbox();
  let fixture: JsonProcess | undefined;
  let qt: JsonProcess | undefined;
  const config = path.join(directory, "alfc.config.json");
  let primaryError: unknown;
  try {
    fixture = await startFixture(directory);
    qt = await startQt("ws://127.0.0.1:5522/ws/");
    expect(
      (await qtRequest(qt, { kind: "fixedpercentage", data: 64 })).ok,
    ).toBe(true);
    await rename(config, config + ".saved");
    await mkdir(config);
    expect(
      (await qtRequest(qt, { kind: "fixedpercentage", data: 76 })).error,
    ).toMatch(/^PERSISTENCE_ERROR:/);
    await qt.wait((event) => event.state?.fixedPercentage === 76);
    await rm(config, { recursive: true });
    await rename(config + ".saved", config);
    await fixture.command({ op: "fail-wmi" });
    await qt.close(false);
    qt = undefined;
    await fixture.close(true);
    fixture = await startFixture(directory);
    qt = await startQt("ws://[::1]:5522/ws");
    await qt.wait(
      (event) =>
        event.ready === true &&
        event.state?.fixedPercentage === 64 &&
        event.state.isFanControlAvailable === true &&
        event.state.restartRequired !== true,
    );
    expect(
      (await qtRequest(qt, { kind: "fixedpercentage", data: 77 })).ok,
    ).toBe(true);
    const persisted = JSON.parse(await readFile(config, "utf8")) as Record<
      string,
      unknown
    >;
    expect(persisted.fixedPercentage).toBe(77);
    for (const key of [
      "protocolVersion",
      "isFanControlAvailable",
      "isCpuTuningAvailable",
      "isGpuBoostAvailable",
      "restartRequired",
    ])
      expect(persisted).not.toHaveProperty(key);
    await qt.close(false);
    qt = undefined;
    await fixture.close(true);
    fixture = await startFixture(directory);
    qt = await startQt("ws://127.0.0.1:5522/ws");
    await qt.wait(
      (event) => event.ready === true && event.state?.fixedPercentage === 77,
    );
    const readback = await fixture.command({ op: "inspect" });
    expect(readback.calls).toContainEqual({
      method: "SetFixedFanSpeed",
      args: { Data: Math.ceil((77 / 100) * 229) },
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await cleanup(directory, qt, fixture, primaryError);
  }
});
