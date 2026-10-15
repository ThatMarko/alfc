import { isNewerReleaseVersion } from "./releaseVersion";

const GITHUB_API_URL =
  "https://api.github.com/repos/ThatMarko/alfc/releases/latest";
const CHECK_INTERVAL = 1000 * 60 * 60 * 12; // 12 hours
const REQUEST_TIMEOUT = 10_000;

export function startReleaseUpdateChecks(
  currentVersion: string,
  onResult: (newVersionAvailable: boolean) => void,
) {
  let stopped = false;
  let controller: AbortController | undefined;
  let requestTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  const checkVersion = async () => {
    const request = new AbortController();
    controller = request;
    requestTimer = setTimeout(() => request.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(GITHUB_API_URL, { signal: request.signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `GitHub release check failed (HTTP ${response.status})`,
        );
      }
      const data: unknown = await response.json();

      if (
        !stopped &&
        !request.signal.aborted &&
        typeof data === "object" &&
        data !== null &&
        "tag_name" in data &&
        typeof data.tag_name === "string"
      ) {
        onResult(isNewerReleaseVersion(data.tag_name, currentVersion));
      }
    } catch (error) {
      if (!stopped && !request.signal.aborted)
        console.error("Failed to check for updates:", error);
    } finally {
      clearTimeout(requestTimer);
      requestTimer = undefined;
      controller = undefined;
      // Wait for this request, including its body, before starting the next one.
      if (!stopped) pollTimer = setTimeout(checkVersion, CHECK_INTERVAL);
    }
  };

  void checkVersion();

  return () => {
    stopped = true;
    clearTimeout(pollTimer);
    clearTimeout(requestTimer);
    controller?.abort();
  };
}
