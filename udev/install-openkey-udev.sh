#!/bin/sh
# OpenKey Linux setup: installs the udev rule that lets your user (and the plugdev group) open the
# HID interfaces of the keyboards OpenKey supports. It changes file permissions only; it never talks
# to a keyboard and never changes one.
#
# Run it yourself, with administrator rights:
#   sudo sh install-openkey-udev.sh            install or update the rule
#   sudo sh install-openkey-udev.sh --uninstall remove it
#   sh install-openkey-udev.sh --dry-run        show what would happen, change nothing
#   sudo sh install-openkey-udev.sh --device 258a:015e
#                                               also allow a keyboard that is not in the list
#                                               (USB vendor:product ID, as shown by OpenKey or lsusb)
# Then unplug the keyboard, plug it back in, and press Retry on the OpenKey website.
#
# Options for packagers and tests: --target-dir DIR (install elsewhere, no root needed),
# --no-reload (skip udevadm).
set -eu

RULE_NAME=70-openkey.rules
# Earlier OpenKey releases installed the rule as 99-openkey.rules, which sorts after systemd's
# 73-seat-late.rules, so the logged-in user never got access through uaccess. Replaced on install.
OLD_RULE_NAME=99-openkey.rules
TARGET_DIR=/etc/udev/rules.d
DRY_RUN=0
UNINSTALL=0
RELOAD=1
CUSTOM_DIR=0
EXTRA_IDS=""
ARGS="$*"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --no-reload) RELOAD=0 ;;
    --target-dir)
      [ $# -ge 2 ] || { echo "--target-dir needs a directory" >&2; exit 2; }
      TARGET_DIR=$2; CUSTOM_DIR=1; shift ;;
    --device)
      [ $# -ge 2 ] || { echo "--device needs a USB ID such as 258a:015e" >&2; exit 2; }
      id=$(printf '%s' "$2" | tr 'A-F' 'a-f')
      case "$id" in
        [0-9a-f][0-9a-f][0-9a-f][0-9a-f]:[0-9a-f][0-9a-f][0-9a-f][0-9a-f]) EXTRA_IDS="$EXTRA_IDS $id" ;;
        *) echo "--device $2: expected four hex digits, a colon and four hex digits (e.g. 258a:015e)" >&2; exit 2 ;;
      esac
      shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then say "[dry run] $*"; else "$@"; fi; }

if [ "$(uname -s)" != "Linux" ]; then
  say "This script is for Linux. Windows and macOS need no permission setup for OpenKey."
  exit 1
fi
if [ "$DRY_RUN" = 0 ] && [ "$CUSTOM_DIR" = 0 ] && [ "$(id -u)" -ne 0 ]; then
  say "Administrator rights are needed to write $TARGET_DIR."
  say "Run: sudo sh $0${ARGS:+ $ARGS}"
  exit 1
fi

TARGET=$TARGET_DIR/$RULE_NAME
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
cat > "$TMP" <<'OPENKEY_RULE_EOF'
# OpenKey – grant the logged-in user (uaccess) and the plugdev group access to the HID
# interfaces of the keyboards, mice and receivers OpenKey supports (AJAZZ, AULA, RK, Razer, Wooting,
# SteelSeries, Logitech, HyperX, Ducky, A4Tech, EVision boards). Needed by the CLI and by Chromium's
# WebHID on Linux.
#
# The number matters: systemd turns TAG+="uaccess" into an access entry for the logged-in user in
# 73-seat-late.rules, and udev applies rule files in name order, so this file must sort before 73.
# (OpenKey shipped it as 99-openkey.rules before; there only the plugdev group got access.)
#
# Install (or run install-openkey-udev.sh, which does the same):
#   sudo cp udev/70-openkey.rules /etc/udev/rules.d/
#   sudo udevadm control --reload-rules && sudo udevadm trigger
# then unplug and replug the keyboard.

# Sonix-based AK820 Pro / AK820 MAX / MAX PLUS (wired) and their 2.4 GHz receivers
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="8009", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="800a", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="fdfd", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="fefe", MODE="0660", GROUP="plugdev", TAG+="uaccess"
# AK820 MAX 2.4 GHz receiver that enumerates with Apple's vendor ID (official driver config.xml)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="05ac", ATTRS{idProduct}=="024f", MODE="0660", GROUP="plugdev", TAG+="uaccess"
# Bluetooth HID links have no USB parent; match the HID device name instead
SUBSYSTEM=="hidraw", KERNELS=="0005:0C45:FEFE.*", MODE="0660", GROUP="plugdev", TAG+="uaccess"
# CRS-based AK820 Max Plus revision (VID 1A2C)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1a2c", ATTRS{idProduct}=="a036", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1a2c", ATTRS{idProduct}=="8fff", MODE="0660", GROUP="plugdev", TAG+="uaccess"
# BY Tech / SinoWealth boards: AULA F75, F87, F99, H108 (all 258A:010C), RK R75 RGB wired (258A:015E)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="258a", ATTRS{idProduct}=="010c", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="258a", ATTRS{idProduct}=="015e", MODE="0660", GROUP="plugdev", TAG+="uaccess"
# AULA / AJAZZ "BY edition" 2.4 GHz receiver
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="3554", ATTRS{idProduct}=="fa09", MODE="0660", GROUP="plugdev", TAG+="uaccess"

# AJAZZ AJ139 V2 MC mouse: cable and 2.4 GHz receiver
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="a8a4", ATTRS{idProduct}=="2255", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="a8a5", ATTRS{idProduct}=="2255", MODE="0660", GROUP="plugdev", TAG+="uaccess"

# AJAZZ AJ179 mouse: 2.4 GHz receiver and cable
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="249a", ATTRS{idProduct}=="5c2f", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="248a", ATTRS{idProduct}=="5c2e", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="248a", ATTRS{idProduct}=="5d2e", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="248a", ATTRS{idProduct}=="5e2e", MODE="0660", GROUP="plugdev", TAG+="uaccess"

# AJAZZ AK992 (SEMICO firmware)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1a2c", ATTRS{idProduct}=="9c00", MODE="0660", GROUP="plugdev", TAG+="uaccess"

# FL Esports MK870, Pulsar PCMK TKL (Winbond OEM protocol)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0416", ATTRS{idProduct}=="c345", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0416", ATTRS{idProduct}=="b23c", MODE="0660", GROUP="plugdev", TAG+="uaccess"

# AULA F87S 8K (cable and receiver), AJAZZ AK680 V2 / AK680 MAX (web-driver protocol)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="38a6", ATTRS{idProduct}=="2908", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="fef9", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="80bc", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="80c1", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="80c2", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="80b2", MODE="0660", GROUP="plugdev", TAG+="uaccess"

# RK M87 and M75 (BY Tech platform)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="258a", ATTRS{idProduct}=="01a2", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="258a", ATTRS{idProduct}=="0163", MODE="0660", GROUP="plugdev", TAG+="uaccess"

# EVision firmware boards (Redragon, Glorious, AJAZZ …)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="5004", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="5104", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="5204", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="652f", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="7672", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="7698", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0c45", ATTRS{idProduct}=="8520", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="5000", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="502a", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="505b", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="5064", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="5078", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="5084", MODE="0660", GROUP="plugdev", TAG+="uaccess"

# A4Tech Bloody B820R, HyperX Alloy Origins, Ducky One 2 RGB
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="09da", ATTRS{idProduct}=="fa10", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0951", ATTRS{idProduct}=="16e5", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="03f0", ATTRS{idProduct}=="0591", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="04d9", ATTRS{idProduct}=="0348", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="04d9", ATTRS{idProduct}=="0356", MODE="0660", GROUP="plugdev", TAG+="uaccess"

# Razer Chroma keyboards
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0241", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0203", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0211", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0209", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0221", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0228", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="024e", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="025a", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="025c", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0a24", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0258", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0271", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0287", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="028d", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02b3", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02b4", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02a5", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0293", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02d7", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02d5", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02d4", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02d2", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0216", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="021a", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="022a", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="025e", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="023f", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="021e", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="025d", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="028f", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02a1", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02a3", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0294", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02a2", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0295", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0298", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0296", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0290", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0292", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0227", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0226", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0266", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0257", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0282", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0243", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="026b", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="026c", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02a6", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02a7", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="02e4", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="0244", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", ATTRS{idProduct}=="022b", MODE="0660", GROUP="plugdev", TAG+="uaccess"

# Wooting keyboards (base product id and the two gamepad-driver alternatives)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="03eb", ATTRS{idProduct}=="ff01", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="03eb", ATTRS{idProduct}=="ff02", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1100", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1101", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1102", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1200", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1201", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1202", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1210", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1211", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1212", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1220", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1221", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1222", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1230", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1231", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1232", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1300", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1301", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1302", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1310", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1311", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1312", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1320", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1321", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1322", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1340", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1341", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1342", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1400", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1401", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1402", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1510", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1511", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", ATTRS{idProduct}=="1512", MODE="0660", GROUP="plugdev", TAG+="uaccess"

# SteelSeries Apex keyboards
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="161c", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1612", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1618", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1634", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1620", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1610", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1614", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1628", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1630", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1632", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1642", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1644", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1646", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1038", ATTRS{idProduct}=="1640", MODE="0660", GROUP="plugdev", TAG+="uaccess"

# Logitech G915 / G915 TKL / G815 (cable and Lightspeed receivers)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="046d", ATTRS{idProduct}=="c33e", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="046d", ATTRS{idProduct}=="c541", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="046d", ATTRS{idProduct}=="c343", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="046d", ATTRS{idProduct}=="c545", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="046d", ATTRS{idProduct}=="c547", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="046d", ATTRS{idProduct}=="c33f", MODE="0660", GROUP="plugdev", TAG+="uaccess"
OPENKEY_RULE_EOF
if [ -n "$EXTRA_IDS" ]; then
  printf '\n# Added with --device for keyboards not in the list above\n' >> "$TMP"
  for id in $EXTRA_IDS; do
    printf 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="%s", ATTRS{idProduct}=="%s", MODE="0660", GROUP="plugdev", TAG+="uaccess"\n' "${id%%:*}" "${id#*:}" >> "$TMP"
  done
fi

reload() {
  [ "$RELOAD" = 1 ] || return 0
  if command -v udevadm >/dev/null 2>&1; then
    run udevadm control --reload-rules
    run udevadm trigger --subsystem-match=hidraw
  else
    say "udevadm was not found: reboot (or reload udev) for the change to apply."
  fi
}

OLD=$TARGET_DIR/$OLD_RULE_NAME
# Only a file OpenKey wrote is ever removed: it must start with OpenKey's own header.
is_ours() { [ -f "$1" ] && head -n 1 "$1" | grep -q '^# OpenKey'; }

if [ "$UNINSTALL" = 1 ]; then
  removed=0
  for f in "$TARGET" "$OLD"; do
    if is_ours "$f"; then run rm -f "$f"; say "Removed $f."; removed=1; fi
  done
  if [ "$removed" = 1 ]; then reload; else say "Nothing to remove: no OpenKey rule in $TARGET_DIR."; fi
  exit 0
fi

if [ -f "$TARGET" ] && cmp -s "$TMP" "$TARGET"; then
  say "The OpenKey rule is already installed at $TARGET."
else
  if [ -f "$TARGET" ]; then
    run cp "$TARGET" "$TARGET.bak"
    say "Saved the previous file as $TARGET.bak."
  fi
  run mkdir -p "$TARGET_DIR"
  run cp "$TMP" "$TARGET"
  run chmod 0644 "$TARGET"
  say "Installed $TARGET."
fi
if is_ours "$OLD"; then
  run rm -f "$OLD"
  say "Removed the earlier OpenKey rule $OLD (replaced by $TARGET)."
fi
if [ -f "$TARGET_DIR/99-openak820.rules" ]; then
  say "Note: an older rule ($TARGET_DIR/99-openak820.rules) is also present. It still works; you may remove it."
fi
reload

say ""
say "Next steps:"
say "  1. Unplug the keyboard (or its receiver) and plug it back in."
say "  2. Return to OpenKey in Chrome, Edge, Opera or Brave and press Retry (or Connect keyboard)."
say "If your browser is a Snap or Flatpak package, it may not see USB devices; use a distribution package."
