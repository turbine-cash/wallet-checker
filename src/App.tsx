import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { describeRpcError } from "./lib/solana/rpc";
import { createIdleProgress, scanWalletHistory } from "./lib/solana/scan";
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
        "status-pill",
        status === "succeeded" ? "status-pill-success" : "status-pill-failed",
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
        "finding-pill",
        finding.kind === "durable-nonce"
          ? "finding-pill-muted"
          : finding.instructionType === "revoke"
            ? "finding-pill-warning"
            : "finding-pill-primary",
      )}
    >
      {finding.label}
    </span>
  );
}

function ProgressStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="progress-stat">
      <span className="progress-stat-label">{label}</span>
      <span className="progress-stat-value">{value}</span>
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
      <div className="state-card">
        No token delegation or durable nonce usage was found.
      </div>
    );
  }

  if (progress.phase === "aborted") {
    return (
      <div className="state-card state-card-warning">
        Scan stopped. Partial findings are still listed below.
      </div>
    );
  }

  return (
    <div className="state-card state-card-muted">
      Paste an RPC URL and wallet pubkey to scan historical activity.
    </div>
  );
}

function ResultCard({ row }: { row: FindingRow }) {
  return (
    <a
      href={row.explorerUrl}
      target="_blank"
      rel="noreferrer"
      className="finding-card group"
    >
      <div className="finding-card-head">
        <div className="finding-card-meta">
          <span className="finding-card-signature">
            {shortenAddress(row.signature)}
          </span>
          <span className="finding-card-subline">
            Slot {formatCount(row.slot)} · {formatCompactDate(row.blockTime)}
          </span>
        </div>

        <div className="finding-card-badges">
          {row.findings.map((finding, index) => (
            <FindingBadge
              key={`${row.signature}-${finding.kind}-${index}`}
              finding={finding}
            />
          ))}
        </div>

        <div className="finding-card-actions">
          <StatusPill status={row.status} />
        </div>
      </div>
    </a>
  );
}

function ResultList({
  rows,
  hasScanned,
  progress,
}: {
  rows: FindingRow[];
  hasScanned: boolean;
  progress: ScanProgress;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (rows.length === 0) {
    return <EmptyState hasScanned={hasScanned} progress={progress} />;
  }

  const visibleRows = isExpanded ? rows : rows.slice(0, 5);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <div className="result-stack">
      {visibleRows.map((row) => (
        <ResultCard key={`${row.signature}-${row.slot}`} row={row} />
      ))}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className="secondary-btn"
          style={{ width: "100%", marginTop: "0.5rem" }}
        >
          View all {hiddenCount} more findings
        </button>
      )}
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
    <main className="theme-stage">
      <section className="shell-card">
        <header className="shell-header">
          <p className="shell-eyebrow">Wallet Audit</p>
          <h1 className="shell-title">Scan delegation & nonces.</h1>
        </header>

        <form className="scanner-form" onSubmit={handleSubmit}>
          <div className="field-block">
            <div className="field-heading-row">
              <label htmlFor="rpc-url" className="field-label">
                RPC URL
              </label>
              <span className="field-caption">
                {provider === "helius" ? "Helius Detected" : "Standard RPC"}
              </span>
            </div>
            <input
              id="rpc-url"
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={rpcUrl}
              onChange={(event) => setRpcUrl(event.target.value)}
              className="field-shell"
              placeholder="https://mainnet.helius-rpc.com/..."
            />
            {rpcUrlError ? <p className="field-error">{rpcUrlError}</p> : null}
          </div>

          <div className="field-block">
            <label htmlFor="wallet-pubkey" className="field-label">
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
              placeholder="Enter the base58 wallet address"
            />
            {pubkeyError ? <p className="field-error">{pubkeyError}</p> : null}
          </div>

          <div className="field-block">
            <span className="field-label">Scan Mode</span>
            <div className="mode-switch">
              <button
                type="button"
                disabled={provider !== "helius"}
                onClick={() => setPreferredMode("standard")}
                className={classNames(
                  "mode-card",
                  effectiveMode === "standard" && "mode-card-active",
                  provider !== "helius" && "mode-card-disabled",
                )}
              >
                Standard
              </button>

              <button
                type="button"
                disabled={provider !== "helius"}
                onClick={() => setPreferredMode("helius")}
                className={classNames(
                  "mode-card",
                  effectiveMode === "helius" && "mode-card-active",
                  provider !== "helius" && "mode-card-disabled",
                )}
              >
                Helius Full
              </button>
            </div>
          </div>

          <div className="action-row">
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

        <section className="panel-section">
          <div className="section-head">
            <div>
              <p className="section-eyebrow">Live Activity</p>
            </div>
            <span className="meta-pill">{progress.phase}</span>
          </div>

          <div
            className={classNames(
              "scan-meter",
              progress.phase === "scanning" && "scan-meter-active",
              progress.phase === "completed" && "scan-meter-finished",
              progress.phase === "error" && "scan-meter-error",
              progress.phase === "aborted" && "scan-meter-paused",
            )}
          >
            <div className="scan-meter-track" />
          </div>

          <div className="progress-grid">
            <ProgressStat
              label="Pages"
              value={formatCount(progress.pagesFetched)}
            />
            <ProgressStat
              label="Txns"
              value={formatCount(progress.transactionsScanned)}
            />
            <ProgressStat label="Hits" value={formatCount(rows.length)} />
            <ProgressStat label="Time" value={formatElapsed(liveElapsedMs)} />
          </div>
        </section>

        <section className="panel-section">
          <div className="section-head">
            <div>
              <p className="section-eyebrow">Findings</p>
            </div>
            <span className="meta-pill">{formatCount(rows.length)} hits</span>
          </div>

          {errorMessage ? (
            <div className="state-card state-card-error">{errorMessage}</div>
          ) : null}

          <ResultList rows={rows} hasScanned={hasScanned} progress={progress} />
        </section>
      </section>
    </main>
  );
}

export default App;
