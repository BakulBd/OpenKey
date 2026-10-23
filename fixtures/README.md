# fixtures/

Evidence-backed byte sequences used by the tests. Every file records the device, firmware, transport,
interface, report ID, raw bytes, the expected parsing, its source and a confidence level.

* `*-hw.json` – captured from real hardware (VERIFIED); replayed by `tests/device/hardware-replay.test.ts`.
* `sonix-feature-*.json` – golden values reproduced from the official driver's code paths (OBSERVED).
* `rgb/mk870-lighting-captures-issue13.json` – the 45 lighting writes an FL Esports MK870 owner
  captured on Linux (issue #13), each with what the owner set; replayed byte for byte by
  `tests/protocol/winbond.test.ts` (OBSERVED: captured on hardware, not by OpenKey's own write).
* `device-info/ak820-max-plus-usb-1.07.json` – USB identity and raw report descriptors of the test unit.
* `diagnostics/*.json` – sanitized diagnostic packages (support bundle v2): identity and HID
  descriptors only, never packets, typing, keymaps or serial numbers. Each carries a `fixture` block
  with its source, what it does **not** record, and the expected detection outcome. Fixtures A and B
  are regression guards: neither may ever become a supported or write-capable device through
  descriptor similarity (`tests/safety/invariants.test.ts`). They can also be loaded in the web app
  (Research lab → Offline analysis).
