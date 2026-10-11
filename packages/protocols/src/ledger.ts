import type { Evidence, FeatureId } from '@openkey/core';

/**
 * Protocol evidence ledger: one entry per command or behaviour an adapter knows about, including
 * the ones it must never send. Tests keep the ledger and the code in step (every command constant
 * has an entry, no capability claims more evidence than its commands, forbidden entries are never
 * implemented), so the ledger cannot drift into documentation that nobody checks.
 */
export type CommandClass =
  /** Reads state; nothing changes on the device. */
  | 'read'
  /** Changes RAM state only; a replug restores the previous state. */
  | 'write-volatile'
  /** Changes flash or other persistent state the user can change back. */
  | 'write-persistent'
  /** Firmware, bootloader, erase, calibration, factory reset. Never implemented. */
  | 'destructive';

export interface LedgerEntry {
  /** Stable name, equal to the adapter's constant where one exists. */
  name: string;
  /** Command byte(s) as hex, or a description for behaviours that have no command. */
  code: string;
  purpose: string;
  family: string;
  /** Protocol or firmware versions the entry applies to. */
  versions: string;
  class: CommandClass;
  /** Collection and report kind that carry it, e.g. `FF13:0001 feature, report ID 0`. */
  transport: string;
  request: string;
  response: string;
  /** Checksums, trailers, echo rules. */
  validation: string;
  errors: string;
  /** Pacing, timeouts and retries. */
  timing: string;
  evidence: Evidence;
  /** Hardware and firmware it was observed on, when evidence is VERIFIED. */
  testedOn?: string;
  sideEffects: string;
  /** Capabilities that depend on this entry; their confidence may not exceed the entry's. */
  usedBy: FeatureId[];
  sources: string[];
  /** False for entries that are documented only so nobody implements them by accident. */
  implemented: boolean;
}
