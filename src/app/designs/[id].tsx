import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HtmlView } from '../../components/HtmlView';
import { TextPrompt } from '../../components/TextPrompt';
import { Icon } from '../../components/ui';
import { chat } from '../../lib/api';
import { canvasSystemPrompt, exportBoardHtml, exportBoardPdf, exportBoardPng, exportPrototypeHtml, parseBoardEdits } from '../../lib/designTools';
import { addBoard, canvasDocument, deleteBoard, duplicateBoard, renameDesign, updateBoard, useDesign } from '../../lib/designs';
import type { Board } from '../../lib/designs';
import { shareFile } from '../../lib/fileActions';
import { uid } from '../../lib/id';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import type { Attachment } from '../../lib/types';

/** Last pan/zoom per design, so rebuilding the canvas (new boards, coming back) keeps the view. */
const lastView = new Map<string, { x: number; y: number; k: number }>();

/** Infinite canvas of a design's boards, with a prompt bar that asks the model for new or changed screens. */
export default function DesignCanvas() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const design = useDesign(id);
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const { settings } = useStore();
  const [fitKey, setFitKey] = useState(0);
  const token = useMemo(() => uid(), []);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [stoppable, setStoppable] = useState(false);
  const [renaming, setRenaming] = useState<Board | 'design' | null>(null);

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
    setBusy('Designing…');
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStoppable(true);
    try {
      let shown = 0;
      const reply = await chat({
        settings,
        model: settings.model,
        signal: ctrl.signal,
        messages: [
          { role: 'system', content: canvasSystemPrompt(design) },
          { role: 'user', content: text },
        ],
        onText: (t) => {
          const n = (t.match(/<board\b/gi) ?? []).length;
          if (n !== shown) {
            shown = n;
            setBusy(`Designing screen ${n}…`);
          }
        },
      });
      const edits = parseBoardEdits(reply);
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
        <Text style={{ color: theme.muted }}>This design no longer exists.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface2 }}>
      <Stack.Screen
        options={{
          title: design.title,
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 18, alignItems: 'center' }}>
              <Pressable onPress={() => {
                  lastView.delete(design.id);
                  setFitKey((k) => k + 1);
                }} hitSlop={10} accessibilityLabel="Zoom to fit">
                <Icon name="maximize" size={19} color={theme.text} />
              </Pressable>
              <Pressable
                onPress={() => design.boards.length && router.push({ pathname: '/designs/play', params: { id: design.id } })}
                hitSlop={10}
                accessibilityLabel="Play prototype"
              >
                <Icon name="play" size={19} color={theme.text} />
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.alert(design.title, undefined, [
                    { text: 'Rename design', onPress: () => setRenaming('design') },
                    { text: 'Share prototype (HTML)', onPress: () => run('Preparing…', () => exportPrototypeHtml(design)) },
                    { text: 'Cancel', style: 'cancel' },
                  ])
                }
                hitSlop={10}
                accessibilityLabel="Design options"
              >
                <Icon name="more-horizontal" size={20} color={theme.text} />
              </Pressable>
            </View>
          ),
        }}
      />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          <HtmlView html={html} background={theme.surface2} onMessage={onMessage} />
          {!!busy && (
            <View style={[styles.busy, { backgroundColor: theme.text }]}>
              <ActivityIndicator size="small" color={theme.bg} />
              <Text style={{ color: theme.bg, fontSize: 13, fontWeight: '600' }}>{busy}</Text>
              {stoppable && (
                <Pressable onPress={() => abort.current?.abort()} hitSlop={8} accessibilityLabel="Stop">
                  <Icon name="x" size={16} color={theme.bg} />
                </Pressable>
              )}
            </View>
          )}
        </View>
        <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={[styles.bar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Icon name="pen-tool" size={17} color={theme.accent} />
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Describe a screen or change…"
              placeholderTextColor={theme.faint}
              style={[styles.input, { color: theme.text }]}
              multiline
              onSubmitEditing={send}
              submitBehavior="submit"
              returnKeyType="send"
              accessibilityLabel="Describe a screen or change"
            />
            <Pressable
              onPress={send}
              disabled={!prompt.trim() || !!busy}
              accessibilityLabel="Send"
              style={[styles.send, { backgroundColor: prompt.trim() && !busy ? theme.accent : theme.oat }]}
            >
              <Icon name="arrow-up" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
          <Text style={{ color: theme.faint, fontSize: 11, textAlign: 'center', marginTop: 6 }}>
            Tap a board to preview · long-press for more · pinch or scroll to zoom
          </Text>
        </View>
      </KeyboardAvoidingView>
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
  busy: { position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  barWrap: { paddingHorizontal: 12, paddingTop: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, paddingLeft: 16, paddingRight: 6, paddingVertical: 6, maxWidth: 760, width: '100%', alignSelf: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  input: { flex: 1, fontSize: 15, maxHeight: 120, paddingVertical: 8, alignSelf: 'center' },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
