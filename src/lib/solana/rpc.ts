interface JsonRpcSuccess<T> {
  id: number | string | null;
  jsonrpc: string;
  result: T;
}

interface JsonRpcFailure {
  id: number | string | null;
  jsonrpc: string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class RpcRequestError extends Error {
  code?: number;
  status?: number;
  data?: unknown;
  retryable: boolean;

  constructor(
    message: string,
    options: {
      code?: number;
      status?: number;
      data?: unknown;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "RpcRequestError";
    this.code = options.code;
    this.status = options.status;
    this.data = options.data;
    this.retryable = options.retryable ?? false;
  }
}

interface RpcCallOptions {
  maxRetries?: number;
  onRetry?: (context: { attempt: number; method: string }) => void;
  signal: AbortSignal;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableRpcError(
  code: number | undefined,
  message: string,
): boolean {
  if (code !== undefined && [-32603, -32016, -32005, -32004].includes(code)) {
    return true;
  }

  const normalized = message.toLowerCase();

  return (
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("timed out") ||
    normalized.includes("try again") ||
    normalized.includes("temporarily unavailable")
  );
}

function toRpcRequestError(error: unknown, method: string): RpcRequestError {
  if (error instanceof RpcRequestError) {
    return error;
  }

  if (error instanceof Error) {
    return new RpcRequestError(
      `${method} failed: ${error.message || "Unknown error."}`,
      { retryable: true },
    );
  }

  return new RpcRequestError(`${method} failed with an unknown error.`, {
    retryable: true,
  });
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new DOMException("Request aborted.", "AbortError");
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", abortHandler);
      resolve();
    }, milliseconds);

    const abortHandler = () => {
      globalThis.clearTimeout(timeoutId);
      reject(new DOMException("Request aborted.", "AbortError"));
    };

    signal.addEventListener("abort", abortHandler, { once: true });
  });
}

function getRetryDelay(attempt: number): number {
  return 350 * 2 ** attempt;
}

export async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  options: RpcCallOptions,
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  let attempt = 0;

  while (true) {
    if (options.signal.aborted) {
      throw new DOMException("Request aborted.", "AbortError");
    }

    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: `${method}-${attempt}-${Date.now()}`,
          jsonrpc: "2.0",
          method,
          params,
        }),
        signal: options.signal,
      });

      if (!response.ok) {
        throw new RpcRequestError(
          `${method} returned HTTP ${response.status}.`,
          {
            retryable: isRetryableHttpStatus(response.status),
            status: response.status,
          },
        );
      }

      const payload = (await response.json()) as
        | JsonRpcFailure
        | JsonRpcSuccess<T>;

      if ("error" in payload) {
        throw new RpcRequestError(payload.error.message, {
          code: payload.error.code,
          data: payload.error.data,
          retryable: isRetryableRpcError(
            payload.error.code,
            payload.error.message,
          ),
        });
      }

      return payload.result;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const normalizedError = toRpcRequestError(error, method);

      if (!normalizedError.retryable || attempt >= maxRetries) {
        throw normalizedError;
      }

      options.onRetry?.({ attempt: attempt + 1, method });
      await delay(getRetryDelay(attempt), options.signal);
      attempt += 1;
    }
  }
}

export function describeRpcError(error: unknown): string {
  if (error instanceof RpcRequestError) {
    const statusPrefix = error.status ? `HTTP ${error.status}: ` : "";
    return `${statusPrefix}${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown RPC error.";
}
