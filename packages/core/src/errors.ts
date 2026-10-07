/**
 * Explicit error model. Every error carries a stable `code` so UIs and the CLI can map it to a
 * human-readable explanation without string matching.
 */

export type OpenAk820ErrorCode =
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
  | 'WEBHID_UNAVAILABLE';

export class OpenAk820Error extends Error {
  readonly code: OpenAk820ErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: OpenAk820ErrorCode,
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

export class DeviceNotFoundError extends OpenAk820Error {
  constructor(
    message = 'No supported AK820-family keyboard was found.',
    details: Record<string, unknown> = {},
  ) {
    super('DEVICE_NOT_FOUND', message, details);
  }
}

export class UnsupportedDeviceError extends OpenAk820Error {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('UNSUPPORTED_DEVICE', message, details);
  }
}

export class UnsupportedProtocolError extends OpenAk820Error {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('UNSUPPORTED_PROTOCOL', message, details);
  }
}

export class UnsupportedFeatureError extends OpenAk820Error {
  readonly feature: string;
  constructor(feature: string, reason: string, details: Record<string, unknown> = {}) {
    super('UNSUPPORTED_FEATURE', `${feature} is not supported: ${reason}`, { feature, ...details });
    this.feature = feature;
  }
}

export class TransportError extends OpenAk820Error {
  constructor(message: string, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super('TRANSPORT', message, details, options);
  }
}

export class PermissionError extends OpenAk820Error {
  constructor(message: string, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super('PERMISSION', message, details, options);
  }
}

export class ProtocolError extends OpenAk820Error {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('PROTOCOL', message, details);
  }
}

export class TimeoutError extends OpenAk820Error {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('TIMEOUT', message, details);
  }
}

export class MalformedResponseError extends OpenAk820Error {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('MALFORMED_RESPONSE', message, details);
  }
}

export class FirmwareMismatchError extends OpenAk820Error {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('FIRMWARE_MISMATCH', message, details);
  }
}

export class CapabilityMismatchError extends OpenAk820Error {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('CAPABILITY_MISMATCH', message, details);
  }
}

export class TftUploadError extends OpenAk820Error {
  constructor(message: string, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super('TFT_UPLOAD', message, details, options);
  }
}

/** Raised when an operation is refused by the safety policy (e.g. an unverified write). */
export class SafetyBlockedError extends OpenAk820Error {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('SAFETY_BLOCKED', message, details);
  }
}

export class WebHidUnavailableError extends OpenAk820Error {
  constructor(message = 'WebHID is not available in this browser.') {
    super('WEBHID_UNAVAILABLE', message);
  }
}

export function isOpenAk820Error(e: unknown): e is OpenAk820Error {
  return e instanceof OpenAk820Error;
}

/** Human-readable explanation for UIs and the CLI. */
export function explainError(e: unknown): { title: string; detail: string; hint?: string } {
  if (!isOpenAk820Error(e)) {
    const msg = e instanceof Error ? e.message : String(e);
    return { title: 'Unexpected error', detail: msg };
  }
  switch (e.code) {
    case 'DEVICE_NOT_FOUND':
      return {
        title: 'Keyboard not found',
        detail: e.message,
        hint: 'Connect the keyboard with a USB data cable and set the mode switch to wired. Configuration over Bluetooth is not supported by the firmware.',
      };
    case 'PERMISSION':
      return {
        title: 'Permission denied',
        detail: e.message,
        hint: 'On Linux install the OpenAK820 udev rule (udev/99-openak820.rules) and replug the keyboard. In the browser, grant access in the device picker.',
      };
    case 'TRANSPORT':
      return {
        title: 'Communication failed',
        detail: e.message,
        hint: 'The keyboard may be busy or claimed by another program (close the vendor driver or other configurators), or it was unplugged.',
      };
    case 'TIMEOUT':
      return {
        title: 'The keyboard did not answer in time',
        detail: e.message,
        hint: 'Replug the keyboard and try again.',
      };
    case 'UNSUPPORTED_FEATURE':
      return { title: 'Feature not available', detail: e.message };
    case 'UNSUPPORTED_DEVICE':
    case 'UNSUPPORTED_PROTOCOL':
      return {
        title: 'Unsupported keyboard or firmware',
        detail: e.message,
        hint: 'Open Diagnostics and share the report in an issue so support can be added.',
      };
    case 'SAFETY_BLOCKED':
      return { title: 'Blocked by safety policy', detail: e.message };
    case 'WEBHID_UNAVAILABLE':
      return {
        title: 'WebHID unavailable',
        detail: e.message,
        hint: 'Use a Chromium-based browser (Chrome, Edge, Opera, Brave) over HTTPS or http://localhost.',
      };
    default:
      return { title: e.name, detail: e.message };
  }
}
