import { useEffect, useState } from "react";
import packageJson from "../../../package.json";
import { startReleaseUpdateChecks } from "./releaseUpdateCheck";

export function useVersionCheck() {
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);

  useEffect(
    () => startReleaseUpdateChecks(packageJson.version, setNewVersionAvailable),
    [],
  );

  return newVersionAvailable;
}
