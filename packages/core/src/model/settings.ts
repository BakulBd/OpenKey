/**
 * System settings. Every field is optional because each firmware supports a different subset;
 * the driver's capabilities describe which ones apply. Unknown fields are preserved in `extra`.
 */
export interface SystemSettings {
  /** Index into the driver's sleep-time option list. */
  sleepTime?: number;
  /** Index into the driver's key-response (debounce) option list. */
  keyResponseTime?: number;
  /** Win/Mac layout switch state as tracked by firmware. */
  fnSwitch?: number;
  disableWinKey?: boolean;
  disableAltTab?: boolean;
  disableAltF4?: boolean;
  gameMode?: boolean;
  pollingRateHz?: number;
  extra?: Record<string, number>;
}

export interface SettingOption {
  value: number;
  label: string;
}

export interface SettingsSchema {
  sleepTime?: SettingOption[];
  keyResponseTime?: SettingOption[];
  pollingRateHz?: SettingOption[];
}
