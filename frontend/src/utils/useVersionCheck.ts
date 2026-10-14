import { useEffect, useState } from "react";
import packageJson from "../../../package.json";
import { isNewerReleaseVersion } from "./releaseVersion";

const GITHUB_API_URL =
  "https://api.github.com/repos/ThatMarko/alfc/releases/latest";
const CHECK_INTERVAL = 1000 * 60 * 60 * 12; // 12 hours

export function useVersionCheck() {
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const checkVersion = async () => {
      try {
        const response = await fetch(GITHUB_API_URL, {
          signal: controller.signal,
        });
        const data = await response.json();

        if (
          response.ok &&
          typeof data?.tag_name === "string" &&
          !controller.signal.aborted
        ) {
          setNewVersionAvailable(
            isNewerReleaseVersion(data.tag_name, packageJson.version),
          );
        }
      } catch (error) {
        if (!controller.signal.aborted)
          console.error("Failed to check for updates:", error);
      }
    };

    checkVersion();
    const interval = setInterval(checkVersion, CHECK_INTERVAL);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  return newVersionAvailable;
}
