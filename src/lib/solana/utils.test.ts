import { describe, expect, it } from "vitest";
import { resolveRpcRouting } from "./utils";

describe("resolveRpcRouting", () => {
  it("routes only the exact mainnet Helius host to the fast path", () => {
    expect(
      resolveRpcRouting("https://mainnet.helius-rpc.com/?api-key=test"),
    ).toEqual({
      provider: "helius",
      scanMode: "helius",
    });
  });

  it("treats devnet Helius and custom hosts as standard scans", () => {
    expect(
      resolveRpcRouting("https://devnet.helius-rpc.com/?api-key=test"),
    ).toEqual({
      provider: "standard",
      scanMode: "standard",
    });
    expect(resolveRpcRouting("https://rpc.example.com/?api-key=test")).toEqual({
      provider: "standard",
      scanMode: "standard",
    });
  });
});
