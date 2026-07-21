import { pathToFileURL } from "node:url";

import { SafePhase6StagingError } from "../phase-6/lib/staging-contracts";
import {
  PHASE9_MUTATING_UAT_CASES,
  PHASE9_NON_MUTATING_UAT_CASES,
  PHASE9_UAT_CASES,
} from "./lib/uat-manifest";

interface UatPlan {
  readonly mode: "DRY_RUN";
  readonly selectedCases: readonly (typeof PHASE9_UAT_CASES)[number][];
  readonly mutationAuthorized: boolean;
}

export function createUatPlan(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): UatPlan {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  const allowed = args.every(
    (argument) =>
      argument === "--dry-run" ||
      argument === "--authorize-mutating-uat" ||
      argument.startsWith("--case="),
  );
  if (!allowed || !args.includes("--dry-run")) {
    throw new SafePhase6StagingError(
      "Phase 9 UAT planning requires the exact dry-run contract.",
    );
  }
  const mutationAuthorized = args.includes("--authorize-mutating-uat");
  if (environment.PHASE9_AUTHORIZE_MUTATING_UAT && !mutationAuthorized) {
    throw new SafePhase6StagingError(
      "Mutating UAT authorization cannot be inferred from environment.",
    );
  }
  const requested = args
    .filter((argument) => argument.startsWith("--case="))
    .map((argument) => argument.slice("--case=".length));
  const selectedCases =
    requested.length === 0
      ? [...PHASE9_NON_MUTATING_UAT_CASES]
      : requested.map((id) => {
          const testCase = PHASE9_UAT_CASES.find(
            (candidate) => candidate.id === id,
          );
          if (!testCase) {
            throw new SafePhase6StagingError("Unknown Phase 9 UAT case.");
          }
          return testCase;
        });
  if (
    selectedCases.some((testCase) => testCase.dataMutation) &&
    !mutationAuthorized
  ) {
    throw new SafePhase6StagingError(
      "Mutating Phase 9 UAT cases require explicit command-line authorization.",
    );
  }
  return { mode: "DRY_RUN", selectedCases, mutationAuthorized };
}

export async function main(arguments_ = process.argv.slice(2)): Promise<void> {
  const plan = createUatPlan(arguments_);
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      mode: plan.mode,
      totalCaseCount: PHASE9_UAT_CASES.length,
      nonMutatingCaseCount: PHASE9_NON_MUTATING_UAT_CASES.length,
      mutatingCaseCount: PHASE9_MUTATING_UAT_CASES.length,
      mutationAuthorized: plan.mutationAuthorized,
      selectedCases: plan.selectedCases,
      secretsPrinted: false,
      uatExecuted: false,
    })}\n`,
  );
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
