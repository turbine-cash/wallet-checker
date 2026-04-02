import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createIdleProgress, scanWalletHistory } from "./lib/solana/scan";
import type { FindingRow, ScanInputs } from "./lib/solana/types";

vi.mock("./lib/solana/scan", async () => {
  const actual =
    await vi.importActual<typeof import("./lib/solana/scan")>(
      "./lib/solana/scan",
    );

  return {
    ...actual,
    scanWalletHistory: vi.fn(),
  };
});

const mockedScanWalletHistory = vi.mocked(scanWalletHistory);

const sampleRow: FindingRow = {
  blockTime: 1_735_689_600,
  confirmationStatus: "finalized",
  explorerUrl: "https://explorer.solana.com/tx/sampleSig",
  findings: [
    {
      amount: "42",
      delegate: "Deleg8H9c5mDV1A7v7UR4uuV4qx6dzM3D8zz111111111",
      detail: "Approved delegation for 42 to Deleg...1111 on Tokn...1111.",
      instructionType: "approve",
      kind: "token-delegation",
      label: "Delegation",
      mint: null,
      owner: null,
      programName: "spl-token",
      source: "top-level",
      tokenAccount: "Tokn111111111111111111111111111111111111111",
    },
  ],
  signature:
    "5h6xBEauJ3PK6SWCZ1PGjBvj8vDdWG3KpwATGy1ARAXFSDwt8GFXM7W5Ncn16wmqokgpiKRLuS83KUxyZyv2sUYv",
  slot: 111,
  status: "succeeded",
  summary: "Approved delegation for 42 to Deleg...1111 on Tokn...1111.",
};

describe("App", () => {
  afterEach(() => {
    mockedScanWalletHistory.mockReset();
    cleanup();
  });

  it("routes the exact mainnet Helius host automatically and hides mode controls", async () => {
    mockedScanWalletHistory.mockResolvedValue({
      progress: createIdleProgress({
        provider: "helius",
        rpcUrl: "https://mainnet.helius-rpc.com/?api-key=test",
        scanMode: "helius",
        walletPubkey: "11111111111111111111111111111111",
      }),
      rows: [],
    });

    render(<App />);

    expect(screen.queryByText(/Scan Mode/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Helius Full/i })).toBeNull();
    expect(screen.queryByText(/Helius Detected/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/RPC URL/i), {
      target: {
        value: "https://mainnet.helius-rpc.com/?api-key=test",
      },
    });
    fireEvent.change(screen.getByLabelText(/Wallet Pubkey/i), {
      target: {
        value: "11111111111111111111111111111111",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Start scan/i }));

    await waitFor(() => {
      expect(mockedScanWalletHistory).toHaveBeenCalledTimes(1);
    });

    expect(mockedScanWalletHistory.mock.calls[0]?.[0]).toMatchObject({
      provider: "helius",
      scanMode: "helius",
    });
  });

  it("treats devnet and non-Helius hosts as standard scans", async () => {
    mockedScanWalletHistory.mockResolvedValue({
      progress: createIdleProgress({
        provider: "standard",
        rpcUrl: "https://devnet.helius-rpc.com/?api-key=test",
        scanMode: "standard",
        walletPubkey: "11111111111111111111111111111111",
      }),
      rows: [],
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText(/RPC URL/i), {
      target: {
        value: "https://devnet.helius-rpc.com/?api-key=test",
      },
    });
    fireEvent.change(screen.getByLabelText(/Wallet Pubkey/i), {
      target: {
        value: "11111111111111111111111111111111",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Start scan/i }));

    await waitFor(() => {
      expect(mockedScanWalletHistory).toHaveBeenCalledTimes(1);
    });

    expect(mockedScanWalletHistory.mock.calls[0]?.[0]).toMatchObject({
      provider: "standard",
      scanMode: "standard",
    });
  });

  it("renders all findings as compact cards without summary text", async () => {
    const sixRows = Array.from({ length: 6 }, (_, index) => ({
      ...sampleRow,
      blockTime: (sampleRow.blockTime ?? 0) + index,
      explorerUrl: `https://explorer.solana.com/tx/sampleSig${index}`,
      signature: `${sampleRow.signature}${index}`,
      slot: sampleRow.slot + index,
    }));

    mockedScanWalletHistory.mockImplementation(
      async (inputs: ScanInputs, callbacks) => {
        callbacks.onProgress?.({
          ...createIdleProgress(inputs),
          elapsedMs: 0,
          mode: inputs.scanMode,
          phase: "scanning",
          provider: inputs.provider,
          startedAt: Date.now(),
          statusText: "Scanning history.",
        });

        const completedProgress = {
          ...createIdleProgress(inputs),
          elapsedMs: 250,
          finishedAt: Date.now(),
          matchesFound: sixRows.length,
          mode: inputs.scanMode,
          pagesFetched: 1,
          phase: "completed" as const,
          provider: inputs.provider,
          startedAt: Date.now() - 250,
          statusText: "Scan complete.",
          transactionsScanned: sixRows.length,
        };

        for (const row of sixRows) {
          callbacks.onMatch?.(row);
        }

        callbacks.onProgress?.(completedProgress);
        return {
          progress: completedProgress,
          rows: sixRows,
        };
      },
    );

    render(<App />);

    fireEvent.change(screen.getByLabelText(/RPC URL/i), {
      target: {
        value: "https://mainnet.helius-rpc.com/?api-key=test",
      },
    });
    fireEvent.change(screen.getByLabelText(/Wallet Pubkey/i), {
      target: {
        value: "11111111111111111111111111111111",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Start scan/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/^Delegation$/i)).toHaveLength(sixRows.length);
    });

    expect(screen.getAllByText(/^Succeeded$/i)).toHaveLength(sixRows.length);
    expect(
      screen.queryByText(/Approved delegation for 42 to Deleg/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /View all/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/^completed$/i)).toBeInTheDocument();
  });
});
