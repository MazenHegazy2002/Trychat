#!/usr/bin/env bash
# Runs inside the emulator runner: install APK, record video, run flows, check for crashes.
set -u
OUT=e2e-out; mkdir -p "$OUT/screenshots"
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb logcat -c
# The emulator's own launcher sometimes hangs under CI load ("Pixel Launcher isn't responding"); hide such
# system dialogs so they don't cover the app.
adb shell settings put global hide_error_dialogs 1 || true
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
# Launch probe: what is in front of the app 25 s after a cold start (dialogs, ANRs, permission prompts).
adb shell monkey -p com.trychat.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 25
{ adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp"; adb shell dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | head -5; } > "$OUT/probe-launch.txt" 2>&1 || true
adb exec-out screencap -p > "$OUT/probe-launch.png" || true
maestro hierarchy --compact > "$OUT/probe-launch-hierarchy.csv" 2>/dev/null || true
adb shell am force-stop com.trychat.app || true
adb logcat -v time > "$OUT/logcat.txt" 2>&1 &
LOGPID=$!
# screenrecord caps at 180 s per file, so record in a loop of segments.
( i=0; while true; do adb shell screenrecord --time-limit 180 /sdcard/e2e-$i.mp4 || break; i=$((i+1)); done ) &
RECPID=$!
maestro test e2e --format junit --output "$OUT/report.xml" \
  --test-output-dir "$OUT/maestro" --debug-output "$OUT/maestro-debug"
STATUS=$?
# Keyboard probe: a new chat with text typed, then what's on screen (view tree, keyboard, screenshot).
maestro test e2e/probe/keyboard.yaml --test-output-dir "$OUT/probe" || true
maestro hierarchy --compact > "$OUT/probe-hierarchy.csv" 2>/dev/null || true
{ adb shell dumpsys input_method | grep -E "mInputShown|mIsInputViewShown|mImeWindowVis"; adb shell dumpsys window windows | grep -E "InputMethod|mFrame=|mGivenContentInsets|ime" | head -40; adb shell wm size; adb shell wm density; } > "$OUT/probe-ime.txt" 2>&1 || true
adb exec-out screencap -p > "$OUT/probe-keyboard.png" || true
kill $RECPID 2>/dev/null; adb shell pkill -INT screenrecord || true; sleep 4
for f in $(adb shell ls /sdcard/ | tr -d '\r' | grep '^e2e-.*mp4$'); do adb pull "/sdcard/$f" "$OUT/" || true; done
find "$OUT/maestro" -name '*.png' -exec cp {} "$OUT/screenshots/" \; 2>/dev/null || true
find . -maxdepth 1 -name '*.png' -exec mv {} "$OUT/screenshots/" \; 2>/dev/null || true
bash e2e/check-android-crash.sh "$OUT/logcat.txt"; CRASH=$?
kill $LOGPID 2>/dev/null || true
[ $CRASH -eq 0 ] || exit 1
exit $STATUS
