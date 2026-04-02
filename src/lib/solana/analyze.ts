import type {
  DurableNonceFinding,
  Finding,
  FindingRow,
  HeliusTransactionEntry,
  NormalizedTransaction,
  RpcParsedInfo,
  RpcParsedInstruction,
  RpcSignatureInfo,
  RpcTransactionResponse,
  TokenDelegationFinding,
} from "./types";
import { buildExplorerUrl, formatTokenAmount, shortenAddress } from "./utils";

const SPL_TOKEN_PROGRAM_IDS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);

const TOKEN_PROGRAM_NAMES = new Set([
  "spl-token",
  "spl-token-2022",
  "token",
  "token-2022",
]);

const TOKEN_DELEGATION_TYPES = new Set(["approve", "approvechecked", "revoke"]);

const DURABLE_NONCE_TYPES = new Set([
  "advancenonce",
  "advancenonceaccount",
  "nonceadvance",
]);

function toLowerCase(value: string | null | undefined): string | null {
  return value ? value.toLowerCase() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getInstructionType(parsed: RpcParsedInfo | undefined): string | null {
  if (!parsed?.type) {
    return null;
  }

  return parsed.type.trim();
}

function getInstructionInfo(
  instruction: RpcParsedInstruction,
): Record<string, unknown> | null {
  return isRecord(instruction.parsed?.info) ? instruction.parsed.info : null;
}

function getProgramName(instruction: RpcParsedInstruction): string {
  return (
    instruction.program?.trim() || instruction.programId?.trim() || "unknown"
  );
}

function isTokenProgram(instruction: RpcParsedInstruction): boolean {
  const program = toLowerCase(instruction.program);
  const programId = instruction.programId?.trim();

  return (
    (program !== null && TOKEN_PROGRAM_NAMES.has(program)) ||
    (programId !== undefined && SPL_TOKEN_PROGRAM_IDS.has(programId))
  );
}

function isSystemProgram(instruction: RpcParsedInstruction): boolean {
  const program = toLowerCase(instruction.program);
  return (
    program === "system" ||
    instruction.programId === "11111111111111111111111111111111"
  );
}

function extractString(
  source: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!source) {
    return null;
  }

  for (const key of keys) {
    const candidate = source[key];

    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

function extractTokenAmount(
  source: Record<string, unknown> | null,
): string | null {
  if (!source) {
    return null;
  }

  const tokenAmount = source.tokenAmount;

  if (isRecord(tokenAmount)) {
    const uiAmountString = tokenAmount.uiAmountString;
    const uiAmount = tokenAmount.uiAmount;
    const rawAmount = tokenAmount.amount;

    if (typeof uiAmountString === "string" && uiAmountString.length > 0) {
      return formatTokenAmount(uiAmountString);
    }

    if (typeof uiAmount === "number") {
      return formatTokenAmount(uiAmount);
    }

    if (typeof rawAmount === "string") {
      return formatTokenAmount(rawAmount);
    }
  }

  return formatTokenAmount(
    extractString(source, ["amount", "tokenAmountUiAmount", "delegatedAmount"]),
  );
}

function createTokenDelegationFinding(
  instruction: RpcParsedInstruction,
  source: "top-level" | "inner",
): TokenDelegationFinding | null {
  if (!isTokenProgram(instruction)) {
    return null;
  }

  const instructionType = toLowerCase(getInstructionType(instruction.parsed));

  if (!instructionType || !TOKEN_DELEGATION_TYPES.has(instructionType)) {
    return null;
  }

  const info = getInstructionInfo(instruction);
  const delegate = extractString(info, ["delegate", "newDelegate"]);
  const owner = extractString(info, ["owner", "sourceOwner", "multisigOwner"]);
  const tokenAccount = extractString(info, [
    "source",
    "account",
    "tokenAccount",
  ]);
  const mint = extractString(info, ["mint"]);
  const amount = extractTokenAmount(info);
  const isApproval = instructionType.startsWith("approve");
  const action = instructionType === "revoke" ? "Revoked" : "Approved";
  const targetLabel =
    tokenAccount !== null
      ? shortenAddress(tokenAccount)
      : mint !== null
        ? shortenAddress(mint)
        : "token account";
  const amountLabel = amount ? ` for ${amount}` : "";
  const delegateLabel = delegate ? ` to ${shortenAddress(delegate)}` : "";
  const detail =
    instructionType === "revoke"
      ? `Revoked delegation on ${targetLabel}.`
      : `${action}${instructionType === "approvechecked" ? " checked" : ""} delegation${amountLabel}${delegateLabel} on ${targetLabel}.`;

  return {
    amount,
    delegate,
    detail,
    instructionType,
    kind: "token-delegation",
    label: isApproval ? "Delegation" : "Revoke",
    mint,
    owner,
    programName: getProgramName(instruction),
    source,
    tokenAccount,
  };
}

function createDurableNonceFinding(
  instruction: RpcParsedInstruction,
): DurableNonceFinding | null {
  if (!isSystemProgram(instruction)) {
    return null;
  }

  const instructionType = toLowerCase(getInstructionType(instruction.parsed));

  if (!instructionType || !DURABLE_NONCE_TYPES.has(instructionType)) {
    return null;
  }

  const info = getInstructionInfo(instruction);
  const nonceAccount = extractString(info, [
    "nonceAccount",
    "authorizedNonceAccount",
    "account",
  ]);
  const nonceAuthority = extractString(info, [
    "nonceAuthority",
    "authorizedPubkey",
    "authority",
  ]);

  return {
    detail: `Used a durable nonce via ${shortenAddress(nonceAccount)}.`,
    instructionType,
    kind: "durable-nonce",
    label: "Durable nonce",
    nonceAccount,
    nonceAuthority,
    source: "top-level",
  };
}

function buildSummary(
  status: NormalizedTransaction["status"],
  findings: Finding[],
): string {
  const summary = findings.map((finding) => finding.detail).join(" ");

  return status === "failed" ? `Failed attempt. ${summary}` : summary;
}

export function normalizeStandardTransaction(
  signatureInfo: RpcSignatureInfo,
  transaction: RpcTransactionResponse | null,
): NormalizedTransaction | null {
  if (!transaction?.transaction?.message) {
    return null;
  }

  const signature =
    transaction.transaction.signatures[0] ?? signatureInfo.signature;

  return {
    blockTime: transaction.blockTime ?? signatureInfo.blockTime,
    confirmationStatus: signatureInfo.confirmationStatus,
    message: transaction.transaction.message,
    meta: transaction.meta,
    signature,
    slot: transaction.slot ?? signatureInfo.slot,
    status: transaction.meta?.err ? "failed" : "succeeded",
  };
}

export function normalizeHeliusTransaction(
  entry: HeliusTransactionEntry,
): NormalizedTransaction | null {
  if (!entry.transaction?.message) {
    return null;
  }

  const signature = entry.signature ?? entry.transaction.signatures[0];

  if (!signature) {
    return null;
  }

  return {
    blockTime: entry.blockTime,
    confirmationStatus: entry.confirmationStatus,
    message: entry.transaction.message,
    meta: entry.meta,
    signature,
    slot: entry.slot,
    status: entry.err || entry.meta?.err ? "failed" : "succeeded",
  };
}

export function analyzeTransaction(
  transaction: NormalizedTransaction,
  rpcUrl: string,
): FindingRow | null {
  const findings: Finding[] = [];
  const [firstInstruction] = transaction.message.instructions;

  if (firstInstruction) {
    const durableNonceFinding = createDurableNonceFinding(firstInstruction);

    if (durableNonceFinding) {
      findings.push(durableNonceFinding);
    }
  }

  for (const instruction of transaction.message.instructions) {
    const finding = createTokenDelegationFinding(instruction, "top-level");

    if (finding) {
      findings.push(finding);
    }
  }

  for (const group of transaction.meta?.innerInstructions ?? []) {
    for (const instruction of group.instructions ?? []) {
      const finding = createTokenDelegationFinding(instruction, "inner");

      if (finding) {
        findings.push(finding);
      }
    }
  }

  if (findings.length === 0) {
    return null;
  }

  return {
    blockTime: transaction.blockTime,
    confirmationStatus: transaction.confirmationStatus,
    explorerUrl: buildExplorerUrl(transaction.signature, rpcUrl),
    findings,
    signature: transaction.signature,
    slot: transaction.slot,
    status: transaction.status,
    summary: buildSummary(transaction.status, findings),
  };
}
