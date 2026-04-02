import {
  analyzeTransaction,
  normalizeHeliusTransaction,
  normalizeStandardTransaction,
} from "./analyze";
import { describeRpcError, rpcCall, RpcRequestError } from "./rpc";
import type {
  FindingRow,
  HeliusTransactionsPage,
  RpcSignatureInfo,
  RpcTransactionResponse,
  ScanCallbacks,
  ScanInputs,
  ScanProgress,
  ScanResult,
} from "./types";

const DEFAULT_STANDARD_PAGE_SIZE = 1000;
const DEFAULT_HELIUS_PAGE_SIZE = 100;
const DEFAULT_STANDARD_CONCURRENCY = 6;

interface ScanRuntime {
  rows: FindingRow[];
  progress: ScanProgress;
  callbacks: ScanCallbacks;
  emitProgress: (force?: boolean) => void;
  pushRow: (row: FindingRow) => void;
}

function createProgressSnapshot(progress: ScanProgress): ScanProgress {
  const finishedAt = progress.finishedAt ?? Date.now();
  const startedAt = progress.startedAt ?? finishedAt;

  return {
    ...progress,
    elapsedMs: finishedAt - startedAt,
  };
}

function createInitialProgress(inputs: ScanInputs): ScanProgress {
  return {
    cursor: null,
    elapsedMs: 0,
    finishedAt: null,
    matchesFound: 0,
    mode: inputs.scanMode,
    pagesFetched: 0,
    phase: "idle",
    provider: inputs.provider,
    requestErrors: 0,
    retries: 0,
    startedAt: null,
    statusText: "Ready to scan.",
    transactionsScanned: 0,
  };
}

function createAbortError(): DOMException {
  return new DOMException("Scan aborted.", "AbortError");
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let currentIndex = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      while (currentIndex < items.length) {
        if (signal.aborted) {
          throw createAbortError();
        }

        const item = items[currentIndex];
        currentIndex += 1;

        if (!item) {
          continue;
        }

        await worker(item);
      }
    },
  );

  await Promise.all(runners);
}

export function createIdleProgress(inputs: ScanInputs): ScanProgress {
  return createInitialProgress(inputs);
}

async function scanHeliusHistory(
  inputs: ScanInputs,
  runtime: ScanRuntime,
): Promise<void> {
  let paginationToken: string | null = null;
  const heliusPageSize =
    runtime.callbacks.heliusPageSize ?? DEFAULT_HELIUS_PAGE_SIZE;

  do {
    const page: HeliusTransactionsPage = await rpcCall<HeliusTransactionsPage>(
      inputs.rpcUrl,
      "getTransactionsForAddress",
      [
        inputs.walletPubkey,
        {
          commitment: "finalized",
          encoding: "jsonParsed",
          filters: {
            status: "any",
            tokenAccounts: "all",
          },
          limit: heliusPageSize,
          maxSupportedTransactionVersion: 0,
          ...(paginationToken ? { paginationToken } : {}),
          transactionDetails: "full",
        },
      ],
      {
        maxRetries: runtime.callbacks.maxRetries,
        onRetry: ({ method }) => {
          runtime.progress.retries += 1;
          runtime.progress.statusText = `Retrying ${method} after a temporary RPC failure.`;
          runtime.emitProgress(true);
        },
        signal: runtime.callbacks.signal,
      },
    );

    if (!page.data.length) {
      break;
    }

    runtime.progress.pagesFetched += 1;
    runtime.progress.cursor = page.paginationToken;
    runtime.progress.statusText = `Fetched Helius page ${runtime.progress.pagesFetched}. Analyzing ${page.data.length} transactions.`;
    runtime.emitProgress(true);

    for (const entry of page.data) {
      if (runtime.callbacks.signal.aborted) {
        throw createAbortError();
      }

      runtime.progress.transactionsScanned += 1;

      const normalized = normalizeHeliusTransaction(entry);
      const row = normalized
        ? analyzeTransaction(normalized, inputs.rpcUrl)
        : null;

      if (row) {
        runtime.pushRow(row);
      } else {
        runtime.emitProgress();
      }
    }

    paginationToken = page.paginationToken;
  } while (paginationToken);
}

async function scanStandardHistory(
  inputs: ScanInputs,
  runtime: ScanRuntime,
): Promise<void> {
  const pageSize =
    runtime.callbacks.standardPageSize ?? DEFAULT_STANDARD_PAGE_SIZE;
  const concurrency =
    runtime.callbacks.standardConcurrency ?? DEFAULT_STANDARD_CONCURRENCY;
  let before: string | null = null;

  while (true) {
    const signatures: RpcSignatureInfo[] = await rpcCall<RpcSignatureInfo[]>(
      inputs.rpcUrl,
      "getSignaturesForAddress",
      [
        inputs.walletPubkey,
        {
          commitment: "finalized",
          limit: pageSize,
          ...(before ? { before } : {}),
        },
      ],
      {
        maxRetries: runtime.callbacks.maxRetries,
        onRetry: ({ method }) => {
          runtime.progress.retries += 1;
          runtime.progress.statusText = `Retrying ${method} after a temporary RPC failure.`;
          runtime.emitProgress(true);
        },
        signal: runtime.callbacks.signal,
      },
    );

    if (!signatures.length) {
      break;
    }

    runtime.progress.pagesFetched += 1;
    before = signatures[signatures.length - 1]?.signature ?? null;
    runtime.progress.cursor = before;
    runtime.progress.statusText = `Fetched signature page ${runtime.progress.pagesFetched}. Hydrating ${signatures.length} transactions.`;
    runtime.emitProgress(true);

    await runWithConcurrency<RpcSignatureInfo>(
      signatures,
      concurrency,
      async (signatureInfo) => {
        if (runtime.callbacks.signal.aborted) {
          throw createAbortError();
        }

        try {
          const transaction = await rpcCall<RpcTransactionResponse | null>(
            inputs.rpcUrl,
            "getTransaction",
            [
              signatureInfo.signature,
              {
                commitment: "finalized",
                encoding: "jsonParsed",
                maxSupportedTransactionVersion: 0,
              },
            ],
            {
              maxRetries: runtime.callbacks.maxRetries,
              onRetry: ({ method }) => {
                runtime.progress.retries += 1;
                runtime.progress.statusText = `Retrying ${method} after a temporary RPC failure.`;
                runtime.emitProgress(true);
              },
              signal: runtime.callbacks.signal,
            },
          );

          const normalized = normalizeStandardTransaction(
            signatureInfo,
            transaction,
          );
          const row = normalized
            ? analyzeTransaction(normalized, inputs.rpcUrl)
            : null;

          if (row) {
            runtime.pushRow(row);
          }
        } catch (error) {
          if (
            runtime.callbacks.signal.aborted ||
            (error instanceof Error && error.name === "AbortError")
          ) {
            throw createAbortError();
          }

          runtime.progress.requestErrors += 1;
          runtime.progress.statusText = `Skipped ${signatureInfo.signature.slice(0, 8)} after ${describeRpcError(error)}.`;
          runtime.emitProgress(true);
        } finally {
          runtime.progress.transactionsScanned += 1;
          runtime.emitProgress();
        }
      },
      runtime.callbacks.signal,
    );

    if (signatures.length < pageSize) {
      break;
    }
  }
}

function resetForFallback(
  progress: ScanProgress,
  fallbackInputs: ScanInputs,
): void {
  progress.cursor = null;
  progress.finishedAt = null;
  progress.matchesFound = 0;
  progress.mode = fallbackInputs.scanMode;
  progress.pagesFetched = 0;
  progress.phase = "scanning";
  progress.provider = fallbackInputs.provider;
  progress.requestErrors = 0;
  progress.retries = 0;
  progress.statusText = "Continuing with standard scan.";
  progress.transactionsScanned = 0;
}

export async function scanWalletHistory(
  inputs: ScanInputs,
  callbacks: ScanCallbacks,
): Promise<ScanResult> {
  const rows: FindingRow[] = [];
  const progress = createInitialProgress(inputs);
  const startedAt = Date.now();
  let lastProgressEmit = 0;

  progress.phase = "validating";
  progress.startedAt = startedAt;
  progress.statusText = "Validating inputs and preparing scan.";

  const emitProgress = (force = false) => {
    const now = Date.now();

    if (!force && now - lastProgressEmit < 100) {
      return;
    }

    lastProgressEmit = now;
    progress.finishedAt = null;
    callbacks.onProgress?.(
      createProgressSnapshot({
        ...progress,
        elapsedMs: now - startedAt,
      }),
    );
  };

  const pushRow = (row: FindingRow) => {
    rows.push(row);
    progress.matchesFound = rows.length;
    callbacks.onMatch?.(row);
    emitProgress(true);
  };

  const finalize = (phase: ScanProgress["phase"], statusText: string) => {
    progress.phase = phase;
    progress.statusText = statusText;
    progress.finishedAt = Date.now();
    callbacks.onProgress?.(createProgressSnapshot(progress));
  };

  emitProgress(true);

  try {
    progress.phase = "scanning";
    progress.statusText = `Scanning ${inputs.walletPubkey} with ${inputs.scanMode === "helius" ? "Helius full transactions" : "standard Solana RPC"}.`;
    emitProgress(true);

    const runtime: ScanRuntime = {
      callbacks,
      emitProgress,
      progress,
      pushRow,
      rows,
    };

    if (inputs.scanMode === "helius") {
      try {
        await scanHeliusHistory(inputs, runtime);
      } catch (error) {
        if (
          callbacks.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw error;
        }

        if (!(error instanceof RpcRequestError)) {
          throw error;
        }

        rows.length = 0;
        const fallbackInputs: ScanInputs = {
          ...inputs,
          provider: "standard",
          scanMode: "standard",
        };
        resetForFallback(progress, fallbackInputs);
        emitProgress(true);
        await scanStandardHistory(fallbackInputs, runtime);
      }
    } else {
      await scanStandardHistory(inputs, runtime);
    }

    finalize(
      "completed",
      rows.length > 0
        ? `Scan complete. Found ${rows.length} matching transactions.`
        : "Scan complete. No delegation or durable nonce activity found.",
    );
    return { progress: createProgressSnapshot(progress), rows };
  } catch (error) {
    if (
      callbacks.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      finalize("aborted", "Scan stopped. Partial findings kept.");
      return { progress: createProgressSnapshot(progress), rows };
    }

    progress.requestErrors += 1;
    finalize("error", describeRpcError(error));
    throw error;
  }
}
