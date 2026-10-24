#!/usr/bin/env bash
# Fails if logcat shows a TryChat crash/ANR, or the app is no longer in the foreground.
LOG=${1:-e2e-out/logcat.txt}
if grep -qE "FATAL EXCEPTION|ANR in com.trychat.app" "$LOG"; then
  echo "::error::TryChat crashed (see logcat artifact)"
  grep -nE -A30 "FATAL EXCEPTION|ANR in com.trychat.app" "$LOG" | head -150
  exit 1
fi
adb shell am start -W -n com.trychat.app/.MainActivity >/dev/null 2>&1 || true
sleep 3
if ! adb shell dumpsys activity activities | grep -E "ResumedActivity" | grep -q com.trychat.app; then
  echo "::error::TryChat is not in the foreground"; exit 1
fi
echo "No crash detected."
