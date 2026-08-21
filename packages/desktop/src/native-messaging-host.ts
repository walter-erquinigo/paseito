import net from "node:net";
import os from "node:os";
import path from "node:path";

const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
const MR_NATIVE_SOCKET_FILENAME = "mr-native-bridge.sock";

function socketPath(): string {
  return (
    process.env.PASEITO_MR_NATIVE_SOCKET ??
    path.join(os.homedir(), "Library/Application Support/Paseito", MR_NATIVE_SOCKET_FILENAME)
  );
}

function writeNativeMessage(value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(header);
  process.stdout.write(body);
}

async function forward(value: unknown): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath());
    let buffer = "";
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      socket.end();
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("connect", () => socket.write(`${JSON.stringify(value)}\n`));
  });
}

let input = Buffer.alloc(0);
process.stdin.on("data", (chunk: Buffer) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const length = input.readUInt32LE(0);
    if (length > MAX_MESSAGE_BYTES) {
      writeNativeMessage({
        protocolVersion: 1,
        id: "",
        ok: false,
        error: "Native message is too large.",
      });
      process.exitCode = 1;
      return;
    }
    if (input.length < 4 + length) return;
    const body = input.subarray(4, 4 + length);
    input = input.subarray(4 + length);
    void forward(JSON.parse(body.toString("utf8")))
      .then(writeNativeMessage)
      .catch((error) =>
        writeNativeMessage({
          protocolVersion: 1,
          id: "",
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
  }
});
