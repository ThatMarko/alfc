import { mofGet } from "./mofGet";
import { mofSet } from "./mofSet";

export type MethodArgument = {
  description: string;
  name: string;
  type: string;
};

export type WmiMethods = {
  [name: string]: {
    methodId: string;
    methodName: string;
    description: string;
    inArgs: MethodArgument[];
    outArgs: MethodArgument[];
  };
};

function parseMof(mof: string) {
  const methods: WmiMethods = {};
  const rawMethods = mof.split("\n");
  for (const rawMethod of rawMethods) {
    // parse metadata and raw args string
    const match = rawMethod.match(
      /.+?\((?<methodId>.+?)\).+?Description\("(?<description>.+?)"\)] void (?<methodName>.+?)\((?<args>.+?)\);/,
    );
    if (match && match.groups) {
      const { methodId, description, methodName, args } = match.groups;
      if (!methodId || !description || !methodName || !args) continue;

      const inArgs: MethodArgument[] = [];
      const outArgs: MethodArgument[] = [];
      const rawArgs = args.substring(1).split(", [");
      for (const rawArg of rawArgs) {
        const argsMatch = rawArg.match(
          /(?<kind>in|out), Description\("(?<description>.+?)"\)] (?<type>.+?) (?<name>.+?)$/,
        );
        if (argsMatch && argsMatch.groups) {
          const { kind, description: argDesc, type, name } = argsMatch.groups;
          if (!kind || !argDesc || !type || !name) continue;
          const inOrOut = kind === "in" ? inArgs : outArgs;
          inOrOut.push({
            description: argDesc,
            type,
            name,
          });
        }
      }

      methods[methodName] = {
        methodId,
        methodName,
        description,
        inArgs,
        outArgs,
      };
    }
  }

  const result: WmiMethods = {};
  for (const key of Object.keys(methods).sort()) {
    const method = methods[key];
    if (method) result[key] = method;
  }
  return result;
}

export const getMethods = parseMof(mofGet);
export const setMethods = parseMof(mofSet);

// Managed fan mode/speed is authoritative across the web UI and Plasma.
// Raw diagnostics must not bypass that controller.
export const managedFanMethods = new Set([
  "SetGPUFanDuty",
  "SetSuperQuiet",
  "SetDeepFan",
  "SetCurrentFanStep",
  "SetStepFanStatus",
  "SetFanIndexValue",
  "SetFixedFanStatus",
  "SetFixedFanSpeed",
  "SetFanAdjustStatus",
  "SetAutoFanStatus",
  "TurnOffFan",
  "SetFanSpeed",
]);
