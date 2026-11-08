import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatSize } from '../lib/attachments';
import { fileGroup, typeLabel } from '../lib/fileKinds';
import type { FileGroup } from '../lib/fileKinds';
import { FONT, RADIUS, TYPE, WIDE_BREAKPOINT, shadow, useTheme } from '../lib/theme';
import type { Attachment } from '../lib/types';
import { displayUri } from '../lib/webFiles';
import { Divider, Icon, IconButton, IconTile } from './ui';
import type { IconName } from './ui';
import { VoiceNote } from './Voice';
import { Text } from './Text';

export type AttachSource = 'photos' | 'camera' | 'files';

const FILE_ICONS: Record<FileGroup, IconName> = {
  image: 'image',
  pdf: 'file-text',
  text: 'file-text',
  code: 'code',
  sheet: 'grid',
  doc: 'file-text',
  slides: 'monitor',
  archive: 'archive',
  audio: 'music',
  video: 'film',
  other: 'file',
};

/** Sheet with the ways to attach something: rises from the bottom on phones, a centred dialog on wide screens. */
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
  const wide = useWindowDimensions().width >= WIDE_BREAKPOINT;
  const options: [AttachSource, IconName, string, string][] = [
    ['photos', 'image', 'Photos', 'Choose up to 6 from your gallery'],
    ['camera', 'camera', 'Camera', 'Take a photo now'],
    ['files', 'paperclip', 'Files', 'PDFs, code, text, CSV and more'],
  ];
  return (
    <Modal
      statusBarTranslucent
      navigationBarTranslucent
      visible={visible}
      transparent
      animationType={wide ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, wide && styles.backdropWide]}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]} onPress={onClose} accessibilityLabel="Close" />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: theme.surfaceRaised },
            shadow(theme, 'sheet'),
            wide ? styles.dialog : { paddingBottom: insets.bottom + 16 },
          ]}
        >
          {!wide && <View style={[styles.grabber, { backgroundColor: theme.borderStrong }]} />}
          <View style={styles.sheetHeader}>
            <Text style={[TYPE.headline, { color: theme.ink, flex: 1 }]} accessibilityRole="header">
              Add to chat
            </Text>
            <IconButton name="x" label="Close" onPress={onClose} style={{ marginRight: -10 }} />
          </View>
          <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {options.map(([key, icon, title, sub], i) => (
              <View key={key}>
                {i > 0 && <Divider inset={64} />}
                <Pressable
                  onPress={() => {
                    onClose();
                    onPick(key);
                  }}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.option,
                    (pressed || hovered) && { backgroundColor: theme.fill },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={title}
                  accessibilityHint={sub}
                >
                  <IconTile name={icon} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '500' }]}>{title}</Text>
                    <Text style={[TYPE.caption, { color: theme.inkMuted }]}>{sub}</Text>
                  </View>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
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
            <Image source={{ uri: displayUri(a.uri) }} style={[styles.thumb, { backgroundColor: theme.fill, borderColor: theme.border }]} />
          ) : (
            <FileTile a={a} compact />
          )}
          <Pressable
            onPress={() => onRemove(a.id)}
            hitSlop={11}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${a.name}`}
            style={[styles.remove, { backgroundColor: theme.ink, borderColor: theme.surfaceRaised }]}
          >
            <Icon name="x" size={12} color={theme.bg} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

/** A file as a FileCard-style tile: icon tile, name, and "PDF · 248 KB" in Geist Mono. */
function FileTile({ a, compact }: { a: Attachment; compact?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.fileTile,
        compact ? styles.fileTileCompact : styles.fileTileCard,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={[styles.fileIcon, { backgroundColor: theme.fill }]}>
        <Icon name={FILE_ICONS[fileGroup(a.name, a.mimeType)]} size={16} color={theme.ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: theme.ink, fontSize: compact ? 13 : 14, lineHeight: compact ? 18 : 20, fontWeight: '500' }} numberOfLines={compact ? 2 : 1}>
          {a.name}
        </Text>
        <Text style={[styles.fileMeta, { color: theme.inkFaint }]} numberOfLines={1}>
          {typeLabel(a.name, a.mimeType)} · {formatSize(a.size)}
        </Text>
      </View>
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
            <Pressable key={a.id} onPress={() => setOpen(a)} accessibilityRole="imagebutton" accessibilityLabel={`Open ${a.name}`}>
              <Image
                source={{ uri: displayUri(a.uri) }}
                style={[images.length === 1 ? styles.single : styles.multi, { backgroundColor: theme.fill, borderColor: theme.border }]}
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
        <Pressable style={[styles.viewer, { backgroundColor: theme.bg }]} onPress={() => setOpen(null)} accessibilityLabel="Close image">
          {open && <Image source={{ uri: displayUri(open.uri) }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropWide: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, paddingTop: 8, paddingHorizontal: 16 },
  dialog: { width: '100%', maxWidth: 440, borderRadius: RADIUS.lg, paddingTop: 12, paddingBottom: 24 },
  grabber: { width: 36, height: 5, borderRadius: RADIUS.pill, alignSelf: 'center' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 8 },
  group: { borderWidth: 1, borderRadius: RADIUS.md, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 64 },
  pendingRow: { gap: 10, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 4 },
  thumb: { width: 64, height: 64, borderRadius: RADIUS.sm, borderWidth: 1 },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileTile: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1 },
  fileTileCompact: { width: 184, height: 64, borderRadius: RADIUS.sm, paddingHorizontal: 10 },
  fileTileCard: { width: 260, maxWidth: '100%', borderRadius: RADIUS.md, padding: 12 },
  fileIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  fileMeta: { fontFamily: FONT.mono, fontSize: 11, lineHeight: 16 },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', maxWidth: '85%' },
  single: { width: 220, height: 220, borderRadius: RADIUS.md, borderWidth: 1 },
  multi: { width: 108, height: 108, borderRadius: RADIUS.sm, borderWidth: 1 },
  viewer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
