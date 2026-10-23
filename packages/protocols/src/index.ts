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
import { hmkProtocol } from './families/hmk/protocol.js';
import { yjxMouseProtocol } from './families/yjx-mouse/protocol.js';
import { lampArrayProtocol } from './families/lamparray/protocol.js';
import { aj179MouseProtocol } from './families/aj179-mouse/protocol.js';
import { semicoProtocol } from './families/semico/protocol.js';
import { winbondProtocol } from './families/winbond/protocol.js';
import { hubProtocol } from './families/hub-aa55/protocol.js';
import { razerProtocol } from './families/razer/protocol.js';
import { wootingProtocol } from './families/wooting/protocol.js';
import { evisionProtocol } from './families/evision/protocol.js';
import {
  bloodyB820RProtocol,
  duckyProtocol,
  hyperxOriginsProtocol,
} from './families/oem-direct/protocols.js';
import { steelSeriesProtocol } from './families/oem-direct/steelseries.js';
import { logitechProtocol } from './families/logitech-hidpp/protocol.js';
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
export * as zmk from './families/zmk/index.js';
export * as hmk from './families/hmk/index.js';
export * as yjxMouse from './families/yjx-mouse/index.js';
export * as lampArray from './families/lamparray/index.js';
export * as aj179Mouse from './families/aj179-mouse/index.js';
export * as semico from './families/semico/index.js';
export * as winbond from './families/winbond/index.js';
export * as hubAa55 from './families/hub-aa55/index.js';
export * as razer from './families/razer/index.js';
export * as wooting from './families/wooting/index.js';
export * as evision from './families/evision/index.js';
export * as oemDirect from './families/oem-direct/index.js';
export * as logitech from './families/logitech-hidpp/index.js';
export * from './families/common/direct-lighting.js';

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
    .register(aulaReceiverProtocol)
    .register(hmkProtocol)
    .register(yjxMouseProtocol)
    .register(lampArrayProtocol)
    .register(aj179MouseProtocol)
    .register(semicoProtocol)
    .register(winbondProtocol)
    .register(hubProtocol)
    .register(razerProtocol)
    .register(wootingProtocol)
    .register(evisionProtocol)
    .register(bloodyB820RProtocol)
    .register(hyperxOriginsProtocol)
    .register(duckyProtocol)
    .register(steelSeriesProtocol)
    .register(logitechProtocol);
  for (const p of PLANNED_ADAPTERS) r.plan(p);
  return r;
}
export * as example from './families/example/index.js';
