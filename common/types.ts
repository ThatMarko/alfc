export type FanTable = [number, number][];

export type State = {
  readonly protocolVersion: string;
  cpuFanTable: FanTable;
  gpuFanTable: FanTable;

  doFixedSpeed: boolean;
  fixedPercentage: number;

  gpuBoost: boolean;
  pl1: number;
  pl2: number;

  isCpuTuningAvailable?: boolean;
  isGpuBoostAvailable?: boolean;
  isFanControlAvailable?: boolean;
  // A native channel failed permanently; unaffected features remain usable.
  restartRequired?: boolean;
};

export type Args = {
  [key: string]: number;
};

// Packed firmware responses can exceed JavaScript's exact integer range.
// Keep ordinary sensor values numeric and larger responses lossless in JSON.
export type NativeResult = number | string;

export enum MessageToClientKind {
  FanControlActivity = "fancontrolactivity",
  State = "state",
  Success = "success",
  Error = "error",
}

export enum MessageToServerKind {
  Get = "get",
  Set = "set",
  Tune = "tune",
  FanTable = "fantable",
  FixedPercentage = "fixedpercentage",
  DoFixedSpeed = "dofixedspeed",
  RegisterActivitySocket = "registeractivitysocket",
}

export type FanControlActivity = {
  appliedSpeed: number | null;
  avgCPUTemp: number;
  avgGPUTemp: number;
  target: number;
  // True when the last collection failed: the temperatures are the last
  // successfully collected averages and fans were commanded to the highest
  // configured speed. Absent from 1.0 servers — treat undefined as false.
  sensorFailure?: boolean;
};

export type MessageToClient = Pick<
  MessageToServer,
  "methodName" | "methodId" | "requestId"
> &
  (
    | {
        kind: MessageToClientKind.State;
        data: State;
      }
    | {
        kind: MessageToClientKind.Success;
        data?: unknown;
      }
    | {
        kind: MessageToClientKind.Error;
        data: string;
      }
    | {
        kind: MessageToClientKind.FanControlActivity;
        data: FanControlActivity;
      }
  );

export type MessageToServer = {
  kind: MessageToServerKind;
  methodId?: string;
  methodName?: string;
  requestId?: string;
  data?: unknown;
};
