import { describe, expect, it } from "vitest";
import { analyzeTransaction } from "./analyze";
import type { NormalizedTransaction, RpcParsedInstruction } from "./types";
import { buildExplorerUrl } from "./utils";

const RPC_URL = "https://api.mainnet-beta.solana.com";
const DEVNET_RPC_URL = "https://api.devnet.solana.com";
const DEVNET_NONCE_SETUP_SIGNATURE =
  "skkfzUQrZF2rcmrhAQV6SuLa7Hj3jPFu7cfXAHvkVep3Lk3fNSVypwULhqMRinsa6Zj5xjj8zKZBQ1agMxwuABZ";
const DEVNET_NONCE_SETUP_EXPLORER_URL =
  "https://explorer.solana.com/tx/skkfzUQrZF2rcmrhAQV6SuLa7Hj3jPFu7cfXAHvkVep3Lk3fNSVypwULhqMRinsa6Zj5xjj8zKZBQ1agMxwuABZ?cluster=devnet";

function createTransaction(
  overrides: Partial<NormalizedTransaction> = {},
  instructions: RpcParsedInstruction[] = [],
): NormalizedTransaction {
  return {
    blockTime: 1_735_689_600,
    confirmationStatus: "finalized",
    message: {
      accountKeys: [],
      instructions,
      recentBlockhash: "RecentBlockhash11111111111111111111111111",
    },
    meta: {
      err: null,
      innerInstructions: [],
    },
    signature:
      "5h6xBEauJ3PK6SWCZ1PGjBvj8vDdWG3KpwATGy1ARAXFSDwt8GFXM7W5Ncn16wmqokgpiKRLuS83KUxyZyv2sUYv",
    slot: 1054,
    status: "succeeded",
    ...overrides,
  };
}

describe("analyzeTransaction", () => {
  it("detects top-level token approval instructions", () => {
    const row = analyzeTransaction(
      createTransaction({}, [
        {
          parsed: {
            info: {
              delegate: "Deleg8H9c5mDV1A7v7UR4uuV4qx6dzM3D8zz111111111",
              mint: "So11111111111111111111111111111111111111112",
              owner: "Ownr111111111111111111111111111111111111111",
              source: "Tokn111111111111111111111111111111111111111",
              tokenAmount: {
                amount: "42000000",
                decimals: 6,
                uiAmountString: "42",
              },
            },
            type: "approve",
          },
          program: "spl-token",
          programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
      ]),
      RPC_URL,
    );

    expect(row).not.toBeNull();
    expect(row?.findings).toHaveLength(1);
    expect(row?.findings[0]?.kind).toBe("token-delegation");
    expect(row?.summary).toContain("Approved delegation for 42");
  });

  it("detects inner revoke instructions and marks failed attempts", () => {
    const row = analyzeTransaction(
      createTransaction(
        {
          meta: {
            err: { InstructionError: [0, "Custom"] },
            innerInstructions: [
              {
                index: 0,
                instructions: [
                  {
                    parsed: {
                      info: {
                        account: "Tokn111111111111111111111111111111111111111",
                      },
                      type: "revoke",
                    },
                    program: "spl-token",
                    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                  },
                ],
              },
            ],
          },
          status: "failed",
        },
        [
          {
            parsed: {
              info: {},
              type: "transfer",
            },
            program: "system",
            programId: "11111111111111111111111111111111",
          },
        ],
      ),
      RPC_URL,
    );

    expect(row).not.toBeNull();
    expect(row?.status).toBe("failed");
    expect(row?.summary).toContain("Failed attempt.");
    expect(row?.findings[0]?.instructionType).toBe("revoke");
    expect(row?.findings[0]?.source).toBe("inner");
  });

  it("detects durable nonce transactions when the first instruction advances a nonce", () => {
    const row = analyzeTransaction(
      createTransaction({}, [
        {
          parsed: {
            info: {
              nonceAccount: "9BvJtA8nmS1Q8nVxMVGQ6fpYhPMPgWNgYtYj5P3Bv6bG",
              nonceAuthority: "8fTANFJ6cW4vJH6kUnQr2M5R9nJ2mD7FuRhRrNQYw2kK",
            },
            type: "advanceNonceAccount",
          },
          program: "system",
          programId: "11111111111111111111111111111111",
        },
      ]),
      RPC_URL,
    );

    expect(row).not.toBeNull();
    expect(row?.findings[0]?.kind).toBe("durable-nonce");
    expect(row?.summary).toContain("durable nonce");
  });

  it("does not treat the provided devnet nonce-account setup transaction as durable nonce usage", () => {
    const row = analyzeTransaction(
      createTransaction(
        {
          signature: DEVNET_NONCE_SETUP_SIGNATURE,
        },
        [
          {
            parsed: {
              info: {},
              type: "createAccount",
            },
            program: "system",
            programId: "11111111111111111111111111111111",
          },
          {
            parsed: {
              info: {
                nonceAccount: "9BvJtA8nmS1Q8nVxMVGQ6fpYhPMPgWNgYtYj5P3Bv6bG",
              },
              type: "initializeNonceAccount",
            },
            program: "system",
            programId: "11111111111111111111111111111111",
          },
        ],
      ),
      DEVNET_RPC_URL,
    );

    expect(row).toBeNull();
  });

  it("builds the expected explorer link for the provided devnet nonce example", () => {
    expect(buildExplorerUrl(DEVNET_NONCE_SETUP_SIGNATURE, DEVNET_RPC_URL)).toBe(
      DEVNET_NONCE_SETUP_EXPLORER_URL,
    );
  });
});
