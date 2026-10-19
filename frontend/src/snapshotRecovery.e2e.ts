import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import type { MessageToServer, State } from "../../common/types";

const state: State = {
  protocolVersion: "1.1",
  cpuFanTable: [[40, 15]],
  gpuFanTable: [[40, 15]],
  doFixedSpeed: false,
  fixedPercentage: 50,
  gpuBoost: true,
  pl1: 37,
  pl2: 106,
  isFanControlAvailable: true,
  isCpuTuningAvailable: true,
  isGpuBoostAvailable: true,
};

async function backend(page: Page, firstSnapshot = false) {
  const connections: WebSocketRoute[] = [];
  const closed = new Set<WebSocketRoute>();
  const requests: MessageToServer[] = [];
  const subscriptions: WebSocketRoute[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const startTime = new Date("2026-10-16T00:00:00Z");
  await page.clock.install({ time: startTime });
  await page.clock.pauseAt(new Date(startTime.getTime() + 1000));
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ status: 404, body: "{}" }),
  );
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.routeWebSocket(/\/ws$/, (socket) => {
    connections.push(socket);
    socket.onClose((code, reason) => {
      closed.add(socket);
      // Installing onClose takes ownership of the routed closing handshake.
      void socket.close({ code, reason });
    });
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as MessageToServer;
      if (message.kind === "registeractivitysocket") subscriptions.push(socket);
      else requests.push(message);
    });
    if (firstSnapshot && connections.length === 1)
      socket.send(JSON.stringify({ kind: "state", data: state }));
  });
  const send = (message: object) => {
    const socket = connections.at(-1);
    if (!socket) throw new Error("WebSocket not connected");
    socket.send(JSON.stringify(message));
  };
  await page.goto("/");
  await expect.poll(() => subscriptions.length).toBe(1);
  return { connections, closed, requests, subscriptions, errors, send };
}

test("an opened connection without initial settings expires and recovers automatically", async ({
  page,
}) => {
  const server = await backend(page);
  await expect(
    page.getByRole("heading", { name: "Connecting to ALFC" }),
  ).toBeVisible();
  await page.clock.fastForward(9999);
  expect(server.closed.size).toBe(0);
  expect(server.requests).toEqual([]);
  await page.clock.fastForward(2);
  await expect.poll(() => server.closed.size).toBe(1);
  await page.clock.fastForward(1000);
  await expect.poll(() => server.connections.length).toBe(2);
  await expect.poll(() => server.subscriptions.length).toBe(2);
  await expect(
    page.getByRole("heading", { name: "Connecting to ALFC" }),
  ).toBeVisible();
  expect(server.requests).toEqual([]);

  server.send({ kind: "state", data: state });
  const mode = page.getByRole("button", { name: "Switch to fixed mode" });
  await expect(mode).toBeEnabled();
  // A validated snapshot cancels the deadline for this socket.
  await page.clock.fastForward(20000);
  expect(server.connections).toHaveLength(2);
  await mode.click();
  await expect.poll(() => server.requests.length).toBe(1);
  server.send({ kind: "success", requestId: server.requests[0]?.requestId });
  await expect(mode).toBeEnabled();
  expect(server.errors).toEqual([]);
});

test("a silent reconnect preserves confirmed settings and drafts without replaying a write", async ({
  page,
}) => {
  const server = await backend(page, true);
  const fixed = page.getByLabel("Fixed fan speed percentage");
  await expect(fixed).toBeEnabled();
  await fixed.fill("63");
  const mode = page.getByRole("button", { name: "Switch to fixed mode" });
  await mode.click();
  await expect.poll(() => server.requests.length).toBe(1);
  await server.connections[0]?.close({ code: 1012, reason: "Service restart" });
  await expect(fixed).toBeDisabled();
  await expect(fixed).toHaveValue("63");
  await page.clock.fastForward(1000);
  await expect.poll(() => server.connections.length).toBe(2);
  await expect.poll(() => server.subscriptions.length).toBe(2);
  await expect(fixed).toBeDisabled();
  await expect(fixed).toHaveValue("63");
  expect(server.requests).toHaveLength(1);

  // Malformed state must preserve the diagnostic and cannot extend the
  // initial-snapshot deadline or authorize writes.
  await page.clock.fastForward(9000);
  server.send({ kind: "state", data: { protocolVersion: "2.0" } });
  await expect(
    page.getByText("incompatible or invalid state", { exact: false }),
  ).toBeVisible();
  await expect(fixed).toBeDisabled();
  await page.clock.fastForward(1001);
  await expect
    .poll(() => {
      const silentSocket = server.connections[1];
      return silentSocket !== undefined && server.closed.has(silentSocket);
    })
    .toBe(true);
  await expect(
    page.getByText("incompatible or invalid state", { exact: false }),
  ).toBeVisible();
  await page.clock.fastForward(1000);
  await expect.poll(() => server.connections.length).toBe(3);
  await expect(fixed).toBeDisabled();
  await expect(fixed).toHaveValue("63");
  server.send({ kind: "success", requestId: server.requests[0]?.requestId });
  await expect(fixed).toBeDisabled();
  server.send({ kind: "state", data: state });
  await expect(fixed).toBeEnabled();
  await expect(fixed).toHaveValue("63");
  expect(server.requests).toHaveLength(1);
  expect(server.subscriptions).toEqual(server.connections);
  expect(server.errors).toEqual([]);
});
