const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const BASE58_LOOKUP = new Map(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);

export function isValidRpcUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isHeliusRpcUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      host.includes("helius-rpc.com") ||
      host.includes("helius.dev") ||
      host.includes("helius.xyz")
    );
  } catch {
    return false;
  }
}

export function inferClusterFromRpcUrl(
  value: string,
): "devnet" | "testnet" | "mainnet-beta" {
  try {
    const url = new URL(value);
    const haystack =
      `${url.hostname}${url.pathname}${url.search}`.toLowerCase();

    if (haystack.includes("devnet")) {
      return "devnet";
    }

    if (haystack.includes("testnet")) {
      return "testnet";
    }
  } catch {
    return "mainnet-beta";
  }

  return "mainnet-beta";
}

export function buildExplorerUrl(signature: string, rpcUrl: string): string {
  const cluster = inferClusterFromRpcUrl(rpcUrl);
  const baseUrl = `https://explorer.solana.com/tx/${signature}`;

  return cluster === "mainnet-beta" ? baseUrl : `${baseUrl}?cluster=${cluster}`;
}

export function shortenAddress(value: string | null | undefined): string {
  if (!value) {
    return "unknown";
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function decodeBase58(value: string): Uint8Array {
  if (value.length === 0) {
    throw new Error("Base58 value cannot be empty.");
  }

  const bytes: number[] = [];

  for (const character of value) {
    const digit = BASE58_LOOKUP.get(character);

    if (digit === undefined) {
      throw new Error(`Invalid base58 character: ${character}`);
    }

    let carry = digit;

    for (let index = 0; index < bytes.length; index += 1) {
      const current = bytes[index]! * 58 + carry;
      bytes[index] = current & 0xff;
      carry = current >> 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeroCount = 0;

  for (const character of value) {
    if (character !== "1") {
      break;
    }

    leadingZeroCount += 1;
  }

  const decoded = new Uint8Array(leadingZeroCount + bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    decoded[decoded.length - 1 - index] = bytes[index]!;
  }

  return decoded;
}

export function isValidSolanaPubkey(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length < 32 || trimmed.length > 44) {
    return false;
  }

  if (!/^[1-9A-HJ-NP-Za-km-z]+$/u.test(trimmed)) {
    return false;
  }

  try {
    return decodeBase58(trimmed).length === 32;
  } catch {
    return false;
  }
}

export function formatDateTime(blockTime: number | null): string {
  if (!blockTime) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(blockTime * 1000);
}

export function formatCompactDate(blockTime: number | null): string {
  if (!blockTime) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(blockTime * 1000);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export function formatTokenAmount(
  amount: string | number | null | undefined,
): string | null {
  if (amount === null || amount === undefined || amount === "") {
    return null;
  }

  const normalized =
    typeof amount === "number" ? amount.toString() : amount.trim();

  if (normalized.length === 0) {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/u.test(normalized)) {
    const numericValue = Number(normalized);

    if (Number.isFinite(numericValue)) {
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 9,
      }).format(numericValue);
    }
  }

  return normalized;
}

export function classNames(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}
