import { rm } from "node:fs/promises";

// Only remove this workspace's compiler caches, never dependency files.
await Promise.all(
  ["", "common/", "frontend/", "server/"].map((directory) =>
    rm(new URL(`${directory}tsconfig.tsbuildinfo`, import.meta.url), {
      force: true,
    }),
  ),
);
