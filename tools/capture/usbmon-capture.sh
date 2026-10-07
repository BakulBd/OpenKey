#!/usr/bin/env bash
# Capture all USB traffic of one device with usbmon + tshark (Linux). Needs root for usbmon.
#   tools/capture/usbmon-capture.sh 0c45:8009 captures/11-tft-red-image.pcapng
# Then convert:  pnpm tsx tools/capture/src/pcap-to-experiment.ts captures/11-tft-red-image.pcapng --id 11-tft-red-image
set -euo pipefail
vidpid="${1:?usage: $0 <vid:pid> <out.pcapng>}"
out="${2:?usage: $0 <vid:pid> <out.pcapng>}"
vid="${vidpid%%:*}"; pid="${vidpid##*:}"
dev=""
for d in /sys/bus/usb/devices/*; do
  [[ -f "$d/idVendor" ]] || continue
  if [[ "$(cat "$d/idVendor")" == "$vid" && "$(cat "$d/idProduct")" == "$pid" ]]; then dev="$d"; break; fi
done
[[ -n "$dev" ]] || { echo "device $vidpid not found" >&2; exit 1; }
bus=$(cat "$dev/busnum"); addr=$(cat "$dev/devnum")
echo "device $vidpid at bus $bus address $addr ($(cat "$dev/product" 2>/dev/null || true))"
sudo modprobe usbmon
mkdir -p "$(dirname "$out")"
echo "capturing on usbmon$bus (Ctrl+C to stop) -> $out"
sudo tshark -i "usbmon$bus" -f "" -w "$out" -Y "usb.device_address == $addr" 2>/dev/null || \
  sudo tshark -i "usbmon$bus" -w "$out"
