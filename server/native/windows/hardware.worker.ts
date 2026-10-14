import * as acpi from "./acpi";
import * as cpuoc from "./cpuoc";
import type {
  HardwareOperation,
  HardwareRequest,
  HardwareResponse,
} from "./hardware-protocol";

declare const self: Worker;

// COM initialization, calls and teardown must remain on the same thread.
// The parent watchdog cannot cancel a native call; it permanently disables
// this worker after a timeout instead of unloading a DLL while it is active.
async function execute(operation: HardwareOperation) {
  switch (operation.kind) {
    case "wmiInit":
      await acpi.wmiInit();
      return;
    case "tuneInit":
      await cpuoc.tuneInit();
      return;
    case "get":
      return acpi.getCall(
        operation.methodId,
        operation.methodName,
        operation.args,
      );
    case "set":
      await acpi.setCall(
        operation.methodId,
        operation.methodName,
        operation.args,
      );
      return;
    case "tune":
      await cpuoc.tune(operation.pl1, operation.pl2);
      return;
    case "cleanupWmi":
      acpi.wmiCleanup();
      return;
    case "cleanupCpu":
      cpuoc.cpuocCleanup();
      return;
  }
}

let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<HardwareRequest>) => {
  const { id, operation } = event.data;
  queue = queue.then(async () => {
    let response: HardwareResponse;
    try {
      response = { id, ok: true, result: await execute(operation) };
    } catch (error) {
      response = {
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        restartRequired:
          error instanceof Error &&
          "restartRequired" in error &&
          error.restartRequired === true,
      };
    }
    self.postMessage(response);
  });
};
