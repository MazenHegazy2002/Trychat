import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';  
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../lib/theme';
import type { Attachment } from '../lib/types';
import { displayUri } from '../lib/webFiles';
import { Icon } from './ui';

export const MAX_VOICE_MS = 5 * 60 * 1000;

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Replaces the composer row while recording a voice note: cancel, live timer (max 5 min), stop,
 * then a preview with send. `onSend` gets the recording's file uri and duration.
 */
export function VoiceRecorder({
  onCancel,
  onSend,
  sending,
}: {
  onCancel: () => void;
  onSend: (uri: string, durationMs: number) => void;
  sending: boolean;
}) {
  const theme = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [done, setDone] = useState<{ uri: string; durationMs: number } | null>(null);
  const started = useRef(false);
  const stopping = useRef(false);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let limit: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) throw new Error('Microphone permission was denied. You can allow it in Settings.');
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
        recorder.record();
        started.current = true;
        limit = setTimeout(() => stopRef.current(), MAX_VOICE_MS);
      } catch (e) {
        if (!cancelled) {
          Alert.alert("Couldn't record", e instanceof Error ? e.message : String(e));
          onCancel();
        }
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(limit);
      if (started.current && !stopping.current) recorder.stop().catch(() => {});
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = async () => {
    if (stopping.current || !started.current) return;
    stopping.current = true;
    const durationMs = recorder.getStatus().durationMillis || state.durationMillis;
    await recorder.stop().catch(() => {});
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    if (recorder.uri) setDone({ uri: recorder.uri, durationMs });
    else onCancel();
  };
  useEffect(() => {
    stopRef.current = stop;
  });

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onCancel}
        disabled={sending}
        style={[styles.round, { borderColor: theme.border }]}
        accessibilityRole="button"
        accessibilityLabel={done ? 'Delete voice message' : 'Cancel recording'}
      >
        <Icon name={done ? 'trash-2' : 'x'} size={18} color={theme.text} />
      </Pressable>
      {done ? (
        <View style={{ flex: 1 }}>
          <VoicePlayer uri={done.uri} durationMs={done.durationMs} />
        </View>
      ) : (
        <View style={styles.timer} accessibilityLiveRegion="polite" accessible accessibilityLabel={`Recording, ${formatDuration(state.durationMillis)}`}>
          <View style={[styles.dot, { backgroundColor: theme.danger, opacity: state.isRecording ? 1 : 0.4 }]} />
          <Text style={{ color: theme.text, fontSize: 16, fontVariant: ['tabular-nums'] }}>
            {formatDuration(state.durationMillis)}
          </Text>
          <Text style={{ color: theme.faint, fontSize: 13 }}> / {formatDuration(MAX_VOICE_MS)}</Text>
        </View>
      )}
      {done ? (
        <Pressable
          onPress={() => onSend(done.uri, done.durationMs)}
          disabled={sending}
          style={[styles.round, { backgroundColor: theme.accent, borderWidth: 0 }]}
          accessibilityRole="button"
          accessibilityLabel="Send voice message"
        >
          {sending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Icon name="arrow-up" size={20} color="#FFFFFF" />}
        </Pressable>
      ) : (
        <Pressable
          onPress={stop}
          style={[styles.round, { backgroundColor: theme.danger, borderWidth: 0 }]}
          accessibilityRole="button"
          accessibilityLabel="Stop recording"
        >
          <Icon name="square" size={14} color="#FFFFFF" />
        </Pressable>
      )}
    </View>
  );
}

/** Play/pause, progress bar and time for a voice note. */
export function VoicePlayer({ uri, durationMs }: { uri: string; durationMs: number }) {
  const theme = useTheme();
  const player = useAudioPlayer({ uri: displayUri(uri) }, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const total = status.duration > 0 ? status.duration * 1000 : durationMs;
  const pos = status.currentTime * 1000;
  const progress = total > 0 ? Math.min(1, pos / total) : 0;

  const toggle = async () => {
    if (status.playing) return player.pause();
    await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    if (status.didJustFinish || (total > 0 && pos >= total - 100)) await player.seekTo(0);
    player.play();
  };

  return (
    <View style={styles.player}>
      <Pressable
        onPress={toggle}
        style={[styles.play, { backgroundColor: theme.text }]}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice message' : 'Play voice message'}
      >
        <Icon name={status.playing ? 'pause' : 'play'} size={16} color={theme.bg} />
      </Pressable>
      <View
        style={[styles.track, { backgroundColor: theme.border }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      >
        <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: theme.accent }]} />
      </View>
      <Text style={{ color: theme.muted, fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 36 }}>
        {formatDuration(status.playing || pos > 0 ? pos : total)}
      </Text>
    </View>
  );
}

/** A sent voice note: player plus, when transcription failed, a small hint. */
export function VoiceNote({ a }: { a: Attachment }) {
  const theme = useTheme();
  return (
    <View style={[styles.note, { backgroundColor: theme.userBubble, borderColor: theme.border }]}>
      <VoicePlayer uri={a.uri} durationMs={a.voice?.durationMs ?? 0} />
      {!!a.voice?.transcriptError && (
        <Text style={{ color: theme.faint, fontSize: 12, marginTop: 2 }}>
          No transcript: {a.voice.transcriptError}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  timer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  player: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  play: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4 },
  note: { width: 250, maxWidth: '85%', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 6 },
});
