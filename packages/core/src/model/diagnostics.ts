/**
 * Protocol checks: read-only requests an adapter can send on the user's request to show how a
 * keyboard answers its protocol, for diagnostics and support requests. A check never changes the
 * keyboard, and its result keeps only the shape of the answer (report ID, length, whether the
 * command was echoed), never the payload, so it can go into a shared diagnostic package.
 */

/** A check an adapter offers, described before anything is sent. */
export interface ProtocolCheckInfo {
  id: string;
  title: string;
  /** The identifying bytes sent, upper-case hex (the rest of the report is zero). */
  command: string;
  /** Where the request comes from (vendor software, public source). */
  source: string;
  /** Always read-only: a check that changed the keyboard would not be a check. */
  effect: 'read-only';
}

export type ProtocolCheckStatus = 'answered' | 'no-answer' | 'unexpected' | 'error';

/** The shape of an answer, without its payload. */
export interface ProtocolReplyShape {
  reportId: number;
  /** Payload length in bytes (without the report ID). */
  length: number;
  /** The first payload byte repeated the command byte. */
  echo: boolean;
  /** First payload byte, hex: the command or status the keyboard answered with. */
  firstByte: string;
  /** How many payload bytes are not zero: tells an empty answer from a filled one. */
  nonZeroBytes: number;
}

export interface ProtocolCheckResult {
  id: string;
  title: string;
  command: string;
  source: string;
  status: ProtocolCheckStatus;
  reply?: ProtocolReplyShape;
  detail: string;
  at: string;
}

/** A driver that offers protocol checks (see `ProtocolCheckInfo`). */
export interface DiagnosticsDriver {
  listProtocolChecks(): readonly ProtocolCheckInfo[];
  runProtocolCheck(id: string): Promise<ProtocolCheckResult>;
}

export function isDiagnosticsDriver(d: unknown): d is DiagnosticsDriver {
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof (d as DiagnosticsDriver).listProtocolChecks === 'function' &&
    typeof (d as DiagnosticsDriver).runProtocolCheck === 'function'
  );
}

const hex2 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/** Reduces an answer to its shape. `bytes` is the payload without the report ID. */
export function replyShape(
  reportId: number,
  bytes: Uint8Array,
  command: number,
): ProtocolReplyShape {
  return {
    reportId,
    length: bytes.length,
    echo: bytes[0] === command,
    firstByte: hex2(bytes[0] ?? 0),
    nonZeroBytes: bytes.reduce((n, b) => n + (b !== 0 ? 1 : 0), 0),
  };
}
