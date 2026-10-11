#!/bin/sh
# OpenKey Linux setup: installs the udev rule that lets your user (and the plugdev group) open the
# HID interfaces of the keyboards OpenKey supports. It changes file permissions only; it never talks
# to a keyboard and never changes one.
#
# Run it yourself, with administrator rights:
#   sudo sh install-openkey-udev.sh            install or update the rule
#   sudo sh install-openkey-udev.sh --uninstall remove it
#   sh install-openkey-udev.sh --dry-run        show what would happen, change nothing
# Then unplug the keyboard, plug it back in, and press Retry on the OpenKey website.
#
# Options for packagers and tests: --target-dir DIR (install elsewhere, no root needed),
# --no-reload (skip udevadm).
set -eu

RULE_NAME=99-openkey.rules
TARGET_DIR=/etc/udev/rules.d
DRY_RUN=0
UNINSTALL=0
RELOAD=1
CUSTOM_DIR=0
ARGS="$*"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --no-reload) RELOAD=0 ;;
    --target-dir)
      [ $# -ge 2 ] || { echo "--target-dir needs a directory" >&2; exit 2; }
      TARGET_DIR=$2; CUSTOM_DIR=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
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
# interfaces of AJAZZ AK820-family keyboards and receivers. Needed by the CLI and by Chromium's
# WebHID on Linux. Install:
#   sudo cp udev/99-openkey.rules /etc/udev/rules.d/
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
OPENKEY_RULE_EOF

reload() {
  [ "$RELOAD" = 1 ] || return 0
  if command -v udevadm >/dev/null 2>&1; then
    run udevadm control --reload-rules
    run udevadm trigger --subsystem-match=hidraw
  else
    say "udevadm was not found: reboot (or reload udev) for the change to apply."
  fi
}

if [ "$UNINSTALL" = 1 ]; then
  if [ -f "$TARGET" ]; then
    run rm -f "$TARGET"
    reload
    say "Removed $TARGET."
  else
    say "Nothing to remove: $TARGET does not exist."
  fi
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
if [ -f "$TARGET_DIR/99-openak820.rules" ]; then
  say "Note: an older rule ($TARGET_DIR/99-openak820.rules) is also present. It still works; you may remove it."
fi
reload

say ""
say "Next steps:"
say "  1. Unplug the keyboard (or its receiver) and plug it back in."
say "  2. Return to OpenKey in Chrome, Edge, Opera or Brave and press Retry (or Connect keyboard)."
say "If your browser is a Snap or Flatpak package, it may not see USB devices; use a distribution package."
