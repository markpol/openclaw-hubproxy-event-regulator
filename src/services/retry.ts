import type { RetryConfig } from "../config.js";

export class HttpStatusError extends Error {
  public constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`HTTP ${status} from ${url}`);
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  retry: RetryConfig,
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void,
): Promise<T> {
  let attempt = 0;

  while (true) {
    attempt += 1;

    try {
      return await operation();
    } catch (error) {
      if (attempt >= retry.attempts || !isRetryable(error)) {
        throw error;
      }

      const delayMs = Math.min(
        retry.maxDelayMs,
        Math.round(retry.baseDelayMs * retry.backoffFactor ** (attempt - 1)),
      );

      onRetry?.(attempt, error, delayMs);
      await sleep(delayMs);
    }
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  if (error instanceof Error) {
    return !("code" in error) || error.name === "TypeError" || error.name === "AbortError";
  }

  return false;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
