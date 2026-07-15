export type AuthEnvironmentSource = Record<string, string | undefined>;

export type AuthEnvironment = {
  baseUrl: string;
  secret: string;
  trustedOrigins: string[];
};

const MINIMUM_SECRET_LENGTH = 32;

function parseHttpOrigin(value: string, variableName: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must contain a valid URL origin.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${variableName} must use the http or https protocol.`);
  }

  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${variableName} must contain origins without credentials, paths, query strings, or fragments.`,
    );
  }

  return url.origin;
}

export function parseTrustedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) {
    throw new Error("AUTH_TRUSTED_ORIGINS is required.");
  }

  const origins = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parseHttpOrigin(entry, "AUTH_TRUSTED_ORIGINS"));

  if (origins.length === 0) {
    throw new Error("AUTH_TRUSTED_ORIGINS must contain at least one origin.");
  }

  return [...new Set(origins)];
}

export function readAuthEnvironment(
  source: AuthEnvironmentSource = process.env,
): AuthEnvironment {
  const rawBaseUrl = source.BETTER_AUTH_URL;
  const secret = source.BETTER_AUTH_SECRET;

  if (!rawBaseUrl?.trim()) {
    throw new Error("BETTER_AUTH_URL is required.");
  }

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required.");
  }

  if (secret.trim() !== secret || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${MINIMUM_SECRET_LENGTH} characters and contain no surrounding whitespace.`,
    );
  }

  return {
    baseUrl: parseHttpOrigin(rawBaseUrl.trim(), "BETTER_AUTH_URL"),
    secret,
    trustedOrigins: parseTrustedOrigins(source.AUTH_TRUSTED_ORIGINS),
  };
}
