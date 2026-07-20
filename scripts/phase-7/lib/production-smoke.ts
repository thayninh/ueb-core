export interface SafeDenyObservation {
  readonly status: number;
  readonly containsProtectedData: boolean;
  readonly redirectedToProtectedContent: boolean;
}

export function isAcceptedSafeDeny(observation: SafeDenyObservation): boolean {
  return (
    (observation.status === 403 || observation.status === 404) &&
    !observation.containsProtectedData &&
    !observation.redirectedToProtectedContent
  );
}

export async function runWithSmokeSessionCleanup<T>(
  action: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  try {
    return await action();
  } finally {
    await cleanup();
  }
}
