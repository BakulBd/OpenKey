# fixtures/

Evidence-backed byte sequences used by the tests. Every file records the device, firmware, transport,
interface, report ID, raw bytes, the expected parsing, its source and a confidence level.

* `*-hw.json` – captured from real hardware (CONFIRMED); replayed by `tests/device/hardware-replay.test.ts`.
* `sonix-feature-*.json` – golden values reproduced from the official driver's code paths (STRONGLY_SUPPORTED).
* `device-info/ak820-max-plus-usb-1.07.json` – USB identity and raw report descriptors of the test unit.
