import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HtmlView } from '../../components/HtmlView';
import { KeyboardPadded } from '../../components/KeyboardPadded';
import { TextPrompt } from '../../components/TextPrompt';
import { EmptyState, Icon, IconButton, RunningDot } from '../../components/ui';
import { chat } from '../../lib/api';
import { canvasSystemPrompt, exportBoardHtml, exportBoardPdf, exportBoardPng, exportPrototypeHtml, parseBoardEdits } from '../../lib/designTools';
import { addBoard, canvasDocument, deleteBoard, duplicateBoard, renameDesign, updateBoard, useDesign } from '../../lib/designs';
import type { Board } from '../../lib/designs';
import { shareFile } from '../../lib/fileActions';
import { uid } from '../../lib/id';
import { useStore } from '../../lib/store';
import { RADIUS, SIZE, TYPE, shadow, useTheme } from '../../lib/theme';
import type { Attachment } from '../../lib/types';
import { Text, TextInput } from '../../components/Text';

/** Last pan/zoom per design, so rebuilding the canvas (new boards, coming back) keeps the view. */
const lastView = new Map<string, { x: number; y: number; k: number }>();

/** The one-sentence summary the model writes before its first board. */
function summaryOf(text: string): string | null {
  const at = text.search(/<board\b/i);
  const lead = (at === -1 ? text : text.slice(0, at)).replace(/<[^>]+>/g, '').replace(/```\w*/g, '').trim();
  return lead || null;
}

/** "Writing html… N lines" while boards stream in. */
function writingStatus(text: string): string {
  const at = text.search(/<board\b/i);
  if (at === -1) return 'Designing…';
  const lines = text.slice(at).split('\n').length;
  return `Writing html… ${lines} line${lines === 1 ? '' : 's'}`;
}

/** Infinite canvas of a design's boards, with a prompt bar that asks the model for new or changed screens. */
export default function DesignCanvas() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const design = useDesign(id);
  const theme = useTheme();
  const dark = theme.dark;
  const insets = useSafeAreaInsets();
  const { settings } = useStore();
  const [fitKey, setFitKey] = useState(0);
  const token = useMemo(() => uid(), []);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [stoppable, setStoppable] = useState(false);
  const [renaming, setRenaming] = useState<Board | 'design' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Rebuilt when boards change (keeping the current pan/zoom) or "Fit" is pressed.
  const boardsKey = design ? design.boards.map((b) => `${b.id}:${b.name}:${b.x}:${b.y}:${b.html.length}:${b.html.slice(-64)}`).join('|') : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => (design ? canvasDocument(design, lastView.get(design.id) ?? null, dark, token) : ''), [boardsKey, dark, fitKey, token]);

  const run = async (label: string, make: () => Promise<Attachment> | Attachment) => {
    setBusy(label);
    try {
      await shareFile(await make());
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const boardMenu = useCallback(
    (b: Board) => {
      if (!design) return;
      Alert.alert(b.name, `${b.width} × ${b.height}`, [
        { text: 'Open preview', onPress: () => router.push({ pathname: '/designs/play', params: { id: design.id, board: b.id } }) },
        { text: 'Rename', onPress: () => setRenaming(b) },
        { text: 'Duplicate', onPress: () => duplicateBoard(design.id, b.id) },
        { text: 'Export PNG', onPress: () => run('Exporting PNG…', () => exportBoardPng(b)) },
        { text: 'Export PDF', onPress: () => run('Exporting PDF…', () => exportBoardPdf(b)) },
        { text: 'Share HTML', onPress: () => run('Preparing…', () => exportBoardHtml(b)) },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            Alert.alert(`Delete ${b.name}?`, undefined, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deleteBoard(design.id, b.id) },
            ]),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [design],
  );

  const onMessage = (data: string) => {
    let m: any;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m?.token !== token || !design) return;
    if (m.type === 'view') lastView.set(design.id, { x: m.x, y: m.y, k: m.k });
    const b = design.boards.find((x) => x.id === m.id);
    if (m.type === 'tap' && b) router.push({ pathname: '/designs/play', params: { id: design.id, board: b.id } });
    if (m.type === 'longpress' && b) boardMenu(b);
  };

  const send = async () => {
    const text = prompt.trim();
    if (!text || !design || busy) return;
    if (!settings.apiKey && !settings.baseUrl) return Alert.alert('Set up a model', 'Add your API key and model in Settings first.');
    setPrompt('');
    setNote(null);
    setBusy('Designing…');
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStoppable(true);
    try {
      let shown = '';
      let noted = false;
      const reply = await chat({
        settings,
        model: settings.model,
        signal: ctrl.signal,
        messages: [
          { role: 'system', content: canvasSystemPrompt(design) },
          { role: 'user', content: text },
        ],
        onText: (t) => {
          const status = writingStatus(t);
          if (status !== shown) {
            shown = status;
            setBusy(status);
          }
          if (!noted && /<board\b/i.test(t)) {
            noted = true;
            setNote(summaryOf(t));
          }
        },
      });
      const edits = parseBoardEdits(reply);
      if (!noted) setNote(summaryOf(reply));
      if (!edits.length) {
        Alert.alert('No screens in the reply', reply.replace(/<[^>]+>/g, '').slice(0, 400) || 'Try describing the screen in more detail.');
        return;
      }
      for (const e of edits) {
        const existing = (e.id && design.boards.find((b) => b.id === e.id)) || design.boards.find((b) => e.name && b.name.toLowerCase() === e.name.toLowerCase());
        if (existing) updateBoard(design.id, existing.id, { html: e.html, ...(e.name ? { name: e.name } : {}) });
        else await addBoard(design.id, { name: e.name, html: e.html, width: e.width, height: e.height });
      }
    } catch (e) {
      if (!ctrl.signal.aborted) Alert.alert('Design failed', e instanceof Error ? e.message : String(e));
    } finally {
      abort.current = null;
      setStoppable(false);
      setBusy(null);
    }
  };

  if (!design) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <EmptyState icon="pen-tool" title="This design no longer exists." />
      </View>
    );
  }

  const canSend = !!prompt.trim() && !busy;
  const screens = `${design.boards.length} screen${design.boards.length === 1 ? '' : 's'}`;
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          title: design.title,
          headerTitle: () => (
            <Pressable
              onPress={() => setRenaming('design')}
              accessibilityRole="button"
              accessibilityLabel={design.title}
              accessibilityHint="Rename design"
              style={styles.titleButton}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 220 }}>
                <Text style={{ color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
                  {design.title}
                </Text>
                <Icon name="edit-2" size={12} color={theme.inkFaint} />
              </View>
              <Text style={{ color: theme.inkMuted, fontSize: 12, lineHeight: 16 }} numberOfLines={1}>
                {screens}
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <IconButton
                name="play"
                label="Play prototype"
                onPress={() => design.boards.length && router.push({ pathname: '/designs/play', params: { id: design.id } })}
              />
              <IconButton name="share" label="Share prototype (HTML)" onPress={() => run('Preparing…', () => exportPrototypeHtml(design))} />
            </View>
          ),
        }}
      />
      <KeyboardPadded bottomInset={Math.max(insets.bottom, 10) - 8}>
        <View style={{ flex: 1, backgroundColor: theme.dark ? theme.codeBg : theme.fill, borderTopWidth: 1, borderTopColor: theme.border }}>
          <HtmlView html={html} background={theme.dark ? theme.codeBg : theme.fill} onMessage={onMessage} />
          {!!busy && (
            <View
              accessibilityRole="progressbar"
              accessibilityLiveRegion="polite"
              style={[styles.busy, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }, shadow(theme, 'raised')]}
            >
              <RunningDot />
              <Text style={{ color: theme.ink, fontSize: 13, lineHeight: 18 }}>{busy}</Text>
            </View>
          )}
          <IconButton
            name="maximize"
            label="Zoom to fit"
            size={18}
            onPress={() => {
              lastView.delete(design.id);
              setFitKey((k) => k + 1);
            }}
            style={[styles.fit, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }, shadow(theme, 'raised')]}
          />
        </View>
        <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, 10), backgroundColor: theme.bg, borderTopColor: theme.border }]}>
          <Text style={note ? [TYPE.callout, styles.note, { color: theme.ink }] : [styles.note, { color: theme.inkFaint, fontSize: 12, lineHeight: 16 }]} numberOfLines={3}>
            {note ?? 'Tap a board to preview · long-press for more · pinch or scroll to zoom'}
          </Text>
          <View style={[styles.bar, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }, shadow(theme, 'raised')]}>
            <Icon name="pen-tool" size={18} color={theme.inkFaint} style={{ marginLeft: 10 }} />
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Describe a screen or change…"
              style={[styles.input, { color: theme.ink }]}
              multiline
              onSubmitEditing={send}
              submitBehavior="submit"
              returnKeyType="send"
              accessibilityLabel="Describe a screen or change"
            />
            {stoppable ? (
              <Pressable onPress={() => abort.current?.abort()} accessibilityRole="button" accessibilityLabel="Stop" style={[styles.send, { backgroundColor: theme.ink }]}>
                <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: theme.bg }} />
              </Pressable>
            ) : (
              <Pressable
                onPress={send}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="Send"
                accessibilityState={{ disabled: !canSend }}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.send,
                  canSend
                    ? [{ backgroundColor: pressed ? theme.accentPress : hovered ? theme.accentHover : theme.accent }, shadow(theme, 'glow')]
                    : { backgroundColor: theme.fill },
                ]}
              >
                <Icon name="arrow-up" size={22} color={canSend ? theme.onAccent : theme.inkFaint} />
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardPadded>
      <TextPrompt
        visible={!!renaming}
        title={renaming === 'design' ? 'Rename design' : 'Rename board'}
        initialValue={renaming === 'design' ? design.title : renaming?.name}
        onClose={() => setRenaming(null)}
        onSubmit={(t) => {
          if (renaming === 'design') renameDesign(design.id, t);
          else if (renaming && t.trim()) updateBoard(design.id, renaming.id, { name: t.trim() });
          setRenaming(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  titleButton: { alignItems: 'center', justifyContent: 'center', minHeight: SIZE.controlMd, paddingHorizontal: 6 },
  busy: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 32,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  fit: { position: 'absolute', right: 12, bottom: 12, borderWidth: 1 },
  barWrap: { paddingHorizontal: 12, paddingTop: 10, gap: 10, borderTopWidth: 1 },
  note: { marginHorizontal: 4, maxWidth: SIZE.contentMax, width: '100%', alignSelf: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: 4,
    maxWidth: SIZE.contentMax,
    width: '100%',
    alignSelf: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    minHeight: SIZE.controlMd,
    paddingHorizontal: 4,
    paddingVertical: 11,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  send: { width: 40, height: 40, margin: 2, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
});
