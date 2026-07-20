export interface SafeDenyObservation {
  readonly status: number;
  readonly containsProtectedData: boolean;
  readonly redirectedToProtectedContent: boolean;
}

const cleanupFailureDiagnostic = Symbol("smokeCleanupFailureDiagnostic");

type ErrorWithCleanupDiagnostic = Error & {
  [cleanupFailureDiagnostic]?: unknown;
};

export function isAcceptedSafeDeny(observation: SafeDenyObservation): boolean {
  return (
    (observation.status === 403 || observation.status === 404) &&
    !observation.containsProtectedData &&
    !observation.redirectedToProtectedContent
  );
}

export function createSessionRevocationRequest(): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  };
}

export function getSmokeCleanupFailure(error: unknown): unknown {
  return error instanceof Error
    ? (error as ErrorWithCleanupDiagnostic)[cleanupFailureDiagnostic]
    : undefined;
}

export async function runWithSmokeSessionCleanup<T>(
  action: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let result!: T;
  try {
    result = await action();
  } catch (primaryFailure) {
    try {
      await cleanup();
    } catch (cleanupFailure) {
      throw attachCleanupDiagnostic(primaryFailure, cleanupFailure);
    }
    throw primaryFailure;
  }

  await cleanup();
  return result;
}

function attachCleanupDiagnostic(
  primaryFailure: unknown,
  cleanupFailure: unknown,
): unknown {
  if (primaryFailure instanceof Error && Object.isExtensible(primaryFailure)) {
    Object.defineProperty(primaryFailure, cleanupFailureDiagnostic, {
      configurable: false,
      enumerable: false,
      value: cleanupFailure,
      writable: false,
    });
    return primaryFailure;
  }

  return new AggregateError(
    [primaryFailure, cleanupFailure],
    primaryFailure instanceof Error
      ? primaryFailure.message
      : "PRODUCTION_SMOKE_ACTION_FAILED",
    { cause: primaryFailure },
  );
}
