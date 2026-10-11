# Writing an adapter

An adapter teaches OpenKey one protocol family. It never touches the UI: the app renders whatever the
adapter's capabilities say. This guide uses the template adapter in
[`packages/protocols/src/families/example/`](../packages/protocols/src/families/example/), a fictional
protocol that is tested end to end but never registered in the app.

Before writing code, read [CONTRIBUTING_KEYBOARDS.md](CONTRIBUTING_KEYBOARDS.md) (the community
workflow) and [SAFETY_INVARIANTS.md](SAFETY_INVARIANTS.md) (the rules your adapter will be tested
against).

## 1. What needs code and what is data

| Piece | Kind | Where | Can it enable a write? |
| ----- | ---- | ----- | ---------------------- |
| Device catalogue entry (brand, model, identity, hardware facts) | data | `packages/devices/src/catalog.ts` | no: it names devices, never selects a protocol |
| Device definition and layout (key geometry, slots, LED indices) | data | `devices/*.json`, `packages/devices/src/layouts/` | no: a layout is never proof that writing is safe |
| Diagnostic package | data | exported by users, `fixtures/diagnostics/` | no: analysed offline, cannot open a transport |
| Protocol adapter (match, probe plan, probe, driver, capabilities) | **code** | `packages/protocols/src/families/<family>/` | yes, after review, conformance tests and evidence |
| Protocol evidence ledger | code (typed data) | `families/<family>/ledger.ts` | constrains what the adapter may claim |

Adapters are reviewed TypeScript shipped with releases. OpenKey does not load adapter code at runtime
from a URL or a file, and does not use `eval`; see
[ARCHITECTURE_DECISION.md](ARCHITECTURE_DECISION.md#extension-model) for why.

## 2. The contract (v1)

`ProtocolDefinition` in [`registry.ts`](../packages/protocols/src/registry.ts); `apiVersion` must equal
`ADAPTER_API_VERSION` or the registry refuses the adapter.

| Member | Rule |
| ------ | ---- |
| `id` | kebab-case, stable, never reused for another protocol |
| `manifest.status` | `planned` → `research` → `community` → `experimental` → `verified`; only hardware runs move it right |
| `manifest.transports` | `input` (links the keyboard types over) and `configuration` (links that carry configuration) are declared separately and never inferred from each other |
| `manifest.provenance`, `license`, `limitations`, `fixtures` | required; limitations may be empty only for `verified` |
| `manifest.verifiedIdentities` | units the adapter was verified on, each with its evidence; drives the VERIFIED_MATCH verdict |
| `match(group)` | descriptors only, pure and deterministic, returns reasons **and** rejections. Never trust VID/PID alone |
| `probePlan.operations` | every report the probe may send or read, at which level, its identifying bytes, purpose, effect and evidence |
| `probePlan.autoConsent(group)` | `auto: true` only for identities where the handshake is known to be harmless (verified on hardware, or sent to that identity by the vendor's own software), or a public-specification read on a reserved collection. Everything else waits for the user |
| `probe(ctx)` | only declared operations; passive level sends nothing; set `identified: true` only when the answer is specific to your family (an echo, a magic value, a matching ID) |
| `createDriver` | called only after `identified`; the driver extends `BaseKeyboardDriver`, whose default for every method is `UnsupportedFeatureError` |

Optional operations are optional by construction: implement the methods your firmware supports and
describe them in `getCapabilities()`. Do not add stub implementations that pretend to succeed.

## 3. Capabilities

For each feature: `status`, `read` (`device` / `mirror` / `none`), `write`, `confidence` (evidence),
`safety` (risk class) and a `note`. Use `configurable(read, write, evidence, …)`; it reports a write
without device read-back as `WRITE_ONLY`, so the UI never implies the shown value came from the
keyboard. A screen whose upload is unknown is `NOT_YET_REVERSE_ENGINEERED` or `PHYSICALLY_PRESENT`,
never `NOT_SUPPORTED`. A feature that is absent on this link is `TRANSPORT_LIMITED`.

## 4. Evidence ledger

List every command, including the ones you must never send (`class: 'destructive'`,
`implemented: false`). Add a ledger test like `tests/protocol/ledger.test.ts`: every command constant
has an entry, no capability claims more evidence than its commands, every VERIFIED entry cites a
`*-hw.json` fixture whose own `confidence` is VERIFIED.

## 5. Tests

Copy [`tests/conformance/example-adapter.test.ts`](../tests/conformance/example-adapter.test.ts). At minimum:

- `checkManifest`, `checkMatchPurity`, `checkProbeTraffic` return no issues (the conformance kit,
  `packages/protocols/src/conformance.ts`); add your sample device to `SAMPLES` in
  `tests/conformance/adapters.conformance.test.ts` when the adapter is registered.
- Identification passes on your simulator and sends nothing to a foreign identity without consent.
- Codecs against fixtures (golden bytes); round trips; unknown encodings preserved as raw.
- Writes: exact packet sequence; validation refuses impossible input before anything is sent;
  read-back produces `VERIFIED` through `runTransaction` where the firmware can report the value.
- Faults with `MockHidDevice.inject()`: timeout, corrupt or truncated answer, wrong report ID,
  disconnect mid-command, reset.
- Fixtures A and B (`fixtures/diagnostics/`) must still produce no selection.

Fixtures are evidence. Never invent captured bytes and label them as captures: simulator output and
values derived from documentation are labelled with their real source.

## 6. Registering

Add the definition to `createDefaultRegistry()` in [`packages/protocols/src/index.ts`](../packages/protocols/src/index.ts)
with a `priority`. Higher priority is tried first; once one adapter identifies the device, the others
are not probed. If your descriptor signature overlaps an existing family, your probe must reject that
family's devices.

## 7. Licensing

Your adapter's own code is MIT (`manifest.license`). Facts learned from GPL or unlicensed projects
may be re-implemented in your own words with a citation in `provenance`; code, data tables and
documentation text from them may not be copied. Never commit vendor binaries, firmware or assets.
See [THIRD_PARTY.md](THIRD_PARTY.md).

## 8. From experimental to verified

One operation at a time on real hardware, with a backup first and read-back where possible
(`openkey verify …` records an evidence file). Commit the reviewed capture as a `-hw.json` fixture,
add the unit to `verifiedIdentities`, raise the ledger entry and capability to VERIFIED, and update
[HARDWARE_TEST_MATRIX.md](HARDWARE_TEST_MATRIX.md). A capability whose evidence is VERIFIED and whose
safety class is safe leaves experimental mode automatically.
