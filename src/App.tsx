import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createIdleProgress, scanWalletHistory } from "./lib/solana/scan";
import { describeRpcError } from "./lib/solana/rpc";
import type {
  Finding,
  FindingRow,
  ProviderKind,
  ScanInputs,
  ScanMode,
  ScanProgress,
  ScanStatus,
} from "./lib/solana/types";
import {
  classNames,
  formatCompactDate,
  formatCount,
  formatElapsed,
  isHeliusRpcUrl,
  isValidRpcUrl,
  isValidSolanaPubkey,
  shortenAddress,
} from "./lib/solana/utils";

function sortFindingRows(left: FindingRow, right: FindingRow): number {
  if (left.slot !== right.slot) {
    return right.slot - left.slot;
  }

  if (left.blockTime !== right.blockTime) {
    return (right.blockTime ?? 0) - (left.blockTime ?? 0);
  }

  return left.signature.localeCompare(right.signature);
}

function createInputs(
  rpcUrl: string,
  walletPubkey: string,
  provider: ProviderKind,
  scanMode: ScanMode,
): ScanInputs {
  return {
    provider,
    rpcUrl: rpcUrl.trim(),
    scanMode,
    walletPubkey: walletPubkey.trim(),
  };
}

function StatusPill({ status }: { status: ScanStatus }) {
  return (
    <span
      className={classNames(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.22em]",
        status === "succeeded"
          ? "border-emerald-400/30 bg-emerald-300/10 text-emerald-100"
          : "border-amber-400/30 bg-amber-300/10 text-amber-100",
      )}
    >
      {status === "succeeded" ? "Succeeded" : "Failed"}
    </span>
  );
}

function FindingBadge({ finding }: { finding: Finding }) {
  return (
    <span
      className={classNames(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em]",
        finding.kind === "durable-nonce"
          ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
          : finding.instructionType === "revoke"
            ? "border-rose-300/30 bg-rose-300/10 text-rose-100"
            : "border-fuchsia-300/30 bg-fuchsia-300/10 text-fuchsia-100",
      )}
    >
      {finding.label}
    </span>
  );
}

function MetricCard({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "cool" | "warm" | "neutral";
  value: string;
}) {
  return (
    <div
      className={classNames(
        "rounded-[1.25rem] border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
        tone === "cool" && "border-cyan-300/15 bg-cyan-300/[0.07] text-cyan-50",
        tone === "warm" &&
          "border-amber-300/15 bg-amber-300/[0.08] text-amber-50",
        tone === "neutral" && "border-white/10 bg-white/[0.04] text-white",
      )}
    >
      <p className="text-[0.68rem] uppercase tracking-[0.28em] text-white/45">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}

function EmptyState({
  hasScanned,
  progress,
}: {
  hasScanned: boolean;
  progress: ScanProgress;
}) {
  if (hasScanned && progress.phase === "completed") {
    return (
      <div className="rounded-[1.6rem] border border-emerald-200/10 bg-emerald-300/[0.05] px-5 py-6 text-sm text-emerald-50/85">
        No token delegation or durable nonce usage was found in the scanned
        history.
      </div>
    );
  }

  if (progress.phase === "aborted") {
    return (
      <div className="rounded-[1.6rem] border border-amber-200/10 bg-amber-300/[0.05] px-5 py-6 text-sm text-amber-50/85">
        Scan stopped. Partial findings are still shown below.
      </div>
    );
  }

  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] px-5 py-6 text-sm text-white/55">
      Paste an RPC URL and a wallet pubkey to start a historical scan. The table
      only shows transactions where delegation or durable nonce activity was
      detected.
    </div>
  );
}

function ResultsTable({ rows }: { rows: FindingRow[] }) {
  return (
    <div className="overflow-hidden rounded-[1.8rem] border border-white/10 bg-black/15">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10">
          <thead className="bg-white/[0.03] text-left text-[0.68rem] uppercase tracking-[0.26em] text-white/45">
            <tr>
              <th className="px-4 py-3 font-semibold">Transaction</th>
              <th className="px-4 py-3 font-semibold">Time</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Findings</th>
              <th className="px-4 py-3 font-semibold">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/6 text-sm text-white/80">
            {rows.map((row) => (
              <tr key={`${row.signature}-${row.slot}`} className="result-row">
                <td className="px-4 py-4 align-top">
                  <a
                    href={row.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex flex-col gap-1.5"
                  >
                    <span className="font-medium text-white transition-colors group-hover:text-cyan-100">
                      {shortenAddress(row.signature)}
                    </span>
                    <span className="text-xs uppercase tracking-[0.2em] text-white/35">
                      Slot {formatCount(row.slot)}
                    </span>
                  </a>
                </td>
                <td className="px-4 py-4 align-top text-white/60">
                  {formatCompactDate(row.blockTime)}
                </td>
                <td className="px-4 py-4 align-top">
                  <StatusPill status={row.status} />
                </td>
                <td className="px-4 py-4 align-top">
                  <div className="flex flex-wrap gap-2">
                    {row.findings.map((finding, index) => (
                      <FindingBadge
                        key={`${row.signature}-${finding.kind}-${index}`}
                        finding={finding}
                      />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-4 align-top text-white/72">
                  {row.summary}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function App() {
  const [rpcUrl, setRpcUrl] = useState("");
  const [walletPubkey, setWalletPubkey] = useState("");
  const [preferredMode, setPreferredMode] = useState<ScanMode>("standard");
  const [isScanning, setIsScanning] = useState(false);
  const [rows, setRows] = useState<FindingRow[]>([]);
  const [progress, setProgress] = useState(() =>
    createIdleProgress(createInputs("", "", "standard", "standard")),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());

  const scanControllerRef = useRef<AbortController | null>(null);
  const scanRunIdRef = useRef(0);

  const provider = isHeliusRpcUrl(rpcUrl) ? "helius" : "standard";
  const effectiveMode = provider === "helius" ? preferredMode : "standard";
  const rpcUrlError =
    rpcUrl.trim().length > 0 && !isValidRpcUrl(rpcUrl)
      ? "Enter a full http:// or https:// RPC URL."
      : null;
  const pubkeyError =
    walletPubkey.trim().length > 0 && !isValidSolanaPubkey(walletPubkey)
      ? "Enter a valid base58 Solana public key."
      : null;
  const hasValidInputs = !rpcUrlError && !pubkeyError && rpcUrl && walletPubkey;
  const hasScanned = rows.length > 0 || progress.phase !== "idle";
  const liveElapsedMs =
    progress.phase === "scanning" && progress.startedAt
      ? clockNow - progress.startedAt
      : progress.elapsedMs;

  useEffect(() => {
    if (!isScanning) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isScanning]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!hasValidInputs || isScanning) {
      return;
    }

    const nextInputs = createInputs(
      rpcUrl,
      walletPubkey,
      provider,
      effectiveMode,
    );

    scanControllerRef.current?.abort();

    const controller = new AbortController();
    const runId = scanRunIdRef.current + 1;

    scanRunIdRef.current = runId;
    scanControllerRef.current = controller;

    setRows([]);
    setClockNow(Date.now());
    setErrorMessage(null);
    setIsScanning(true);
    setProgress(createIdleProgress(nextInputs));

    try {
      await scanWalletHistory(nextInputs, {
        onMatch: (row) => {
          if (scanRunIdRef.current !== runId) {
            return;
          }

          startTransition(() => {
            setRows((currentRows) => {
              const nextRows = [...currentRows, row];
              nextRows.sort(sortFindingRows);
              return nextRows;
            });
          });
        },
        onProgress: (nextProgress) => {
          if (scanRunIdRef.current !== runId) {
            return;
          }

          setClockNow(Date.now());
          setProgress(nextProgress);
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (scanRunIdRef.current === runId) {
        setErrorMessage(describeRpcError(error));
      }
    } finally {
      if (scanRunIdRef.current === runId) {
        setIsScanning(false);
      }

      if (scanControllerRef.current === controller) {
        scanControllerRef.current = null;
      }
    }
  }

  function handleStop() {
    scanControllerRef.current?.abort();
  }

  function handleReset() {
    scanRunIdRef.current += 1;
    scanControllerRef.current?.abort();
    scanControllerRef.current = null;
    setRows([]);
    setErrorMessage(null);
    setIsScanning(false);
    setClockNow(Date.now());
    setProgress(
      createIdleProgress(
        createInputs(rpcUrl, walletPubkey, provider, effectiveMode),
      ),
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#060915] px-4 py-6 text-white sm:px-6 lg:px-10">
      <div className="pointer-events-none absolute inset-0 forensic-grid opacity-70" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[24rem] bg-[radial-gradient(circle_at_top,rgba(79,209,197,0.22),transparent_55%)]" />
      <div className="pointer-events-none absolute right-[-10rem] top-[10rem] h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,rgba(255,168,76,0.22),transparent_60%)] blur-3xl" />
      <div className="pointer-events-none absolute left-[-8rem] bottom-[-5rem] h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,rgba(84,110,255,0.2),transparent_62%)] blur-3xl" />

      <section className="relative mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[0.72rem] uppercase tracking-[0.44em] text-cyan-100/60">
              Historical Wallet Audit
            </p>
            <h1 className="mt-3 max-w-xl text-5xl tracking-[-0.05em] text-white sm:text-6xl [font-family:var(--font-display)]">
              Wallet checker for delegation and durable nonce risk.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/62">
              Scan a wallet address against any browser-accessible Solana RPC.
              Helius URLs can switch between standard signature hydration and
              full transaction history pages.
            </p>
          </div>

          <div className="glass-panel max-w-md rounded-[1.8rem] p-5 text-sm leading-6 text-white/64">
            <p className="text-[0.68rem] uppercase tracking-[0.28em] text-white/42">
              Browser only
            </p>
            <p className="mt-3">
              The app sends requests directly from the browser. If a provider
              blocks CORS or origin traffic, the scan will fail here exactly as
              the user would experience it in production.
            </p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)]">
          <section className="glass-panel rounded-[2rem] p-6 sm:p-7">
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label
                  htmlFor="rpc-url"
                  className="text-[0.72rem] font-semibold uppercase tracking-[0.32em] text-white/52"
                >
                  RPC URL
                </label>
                <input
                  id="rpc-url"
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={rpcUrl}
                  onChange={(event) => setRpcUrl(event.target.value)}
                  className="field-shell"
                  placeholder="https://mainnet.helius-rpc.com/?api-key=..."
                />
                <p className="text-sm text-white/48">
                  Provider detected:{" "}
                  <span className="font-semibold text-white/75">
                    {provider === "helius" ? "Helius" : "Standard RPC"}
                  </span>
                </p>
                {rpcUrlError ? (
                  <p className="text-sm text-rose-200/90">{rpcUrlError}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="wallet-pubkey"
                  className="text-[0.72rem] font-semibold uppercase tracking-[0.32em] text-white/52"
                >
                  Wallet Pubkey
                </label>
                <input
                  id="wallet-pubkey"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={walletPubkey}
                  onChange={(event) => setWalletPubkey(event.target.value)}
                  className="field-shell"
                  placeholder="Enter the wallet address to audit"
                />
                {pubkeyError ? (
                  <p className="text-sm text-rose-200/90">{pubkeyError}</p>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[0.72rem] font-semibold uppercase tracking-[0.32em] text-white/52">
                    Scan mode
                  </span>
                  <span className="text-xs uppercase tracking-[0.18em] text-white/34">
                    Finalized commitment
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={provider !== "helius"}
                    onClick={() => setPreferredMode("standard")}
                    className={classNames(
                      "mode-card",
                      effectiveMode === "standard" && "mode-card-active",
                      provider !== "helius" && "cursor-default opacity-70",
                    )}
                  >
                    <span className="text-sm font-semibold text-white">
                      Standard compatibility
                    </span>
                    <span className="mt-2 block text-sm text-white/52">
                      `getSignaturesForAddress` plus per-signature hydration
                      with `getTransaction`.
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={provider !== "helius"}
                    onClick={() => setPreferredMode("helius")}
                    className={classNames(
                      "mode-card",
                      effectiveMode === "helius" && "mode-card-active",
                      provider !== "helius" && "cursor-not-allowed opacity-45",
                    )}
                  >
                    <span className="text-sm font-semibold text-white">
                      Helius full transactions
                    </span>
                    <span className="mt-2 block text-sm text-white/52">
                      One request per page using `getTransactionsForAddress`
                      with full parsed transactions.
                    </span>
                  </button>
                </div>

                {provider !== "helius" ? (
                  <p className="text-sm text-white/48">
                    Helius full-history mode is only enabled when the RPC host
                    is recognized as Helius.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={!hasValidInputs || isScanning}
                  className="primary-btn"
                >
                  {isScanning ? "Scanning..." : "Start scan"}
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={!isScanning}
                  className="secondary-btn"
                >
                  Stop
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={isScanning || (!hasScanned && !errorMessage)}
                  className="secondary-btn"
                >
                  Reset
                </button>
              </div>
            </form>

            <div className="mt-8 rounded-[1.7rem] border border-white/10 bg-black/20 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[0.68rem] uppercase tracking-[0.28em] text-white/42">
                    Live activity
                  </p>
                  <p className="mt-3 max-w-lg text-sm leading-6 text-white/62">
                    {progress.statusText}
                  </p>
                </div>
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs uppercase tracking-[0.22em] text-white/52">
                  {progress.phase}
                </div>
              </div>

              <div
                className={classNames(
                  "scan-meter mt-5",
                  progress.phase === "scanning" && "scan-meter-active",
                  progress.phase === "completed" && "scan-meter-finished",
                  progress.phase === "error" && "scan-meter-error",
                  progress.phase === "aborted" && "scan-meter-paused",
                )}
              >
                <div className="scan-meter-track" />
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Pages fetched"
                  tone="neutral"
                  value={formatCount(progress.pagesFetched)}
                />
                <MetricCard
                  label="Transactions scanned"
                  tone="cool"
                  value={formatCount(progress.transactionsScanned)}
                />
                <MetricCard
                  label="Findings"
                  tone="warm"
                  value={formatCount(rows.length)}
                />
                <MetricCard
                  label="Elapsed"
                  tone="neutral"
                  value={formatElapsed(liveElapsedMs)}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-3 text-xs uppercase tracking-[0.2em] text-white/42">
                <span>Retries {formatCount(progress.retries)}</span>
                <span>
                  Request errors {formatCount(progress.requestErrors)}
                </span>
                <span>
                  Cursor{" "}
                  {progress.cursor ? shortenAddress(progress.cursor) : "none"}
                </span>
              </div>
            </div>
          </section>

          <section className="glass-panel rounded-[2rem] p-6 sm:p-7">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.34em] text-white/52">
                  Matching Transactions
                </p>
                <h2 className="mt-3 text-3xl tracking-[-0.05em] text-white [font-family:var(--font-display)]">
                  Delegation and durable nonce hits only.
                </h2>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs uppercase tracking-[0.22em] text-white/48">
                {rows.length} rows
              </div>
            </div>

            {errorMessage ? (
              <div className="mb-5 rounded-[1.4rem] border border-rose-200/18 bg-rose-400/[0.08] px-5 py-4 text-sm leading-6 text-rose-100/88">
                {errorMessage}
              </div>
            ) : null}

            {rows.length > 0 ? (
              <ResultsTable rows={rows} />
            ) : (
              <EmptyState hasScanned={hasScanned} progress={progress} />
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

export default App;
