import { z } from "zod";

export function isTimeoutError(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const name = "name" in cause ? String((cause as { name?: unknown }).name) : "";
  if (name === "TimeoutError" || name === "AbortError" || name === "ProviderTimeoutError") return true;
  const message = "message" in cause ? String((cause as { message?: unknown }).message) : "";
  return /the operation was aborted due to timeout|timed out|timeout/i.test(message);
}

export function providerError(message: string, options?: { timeout?: boolean }) {
  const error = new Error(message);
  error.name = options?.timeout ? "ProviderTimeoutError" : "ProviderError";
  return error;
}

export function toHttpError(error: unknown): { status: number; body: Record<string, unknown> } {
  if (isJsonParseError(error)) {
    return {
      status: 400,
      body: {
        error: "Invalid request",
        message: "Request body must be valid JSON.",
        code: "invalid_json"
      }
    };
  }

  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        error: "Invalid request",
        message: "The request is invalid.",
        code: "invalid_request",
        details: error.flatten()
      }
    };
  }

  if (error instanceof Error && (error.name === "ValidationError" || error.message.startsWith("Unsupported chain:"))) {
    return {
      status: 400,
      body: {
        error: "Invalid request",
        message: error.message,
        code: "invalid_request"
      }
    };
  }

  if (error instanceof Error && error.name === "ProviderTimeoutError") {
    return {
      status: 504,
      body: {
        error: "Timeout",
        message: error.message,
        code: "provider_timeout"
      }
    };
  }

  if (error instanceof Error && error.name === "ProviderError") {
    return {
      status: 502,
      body: {
        error: "Provider error",
        message: error.message,
        code: "provider_error"
      }
    };
  }

  if (error instanceof Error && error.name === "ConfigurationError") {
    return {
      status: 500,
      body: {
        error: "Configuration error",
        message: error.message,
        code: "configuration_error"
      }
    };
  }

  if (error instanceof Error && /facilitator/i.test(error.message)) {
    return {
      status: 502,
      body: {
        error: "Payment facilitator unavailable",
        message: "WalletLens could not reach the Coinbase CDP x402 facilitator. Retry shortly.",
        code: "facilitator_unavailable"
      }
    };
  }

  return {
    status: 500,
    body: {
      error: "Internal error",
      message: "WalletLens could not complete the request.",
      code: "internal_error"
    }
  };
}

function isJsonParseError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "type" in error &&
      (error as { type?: unknown }).type === "entity.parse.failed"
  );
}
