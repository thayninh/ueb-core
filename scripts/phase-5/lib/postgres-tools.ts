import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

import { SafePhase5DatabaseError } from "./database-guards";

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export async function runDockerToolToFile(
  shellCommand: string,
  outputPath: string,
): Promise<void> {
  const child = spawnDockerTool(shellCommand);
  child.stdin.end();
  child.stderr.resume();
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  try {
    await Promise.all([waitForSuccess(child), pipeline(child.stdout, output)]);
  } catch {
    child.kill();
    throw new SafePhase5DatabaseError("PostgreSQL backup tool failed safely.");
  }
}

export async function runDockerToolFromFile(input: {
  readonly shellCommand: string;
  readonly inputPath: string;
  readonly targetDatabase?: string;
  readonly captureOutput?: boolean;
}): Promise<Buffer> {
  const child = spawnDockerTool(input.shellCommand, input.targetDatabase);
  child.stderr.resume();
  const chunks: Buffer[] = [];
  let capturedBytes = 0;
  if (input.captureOutput) {
    child.stdout.on("data", (chunk: Buffer) => {
      capturedBytes += chunk.length;
      if (capturedBytes > MAX_CAPTURE_BYTES) {
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
  } else {
    child.stdout.resume();
  }
  try {
    await Promise.all([
      waitForSuccess(child),
      pipeline(createReadStream(input.inputPath), child.stdin),
    ]);
  } catch {
    child.kill();
    throw new SafePhase5DatabaseError("PostgreSQL restore tool failed safely.");
  }
  if (capturedBytes > MAX_CAPTURE_BYTES) {
    throw new SafePhase5DatabaseError("PostgreSQL tool output exceeded limit.");
  }
  return Buffer.concat(chunks);
}

function spawnDockerTool(shellCommand: string, targetDatabase?: string) {
  const environmentArguments = targetDatabase
    ? ["-e", `TARGET_DATABASE=${targetDatabase}`]
    : [];
  return spawn(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      ...environmentArguments,
      "db",
      "sh",
      "-c",
      shellCommand,
    ],
    { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
  );
}

function waitForSuccess(
  child: ReturnType<typeof spawnDockerTool>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("PostgreSQL tool exited unsuccessfully."));
    });
  });
}
