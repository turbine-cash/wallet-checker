import { afterEach, describe, expect, it, vi } from "vitest";
import { scanWalletHistory } from "./scan";
import type { ScanInputs } from "./types";

function createJsonRpcResponse(result: unknown): Response {
  return new Response(
    JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      result,
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
      status: 200,
    },
  );
}

function createJsonRpcErrorResponse(code: number, message: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
      },
      id: 1,
      jsonrpc: "2.0",
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
      status: 200,
    },
  );
}

describe("scanWalletHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hydrates standard RPC history with before pagination", async () => {
    const requests: Array<{ method: string; params: unknown[] }> = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          method: string;
          params: unknown[];
        };

        requests.push(request);

        if (request.method === "getSignaturesForAddress") {
          const config = request.params[1] as { before?: string };

          return createJsonRpcResponse(
            config?.before
              ? []
              : [
                  {
                    blockTime: 1_735_689_600,
                    confirmationStatus: "finalized",
                    err: null,
                    memo: null,
                    signature: "sigA",
                    slot: 111,
                  },
                  {
                    blockTime: 1_735_689_601,
                    confirmationStatus: "finalized",
                    err: null,
                    memo: null,
                    signature: "sigB",
                    slot: 110,
                  },
                ],
          );
        }

        if (request.method === "getTransaction") {
          const [signature] = request.params as [string];

          return createJsonRpcResponse(
            signature === "sigA"
              ? {
                  blockTime: 1_735_689_600,
                  meta: { err: null, innerInstructions: [] },
                  slot: 111,
                  transaction: {
                    message: {
                      accountKeys: [],
                      instructions: [
                        {
                          parsed: {
                            info: {
                              delegate:
                                "Deleg8H9c5mDV1A7v7UR4uuV4qx6dzM3D8zz111111111",
                              source:
                                "Tokn111111111111111111111111111111111111111",
                            },
                            type: "approve",
                          },
                          program: "spl-token",
                          programId:
                            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                        },
                      ],
                    },
                    signatures: [signature],
                  },
                }
              : {
                  blockTime: 1_735_689_601,
                  meta: { err: null, innerInstructions: [] },
                  slot: 110,
                  transaction: {
                    message: {
                      accountKeys: [],
                      instructions: [
                        {
                          parsed: {
                            info: {},
                            type: "transfer",
                          },
                          program: "system",
                          programId: "11111111111111111111111111111111",
                        },
                      ],
                    },
                    signatures: [signature],
                  },
                },
          );
        }

        throw new Error(`Unexpected RPC method ${request.method}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    const inputs: ScanInputs = {
      provider: "standard",
      rpcUrl: "https://api.mainnet-beta.solana.com",
      scanMode: "standard",
      walletPubkey: "11111111111111111111111111111111",
    };

    const result = await scanWalletHistory(inputs, {
      signal: new AbortController().signal,
      standardPageSize: 2,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.progress.transactionsScanned).toBe(2);
    expect(result.progress.pagesFetched).toBe(1);
    const followUpPaginationRequest = requests.find(
      (request) =>
        request.method === "getSignaturesForAddress" &&
        (request.params[1] as { before?: string })?.before === "sigB",
    );

    expect(followUpPaginationRequest).toBeDefined();
  });

  it("uses Helius full transaction pages with token account coverage", async () => {
    const requests: Array<{ method: string; params: unknown[] }> = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          method: string;
          params: unknown[];
        };

        requests.push(request);

        const config = request.params[1] as {
          paginationToken?: string;
          filters: { tokenAccounts: string };
          transactionDetails: string;
        };

        return createJsonRpcResponse(
          config.paginationToken
            ? { data: [], paginationToken: null }
            : {
                data: [
                  {
                    blockTime: 1_735_689_600,
                    confirmationStatus: "finalized",
                    err: null,
                    memo: null,
                    meta: { err: null, innerInstructions: [] },
                    signature: "heliusSig",
                    slot: 222,
                    transaction: {
                      message: {
                        accountKeys: [],
                        instructions: [
                          {
                            parsed: {
                              info: {
                                nonceAccount:
                                  "9BvJtA8nmS1Q8nVxMVGQ6fpYhPMPgWNgYtYj5P3Bv6bG",
                              },
                              type: "advanceNonceAccount",
                            },
                            program: "system",
                            programId: "11111111111111111111111111111111",
                          },
                        ],
                      },
                      signatures: ["heliusSig"],
                    },
                  },
                ],
                paginationToken: "222:1",
              },
        );
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    const inputs: ScanInputs = {
      provider: "helius",
      rpcUrl: "https://mainnet.helius-rpc.com/?api-key=test",
      scanMode: "helius",
      walletPubkey: "11111111111111111111111111111111",
    };

    const result = await scanWalletHistory(inputs, {
      signal: new AbortController().signal,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.progress.transactionsScanned).toBe(1);
    expect(
      (
        requests[0]?.params[1] as {
          filters: { tokenAccounts: string };
          transactionDetails: string;
        }
      ).filters.tokenAccounts,
    ).toBe("all");
    expect(
      (
        requests[0]?.params[1] as {
          filters: { tokenAccounts: string };
          transactionDetails: string;
        }
      ).transactionDetails,
    ).toBe("full");
    expect(
      (requests[1]?.params[1] as { paginationToken?: string }).paginationToken,
    ).toBe("222:1");
  });

  it("falls back to standard scanning after a terminal Helius failure", async () => {
    const requests: Array<{ method: string; params: unknown[] }> = [];
    const progressUpdates: string[] = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          method: string;
          params: unknown[];
        };

        requests.push(request);

        if (request.method === "getTransactionsForAddress") {
          return createJsonRpcErrorResponse(-32601, "Method not found");
        }

        if (request.method === "getSignaturesForAddress") {
          const config = request.params[1] as { before?: string };

          return createJsonRpcResponse(
            config?.before
              ? []
              : [
                  {
                    blockTime: 1_735_689_600,
                    confirmationStatus: "finalized",
                    err: null,
                    memo: null,
                    signature: "sigFallback",
                    slot: 333,
                  },
                ],
          );
        }

        if (request.method === "getTransaction") {
          return createJsonRpcResponse({
            blockTime: 1_735_689_600,
            meta: { err: null, innerInstructions: [] },
            slot: 333,
            transaction: {
              message: {
                accountKeys: [],
                instructions: [
                  {
                    parsed: {
                      info: {
                        delegate:
                          "Deleg8H9c5mDV1A7v7UR4uuV4qx6dzM3D8zz111111111",
                        source: "Tokn111111111111111111111111111111111111111",
                      },
                      type: "approve",
                    },
                    program: "spl-token",
                    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                  },
                ],
              },
              signatures: ["sigFallback"],
            },
          });
        }

        throw new Error(`Unexpected RPC method ${request.method}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    const inputs: ScanInputs = {
      provider: "helius",
      rpcUrl: "https://mainnet.helius-rpc.com/?api-key=test",
      scanMode: "helius",
      walletPubkey: "11111111111111111111111111111111",
    };

    const result = await scanWalletHistory(inputs, {
      onProgress: (progress) => {
        progressUpdates.push(progress.statusText);
      },
      signal: new AbortController().signal,
      standardPageSize: 1,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.progress.mode).toBe("standard");
    expect(progressUpdates).toContain("Continuing with standard scan.");
    expect(requests.map((request) => request.method)).toEqual([
      "getTransactionsForAddress",
      "getSignaturesForAddress",
      "getTransaction",
      "getSignaturesForAddress",
    ]);
  });
});
