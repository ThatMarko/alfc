import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import type { MessageToServer, State } from "../../common/types";

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
  doFixedSpeed: false,
  fixedPercentage: 50,
  gpuBoost: true,
  pl1: 37,
  pl2: 106,
  isFanControlAvailable: true,
  isCpuTuningAvailable: true,
  isGpuBoostAvailable: true,
};

async function backend(page: Page, overrides: Partial<State> = {}) {
  const requests: MessageToServer[] = [];
  const connections: WebSocketRoute[] = [];
  const errors: string[] = [];
  let state = { ...structuredClone(initialState), ...overrides };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ status: 404, body: "{}" }),
  );
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.routeWebSocket(/\/ws$/, (socket) => {
    connections.push(socket);
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as MessageToServer;
      if (message.kind !== "registeractivitysocket") requests.push(message);
    });
    socket.send(JSON.stringify({ kind: "state", data: state }));
  });
  const send = (message: object) => {
    const socket = connections.at(-1);
    if (!socket) throw new Error("WebSocket not connected");
    socket.send(JSON.stringify(message));
  };
  const push = (next: Partial<State>) => {
    state = { ...state, ...next };
    send({ kind: "state", data: state });
  };
  await page.goto("/");
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeVisible();
  return { requests, connections, errors, send, push };
}

test("mode follows backend snapshots and only its own response settles a command", async ({
  page,
}) => {
  const server = await backend(page);
  const fixed = page.getByLabel("Fixed fan speed percentage");
  await expect(fixed).toBeDisabled();
  const mode = page.getByRole("button", { name: "Switch to fixed mode" });
  await mode.click();
  await expect.poll(() => server.requests.length).toBe(1);
  await expect(mode).toBeDisabled();
  server.send({ kind: "success", requestId: "other-client", data: true });
  server.push({ pl1: 45 });
  await expect(mode).toBeDisabled();
  await expect(fixed).toBeDisabled();
  server.send({
    kind: "error",
    requestId: server.requests[0]?.requestId,
    data: "ACPI_ERROR: hardware refused the mode change",
  });
  await expect(mode).toBeEnabled();
  await expect(fixed).toBeDisabled();
  await mode.click();
  await expect.poll(() => server.requests.length).toBe(2);
  server.send({
    kind: "success",
    requestId: server.requests[1]?.requestId,
    data: true,
  });
  server.push({ doFixedSpeed: true });
  await expect(fixed).toBeEnabled();
  await expect(page.getByLabel("CPU temperature for row 1")).toBeDisabled();
  server.push({ doFixedSpeed: false, gpuBoost: false });
  await expect(fixed).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "GPU Boost" }),
  ).not.toBeChecked();
  expect(server.errors).toEqual([]);
});

test("unrelated snapshots preserve drafts and tuning uses correlated acknowledgements", async ({
  page,
}) => {
  const server = await backend(page);
  const pl1 = page.getByLabel("PL1 power limit in watts");
  const temperature = page.getByLabel("CPU temperature for row 1");
  await pl1.fill("62");
  await temperature.fill("41.5");
  await page.getByLabel("CPU fan speed for row 1").fill("17.5");
  server.push({ gpuBoost: false });
  await expect(pl1).toHaveValue("62");
  await expect(temperature).toHaveValue("41.5");
  const tuning = page.locator("form").filter({ has: pl1 });
  await tuning.getByRole("button", { name: "Apply" }).click();
  await expect.poll(() => server.requests.length).toBe(1);
  expect(server.requests[0]).toMatchObject({
    kind: "tune",
    data: { pl1: 62, pl2: 106 },
  });
  await expect(pl1).toBeDisabled();
  server.send({ kind: "success", requestId: "unrelated-tune" });
  await expect(pl1).toBeDisabled();
  server.send({
    kind: "error",
    requestId: server.requests[0]?.requestId,
    data: "INTERNAL_ERROR: tuning failed",
  });
  await expect(pl1).toBeEnabled();
  await expect(pl1).toHaveValue("62");
  server.push({ pl1: 45, pl2: 88 });
  await expect(pl1).toHaveValue("45");
  await expect(temperature).toHaveValue("41.5");
  await page
    .locator("form")
    .filter({ has: temperature })
    .getByRole("button", { name: "Apply" })
    .click();
  await expect.poll(() => server.requests.length).toBe(2);
  expect(server.requests[1]).toMatchObject({
    kind: "fantable",
    data: {
      cpu: [
        [41.5, 17.5],
        [83, 50],
        [88, 100],
      ],
    },
  });
  expect(server.errors).toEqual([]);
});

test("unavailable hardware cannot be changed through disabled controls", async ({
  page,
}) => {
  const server = await backend(page, {
    isFanControlAvailable: false,
    isCpuTuningAvailable: false,
    isGpuBoostAvailable: false,
  });
  await expect(
    page.getByText("Fan control is not available on this system."),
  ).toBeVisible();
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeDisabled();
  await expect(page.getByLabel("CPU temperature for row 1")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Switch to fixed mode" }),
  ).toBeDisabled();
  await expect(page.getByLabel("PL1 power limit in watts")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "GPU Boost" })).toHaveCount(
    0,
  );
  server.push({
    isFanControlAvailable: true,
    isCpuTuningAvailable: true,
    isGpuBoostAvailable: true,
  });
  await expect(page.getByLabel("CPU temperature for row 1")).toBeEnabled();
  await expect(page.getByLabel("PL1 power limit in watts")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "GPU Boost" })).toBeVisible();
  expect(server.requests).toEqual([]);
  expect(server.errors).toEqual([]);
});

test("disconnect aborts pending work and reconnect never replays a hardware write", async ({
  page,
}) => {
  const server = await backend(page);
  await page.getByRole("button", { name: "Switch to fixed mode" }).click();
  await expect.poll(() => server.requests.length).toBe(1);
  await server.connections[0]?.close({ code: 1012, reason: "Service restart" });
  await expect.poll(() => server.connections.length).toBe(2);
  await expect(
    page.getByRole("button", { name: "Switch to fixed mode" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeDisabled();
  expect(server.requests).toHaveLength(1);
  expect(server.errors).toEqual([]);
});

test("invalid state disables the UI and valid state restores it", async ({
  page,
}) => {
  const server = await backend(page);
  await page.getByRole("button", { name: "Switch to fixed mode" }).click();
  await expect.poll(() => server.requests.length).toBe(1);
  server.send({
    kind: "state",
    data: { ...initialState, protocolVersion: "2.0" },
  });
  await expect(page.getByRole("alert")).toContainText(
    "incompatible or invalid state",
  );
  await expect(page.getByLabel("Fixed fan speed percentage")).toHaveCount(0);
  server.send({ kind: "success", requestId: server.requests[0]?.requestId });
  server.push({});
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeVisible();
  server.send({
    kind: "fancontrolactivity",
    data: {
      appliedSpeed: 0,
      avgCPUTemp: 0,
      avgGPUTemp: 0,
      target: 0,
      sensorFailure: true,
    },
  });
  await expect(
    page.getByLabel("Fan control status", { exact: true }),
  ).toHaveValue(/CPU: 0°C/);
  await expect(
    page.getByLabel("Fan control status", { exact: true }),
  ).toHaveValue(/Last applied: 0%/);
  expect(server.errors).toEqual([]);
});

test("mobile UI and expanded raw controls fit the viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const server = await backend(page);
  await page.getByRole("button", { name: /Raw UI/ }).click();
  await expect(page.getByLabel("WMI method name")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath("mobile-ui.png") });
  expect(server.errors).toEqual([]);
});

test("raw diagnostics preserve large results and cannot bypass managed fan state", async ({
  page,
}) => {
  const server = await backend(page);
  await page.getByRole("button", { name: /Raw UI/ }).click();
  await page.getByLabel("WMI method name").selectOption("GetDeepFan");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => server.requests.length).toBe(1);
  server.send({
    kind: "success",
    requestId: server.requests[0]?.requestId,
    data: "1208925819614629174706175",
  });
  await expect(page.getByLabel("WMI command output")).toHaveValue(
    /1208925819614629174706175 \(0xffffffffffffffffffff\)/,
  );
  await page.getByRole("radio", { name: "Set", exact: true }).check();
  await page.getByLabel("WMI method name").selectOption("SetFixedFanSpeed");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("This fan setting is managed by the backend.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(server.requests).toHaveLength(1);
  expect(server.errors).toEqual([]);
});

test("stale telemetry is marked until fresh data arrives and restart guidance persists", async ({
  page,
}) => {
  await page.clock.install();
  const server = await backend(page);
  const activity = {
    appliedSpeed: 25,
    avgCPUTemp: 52,
    avgGPUTemp: 43,
    target: 30,
    sensorFailure: false,
  };
  server.send({ kind: "fancontrolactivity", data: activity });
  await expect(
    page.getByLabel("Fan control status", { exact: true }),
  ).toHaveValue(/CPU: 52°C/);
  await page.clock.fastForward(10001);
  await expect(
    page.getByText(
      "Telemetry is stale. The backend has not sent readings for 10 seconds.",
    ),
  ).toBeVisible();
  await expect(
    page.getByLabel("Fan control status", { exact: true }),
  ).toHaveValue(/^Telemetry is stale/);
  server.send({
    kind: "fancontrolactivity",
    data: { ...activity, avgCPUTemp: 53 },
  });
  await expect(
    page.getByLabel("Fan control status", { exact: true }),
  ).toHaveValue(/^CPU: 53°C/);
  server.push({ restartRequired: true, isCpuTuningAvailable: false });
  await expect(
    page.getByText(
      "A native service stopped responding. Restart ALFC to restore unavailable features.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Switch to fixed mode" }),
  ).toBeEnabled();
  expect(server.errors).toEqual([]);
});
