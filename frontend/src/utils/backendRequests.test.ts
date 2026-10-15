import { BackendRequests } from "./backendRequests";
import {
  MessageToClientKind,
  MessageToServerKind,
  type MessageToServer,
} from "../../../common/types";

describe("backend request lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("settles every concurrent response even when replies arrive in one render interval", async () => {
    const requests = new BackendRequests();
    const sent: MessageToServer[] = [];
    const first = requests.send({ kind: MessageToServerKind.Tune }, (message) =>
      sent.push(message),
    );
    const second = requests.send(
      { kind: MessageToServerKind.Tune },
      (message) => sent.push(message),
    );
    expect(sent[0]?.requestId).not.toEqual(sent[1]?.requestId);
    requests.receive({
      kind: MessageToClientKind.Success,
      requestId: sent[1]?.requestId,
      data: 2,
    });
    requests.receive({
      kind: MessageToClientKind.Success,
      requestId: sent[0]?.requestId,
      data: 1,
    });
    await expect(first).resolves.toMatchObject({ data: 1 });
    await expect(second).resolves.toMatchObject({ data: 2 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores unrelated and duplicate responses", async () => {
    const requests = new BackendRequests();
    let requestId: string | undefined;
    const promise = requests.send(
      { kind: MessageToServerKind.Set },
      (message) => {
        requestId = message.requestId;
      },
    );
    expect(
      requests.receive({
        kind: MessageToClientKind.Success,
        requestId: "someone-else",
      }),
    ).toBe(false);
    expect(requests.receive({ kind: MessageToClientKind.Success })).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    expect(
      requests.receive({ kind: MessageToClientKind.Success, requestId }),
    ).toBe(true);
    expect(
      requests.receive({ kind: MessageToClientKind.Success, requestId }),
    ).toBe(false);
    await expect(promise).resolves.toMatchObject({ kind: "success" });
  });

  it("preserves the exact backend error and leaves other requests pending", async () => {
    const requests = new BackendRequests();
    const sent: MessageToServer[] = [];
    const first = requests.send({ kind: MessageToServerKind.Set }, (message) =>
      sent.push(message),
    );
    const second = requests.send({ kind: MessageToServerKind.Set }, (message) =>
      sent.push(message),
    );
    const firstRejection = expect(first).rejects.toThrow(
      "UNSUPPORTED_FEATURE: GPU boost",
    );
    requests.receive({
      kind: MessageToClientKind.Error,
      requestId: sent[0]?.requestId,
      data: "UNSUPPORTED_FEATURE: GPU boost",
    });
    await firstRejection;
    expect(vi.getTimerCount()).toBe(1);
    const secondRejection = expect(second).rejects.toThrow("Connection lost");
    requests.disconnect();
    await secondRejection;
  });

  it("rejects and removes all pending requests on disconnect, without replay", async () => {
    const requests = new BackendRequests();
    const send = vi.fn();
    const first = requests.send(
      { kind: MessageToServerKind.DoFixedSpeed, data: true },
      send,
    );
    const second = requests.send(
      { kind: MessageToServerKind.FixedPercentage, data: 50 },
      send,
    );
    const assertions = [
      expect(first).rejects.toThrow("Connection lost"),
      expect(second).rejects.toThrow("Connection lost"),
    ];
    requests.disconnect();
    await Promise.all(assertions);
    expect(vi.getTimerCount()).toBe(0);
    requests.disconnect();
    expect(send).toHaveBeenCalledTimes(2);
    const original = send.mock.calls[0]?.[0] as MessageToServer;
    expect(
      requests.receive({
        kind: MessageToClientKind.Success,
        requestId: original.requestId,
      }),
    ).toBe(false);
  });

  it("times out an unconfirmed command and ignores its late response", async () => {
    const requests = new BackendRequests(1000);
    let requestId: string | undefined;
    const promise = requests.send(
      { kind: MessageToServerKind.Tune },
      (message) => {
        requestId = message.requestId;
      },
    );
    const assertion = expect(promise).rejects.toThrow(
      "Check the current state",
    );
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(
      requests.receive({ kind: MessageToClientKind.Success, requestId }),
    ).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up immediately if sending throws", async () => {
    const requests = new BackendRequests();
    await expect(
      requests.send({ kind: MessageToServerKind.Tune }, () => {
        throw new Error("Socket closed");
      }),
    ).rejects.toThrow("Socket closed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not settle a request from malformed wire responses", async () => {
    const requests = new BackendRequests();
    let requestId: string | undefined;
    const promise = requests.send(
      { kind: MessageToServerKind.Tune },
      (sent) => {
        requestId = sent.requestId;
      },
    );
    for (const message of [
      null,
      [],
      { kind: "success", requestId: 1 },
      { kind: "error", requestId, data: { message: "invalid error" } },
      { kind: "success", requestId, methodName: 3 },
      { kind: "state", requestId, data: {} },
    ]) {
      expect(requests.receive(message)).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
    }
    expect(
      requests.receive({ kind: "success", requestId, data: "confirmed" }),
    ).toBe(true);
    await expect(promise).resolves.toMatchObject({ data: "confirmed" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds pending requests and releases capacity after confirmation", async () => {
    const requests = new BackendRequests();
    const sent: MessageToServer[] = [];
    const promises = Array.from({ length: 64 }, () =>
      requests.send({ kind: MessageToServerKind.Tune }, (message) => {
        sent.push(message);
      }),
    );
    const send = vi.fn();
    await expect(
      requests.send({ kind: MessageToServerKind.Tune }, send),
    ).rejects.toThrow("Too many requests");
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(64);
    requests.receive({ kind: "success", requestId: sent[0]?.requestId });
    await expect(promises[0]).resolves.toMatchObject({ kind: "success" });
    const next = requests.send({ kind: MessageToServerKind.Tune }, send);
    expect(send).toHaveBeenCalledOnce();
    const assertions = [...promises.slice(1), next].map((promise) =>
      expect(promise).rejects.toThrow("Connection lost"),
    );
    requests.disconnect();
    await Promise.all(assertions);
    expect(vi.getTimerCount()).toBe(0);
  });
});
