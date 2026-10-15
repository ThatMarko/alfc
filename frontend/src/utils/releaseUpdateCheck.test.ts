import { startReleaseUpdateChecks } from "./releaseUpdateCheck";

const CHECK_INTERVAL = 12 * 60 * 60 * 1000;

describe("release update checks", () => {
  let stop: (() => void) | undefined;
  const fetchMock = vi.fn<typeof fetch>();
  const onResult = vi.fn<(available: boolean) => void>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockReset();
    onResult.mockReset();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["v2.0.1", true],
    ["v2.0.0", false],
    ["v1.9.9", false],
  ])(
    "reports release %s relative to the installed version",
    async (tag, newer) => {
      fetchMock.mockResolvedValue(Response.json({ tag_name: tag }));
      stop = startReleaseUpdateChecks("2.0.0", onResult);
      await vi.advanceTimersByTimeAsync(0);
      expect(onResult).toHaveBeenCalledExactlyOnceWith(newer);
      stop();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("aborts a stalled request and retries later with a fresh signal", async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    stop = startReleaseUpdateChecks("2.0.0", onResult);
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(firstSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(firstSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const nextSignal = fetchMock.mock.calls[1]?.[1]?.signal;
    expect(nextSignal).not.toBe(firstSignal);
    expect(nextSignal?.aborted).toBe(false);
  });

  it("keeps the deadline through body parsing and ignores a late timed-out result", async () => {
    const body = Promise.withResolvers<unknown>();
    const response = Response.json({});
    vi.spyOn(response, "json").mockReturnValue(body.promise);
    fetchMock.mockResolvedValue(response);
    stop = startReleaseUpdateChecks("2.0.0", onResult);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    // Even a delayed body that ignores cancellation cannot overlap another poll.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    body.resolve({ tag_name: "v99.0.0" });
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("cancels an HTTP error body before parsing and retains the last result", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ tag_name: "v2.0.1" }));
    const failure = new Response("Service unavailable", { status: 503 });
    const cancel = vi.spyOn(failure.body!, "cancel");
    const json = vi.spyOn(failure, "json");
    fetchMock.mockResolvedValueOnce(failure);
    stop = startReleaseUpdateChecks("2.0.0", onResult);
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledExactlyOnceWith(true);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL);
    expect(cancel).toHaveBeenCalledOnce();
    expect(json).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to check for updates:",
      expect.objectContaining({ message: expect.stringContaining("HTTP 503") }),
    );
  });

  it("cleans up a pending request without reporting an expected abort", async () => {
    const pending = Promise.withResolvers<Response>();
    fetchMock.mockReturnValue(pending.promise);
    stop = startReleaseUpdateChecks("2.0.0", onResult);
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    stop();
    expect(signal?.aborted).toBe(true);
    pending.reject(new DOMException("Aborted", "AbortError"));
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL * 2);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("ignores an old body after cleanup while a replacement check succeeds", async () => {
    const oldBody = Promise.withResolvers<unknown>();
    const oldResponse = Response.json({});
    vi.spyOn(oldResponse, "json").mockReturnValue(oldBody.promise);
    fetchMock
      .mockResolvedValueOnce(oldResponse)
      .mockResolvedValueOnce(Response.json({ tag_name: "v2.0.0" }));
    const stopOld = startReleaseUpdateChecks("2.0.0", onResult);
    await vi.advanceTimersByTimeAsync(0);
    stopOld();
    stop = startReleaseUpdateChecks("2.0.0", onResult);
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledExactlyOnceWith(false);
    oldBody.resolve({ tag_name: "v99.0.0" });
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledTimes(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, {}, { tag_name: 3 }])(
    "ignores an invalid successful payload: %j",
    async (payload) => {
      fetchMock.mockResolvedValue(Response.json(payload));
      stop = startReleaseUpdateChecks("2.0.0", onResult);
      await vi.advanceTimersByTimeAsync(0);
      expect(onResult).not.toHaveBeenCalled();
    },
  );

  it("reports malformed JSON and still schedules a later check", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("invalid JSON"))
      .mockResolvedValueOnce(Response.json({ tag_name: "v2.0.1" }));
    stop = startReleaseUpdateChecks("2.0.0", onResult);
    await vi.advanceTimersByTimeAsync(0);
    expect(console.error).toHaveBeenCalledOnce();
    expect(onResult).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL);
    expect(onResult).toHaveBeenCalledExactlyOnceWith(true);
  });
});
