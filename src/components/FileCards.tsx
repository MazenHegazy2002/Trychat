import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatSize } from '../lib/attachments';
import { copyFileText, fileOnDevice, openWithApp, saveToDevice, shareFile } from '../lib/fileActions';
import { MAX_TEXT_PREVIEW_BYTES, fileGroup, isTextLike, typeLabel } from '../lib/fileKinds';
import type { FileGroup } from '../lib/fileKinds';
import { readFileText } from '../lib/fileTools';
import { RADIUS, TYPE, useTheme } from '../lib/theme';
import type { Attachment } from '../lib/types';
import { displayUri } from '../lib/webFiles';
import { HtmlView } from './HtmlView';
import { ShareToFriendSheet } from './ShareToFriendSheet';
import { Sheet } from './TextPrompt';
import { EmptyState, Icon, IconButton, PillButton } from './ui';
import type { IconName } from './ui';
import { Text } from './Text';

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

const ext = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();

/** Office, PDF and HTML files by extension too: generated files sometimes carry a generic type. */
const BY_EXT: Record<string, [IconName, string]> = {
  xlsx: ['grid', 'Excel spreadsheet'],
  xls: ['grid', 'Excel spreadsheet'],
  docx: ['file-text', 'Word document'],
  doc: ['file-text', 'Word document'],
  pptx: ['monitor', 'PowerPoint'],
  ppt: ['monitor', 'PowerPoint'],
  pdf: ['file-text', 'PDF'],
  html: ['globe', 'HTML document'],
  htm: ['globe', 'HTML document'],
};

/** HTML pages read as documents: they open right here in the viewer. */
const isHtmlDoc = (a: Pick<Attachment, 'name' | 'mimeType'>) => a.mimeType === 'text/html';

export const fileIcon = (a: Pick<Attachment, 'name' | 'mimeType'>): IconName => {
  if (isHtmlDoc(a)) return 'globe';
  const g = fileGroup(a.name, a.mimeType);
  if (g === 'other' || g === 'code' || g === 'archive') return BY_EXT[ext(a.name)]?.[0] ?? ICONS[g];
  return ICONS[g];
};

/** "PDF", "Word document", "Excel spreadsheet", "PowerPoint", "HTML document", "PNG image"… */
export function fileTypeLabel(a: Pick<Attachment, 'name' | 'mimeType'>): string {
  if (isHtmlDoc(a)) return 'HTML document';
  const byExt = BY_EXT[ext(a.name)]?.[1];
  const label = typeLabel(a.name, a.mimeType);
  if (byExt && /file$|^File$|archive$|^Spreadsheet$|^Presentation$/.test(label)) return byExt;
  return label;
}

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
                  style={[images.length === 1 ? styles.single : styles.multi, { backgroundColor: theme.fill, borderColor: theme.border }]}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.multi, styles.missing, { backgroundColor: theme.fill, borderColor: theme.border }]}>
                  <Icon name="image" size={20} />
                  <Text style={[TYPE.caption, { color: theme.inkFaint, fontSize: 12, marginTop: 4, textAlign: 'center' }]}>Not on this device</Text>
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

/** The 40px tile on `fill` with the file's type icon. */
export function FileTile({ file, size = 40 }: { file: Pick<Attachment, 'name' | 'mimeType'>; size?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: theme.fill }]}>
      <Icon name={fileIcon(file)} size={size >= 40 ? 20 : 16} color={theme.ink} />
    </View>
  );
}

/** One non-image file: icon, name, type · size, and Open / Share / Save / more. */
export function FileCard({ file: a, onOpen, onMore }: { file: Attachment; onOpen: () => void; onMore: () => void }) {
  const theme = useTheme();
  const here = fileOnDevice(a);
  const type = fileTypeLabel(a);
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        onPress={onOpen}
        onLongPress={onMore}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.cardMain, (pressed || hovered) && { backgroundColor: theme.fill }]}
        accessibilityRole="button"
        accessibilityLabel={`${a.name}, ${type}, ${formatSize(a.size)}. Tap to open, long-press for options`}
      >
        <FileTile file={a} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '500' }]} numberOfLines={2}>
            {a.name}
          </Text>
          <Text style={[TYPE.codeLabel, { color: theme.inkFaint, marginTop: 2 }]} numberOfLines={1}>
            {here ? `${type} · ${formatSize(a.size)}` : 'Not on this device'}
          </Text>
        </View>
      </Pressable>
      {here && (
        <View style={[styles.cardActions, { borderTopColor: theme.border }]}>
          <CardButton icon="eye" label="Open" onPress={onOpen} />
          <CardButton icon="share" label="Share" onPress={() => act(() => shareFile(a))} />
          <CardButton icon="download" label="Save" onPress={() => act(() => saveWithFeedback(a))} />
          <IconButton name="more-horizontal" label={`More options for ${a.name}`} onPress={onMore} />
        </View>
      )}
    </View>
  );
}

function CardButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.cardBtn, (pressed || hovered) && { backgroundColor: theme.fill }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={16} />
      <Text style={[TYPE.subhead, { color: theme.ink }]}>{label}</Text>
    </Pressable>
  );
}

/** Sheet with everything you can do with a file. */
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
  const firstDestructive = options.findIndex((o) => o.destructive);
  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible transparent animationType="fade" onRequestClose={onClose}>
      <Sheet title={file.name} subtitle={here ? `${fileTypeLabel(file)} · ${formatSize(file.size)}` : 'Not on this device'} onClose={onClose}>
        <ScrollView style={{ flexShrink: 1 }} bounces={false}>
          {options.map((o, i) => (
            <View key={o.label}>
              {i > 0 && i === firstDestructive && <View style={[styles.optionRule, { backgroundColor: theme.border }]} />}
              <Pressable
                onPress={() => {
                  onClose();
                  o.run();
                }}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.option, (pressed || hovered) && { backgroundColor: theme.fill }]}
                accessibilityRole="button"
                accessibilityLabel={o.label}
              >
                <Icon name={o.icon} size={20} color={o.destructive ? theme.danger : theme.inkMuted} />
                <Text style={[TYPE.callout, { color: o.destructive ? theme.danger : theme.ink }]}>{o.label}</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </Sheet>
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
  const folder = file.uri.slice(0, file.uri.lastIndexOf('/') + 1);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <View style={[styles.viewerBar, { borderBottomColor: theme.border }]}>
          <IconButton name="x" label="Close" onPress={onClose} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[TYPE.headline, { color: theme.ink, fontSize: 16 }]} numberOfLines={1}>
              {file.name}
            </Text>
            <Text style={[TYPE.codeLabel, { color: theme.inkFaint }]} numberOfLines={1}>
              {fileTypeLabel(file)} · {formatSize(file.size)}
            </Text>
          </View>
          <IconButton name="share" label="Share" onPress={() => act(() => shareFile(file))} />
          <IconButton name="more-horizontal" label="More options" onPress={() => onMore(file)} />
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
            <ActivityIndicator color={theme.inkMuted} style={{ marginTop: 40 }} />
          ) : isHtml && text !== null ? (
            <HtmlView html={text} />
          ) : isText && text !== null ? (
            <ScrollView style={{ backgroundColor: theme.codeBg }} contentContainerStyle={{ padding: 16 }}>
              <Text selectable style={[TYPE.code, { color: theme.codeInk }]}>
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
            <EmptyState
              icon={fileIcon(file)}
              title={`${fileTypeLabel(file)} · ${formatSize(file.size)}`}
              action={<PillButton title="Open with another app" icon="external-link" onPress={() => act(() => openWithApp(file))} />}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              There’s no preview for this file here. Open it in another app.
            </EmptyState>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  imageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  single: { width: 240, height: 240, borderRadius: RADIUS.md, borderWidth: 1 },
  multi: { width: 116, height: 116, borderRadius: RADIUS.sm, borderWidth: 1 },
  missing: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  tile: { borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: RADIUS.md, overflow: 'hidden', maxWidth: 420 },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 64 },
  cardActions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
  cardBtn: { flex: 1, minHeight: 44, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, minHeight: 52, borderRadius: RADIUS.sm },
  optionRule: { height: StyleSheet.hairlineWidth, marginVertical: 4, marginHorizontal: 12 },
  viewerBar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth },
});
