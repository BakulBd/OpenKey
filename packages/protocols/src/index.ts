import { ProtocolRegistry } from './registry.js';
import { sonixFeatureProtocol } from './families/sonix-feature/protocol.js';
import { sonixAa55Protocol } from './families/sonix-aa55/protocol.js';
import { qmkViaProtocol } from './families/minor/qmk-via.js';
import { sonixDongleProtocol } from './families/minor/sonix-dongle.js';
import { crsProtocol } from './families/minor/crs-aa55cc33.js';
import { byTechProtocol } from './families/by-tech/protocol.js';
import { royuanProtocol } from './families/royuan/protocol.js';
import { rkClassicProtocol } from './families/rk-classic/protocol.js';
import { aulaReceiverProtocol } from './families/aula-receiver/protocol.js';
import { PLANNED_ADAPTERS } from './families/planned.js';

export * from './registry.js';
export * from './session.js';
export * from './report.js';
export * from './fingerprint.js';
export * from './verdict.js';
export * from './diagnostics.js';
export * from './conformance.js';
export * from './ledger.js';
export { PLANNED_ADAPTERS } from './families/planned.js';
export * as sonixFeature from './families/sonix-feature/index.js';
export * as sonixAa55 from './families/sonix-aa55/index.js';
export * as qmkVia from './families/minor/qmk-via.js';
export * as sonixDongle from './families/minor/sonix-dongle.js';
export * as crs from './families/minor/crs-aa55cc33.js';
export * as byTech from './families/by-tech/index.js';
export * as via from './families/via/index.js';
export * as royuan from './families/royuan/index.js';
export * as rkClassic from './families/rk-classic/index.js';
export * as aulaReceiver from './families/aula-receiver/index.js';

/** Registry with every protocol family OpenKey knows, plus research-only planned adapters. */
export function createDefaultRegistry(): ProtocolRegistry {
  const r = new ProtocolRegistry()
    .register(sonixFeatureProtocol)
    .register(sonixAa55Protocol)
    .register(qmkViaProtocol)
    .register(sonixDongleProtocol)
    .register(crsProtocol)
    .register(byTechProtocol)
    .register(royuanProtocol)
    .register(rkClassicProtocol)
    .register(aulaReceiverProtocol);
  for (const p of PLANNED_ADAPTERS) r.plan(p);
  return r;
}
export * as example from './families/example/index.js';
