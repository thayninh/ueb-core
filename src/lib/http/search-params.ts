export type PageSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export function hasUnexpectedSearchParams(
  params: PageSearchParams,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(params).some((key) => !allowed.has(key));
}

export function firstSearchParam(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

export function parseStrictPositivePage(
  value: string | undefined,
): number | null {
  if (value === undefined) return 1;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
