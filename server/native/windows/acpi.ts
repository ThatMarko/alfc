import path from "node:path";
import type { Args } from "../../../common/types";
import { isDev } from "../../utils/consts";

const baseDir = isDev ? import.meta.dirname : path.dirname(process.execPath);
const exePath = path.join(baseDir, "WmiAPI.exe");

interface WmiResponse {
  ok: boolean;
  data?: number[];
  error?: string;
}

let sendCommand: ((cmd: object) => Promise<WmiResponse>) | null = null;

export async function wmiInit() {
  if (!(await Bun.file(exePath).exists())) {
    throw new Error(`WmiAPI.exe not found at ${exePath}`);
  }

  const proc = Bun.spawn([exePath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });

  const stdoutReader = proc.stdout.getReader();
  const textDecoder = new TextDecoder();
  let readBuffer = "";

  async function readLine(): Promise<string> {
    for (;;) {
      const idx = readBuffer.indexOf("\n");
      if (idx !== -1) {
        const line = readBuffer.slice(0, idx).replace(/\r$/, "");
        readBuffer = readBuffer.slice(idx + 1);
        return line;
      }
      const { value, done } = await stdoutReader.read();
      if (done) throw new Error("WMI helper process exited unexpectedly");
      readBuffer += textDecoder.decode(value, { stream: true });
    }
  }

  sendCommand = async (cmd: object): Promise<WmiResponse> => {
    proc.stdin.write(JSON.stringify(cmd) + "\n");
    proc.stdin.flush();
    const line = await readLine();
    return JSON.parse(line) as WmiResponse;
  };

  let attempt = 0;
  while (attempt < 3) {
    try {
      const response = await sendCommand({ cmd: "init" });
      if (!response.ok) {
        throw new Error(`WMI init failed: ${response.error}`);
      }
      return;
    } catch (e) {
      attempt++;
      if (attempt >= 3) {
        console.error(`WMI init attempt ${attempt} failed. No more retries.`);
        throw e;
      }
      console.log(`WMI init attempt ${attempt} failed. Retrying in 2s...`);
      await Bun.sleep(2000);
    }
  }
}

export function setCall(_: string, methodName: string, args: Args) {
  if (!sendCommand) return Promise.reject(new Error("WMI not initialized"));
  return sendCommand({ cmd: "set", method: methodName, args }).then(
    (response) => {
      if (!response.ok) {
        throw new Error(`WMI set '${methodName}' failed: ${response.error}`);
      }
    },
  );
}

// uint16 values are already little-endian, just need to split them up
function splitWords(numbers: number[]) {
  for (let i = 0; i < numbers.length; i++) {
    const current = numbers[i] ?? 0;
    if (current > 255) {
      numbers[i] = current >> 8;
      numbers.splice(i + 1, 0, current & 0xff);
    }
  }
}

export function getCall(_: string, methodName: string, args?: Args) {
  if (!sendCommand) return Promise.reject(new Error("WMI not initialized"));
  return sendCommand({
    cmd: "get",
    method: methodName,
    ...(args ? { args } : {}),
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`WMI get '${methodName}' failed: ${response.error}`);
    }

    const result: number[] = (response.data ?? []).reverse();
    splitWords(result);

    let value = 0;
    for (const byte of result) {
      value = value * 256 + byte;
    }
    return value;
  });
}

if (import.meta.main) {
  await wmiInit();
  console.log("RPM1", await getCall("doesntmatter", "getRpm1"));
}
