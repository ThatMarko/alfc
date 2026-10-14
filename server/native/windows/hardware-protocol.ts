import type { Args } from "../../../common/types";

export type HardwareOperation =
  | { kind: "wmiInit" }
  | { kind: "tuneInit" }
  | { kind: "get"; methodId: string; methodName: string; args?: Args }
  | { kind: "set"; methodId: string; methodName: string; args: Args }
  | { kind: "tune"; pl1: number; pl2: number }
  | { kind: "cleanupWmi" }
  | { kind: "cleanupCpu" };

export type HardwareRequest = { id: number; operation: HardwareOperation };

export type HardwareResponse =
  | { id: number; ok: true; result?: number | string }
  | { id: number; ok: false; error: string; restartRequired?: boolean };
