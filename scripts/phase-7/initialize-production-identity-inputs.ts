import { chmod, copyFile, mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { constants } from "node:fs";

import { prepareSourceFile } from "../phase-2/lib/row-parser";
import { loadSourceContract } from "../phase-2/lib/source-contract";
import {
  createFacultyLeaderTemplate,
  createLecturerExceptionTemplate,
  createSecretsTemplate,
  createTargetStateTemplate,
  createTestIdentityTemplate,
  inspectExpectedLecturerExceptions,
  PHASE7_SECURE_FILE_NAMES,
} from "./lib/production-operator-inputs";

interface InitializeCommand {
  readonly canonicalSource: string;
  readonly secureDirectory: string;
}

export async function initializeProductionIdentityInputs(
  command: InitializeCommand,
): Promise<string> {
  if (
    !isAbsolute(command.canonicalSource) ||
    !isAbsolute(command.secureDirectory)
  ) {
    throw new Error("PHASE7_SECURE_PATH_REQUIRED");
  }
  const [canonicalSource, contract, workspace] = await Promise.all([
    realpath(command.canonicalSource),
    loadSourceContract(),
    realpath(process.cwd()),
  ]);
  const secureDirectory = resolve(command.secureDirectory);
  if (
    secureDirectory === workspace ||
    secureDirectory.startsWith(`${workspace}${sep}`)
  ) {
    throw new Error("PHASE7_SECURE_PATH_REQUIRED");
  }
  const prepared = await prepareSourceFile(canonicalSource, contract);
  if (
    prepared.violations.length > 0 ||
    prepared.rows.length !== 2_497 ||
    prepared.sourceSha256 !== contract.source_sha256
  ) {
    throw new Error("CANONICAL_SOURCE_CONTRACT_BLOCKED");
  }
  const inventory = inspectExpectedLecturerExceptions(prepared);

  await mkdir(secureDirectory, { recursive: true, mode: 0o700 });
  await chmod(secureDirectory, 0o700);
  const canonicalDestination = join(
    secureDirectory,
    PHASE7_SECURE_FILE_NAMES.canonicalSource,
  );
  await copyFile(
    canonicalSource,
    canonicalDestination,
    constants.COPYFILE_EXCL,
  );
  await chmod(canonicalDestination, 0o600);
  await writeSecureFile(
    join(secureDirectory, PHASE7_SECURE_FILE_NAMES.lecturerExceptions),
    `${JSON.stringify(createLecturerExceptionTemplate(inventory), null, 2)}\n`,
  );
  await writeSecureFile(
    join(secureDirectory, PHASE7_SECURE_FILE_NAMES.facultyLeaders),
    `${JSON.stringify(createFacultyLeaderTemplate(), null, 2)}\n`,
  );
  await writeSecureFile(
    join(secureDirectory, PHASE7_SECURE_FILE_NAMES.testIdentities),
    `${JSON.stringify(createTestIdentityTemplate(), null, 2)}\n`,
  );
  await writeSecureFile(
    join(secureDirectory, PHASE7_SECURE_FILE_NAMES.targetState),
    `${JSON.stringify(createTargetStateTemplate(), null, 2)}\n`,
  );
  await writeSecureFile(
    join(secureDirectory, PHASE7_SECURE_FILE_NAMES.secrets),
    createSecretsTemplate(),
  );

  return [
    "SECURE_INPUT_INITIALIZATION=PASS",
    `CANONICAL_SOURCE_FILE=${basename(canonicalDestination)}`,
    `LECTURER_EMAIL_EXCEPTION_COUNT=${inventory.nonVnu.length}`,
    `DISPLAY_NAME_AMBIGUITY_COUNT=${inventory.ambiguousNames.length}`,
    "DIRECTORY_MODE=0700",
    "FILE_MODES=0600",
    "SECRET_VALUES_WRITTEN=0",
    "DATABASE_CONNECTIONS=0",
    "DATABASE_MUTATIONS=0",
  ].join("\n");
}

async function writeSecureFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

function parseCommand(arguments_: readonly string[]): InitializeCommand {
  const values = new Map<string, string>();
  for (const argument of arguments_) {
    if (argument === "--") continue;
    if (!argument.startsWith("--") || !argument.includes("=")) {
      throw new Error("PHASE7_INITIALIZE_ARGUMENT_INVALID");
    }
    const separator = argument.indexOf("=");
    values.set(argument.slice(0, separator), argument.slice(separator + 1));
  }
  if (
    values.size !== 2 ||
    !values.get("--canonical-source") ||
    !values.get("--secure-directory")
  ) {
    throw new Error("PHASE7_INITIALIZE_ARGUMENT_INVALID");
  }
  return {
    canonicalSource: values.get("--canonical-source")!,
    secureDirectory: values.get("--secure-directory")!,
  };
}

async function main(): Promise<void> {
  try {
    console.log(
      await initializeProductionIdentityInputs(
        parseCommand(process.argv.slice(2)),
      ),
    );
  } catch (error) {
    const safeCodes = new Set([
      "PHASE7_SECURE_PATH_REQUIRED",
      "CANONICAL_SOURCE_CONTRACT_BLOCKED",
      "PHASE7_INITIALIZE_ARGUMENT_INVALID",
    ]);
    const candidateCode = error instanceof Error ? error.message : "";
    console.error(
      [
        "SECURE_INPUT_INITIALIZATION=BLOCKED",
        `ERROR_CODE=${safeCodes.has(candidateCode) ? candidateCode : "PHASE7_INITIALIZE_FAILED"}`,
        "SECRET_VALUES_WRITTEN=0",
        "DATABASE_CONNECTIONS=0",
        "DATABASE_MUTATIONS=0",
      ].join("\n"),
    );
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
