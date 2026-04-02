export type ProviderKind = "helius" | "standard";

export type ScanMode = "helius" | "standard";

export type ScanPhase =
  | "idle"
  | "validating"
  | "scanning"
  | "completed"
  | "aborted"
  | "error";

export type FindingKind = "token-delegation" | "durable-nonce";

export type FindingSource = "top-level" | "inner";

export type ScanStatus = "succeeded" | "failed";

export interface ScanInputs {
  rpcUrl: string;
  walletPubkey: string;
  provider: ProviderKind;
  scanMode: ScanMode;
}

export interface ScanProgress {
  phase: ScanPhase;
  provider: ProviderKind;
  mode: ScanMode;
  statusText: string;
  pagesFetched: number;
  transactionsScanned: number;
  matchesFound: number;
  retries: number;
  requestErrors: number;
  startedAt: number | null;
  finishedAt: number | null;
  elapsedMs: number;
  cursor: string | null;
}

export interface BaseFinding {
  kind: FindingKind;
  instructionType: string;
  label: string;
  detail: string;
  source: FindingSource;
}

export interface TokenDelegationFinding extends BaseFinding {
  kind: "token-delegation";
  delegate: string | null;
  owner: string | null;
  mint: string | null;
  tokenAccount: string | null;
  amount: string | null;
  programName: string;
}

export interface DurableNonceFinding extends BaseFinding {
  kind: "durable-nonce";
  nonceAccount: string | null;
  nonceAuthority: string | null;
}

export type Finding = TokenDelegationFinding | DurableNonceFinding;

export interface FindingRow {
  signature: string;
  slot: number;
  blockTime: number | null;
  status: ScanStatus;
  confirmationStatus: string | null;
  summary: string;
  findings: Finding[];
  explorerUrl: string;
}

export interface RpcSignatureInfo {
  signature: string;
  slot: number;
  err: unknown;
  memo: string | null;
  blockTime: number | null;
  confirmationStatus: string | null;
}

export interface RpcParsedInfo {
  type?: string;
  info?: Record<string, unknown>;
}

export interface RpcParsedInstruction {
  program?: string;
  programId?: string;
  parsed?: RpcParsedInfo;
  accounts?: string[];
  data?: string;
  stackHeight?: number | null;
}

export interface RpcInnerInstructionGroup {
  index: number;
  instructions: RpcParsedInstruction[];
}

export interface RpcAccountKeyInfo {
  pubkey: string;
  signer?: boolean;
  writable?: boolean;
  source?: string;
}

export interface RpcParsedMessage {
  accountKeys: Array<string | RpcAccountKeyInfo>;
  instructions: RpcParsedInstruction[];
  recentBlockhash?: string;
}

export interface RpcTransactionMeta {
  err: unknown;
  innerInstructions?: RpcInnerInstructionGroup[] | null;
  preBalances?: number[];
  postBalances?: number[];
  preTokenBalances?: unknown[];
  postTokenBalances?: unknown[];
  logMessages?: string[] | null;
}

export interface RpcTransactionEnvelope {
  signatures: string[];
  message: RpcParsedMessage;
}

export interface RpcTransactionResponse {
  slot: number;
  blockTime: number | null;
  meta: RpcTransactionMeta | null;
  transaction: RpcTransactionEnvelope | null;
  version?: number | "legacy";
}

export interface HeliusTransactionEntry {
  signature?: string;
  slot: number;
  transactionIndex?: number;
  err: unknown;
  memo: string | null;
  blockTime: number | null;
  confirmationStatus: string | null;
  meta: RpcTransactionMeta | null;
  transaction: RpcTransactionEnvelope | null;
  version?: number | "legacy";
}

export interface HeliusTransactionsPage {
  data: HeliusTransactionEntry[];
  paginationToken: string | null;
}

export interface NormalizedTransaction {
  signature: string;
  slot: number;
  blockTime: number | null;
  confirmationStatus: string | null;
  status: ScanStatus;
  meta: RpcTransactionMeta | null;
  message: RpcParsedMessage;
}

export interface ScanCallbacks {
  signal: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
  onMatch?: (row: FindingRow) => void;
  standardConcurrency?: number;
  standardPageSize?: number;
  heliusPageSize?: number;
  maxRetries?: number;
}

export interface ScanResult {
  rows: FindingRow[];
  progress: ScanProgress;
}
