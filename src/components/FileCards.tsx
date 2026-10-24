import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatSize } from '../lib/attachments';
import { copyFileText, fileOnDevice, openWithApp, saveToDevice, shareFile } from '../lib/fileActions';
import { MAX_TEXT_PREVIEW_BYTES, fileGroup, isTextLike, typeLabel } from '../lib/fileKinds';
import type { FileGroup } from '../lib/fileKinds';
import { readFileText } from '../lib/fileTools';
import { useTheme } from '../lib/theme';
import type { Attachment } from '../lib/types';
import { displayUri } from '../lib/webFiles';
import { HtmlView } from './HtmlView';
import { ShareToFriendSheet } from './ShareToFriendSheet';
import { Icon } from './ui';
import type { IconName } from './ui';

const ICONS: Record<FileGroup, IconName> = {
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

export const fileIcon = (a: Pick<Attachment, 'name' | 'mimeType'>): IconName => ICONS[fileGroup(a.name, a.mimeType)];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs a file action, showing failures as an alert. */
async function act(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    Alert.alert('Something went wrong', errorText(e));
  }
}

async function saveWithFeedback(a: Attachment) {
  const msg = await saveToDevice(a);
  if (msg) Alert.alert('Saved', msg);
}

/** In-app viewing works for images, text and HTML everywhere, and for PDFs/Office files on iOS (WebKit renders them). */
function canViewInApp(a: Attachment): boolean {
  const g = fileGroup(a.name, a.mimeType);
  if (a.kind === 'image' || a.mimeType === 'text/html' || a.mimeType === 'image/svg+xml') return true;
  if (isTextLike(a.name, a.mimeType) && a.size <= MAX_TEXT_PREVIEW_BYTES) return true;
  return Platform.OS === 'ios' && ['pdf', 'doc', 'sheet', 'slides', 'video', 'audio'].includes(g);
}

export interface FileExtraAction {
  label: string;
  icon: IconName;
  destructive?: boolean;
  onPress: (a: Attachment) => void;
}

/**
 * Viewer + action sheet for one file. Render it once and set `viewing` / `menu` to open either.
 * `extra` adds screen-specific actions (e.g. Delete in the Files screen).
 */
export function useFileUi(extra: FileExtraAction[] = []) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [menu, setMenu] = useState<Attachment | null>(null);
  const [forward, setForward] = useState<Attachment[] | null>(null);

  const open = (a: Attachment) => {
    if (!fileOnDevice(a)) return Alert.alert('Not on this device', 'This file was sent on another device or has been deleted.');
    if (canViewInApp(a)) setViewing(a);
    else act(() => openWithApp(a));
  };

  const ui = (
    <>
      <FileViewer
        file={viewing}
        onClose={() => setViewing(null)}
        onMore={(a) => {
          // One modal at a time: iOS won't present a second one over the first.
          setViewing(null);
          setTimeout(() => setMenu(a), 350);
        }}
      />
      <FileActionSheet
        file={menu}
        onClose={() => setMenu(null)}
        onOpen={(a) => {
          setMenu(null);
          open(a);
        }}
        onForward={(a) => {
          setMenu(null);
          setForward([a]);
        }}
        extra={extra}
      />
      <ShareToFriendSheet visible={!!forward} files={forward ?? []} onClose={() => setForward(null)} />
    </>
  );
  return { open, showMenu: setMenu, ui };
}

/** Files the assistant sent in the chat (images, PDFs, any type), with open / share / save actions. */
export function FileCards({ files }: { files: Attachment[]; conversationId?: string }) {
  const theme = useTheme();
  const { open, showMenu, ui } = useFileUi();
  const images = files.filter((a) => a.kind === 'image');
  const others = files.filter((a) => a.kind !== 'image');
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      {images.length > 0 && (
        <View style={styles.imageRow}>
          {images.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => open(a)}
              onLongPress={() => showMenu(a)}
              accessibilityRole="imagebutton"
              accessibilityLabel={`${a.name}. Tap to view, long-press for options`}
            >
              {fileOnDevice(a) ? (
                <Image
                  source={{ uri: displayUri(a.uri) }}
                  style={[images.length === 1 ? styles.single : styles.multi, { backgroundColor: theme.surface2 }]}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.multi, styles.missing, { backgroundColor: theme.surface2 }]}>
                  <Icon name="image" size={22} />
                  <Text style={{ color: theme.faint, fontSize: 11, marginTop: 4 }}>Not on this device</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      )}
      {others.map((a) => (
        <FileCard key={a.id} file={a} onOpen={() => open(a)} onMore={() => showMenu(a)} />
      ))}
      {ui}
    </View>
  );
}

/** One non-image file: icon, name, size · type, and Open / Share / Save / more. */
export function FileCard({ file: a, onOpen, onMore }: { file: Attachment; onOpen: () => void; onMore: () => void }) {
  const theme = useTheme();
  const here = fileOnDevice(a);
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        onPress={onOpen}
        onLongPress={onMore}
        style={styles.cardMain}
        accessibilityRole="button"
        accessibilityLabel={`${a.name}, ${typeLabel(a.name, a.mimeType)}, ${formatSize(a.size)}. Tap to open, long-press for options`}
      >
        <View style={[styles.iconTile, { backgroundColor: theme.surface2 }]}>
          <Icon name={fileIcon(a)} size={20} color={theme.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }} numberOfLines={2}>
            {a.name}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
            {here ? `${formatSize(a.size)} · ${typeLabel(a.name, a.mimeType)}` : 'Not on this device'}
          </Text>
        </View>
      </Pressable>
      {here && (
        <View style={[styles.cardActions, { borderTopColor: theme.border }]}>
          <CardButton icon="eye" label="Open" onPress={onOpen} />
          <CardButton icon="share" label="Share" onPress={() => act(() => shareFile(a))} />
          <CardButton icon="download" label="Save" onPress={() => act(() => saveWithFeedback(a))} />
          <Pressable onPress={onMore} style={styles.moreBtn} accessibilityRole="button" accessibilityLabel={`More options for ${a.name}`}>
            <Icon name="more-horizontal" size={18} color={theme.text} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function CardButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={styles.cardBtn} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={icon} size={15} color={theme.text} />
      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

/** Bottom sheet with everything you can do with a file. */
export function FileActionSheet({
  file,
  onClose,
  onOpen,
  onForward,
  extra = [],
}: {
  file: Attachment | null;
  onClose: () => void;
  onOpen: (a: Attachment) => void;
  onForward: (a: Attachment) => void;
  extra?: FileExtraAction[];
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  if (!file) return null;
  const here = fileOnDevice(file);
  const textLike = isTextLike(file.name, file.mimeType) && file.size <= MAX_TEXT_PREVIEW_BYTES;
  const options: { label: string; icon: IconName; run: () => void; destructive?: boolean }[] = [
    ...(here
      ? [
          { label: 'Open', icon: 'eye' as IconName, run: () => onOpen(file) },
          { label: 'Open with another app', icon: 'external-link' as IconName, run: () => act(() => openWithApp(file)) },
          { label: 'Share', icon: 'share' as IconName, run: () => act(() => shareFile(file)) },
          {
            label: Platform.OS === 'android' ? 'Save to device…' : 'Save to Files',
            icon: 'download' as IconName,
            run: () => act(() => saveWithFeedback(file)),
          },
          { label: 'Send to a friend', icon: 'send' as IconName, run: () => onForward(file) },
          ...(textLike
            ? [
                {
                  label: 'Copy text',
                  icon: 'copy' as IconName,
                  run: () =>
                    act(async () => {
                      if (!(await copyFileText(file))) throw new Error('This file has no text to copy.');
                    }),
                },
              ]
            : []),
        ]
      : []),
    ...extra.map((x) => ({ label: x.label, icon: x.icon, destructive: x.destructive, run: () => x.onPress(file) })),
  ];
  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: theme.bg, paddingBottom: insets.bottom + 12 }]}>
        <View style={[styles.grabber, { backgroundColor: theme.oat }]} />
        <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 20, paddingHorizontal: 20 }} numberOfLines={2}>
          {file.name}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 13, paddingHorizontal: 20, marginTop: 2, marginBottom: 8 }}>
          {here ? `${formatSize(file.size)} · ${typeLabel(file.name, file.mimeType)}` : 'Not on this device'}
        </Text>
        {options.map((o) => (
          <Pressable
            key={o.label}
            onPress={() => {
              onClose();
              o.run();
            }}
            style={({ pressed }) => [styles.option, pressed && { backgroundColor: theme.surface2 }]}
            accessibilityRole="button"
          >
            <Icon name={o.icon} size={20} color={o.destructive ? theme.danger : theme.text} />
            <Text style={{ color: o.destructive ? theme.danger : theme.text, fontSize: 16 }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

/** Full-screen viewer: images, text/code, HTML/SVG; PDFs and Office files on iOS. */
export function FileViewer({ file, onClose, onMore }: { file: Attachment | null; onClose: () => void; onMore: (a: Attachment) => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [loaded, setLoaded] = useState<{ uri: string; text: string | null } | null>(null);

  const isImage = file?.kind === 'image';
  const isHtml = file?.mimeType === 'text/html' || file?.mimeType === 'image/svg+xml';
  const isText = !!file && !isImage && isTextLike(file.name, file.mimeType);

  useEffect(() => {
    if (!file || !isText) return;
    let live = true;
    readFileText(file)
      .catch(() => null)
      .then((t) => live && setLoaded({ uri: file.uri, text: t }));
    return () => {
      live = false;
    };
  }, [file, isText]);
  const text = file && loaded?.uri === file.uri ? loaded.text : null;
  const loading = isText && loaded?.uri !== file?.uri;

  if (!file) return null;
  const dark = isImage;
  const fg = dark ? '#FFFFFF' : theme.text;
  const folder = file.uri.slice(0, file.uri.lastIndexOf('/') + 1);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, backgroundColor: dark ? '#000000' : theme.bg, paddingTop: insets.top }}>
        <View style={styles.viewerBar}>
          <Pressable onPress={onClose} style={styles.barBtn} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="x" size={22} color={fg} />
          </Pressable>
          <Text style={{ flex: 1, color: fg, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
            {file.name}
          </Text>
          <Pressable onPress={() => act(() => shareFile(file))} style={styles.barBtn} accessibilityRole="button" accessibilityLabel="Share">
            <Icon name="share" size={20} color={fg} />
          </Pressable>
          <Pressable onPress={() => onMore(file)} style={styles.barBtn} accessibilityRole="button" accessibilityLabel="More options">
            <Icon name="more-horizontal" size={22} color={fg} />
          </Pressable>
        </View>
        <View style={{ flex: 1, paddingBottom: insets.bottom }}>
          {isImage ? (
            <ScrollView
              contentContainerStyle={{ flexGrow: 1 }}
              maximumZoomScale={4}
              minimumZoomScale={1}
              centerContent
              showsVerticalScrollIndicator={false}
            >
              <Image source={{ uri: displayUri(file.uri) }} style={{ flex: 1, width: '100%', minHeight: 300 }} resizeMode="contain" accessibilityLabel={file.name} />
            </ScrollView>
          ) : loading ? (
            <ActivityIndicator color={theme.muted} style={{ marginTop: 40 }} />
          ) : isHtml && text !== null ? (
            <HtmlView html={text} />
          ) : isText && text !== null ? (
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <Text selectable style={{ color: theme.text, fontFamily: 'monospace', fontSize: 13, lineHeight: 19 }}>
                {text}
              </Text>
            </ScrollView>
          ) : Platform.OS === 'web' && fileGroup(file.name, file.mimeType) === 'pdf' ? (
            <HtmlView uri={file.uri} background={theme.bg} />
          ) : Platform.OS === 'ios' && canViewInApp(file) ? (
            <WebView
              originWhitelist={['*']}
              source={{ uri: file.uri }}
              allowingReadAccessToURL={folder}
              allowFileAccess
              style={{ backgroundColor: theme.bg }}
            />
          ) : (
            <View style={styles.noPreview}>
              <Icon name={fileIcon(file)} size={40} color={theme.muted} />
              <Text style={{ color: theme.muted, textAlign: 'center', marginVertical: 12 }}>
                {typeLabel(file.name, file.mimeType)} · {formatSize(file.size)}
              </Text>
              <Pressable
                onPress={() => act(() => openWithApp(file))}
                style={[styles.openBtn, { backgroundColor: theme.text }]}
                accessibilityRole="button"
              >
                <Text style={{ color: theme.bg, fontWeight: '600' }}>Open with another app</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  imageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  single: { width: 240, height: 240, borderRadius: 16 },
  multi: { width: 116, height: 116, borderRadius: 12 },
  missing: { alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden', maxWidth: 420 },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 64 },
  iconTile: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardActions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  cardBtn: { flex: 1, minHeight: 44, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  moreBtn: { width: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, backgroundColor: 'rgba(20,20,19,0.4)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, minHeight: 52 },
  viewerBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, minHeight: 52 },
  barBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  noPreview: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  openBtn: { minHeight: 48, borderRadius: 999, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
});
