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

async function trackBackendSockets(page: Page) {
  await page.addInitScript(() => {
    const sockets: WebSocket[] = [];
    Object.defineProperty(window, "testBackendSockets", { value: sockets });
    const track = (BrowserWebSocket: typeof WebSocket) =>
      class extends BrowserWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (new URL(url).pathname === "/ws") sockets.push(this);
        }
      };
    // Playwright installs its routed WebSocket constructor through a separate
    // init script; support either initialization order and exclude Vite HMR.
    let browserWebSocket = track(window.WebSocket);
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      get: () => browserWebSocket,
      set: (replacement: typeof WebSocket) => {
        browserWebSocket = track(replacement);
      },
    });
  });
}

async function backend(
  page: Page,
  overrides: Partial<State> = {},
  { stateOnReconnect = true } = {},
) {
  const requests: MessageToServer[] = [];
  const subscriptions: WebSocketRoute[] = [];
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
      if (message.kind === "registeractivitysocket") subscriptions.push(socket);
      else requests.push(message);
    });
    if (connections.length === 1 || stateOnReconnect)
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
  return { requests, subscriptions, connections, errors, send, push };
}

test("mode follows backend snapshots and only its own response settles a command", async ({
  page,
}) => {
  const server = await backend(page);
  const fixed = page.getByLabel("Fixed fan speed percentage");
  await expect(fixed).toBeEnabled();
  const mode = page.getByRole("button", { name: "Switch to fixed mode" });
  await mode.click();
  await expect.poll(() => server.requests.length).toBe(1);
  await expect(mode).toBeDisabled();
  server.send({ kind: "success", requestId: "other-client", data: true });
  server.send({
    kind: "error",
    requestId: server.requests[0]?.requestId,
    data: { message: "Malformed error must not settle the request" },
  });
  server.push({ pl1: 45 });
  await expect(mode).toBeDisabled();
  await expect(fixed).toBeDisabled();
  server.send({
    kind: "error",
    requestId: server.requests[0]?.requestId,
    data: "ACPI_ERROR: hardware refused the mode change",
  });
  await expect(mode).toBeEnabled();
  await expect(fixed).toBeEnabled();
  await mode.click();
  await expect.poll(() => server.requests.length).toBe(2);
  server.send({
    kind: "success",
    requestId: server.requests[1]?.requestId,
    data: true,
  });
  server.push({ doFixedSpeed: true });
  await expect(fixed).toBeEnabled();
  await expect(page.getByLabel("CPU temperature for row 1")).toBeEnabled();
  await expect(mode).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Edit fixed preset" }).click();
  await expect(page).toHaveURL(/#fixed-speed-preset$/);
  await expect(page.locator("#fixed-speed-preset")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(fixed).toBeFocused();
  server.push({ doFixedSpeed: false, gpuBoost: false });
  await expect(fixed).toBeEnabled();
  await expect(mode).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("link", { name: "Edit fan curves" }).click();
  await expect(page).toHaveURL(/#automatic-fan-curves$/);
  await expect(page.locator("#automatic-fan-curves")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("CPU temperature for row 1")).toBeFocused();
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

test("inactive fixed presets and fan curves can be saved without changing modes", async ({
  page,
}) => {
  const server = await backend(page);
  const fixed = page.getByLabel("Fixed fan speed percentage");
  await fixed.fill("65");
  await page
    .locator("form")
    .filter({ has: fixed })
    .getByRole("button", { name: "Apply" })
    .click();
  await expect.poll(() => server.requests.length).toBe(1);
  expect(server.requests[0]).toMatchObject({
    kind: "fixedpercentage",
    data: 65,
  });
  server.push({ fixedPercentage: 65 });
  server.send({ kind: "success", requestId: server.requests[0]?.requestId });
  await expect(
    page.getByRole("button", { name: "Switch to auto mode" }),
  ).toHaveAttribute("aria-pressed", "true");

  server.push({ doFixedSpeed: true });
  const temperature = page.getByLabel("CPU temperature for row 1");
  await temperature.fill("42");
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
        [42, 15],
        [83, 50],
        [88, 100],
      ],
    },
  });
  expect(
    server.requests.some((request) => request.kind === "dofixedspeed"),
  ).toBe(false);
  await expect(
    page.getByRole("button", { name: "Switch to fixed mode" }),
  ).toHaveAttribute("aria-pressed", "true");
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

test("disconnect preserves drafts and rejection guidance while requiring a fresh snapshot without replaying writes", async ({
  page,
}) => {
  const server = await backend(page, {}, { stateOnReconnect: false });
  const temperature = page.getByLabel("CPU temperature for row 1");
  const pl1 = page.getByLabel("PL1 power limit in watts");
  const mode = page.getByRole("button", { name: "Switch to fixed mode" });
  await temperature.fill("41.5");
  await pl1.fill("62");
  await page.getByRole("button", { name: "Switch to fixed mode" }).click();
  await expect.poll(() => server.requests.length).toBe(1);
  await page.clock.install();
  await server.connections[0]?.close({ code: 1012, reason: "Service restart" });
  await expect(mode).toBeDisabled();
  await expect(temperature).toHaveValue("41.5");
  await expect(pl1).toHaveValue("62");
  await expect(
    page.getByRole("alert").filter({
      hasText: "Connection lost before the server confirmed this request",
    }),
  ).toBeVisible();
  await page.clock.fastForward(1000);
  await expect.poll(() => server.connections.length).toBe(2);
  await expect(mode).toBeDisabled();
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeDisabled();
  server.send({ kind: "success", requestId: server.requests[0]?.requestId });
  await expect(mode).toBeDisabled();
  server.push({});
  await expect(mode).toBeEnabled();
  await expect(temperature).toHaveValue("41.5");
  await expect(pl1).toHaveValue("62");
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeEnabled();
  expect(server.requests).toHaveLength(1);
  expect(server.errors).toEqual([]);
});

test("a replacement connection requires its own snapshot and ignores retired socket events", async ({
  page,
}) => {
  await trackBackendSockets(page);
  const server = await backend(page, {}, { stateOnReconnect: false });
  await page.getByRole("button", { name: "Switch to fixed mode" }).click();
  await expect.poll(() => server.requests.length).toBe(1);
  await page.clock.install();
  await page.evaluate(() => {
    const socket = (window as Window & { testBackendSockets?: WebSocket[] })
      .testBackendSockets?.[0];
    if (!socket) throw new Error("Original socket missing");
    socket.dispatchEvent(new Event("error"));
  });
  await server.connections[0]?.close({ code: 1012, reason: "Service restart" });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { testBackendSockets?: WebSocket[] })
            .testBackendSockets?.[0]?.readyState,
      ),
    )
    .toBe(3);
  await page.clock.fastForward(1000);
  await expect.poll(() => server.connections.length).toBe(2);
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeDisabled();
  server.send({ kind: "success", requestId: server.requests[0]?.requestId });
  await expect(
    page.getByRole("button", { name: "Switch to fixed mode" }),
  ).toBeDisabled();
  server.push({});
  await expect(
    page.getByRole("button", { name: "Switch to fixed mode" }),
  ).toBeEnabled();
  await page.evaluate(() => {
    const socket = (window as Window & { testBackendSockets?: WebSocket[] })
      .testBackendSockets?.[0];
    if (!socket) throw new Error("Original socket missing");
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          kind: "state",
          data: { protocolVersion: "2.0" },
        }),
      }),
    );
    socket.dispatchEvent(new Event("error"));
    socket.dispatchEvent(new CloseEvent("close", { code: 1000 }));
  });
  await page.clock.fastForward(10001);
  await expect(
    page.getByRole("button", { name: "Switch to fixed mode" }),
  ).toBeEnabled();
  await expect(
    page.getByText("incompatible or invalid state", { exact: false }),
  ).toHaveCount(0);
  expect(server.connections).toHaveLength(2);
  expect(server.subscriptions).toEqual(server.connections);
  expect(server.requests).toHaveLength(1);
  expect(server.errors).toEqual([]);
});

test("transport backpressure rejects an unsent command immediately and allows a later retry", async ({
  page,
}) => {
  await trackBackendSockets(page);
  const server = await backend(page);
  await page.evaluate(() => {
    const socket = (
      window as Window & { testBackendSockets?: WebSocket[] }
    ).testBackendSockets?.at(-1);
    if (!socket) throw new Error("Backend socket missing");
    Object.defineProperty(socket, "bufferedAmount", {
      configurable: true,
      get: () => 64 * 1024,
    });
  });
  const mode = page.getByRole("button", { name: "Switch to fixed mode" });
  await mode.click();
  await expect(page.getByRole("alert")).toContainText("connection is busy");
  await expect(mode).toBeEnabled();
  expect(server.requests).toEqual([]);
  await page.evaluate(() => {
    const socket = (
      window as Window & { testBackendSockets?: WebSocket[] }
    ).testBackendSockets?.at(-1);
    if (!socket) throw new Error("Backend socket missing");
    Object.defineProperty(socket, "bufferedAmount", {
      configurable: true,
      get: () => 0,
    });
  });
  await mode.click();
  await expect.poll(() => server.requests.length).toBe(1);
  server.send({ kind: "success", requestId: server.requests[0]?.requestId });
  await expect(mode).toBeEnabled();
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
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "incompatible or invalid state" }),
  ).toBeVisible();
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeDisabled();
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
  ).toContainText("0°C");
  await expect(
    page.getByLabel("Fan control status", { exact: true }),
  ).toContainText("0%");
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
  await expect
    .poll(() =>
      page
        .locator("#root > div")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    )
    .toBeLessThanOrEqual(0);
  await page.getByRole("radio", { name: "Set", exact: true }).check();
  await page.getByLabel("WMI method name").selectOption("SetLightBar");
  await expect
    .poll(() =>
      page
        .locator("#root > div")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    )
    .toBeLessThanOrEqual(0);
  await page.addStyleTag({
    content: "#root > div::-webkit-scrollbar { width: 16px; height: 16px; }",
  });
  await expect
    .poll(() =>
      page
        .locator("#root > div")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    )
    .toBeLessThanOrEqual(0);
  await page.locator("#root > div").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("mobile-ui.png") });
  await page.getByLabel("WMI method name").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("mobile-raw-ui.png") });
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
  ).toContainText("52°C");
  await page.clock.fastForward(10001);
  await expect(
    page.getByText(
      "Telemetry is stale. The backend has not sent readings for 10 seconds.",
    ),
  ).toBeVisible();
  await expect(
    page.getByLabel("Fan control status", { exact: true }),
  ).toContainText("Telemetry is stale");
  server.send({
    kind: "fancontrolactivity",
    data: { ...activity, avgCPUTemp: 53 },
  });
  await expect(
    page.getByLabel("Fan control status", { exact: true }),
  ).toContainText("53°C");
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

test("a missing initial activity stream expires despite settings broadcasts and resets on reconnect", async ({
  page,
}) => {
  await page.clock.install();
  const server = await backend(page);
  const status = page.getByLabel("Fan control status", { exact: true });
  await expect(status).toContainText("Waiting for readings");
  await page.clock.fastForward(9000);
  server.push({ pl1: 45 });
  await expect(page.getByLabel("PL1 power limit in watts")).toHaveValue("45");
  await page.clock.fastForward(1001);
  await expect(status).toContainText("Telemetry is stale");

  server.send({
    kind: "fancontrolactivity",
    data: {
      appliedSpeed: null,
      avgCPUTemp: 52,
      avgGPUTemp: 43,
      target: 30,
      sensorFailure: false,
    },
  });
  await expect(status).toContainText("Unconfirmed");
  await expect(status).not.toContainText("Telemetry is stale");
  await server.connections[0]?.close({ code: 1012, reason: "Service restart" });
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeDisabled();
  await page.clock.fastForward(1000);
  await expect.poll(() => server.connections.length).toBe(2);
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeEnabled();
  await expect(status).toContainText("Waiting for readings");
  await expect(status).not.toContainText("Unconfirmed");
  await expect(status).not.toContainText("Telemetry is stale");

  server.push({ isFanControlAvailable: false });
  await expect(status).toContainText("Unavailable");
  await expect(status).not.toContainText("Telemetry is stale");
  await page.clock.fastForward(20000);
  server.push({ pl1: 47 });
  await expect(status).not.toContainText("Telemetry is stale");
  server.push({ isFanControlAvailable: true });
  await expect(status).toContainText("Waiting for readings");
  await expect(status).not.toContainText("Telemetry is stale");
  await page.clock.fastForward(9000);
  server.push({ pl1: 48 });
  server.connections.at(-1)?.send("pong");
  await expect(page.getByLabel("PL1 power limit in watts")).toHaveValue("48");
  await expect(status).not.toContainText("Telemetry is stale");
  server.send({
    kind: "state",
    data: { ...initialState, protocolVersion: "2.0" },
  });
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeDisabled();
  server.push({ pl1: 49 });
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeEnabled();
  await page.clock.fastForward(1001);
  await expect(status).toContainText("Telemetry is stale");
  expect(server.errors).toEqual([]);
});

test("updates to another field in a form preserve independent drafts", async ({
  page,
}) => {
  const server = await backend(page);
  const pl1 = page.getByLabel("PL1 power limit in watts");
  const cpuTemperature = page.getByLabel("CPU temperature for row 1");
  await pl1.fill("62");
  await cpuTemperature.fill("41.5");
  server.push({
    pl2: 120,
    gpuFanTable: [
      [45, 20],
      [80, 100],
    ],
  });
  await expect(pl1).toHaveValue("62");
  await expect(page.getByLabel("PL2 power limit in watts")).toHaveValue("120");
  await expect(cpuTemperature).toHaveValue("41.5");
  await expect(page.getByLabel("GPU temperature for row 1")).toHaveValue("45");
  expect(server.requests).toEqual([]);
  expect(server.errors).toEqual([]);
});

test("fan row controls cannot insert duplicate floating-point temperatures", async ({
  page,
}) => {
  const server = await backend(page, {
    cpuFanTable: [
      [0, 15],
      [Number.MIN_VALUE, 50],
    ],
  });
  await expect(
    page.getByRole("button", { name: "Add CPU row before row 2", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Append CPU fan curve row", exact: true })
    .click();
  await expect(page.getByLabel("CPU temperature for row 3")).toHaveValue("1");
  await page
    .getByRole("button", { name: "Add CPU row before row 3", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Add CPU row before row 4", exact: true }),
  ).toBeFocused();
  const originalRow = page.getByLabel("CPU temperature for row 4");
  await expect(originalRow).toHaveValue("1");
  await originalRow.fill("2");
  await expect(originalRow).toBeFocused();
  await expect(originalRow).toHaveValue("2");
  expect(server.requests).toEqual([]);
  expect(server.errors).toEqual([]);
});

test("removing a fan curve row keeps keyboard focus in the remaining curve", async ({
  page,
}) => {
  const server = await backend(page);
  const gpuTemperature = page.getByLabel("GPU temperature for row 1");
  await gpuTemperature.fill("42.5");
  await page
    .getByRole("button", { name: "Remove CPU row 2", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const nextTemperature = page.getByLabel("CPU temperature for row 2");
  await expect(nextTemperature).toHaveValue("88");
  await expect(nextTemperature).toBeFocused();
  await nextTemperature.fill("89");
  await page
    .getByRole("button", { name: "Remove CPU row 2", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("CPU temperature for row 1")).toBeFocused();
  await expect(page.getByLabel("CPU temperature for row 2")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Remove CPU row 1", exact: true }),
  ).toBeDisabled();
  await expect(gpuTemperature).toHaveValue("42.5");
  expect(server.requests).toEqual([]);
  expect(server.errors).toEqual([]);
});

test("a server without request correlation is rejected before writes are enabled", async ({
  page,
}) => {
  const server = await backend(page);
  server.push({ protocolVersion: "1.0" });
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "incompatible or invalid state" }),
  ).toBeVisible();
  await expect(page.getByLabel("Fixed fan speed percentage")).toBeDisabled();
  server.push({ protocolVersion: "1.1" });
  await expect(
    page.getByRole("button", { name: "Switch to fixed mode", exact: true }),
  ).toBeEnabled();
  expect(server.requests).toEqual([]);
  expect(server.errors).toEqual([]);
});

test("information tooltips are keyboard accessible, associated and dismissible", async ({
  page,
}) => {
  const server = await backend(page);
  const trigger = page.getByRole("button", {
    name: "About fan control status",
    exact: true,
  });
  await trigger.focus();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Both fans use the same target speed");
  await expect(trigger).toHaveAttribute(
    "aria-describedby",
    (await tooltip.getAttribute("id")) ?? "",
  );
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  expect(server.errors).toEqual([]);
});

test("unknown GPU capability cannot advertise or enable GPU boost writes", async ({
  page,
}) => {
  const server = await backend(page, { isGpuBoostAvailable: undefined });
  await expect(page.getByRole("checkbox", { name: "GPU Boost" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Toggle Raw UI", exact: true })
    .click();
  await page.getByRole("radio", { name: "Set", exact: true }).check();
  await page.getByLabel("WMI method name").selectOption("SetAIBoostStatus");
  await page.getByLabel("Argument Data", { exact: true }).fill("1");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("GPU boost is not available on this system.", {
      exact: true,
    }),
  ).toBeVisible();
  server.push({ isGpuBoostAvailable: true });
  await expect(page.getByRole("checkbox", { name: "GPU Boost" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Argument Data", { exact: true }).fill("2");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Argument Data", { exact: true }),
  ).toHaveAttribute("max", "1");
  expect(server.requests).toEqual([]);
  expect(server.errors).toEqual([]);
});
