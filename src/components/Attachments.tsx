import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatSize } from '../lib/attachments';
import { useTheme } from '../lib/theme';
import type { Attachment } from '../lib/types';
import { displayUri } from '../lib/webFiles';
import { Icon } from './ui';
import type { IconName } from './ui';
import { VoiceNote } from './Voice';

export type AttachSource = 'photos' | 'camera' | 'files';

/** Bottom sheet with the ways to attach something. */
export function AttachSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (source: AttachSource) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const options: [AttachSource, IconName, string, string][] = [
    ['photos', 'image', 'Photos', 'Choose up to 6 from your gallery'],
    ['camera', 'camera', 'Camera', 'Take a photo now'],
    ['files', 'paperclip', 'Files', 'PDFs, code, text, CSV and more'],
  ];
  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: theme.bg, paddingBottom: insets.bottom + 12 }]}>
        <View style={[styles.grabber, { backgroundColor: theme.oat }]} />
        <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 22, marginBottom: 8, paddingHorizontal: 20 }}>
          Add to chat
        </Text>
        {options.map(([key, icon, title, sub]) => (
          <Pressable
            key={key}
            onPress={() => {
              onClose();
              onPick(key);
            }}
            style={({ pressed }) => [styles.option, pressed && { backgroundColor: theme.surface2 }]}
            accessibilityRole="button"
          >
            <View style={[styles.optionIcon, { backgroundColor: theme.surface2 }]}>
              <Icon name={icon} size={20} color={theme.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '500' }}>{title}</Text>
              <Text style={{ color: theme.muted, fontSize: 13, marginTop: 1 }}>{sub}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

/** Thumbnails of attachments waiting to be sent, each with a remove button. */
export function PendingAttachments({ items, onRemove }: { items: Attachment[]; onRemove: (id: string) => void }) {
  const theme = useTheme();
  if (!items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pendingRow} keyboardShouldPersistTaps="handled">
      {items.map((a) => (
        <View key={a.id}>
          {a.kind === 'image' ? (
            <Image source={{ uri: displayUri(a.uri) }} style={[styles.thumb, { backgroundColor: theme.surface2 }]} />
          ) : (
            <FileTile a={a} />
          )}
          <Pressable
            onPress={() => onRemove(a.id)}
            hitSlop={8}
            accessibilityLabel={`Remove ${a.name}`}
            style={[styles.remove, { backgroundColor: theme.text }]}
          >
            <Icon name="x" size={12} color={theme.bg} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

function FileTile({ a }: { a: Attachment }) {
  const theme = useTheme();
  return (
    <View style={[styles.fileTile, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Icon name={a.text !== undefined ? 'file-text' : 'file'} size={18} color={theme.text} />
      <Text style={{ color: theme.text, fontSize: 12, fontWeight: '500' }} numberOfLines={2}>
        {a.name}
      </Text>
      <Text style={{ color: theme.faint, fontSize: 11 }}>{formatSize(a.size)}</Text>
    </View>
  );
}

/** Attachments inside a sent message; tap an image to see it full screen. */
export function MessageAttachments({ items }: { items: Attachment[] }) {
  const theme = useTheme();
  const [open, setOpen] = useState<Attachment | null>(null);
  const images = items.filter((a) => a.kind === 'image');
  const files = items.filter((a) => a.kind === 'file' && !a.voice);
  const voices = items.filter((a) => a.voice);
  return (
    <View style={{ alignItems: 'flex-end', gap: 6, marginBottom: 6 }}>
      {images.length > 0 && (
        <View style={styles.imageGrid}>
          {images.map((a) => (
            <Pressable key={a.id} onPress={() => setOpen(a)} accessibilityLabel={`Open ${a.name}`}>
              <Image
                source={{ uri: displayUri(a.uri) }}
                style={[images.length === 1 ? styles.single : styles.multi, { backgroundColor: theme.surface2 }]}
              />
            </Pressable>
          ))}
        </View>
      )}
      {voices.map((a) => (
        <VoiceNote key={a.id} a={a} />
      ))}
      {files.map((a) => (
        <FileTile key={a.id} a={a} />
      ))}
      <Modal statusBarTranslucent navigationBarTranslucent visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.viewer} onPress={() => setOpen(null)} accessibilityLabel="Close image">
          {open && <Image source={{ uri: displayUri(open.uri) }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(20,20,19,0.4)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, minHeight: 64 },
  optionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pendingRow: { gap: 10, paddingHorizontal: 4, paddingTop: 6, paddingBottom: 8 },
  thumb: { width: 64, height: 64, borderRadius: 12 },
  remove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  fileTile: { width: 120, minHeight: 64, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 8, gap: 2 },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', maxWidth: '85%' },
  single: { width: 220, height: 220, borderRadius: 16 },
  multi: { width: 108, height: 108, borderRadius: 12 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
});
