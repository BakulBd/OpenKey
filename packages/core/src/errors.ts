/**
 * Explicit error model. Every error carries a stable `code` so UIs and the CLI can map it to a
 * human-readable explanation without string matching.
 */

export type OpenKeyErrorCode =
  | 'DEVICE_NOT_FOUND'
  | 'UNSUPPORTED_DEVICE'
  | 'UNSUPPORTED_PROTOCOL'
  | 'UNSUPPORTED_FEATURE'
  | 'TRANSPORT'
  | 'PERMISSION'
  | 'PROTOCOL'
  | 'TIMEOUT'
  | 'MALFORMED_RESPONSE'
  | 'FIRMWARE_MISMATCH'
  | 'CAPABILITY_MISMATCH'
  | 'TFT_UPLOAD'
  | 'SAFETY_BLOCKED'
  | 'READBACK_MISMATCH'
  | 'WEBHID_UNAVAILABLE';

export class OpenKeyError extends Error {
  readonly code: OpenKeyErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: OpenKeyErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class DeviceNotFoundError extends OpenKeyError {
  constructor(
    message = 'No supported keyboard was found.',
    details: Record<string, unknown> = {},
  ) {
    super('DEVICE_NOT_FOUND', message, details);
  }
}

export class UnsupportedDeviceError extends OpenKeyError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('UNSUPPORTED_DEVICE', message, details);
  }
}

export class UnsupportedProtocolError extends OpenKeyError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('UNSUPPORTED_PROTOCOL', message, details);
  }
}

export class UnsupportedFeatureError extends OpenKeyError {
  readonly feature: string;
  constructor(feature: string, reason: string, details: Record<string, unknown> = {}) {
    super('UNSUPPORTED_FEATURE', `${feature} is not supported: ${reason}`, { feature, ...details });
    this.feature = feature;
  }
}

export class TransportError extends OpenKeyError {
  constructor(message: string, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super('TRANSPORT', message, details, options);
  }
}

export class PermissionError extends OpenKeyError {
  constructor(message: string, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super('PERMISSION', message, details, options);
  }
}

export class ProtocolError extends OpenKeyError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('PROTOCOL', message, details);
  }
}

export class TimeoutError extends OpenKeyError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('TIMEOUT', message, details);
  }
}

export class MalformedResponseError extends OpenKeyError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('MALFORMED_RESPONSE', message, details);
  }
}

export class FirmwareMismatchError extends OpenKeyError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('FIRMWARE_MISMATCH', message, details);
  }
}

export class CapabilityMismatchError extends OpenKeyError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('CAPABILITY_MISMATCH', message, details);
  }
}

export class TftUploadError extends OpenKeyError {
  constructor(message: string, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super('TFT_UPLOAD', message, details, options);
  }
}

/** Raised when an operation is refused by the safety policy (e.g. an unverified write). */
export class SafetyBlockedError extends OpenKeyError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('SAFETY_BLOCKED', message, details);
  }
}

export class WebHidUnavailableError extends OpenKeyError {
  constructor(message = 'WebHID is not available in this browser.') {
    super('WEBHID_UNAVAILABLE', message);
  }
}

export function isOpenKeyError(e: unknown): e is OpenKeyError {
  return e instanceof OpenKeyError;
}

export class ReadbackMismatchError extends OpenKeyError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('READBACK_MISMATCH', message, details);
  }
}

export type ErrorKind =
  | OpenKeyErrorCode
  | 'UNSUPPORTED_BROWSER'
  | 'DEVICE_IN_USE'
  | 'DEVICE_DISCONNECTED'
  | 'UNEXPECTED';

export interface ErrorExplanation {
  /** Stable key for translations and tests. */
  kind: ErrorKind;
  /** What happened. */
  title: string;
  detail: string;
  /** Likely reason. */
  reason?: string;
  /** Next action for the user. */
  hint?: string;
}

const EXPLAIN: Partial<Record<ErrorKind, { title: string; reason?: string; hint?: string }>> = {
  DEVICE_NOT_FOUND: {
    title: 'Keyboard not found',
    reason: 'No HID device matching a known keyboard was offered, or the cable is charge-only.',
    hint: 'Connect the keyboard with a USB data cable and set its mode switch to wired. Most keyboards cannot be configured over Bluetooth.',
  },
  PERMISSION: {
    title: 'Permission denied',
    reason: 'The browser or operating system did not grant access to the device.',
    hint: 'On Linux install the OpenKey udev rule (udev/99-openkey.rules) and replug the keyboard. In the browser, pick the device again in the chooser.',
  },
  TRANSPORT: {
    title: 'Communication failed',
    reason: 'The keyboard is busy, claimed by another program, or was unplugged.',
    hint: 'Close the vendor software and other configurator tabs, then replug the keyboard.',
  },
  TIMEOUT: {
    title: 'The keyboard did not answer in time',
    reason: 'The firmware is busy or this interface does not answer this command.',
    hint: 'Replug the keyboard and try again.',
  },
  PROTOCOL: {
    title: 'Protocol error',
    reason: 'The keyboard answered with something this adapter does not expect.',
    hint: 'Export a diagnostic package from the Research Lab and attach it to an issue.',
  },
  MALFORMED_RESPONSE: {
    title: 'Malformed response',
    reason: 'Wrong length, wrong report ID or a checksum error in the keyboard’s answer.',
    hint: 'Replug the keyboard. If it persists, export a diagnostic package.',
  },
  FIRMWARE_MISMATCH: {
    title: 'Firmware mismatch',
    reason: 'This firmware revision has not been tested with this adapter.',
    hint: 'Writes stay disabled. Export a diagnostic package to help add support.',
  },
  CAPABILITY_MISMATCH: {
    title: 'Capability mismatch',
    reason: 'The device does not offer what its definition declares.',
    hint: 'Export a diagnostic package and report it.',
  },
  READBACK_MISMATCH: {
    title: 'Read-back mismatch',
    reason: 'The device reports different values than were written.',
    hint: 'Do not write again. Export a diagnostic package and report it; restore a backup if needed.',
  },
  TFT_UPLOAD: { title: 'Screen upload failed', hint: 'Replug the keyboard; it keeps its previous image when an upload is interrupted.' },
  UNSUPPORTED_FEATURE: { title: 'Feature not available' },
  UNSUPPORTED_DEVICE: {
    title: 'Unsupported keyboard or firmware',
    reason: 'No adapter is verified for this device.',
    hint: 'Open the Research Lab, inspect the device safely and export a diagnostic package to request support.',
  },
  UNSUPPORTED_PROTOCOL: {
    title: 'Protocol mismatch',
    reason: 'The device does not speak the protocol its identity suggests.',
    hint: 'Export a diagnostic package to request support.',
  },
  SAFETY_BLOCKED: { title: 'Blocked by safety policy', reason: 'The operation is unverified or high risk.' },
  WEBHID_UNAVAILABLE: {
    title: 'WebHID unavailable',
    reason: 'This browser does not implement WebHID, or the page is not in a secure context.',
    hint: 'Use a Chromium-based browser (Chrome, Edge, Opera, Brave) over HTTPS or http://localhost. Try the demo meanwhile.',
  },
  UNSUPPORTED_BROWSER: {
    title: 'Unsupported browser',
    reason: 'WebHID is available only in Chromium-based desktop browsers.',
    hint: 'Open OpenKey in Chrome, Edge, Opera or Brave on a desktop OS.',
  },
  DEVICE_IN_USE: {
    title: 'Device already in use',
    reason: 'Another tab, the vendor software or a Linux driver holds the interface.',
    hint: 'Close other configurator tabs and the vendor software, then reconnect.',
  },
  DEVICE_DISCONNECTED: {
    title: 'Device disconnected',
    reason: 'The keyboard was unplugged, went to sleep, or switched to wireless.',
    hint: 'Reconnect it by cable; nothing is written automatically on reconnect.',
  },
};

/** Maps a raw WebHID DOMException to an error kind. */
function domExceptionKind(e: { name: string; message: string }): ErrorKind | undefined {
  switch (e.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'PERMISSION';
    case 'NotFoundError':
      return 'DEVICE_NOT_FOUND';
    case 'InvalidStateError':
      return /open|claim|use/i.test(e.message) ? 'DEVICE_IN_USE' : 'DEVICE_DISCONNECTED';
    case 'NetworkError':
      return 'DEVICE_DISCONNECTED';
    case 'NotSupportedError':
      return 'UNSUPPORTED_BROWSER';
    default:
      return undefined;
  }
}

/** Human-readable explanation for UIs and the CLI: what happened, likely reason, next action. */
export function explainError(e: unknown): ErrorExplanation {
  let kind: ErrorKind = 'UNEXPECTED';
  if (isOpenKeyError(e)) kind = e.code;
  else if (typeof e === 'object' && e !== null && 'name' in e && 'message' in e)
    kind = domExceptionKind(e as { name: string; message: string }) ?? 'UNEXPECTED';
  const detail = e instanceof Error ? e.message : String(e);
  const x = EXPLAIN[kind];
  if (!x) return { kind, title: isOpenKeyError(e) ? e.name : 'Unexpected error', detail };
  return { kind, title: x.title, detail, ...(x.reason ? { reason: x.reason } : {}), ...(x.hint ? { hint: x.hint } : {}) };
}
