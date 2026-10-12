declare const __APP_VERSION__: string;

/** Build-time constants. Nothing here is a secret: the app has no server and no keys. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
export const REPO_URL = 'https://github.com/BakulBd/openkey';
export const ISSUES_URL = `${REPO_URL}/issues/new`;
export const CONTRIBUTE_KEYBOARD_URL = `${REPO_URL}/blob/main/docs/CONTRIBUTING_KEYBOARDS.md`;
