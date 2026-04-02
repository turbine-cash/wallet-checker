import {
  analyzeTransaction,
  normalizeHeliusTransaction,
  normalizeStandardTransaction,
} from "./analyze";
import { describeRpcError, rpcCall } from "./rpc";
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

  const onRetry = ({ method }: { attempt: number; method: string }) => {
    progress.retries += 1;
    progress.statusText = `Retrying ${method} after a temporary RPC failure.`;
    emitProgress(true);
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

    if (inputs.scanMode === "helius") {
      let paginationToken: string | null = null;
      const heliusPageSize =
        callbacks.heliusPageSize ?? DEFAULT_HELIUS_PAGE_SIZE;

      do {
        const page: HeliusTransactionsPage =
          await rpcCall<HeliusTransactionsPage>(
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
              maxRetries: callbacks.maxRetries,
              onRetry,
              signal: callbacks.signal,
            },
          );

        if (!page.data.length) {
          break;
        }

        progress.pagesFetched += 1;
        progress.cursor = page.paginationToken;
        progress.statusText = `Fetched Helius page ${progress.pagesFetched}. Analyzing ${page.data.length} transactions.`;
        emitProgress(true);

        for (const entry of page.data) {
          if (callbacks.signal.aborted) {
            throw createAbortError();
          }

          progress.transactionsScanned += 1;

          const normalized = normalizeHeliusTransaction(entry);
          const row = normalized
            ? analyzeTransaction(normalized, inputs.rpcUrl)
            : null;

          if (row) {
            pushRow(row);
          } else {
            emitProgress();
          }
        }

        paginationToken = page.paginationToken;
      } while (paginationToken);
    } else {
      const pageSize = callbacks.standardPageSize ?? DEFAULT_STANDARD_PAGE_SIZE;
      const concurrency =
        callbacks.standardConcurrency ?? DEFAULT_STANDARD_CONCURRENCY;
      let before: string | null = null;

      while (true) {
        const signatures: RpcSignatureInfo[] = await rpcCall<
          RpcSignatureInfo[]
        >(
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
            maxRetries: callbacks.maxRetries,
            onRetry,
            signal: callbacks.signal,
          },
        );

        if (!signatures.length) {
          break;
        }

        progress.pagesFetched += 1;
        before = signatures[signatures.length - 1]?.signature ?? null;
        progress.cursor = before;
        progress.statusText = `Fetched signature page ${progress.pagesFetched}. Hydrating ${signatures.length} transactions.`;
        emitProgress(true);

        await runWithConcurrency<RpcSignatureInfo>(
          signatures,
          concurrency,
          async (signatureInfo) => {
            if (callbacks.signal.aborted) {
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
                  maxRetries: callbacks.maxRetries,
                  onRetry,
                  signal: callbacks.signal,
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
                pushRow(row);
              }
            } catch (error) {
              if (
                callbacks.signal.aborted ||
                (error instanceof Error && error.name === "AbortError")
              ) {
                throw createAbortError();
              }

              progress.requestErrors += 1;
              progress.statusText = `Skipped ${signatureInfo.signature.slice(0, 8)} after ${describeRpcError(error)}.`;
              emitProgress(true);
            } finally {
              progress.transactionsScanned += 1;
              emitProgress();
            }
          },
          callbacks.signal,
        );

        if (signatures.length < pageSize) {
          break;
        }
      }
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
