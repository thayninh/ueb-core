import { pathToFileURL } from "node:url";

import {
  generateStagingSecrets,
  validateStagingSecrets,
} from "./lib/staging-secrets";
import {
  assertExactArguments,
  normalizeArguments,
  SafePhase6StagingError,
  valuesFor,
} from "./lib/staging-contracts";

type Operation = "generate" | "validate";

async function main(): Promise<void> {
  const operation = process.argv[2] as Operation | undefined;
  try {
    if (operation === "generate") {
      const args = normalizeArguments(process.argv.slice(3));
      const confirmation = "--confirm-generate-staging-secrets";
      const prefixes = [
        "--output-directory=",
        "--database-host=",
        "--database-port=",
        "--database-name=",
        "--public-url=",
      ];
      assertExactArguments(args, [confirmation], prefixes);
      if (!args.includes(confirmation)) {
        throw new SafePhase6StagingError(
          "Secret generation requires explicit confirmation.",
        );
      }
      const value = (prefix: string): string => {
        const values = valuesFor(args, prefix);
        if (values.length !== 1) {
          throw new SafePhase6StagingError(
            "Secret generation input is incomplete.",
          );
        }
        return values[0]!;
      };
      const report = await generateStagingSecrets({
        outputDirectory: value("--output-directory="),
        databaseHost: value("--database-host="),
        databasePort: value("--database-port="),
        databaseName: value("--database-name="),
        publicUrl: value("--public-url="),
        monitoringEmail: process.env.STAGING_MONITORING_EMAIL,
      });
      printReport("STAGING_SECRETS_GENERATED", report);
      return;
    }
    if (operation === "validate") {
      const args = normalizeArguments(process.argv.slice(3));
      assertExactArguments(args, [], ["--input-directory="]);
      const directories = valuesFor(args, "--input-directory=");
      if (directories.length !== 1) {
        throw new SafePhase6StagingError(
          "Secret validation requires one input directory.",
        );
      }
      const report = await validateStagingSecrets({
        inputDirectory: directories[0]!,
      });
      printReport("STAGING_SECRETS_VALIDATION", report);
      return;
    }
    throw new SafePhase6StagingError("Unknown staging secret operation.");
  } catch (error) {
    console.error(
      error instanceof SafePhase6StagingError
        ? error.message
        : "Staging secret operation failed safely.",
    );
    console.log("STAGING_SECRETS_STATUS=FAIL");
    process.exitCode = 1;
  }
}

function printReport(
  label: string,
  report: { readonly fileCount: number; readonly manifestSha256: string },
): void {
  console.log(`${label}=PASS`);
  console.log(`SECRET_FILE_COUNT=${report.fileCount}`);
  console.log(`SECRET_MANIFEST_SHA256=${report.manifestSha256}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
