global.Bun = {
  env: process.env,
  file: () => ({
    exists: () => Promise.resolve(true),
    text: () => Promise.resolve(""),
    json: () => Promise.resolve({}),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    stream: () => new ReadableStream(),
    writer: () => ({
      write: () => Promise.resolve(0),
      end: () => Promise.resolve(),
      flush: () => Promise.resolve(),
      ref: () => {},
      unref: () => {},
    }),
  }),
  write: () => Promise.resolve(0),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  spawnSync: () => ({
    exitCode: 0,
    stdout: Buffer.from(""),
    stderr: Buffer.from(""),
  }),
  serve: () => ({ stop: () => {}, publish: () => 0 }),
} as any;
