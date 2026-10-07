import { ProtocolRegistry } from './registry.js';
import { sonixFeatureProtocol } from './families/sonix-feature/protocol.js';
import { sonixAa55Protocol } from './families/sonix-aa55/protocol.js';
import { qmkViaProtocol } from './families/minor/qmk-via.js';
import { sonixDongleProtocol } from './families/minor/sonix-dongle.js';
import { crsProtocol } from './families/minor/crs-aa55cc33.js';
import { PLANNED_ADAPTERS } from './families/planned.js';

export * from './registry.js';
export * from './session.js';
export * from './report.js';
export * from './fingerprint.js';
export { PLANNED_ADAPTERS } from './families/planned.js';
export * as sonixFeature from './families/sonix-feature/index.js';
export * as sonixAa55 from './families/sonix-aa55/index.js';
export * as qmkVia from './families/minor/qmk-via.js';
export * as sonixDongle from './families/minor/sonix-dongle.js';
export * as crs from './families/minor/crs-aa55cc33.js';

/** Registry with every protocol family OpenKey knows, plus research-only planned adapters. */
export function createDefaultRegistry(): ProtocolRegistry {
  const r = new ProtocolRegistry()
    .register(sonixFeatureProtocol)
    .register(sonixAa55Protocol)
    .register(qmkViaProtocol)
    .register(sonixDongleProtocol)
    .register(crsProtocol);
  for (const p of PLANNED_ADAPTERS) r.plan(p);
  return r;
}
