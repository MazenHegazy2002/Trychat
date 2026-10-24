#!/usr/bin/env bash
# Runs inside the emulator runner: install APK, record video, run flows, check for crashes.
set -u
OUT=e2e-out; mkdir -p "$OUT/screenshots"
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb logcat -c
adb logcat -v time > "$OUT/logcat.txt" 2>&1 &
LOGPID=$!
# screenrecord caps at 180 s per file, so record in a loop of segments.
( i=0; while true; do adb shell screenrecord --time-limit 180 /sdcard/e2e-$i.mp4 || break; i=$((i+1)); done ) &
RECPID=$!
maestro test e2e/config.yaml --format junit --output "$OUT/report.xml" \
  --test-output-dir "$OUT/maestro" --debug-output "$OUT/maestro-debug"
STATUS=$?
kill $RECPID 2>/dev/null; adb shell pkill -INT screenrecord || true; sleep 4
for f in $(adb shell ls /sdcard/ | tr -d '\r' | grep '^e2e-.*mp4$'); do adb pull "/sdcard/$f" "$OUT/" || true; done
find "$OUT/maestro" -name '*.png' -exec cp {} "$OUT/screenshots/" \; 2>/dev/null || true
find . -maxdepth 1 -name '*.png' -exec mv {} "$OUT/screenshots/" \; 2>/dev/null || true
bash e2e/check-android-crash.sh "$OUT/logcat.txt"; CRASH=$?
kill $LOGPID 2>/dev/null || true
[ $CRASH -eq 0 ] || exit 1
exit $STATUS
