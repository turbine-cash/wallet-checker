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

  it("enables Helius full mode only for Helius RPC URLs", () => {
    render(<App />);

    const heliusButton = screen.getByRole("button", {
      name: /Helius full transactions/i,
    });
    const rpcInput = screen.getByLabelText(/RPC URL/i);

    expect(heliusButton).toBeDisabled();

    fireEvent.change(rpcInput, {
      target: {
        value: "https://mainnet.helius-rpc.com/?api-key=test",
      },
    });

    expect(heliusButton).not.toBeDisabled();
  });

  it("renders findings returned by the scan", async () => {
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
        callbacks.onMatch?.(sampleRow);

        const completedProgress = {
          ...createIdleProgress(inputs),
          elapsedMs: 250,
          finishedAt: Date.now(),
          matchesFound: 1,
          mode: inputs.scanMode,
          pagesFetched: 1,
          phase: "completed" as const,
          provider: inputs.provider,
          startedAt: Date.now() - 250,
          statusText: "Scan complete.",
          transactionsScanned: 1,
        };

        callbacks.onProgress?.(completedProgress);

        return {
          progress: completedProgress,
          rows: [sampleRow],
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
      expect(
        screen.getByText(/Approved delegation for 42 to Deleg/i),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/5h6x...sUYv/i)).toBeInTheDocument();
    expect(screen.getByText(/Scan complete./i)).toBeInTheDocument();
  });
});
