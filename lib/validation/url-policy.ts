import { AgentError, ErrorCode } from "../types/errors";

export interface UrlValidationOptions {
  context?: string;
  baseUrl?: string;
  allowLocalhost?: boolean;
  allowedOrigins?: string[];
}

/**
 * Validates whether an IP string belongs to private, loopback, or link-local ranges.
 */
function isPrivateOrRestrictedIp(hostname: string): boolean {
  // Strip IPv6 brackets if present
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  // IPv6 checks
  if (host === "::1" || host === "::" || host.startsWith("fe80:") || host.startsWith("fc00:") || host.startsWith("fd00:")) {
    return true;
  }

  // IPv4 dot-decimal check
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }

  const [_, a, b, c, d] = ipv4Match.map(Number);
  if (a < 0 || a > 255 || b < 0 || b > 255 || c < 0 || c > 255 || d < 0 || d > 255) {
    return true; // Malformed IP
  }

  // 0.0.0.0/8
  if (a === 0) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 10.0.0.0/8 (Private RFC 1918)
  if (a === 10) return true;
  // 172.16.0.0/12 (Private RFC 1918)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (Private RFC 1918)
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (Link-local / Cloud metadata)
  if (a === 169 && b === 254) return true;

  return false;
}

/**
 * Validates a URL against allowed schemes (http, https) and SSRF / private metadata destinations.
 * Shared across Planner, ActionExecutor, PreExecutionValidator, and ApiExecutor.
 */
export function validateUrlString(
  rawUrl: string,
  contextOrOptions?: string | UrlValidationOptions,
  baseUrl = "http://localhost:3000"
): URL {
  const options: UrlValidationOptions = typeof contextOrOptions === "string"
    ? { context: contextOrOptions, baseUrl }
    : { context: "navigation", baseUrl, ...contextOrOptions };

  const { context = "navigation", allowLocalhost = true, allowedOrigins } = options;

  if (!rawUrl || typeof rawUrl !== "string") {
    throw new AgentError(
      `Empty or invalid URL provided in ${context}`,
      ErrorCode.VALIDATION_FAILED,
      false
    );
  }

  // Reject dangerous embedded javascript: or data: pseudo-protocols immediately
  const trimmed = rawUrl.trim();
  const lowerTrimmed = trimmed.toLowerCase();
  if (
    lowerTrimmed.startsWith("javascript:") ||
    lowerTrimmed.startsWith("data:") ||
    lowerTrimmed.startsWith("file:") ||
    lowerTrimmed.startsWith("vbscript:")
  ) {
    throw new AgentError(
      `Unsupported or dangerous URL scheme in ${context}: '${trimmed.split(":")[0]}:'. Only http: and https: are permitted.`,
      ErrorCode.VALIDATION_FAILED,
      false
    );
  }

  let parsed: URL;
  try {
    if (trimmed.startsWith("/")) {
      parsed = new URL(trimmed, options.baseUrl || baseUrl);
    } else {
      parsed = new URL(trimmed);
    }
  } catch {
    throw new AgentError(
      `Invalid URL syntax in ${context}: '${rawUrl}'`,
      ErrorCode.VALIDATION_FAILED,
      false
    );
  }

  const scheme = parsed.protocol.toLowerCase();
  const allowedSchemes = ["http:", "https:"];
  if (!allowedSchemes.includes(scheme)) {
    throw new AgentError(
      `Unsupported or dangerous URL scheme in ${context}: '${scheme}'. Only http: and https: are permitted.`,
      ErrorCode.VALIDATION_FAILED,
      false
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = [
    "169.254.169.254",
    "metadata.google.internal",
    "metadata.internal",
    "instance-data",
  ];

  if (blockedHosts.includes(hostname) || hostname.endsWith(".internal")) {
    throw new AgentError(
      `Access to internal metadata destination is prohibited: '${hostname}'`,
      ErrorCode.VALIDATION_FAILED,
      false
    );
  }

  // SSRF / Private network validation
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (isLocalHost) {
    if (!allowLocalhost) {
      throw new AgentError(
        `Access to local network/localhost is prohibited in ${context}: '${hostname}'`,
        ErrorCode.VALIDATION_FAILED,
        false
      );
    }
  } else if (isPrivateOrRestrictedIp(hostname)) {
    throw new AgentError(
      `Access to private network destination is prohibited in ${context}: '${hostname}'`,
      ErrorCode.VALIDATION_FAILED,
      false
    );
  }

  // Allowed origins check if specified
  if (allowedOrigins && allowedOrigins.length > 0) {
    const origin = parsed.origin.toLowerCase();
    const isAllowed = allowedOrigins.some((allowed) => {
      const allowedLower = allowed.toLowerCase();
      return origin === allowedLower || parsed.hostname.endsWith(`.${allowedLower.replace(/^https?:\/\//, "")}`);
    });
    if (!isAllowed) {
      throw new AgentError(
        `Navigation to origin '${parsed.origin}' is not authorized. Permitted origins: ${allowedOrigins.join(", ")}`,
        ErrorCode.VALIDATION_FAILED,
        false
      );
    }
  }

  return parsed;
}

/**
 * Validates that a redirect from a source URL to a destination URL conforms to safety policy.
 */
export function validateRedirectDestination(
  sourceUrl: string,
  destinationUrl: string,
  allowedOrigins?: string[]
): URL {
  return validateUrlString(destinationUrl, {
    context: `redirect from ${sourceUrl}`,
    allowedOrigins,
  });
}

export class UrlPolicy {
  static isPrivateOrLocal(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") return true;
      if (host === "169.254.169.254" || host.endsWith(".internal")) return true;
      return isPrivateOrRestrictedIp(host);
    } catch {
      return true;
    }
  }

  static isSupportedScheme(rawUrl: string): boolean {
    try {
      const trimmed = rawUrl.trim().toLowerCase();
      if (
        trimmed.startsWith("javascript:") ||
        trimmed.startsWith("data:") ||
        trimmed.startsWith("file:") ||
        trimmed.startsWith("vbscript:")
      ) {
        return false;
      }
      const parsed = new URL(rawUrl);
      return ["http:", "https:"].includes(parsed.protocol.toLowerCase());
    } catch {
      return false;
    }
  }

  static validate(rawUrl: string, options?: UrlValidationOptions): URL {
    return validateUrlString(rawUrl, options);
  }
}
