import { TasksPill } from '../../components/TasksPill';
import * as Clipboard from 'expo-clipboard';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import type { ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachSheet, MessageAttachments, PendingAttachments } from '../../components/Attachments';
import type { AttachSource } from '../../components/Attachments';
import { FileCards } from '../../components/FileCards';
import { KeyboardPadded } from '../../components/KeyboardPadded';
import { Banner, Icon, IconButton, Mark, TextAction } from '../../components/ui';
import type { IconName } from '../../components/ui';
import { SlashMenu, isTypingSlashCommand } from '../../components/SlashMenu';
import { pickFiles, pickImages, takePhoto, transcribeVoice, voiceAttachment } from '../../lib/attachments';
import { takeQueuedAttachments } from '../../lib/library';
import { VoiceRecorder } from '../../components/Voice';
import { Markdown } from '../../components/Markdown';
import { ModelPicker } from '../../components/ModelPicker';
import { MoveToProjectSheet } from '../../components/MoveToProjectSheet';
import { ToolCallCard } from '../../components/ToolCallCard';
import { TextPrompt } from '../../components/TextPrompt';
import { resolveSlashCommand } from '../../lib/plugins';
import { useStore } from '../../lib/store';
import { githubConnected, laptopConnected } from '../../lib/tools';
import { FONT, RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, shadow, useTheme } from '../../lib/theme';
import type { Attachment, ChatMessage } from '../../lib/types';
import { Text, TextInput } from '../../components/Text';

const SUGGESTIONS = [
  'Build me a to-do list app',
  'Make a snake game I can play',
  'Remember that I prefer short answers',
  'Explain how APIs work, simply',
];

const TOOL_SUGGESTIONS = [
  'List my GitHub repositories',
  'What files are in my project folder on my laptop?',
];

const SUGGESTION_ICONS: Record<string, IconName> = {
  'Build me a to-do list app': 'check-square',
  'Make a snake game I can play': 'play',
  'Remember that I prefer short answers': 'book-open',
  'Explain how APIs work, simply': 'help-circle',
  'List my GitHub repositories': 'github',
  'What files are in my project folder on my laptop?': 'monitor',
};

/** Content column on wide screens: the transcript and composer centre at 760px with 24px gutters. */
const WIDE_COLUMN: ViewStyle = { width: '100%', maxWidth: SIZE.contentMax, alignSelf: 'center', paddingHorizontal: 24 };

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const store = useStore();
  const conv = store.conversations.find((c) => c.id === id);
  const busy = !!store.busy[id];
  const [input, setInput] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [pending, setPending] = useState<Attachment[]>(() => takeQueuedAttachments(id)); // "Attach to a new chat" from Files
  const [attaching, setAttaching] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sendingVoice, setSendingVoice] = useState(false);
  const [focused, setFocused] = useState(false);
  const wide = useWindowDimensions().width >= WIDE_BREAKPOINT;
  const column: ViewStyle = wide ? WIDE_COLUMN : styles.phoneColumn;
  // Composer keeps a constant bottom inset; the avoiding view subtracts it while the keyboard is up
  // (keyboard height already covers the nav bar), so nothing doubles and nothing jumps mid-animation.
  const composerBottom = Math.max(insets.bottom, 10);
  const inputRef = useRef<TextInput>(null);

  if (!conv) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[TYPE.callout, { color: theme.inkMuted }]}>This chat no longer exists.</Text>
      </View>
    );
  }

  const model = conv.model || store.settings.model;
  const project = store.projects.find((p) => p.id === conv.projectId);
  const lastAssistantId = [...conv.messages].reverse().find((m) => m.role === 'assistant')?.id;

  const canSend = !!input.trim() || pending.length > 0;
  const slashOpen = isTypingSlashCommand(input);

  const send = (text = input) => {
    if ((!text.trim() && !pending.length) || busy || attaching) return;
    setInput('');
    const attachments = pending;
    setPending([]);
    // "/command args" from an enabled plugin expands to its prompt; the bubble keeps what was typed.
    // Unknown "/something" is just text.
    const match = resolveSlashCommand(text, store.commands);
    if (match?.prompt) store.send(id, match.prompt, attachments, text.trim());
    else store.send(id, text, attachments);
  };

  const sendVoice = async (uri: string, durationMs: number) => {
    setSendingVoice(true);
    try {
      const a = await voiceAttachment(uri, durationMs);
      let text: string;
      try {
        const result = await transcribeVoice(store.settings, a);
        text = result.text;
        // Remember a model the server accepted so the next voice note uses it straight away.
        if (result.model !== (store.settings.transcriptionModel || 'whisper-1')) store.updateSettings({ transcriptionModel: result.model });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        a.voice = { durationMs, transcriptError: reason };
        text = `[Voice message — transcription unavailable: ${reason}]`;
      }
      store.send(id, text, [a, ...pending]);
      setPending([]);
      setRecording(false);
    } catch (e) {
      Alert.alert("Couldn't send voice message", e instanceof Error ? e.message : String(e));
    } finally {
      setSendingVoice(false);
    }
  };

  const pickCommand = (token: string) => {
    setInput(`/${token} `);
    inputRef.current?.focus();
  };

  const startCommand = () => {
    setInput('/');
    inputRef.current?.focus();
  };

  const attach = async (source: AttachSource) => {
    setAttaching(true);
    try {
      const added = await (source === 'photos' ? pickImages() : source === 'camera' ? takePhoto() : pickFiles());
      setPending((p) => [...p, ...added].slice(0, 10));
    } catch (e) {
      Alert.alert("Couldn't attach", e instanceof Error ? e.message : String(e));
    } finally {
      setAttaching(false);
    }
  };

  const onMessageLongPress = (m: ChatMessage) => {
    const shown = m.displayText ?? m.content;
    Alert.alert('Message', undefined, [
      { text: 'Copy', onPress: () => Clipboard.setStringAsync(shown) },
      ...(m.role === 'user' ? [{ text: 'Edit & resend', onPress: () => setInput(shown) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    if (item.toolResult) return null; // shown inside the tool card instead
    if (item.role === 'user') {
      return (
        <Pressable onLongPress={() => onMessageLongPress(item)} style={[column, styles.userRow]}>
          {!!item.attachments?.length && <MessageAttachments items={item.attachments} />}
          {item.displayText ? (
            <View style={[styles.userBubble, { backgroundColor: theme.userBubble }]}>
              <CommandText text={item.displayText} />
            </View>
          ) : !!item.content && !item.attachments?.some((a) => a.voice?.transcriptError) && (
            <View style={[styles.userBubble, { backgroundColor: theme.userBubble }]}>
              <Text selectable style={[TYPE.body, { color: theme.ink }]}>
                {item.content}
              </Text>
            </View>
          )}
        </Pressable>
      );
    }
    const streaming = busy && item.id === lastAssistantId;
    return (
      <Pressable onLongPress={() => onMessageLongPress(item)} style={[column, styles.assistantRow]}>
        {item.content ? <Markdown text={item.content} /> : null}
        {item.toolCall && (
          <ToolCallCard
            call={item.toolCall}
            onApprove={(extra) => store.approveTool(id, item.id, extra)}
            onDeny={() => store.denyTool(id, item.id)}
          />
        )}
        {!!item.toolCall?.files?.length && (
          <FileCards files={item.toolCall.files} conversationId={id} />
        )}
        {streaming && !item.content && !item.toolCall && <ActivityIndicator color={theme.inkMuted} style={{ alignSelf: 'flex-start' }} />}
        {!!item.error && (
          <View style={[styles.error, { backgroundColor: theme.dangerSoft }]}>
            <Icon name="alert-circle" size={20} color={theme.danger} style={{ marginTop: 12 }} />
            <Text style={[styles.errorText, { color: theme.ink }]}>{item.error}</Text>
            <TextAction title="Retry" onPress={() => store.regenerate(id)} />
          </View>
        )}
        {!streaming && !item.error && !item.toolCall && item.id === lastAssistantId && (
          <View style={styles.actions}>
            <MessageAction icon="copy" label="Copy" onPress={() => Clipboard.setStringAsync(item.content)} />
            <MessageAction icon="refresh-cw" label="Regenerate" onPress={() => store.regenerate(id)} />
          </View>
        )}
      </Pressable>
    );
  };

  const suggestions = [
    ...(githubConnected(store.settings) ? [TOOL_SUGGESTIONS[0]] : []),
    ...(laptopConnected(store.settings) ? [TOOL_SUGGESTIONS[1]] : []),
    ...SUGGESTIONS,
  ].slice(0, 5);
  // Two per row; an odd last card spans the row.
  const suggestionRows: string[][] = [];
  for (let i = 0; i < suggestions.length; i += 2) suggestionRows.push(suggestions.slice(i, i + 2));

  const sendDisabled = !canSend || attaching;

  return (
    // Android draws edge-to-edge, so the window no longer shrinks for the keyboard: the screen pads itself by the
    // keyboard's height, keeping the composer 8pt above it.
    <KeyboardPadded bottomInset={composerBottom - 8} style={{ backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          // On wide screens the sidebar handles navigation.
          headerBackVisible: !wide,
          headerTitle: () => (
            <View style={[styles.titleBlock, { maxWidth: wide ? 480 : 220 }, wide && styles.titleBlockWide]}>
              <Pressable
                onPress={() => setRenaming(true)}
                accessibilityRole="button"
                accessibilityLabel={conv.title}
                accessibilityHint="Rename chat"
                style={{ flexShrink: 1 }}
              >
                <Text numberOfLines={1} style={[styles.title, { color: theme.ink }]}>
                  {conv.title}
                </Text>
              </Pressable>
              <View style={styles.subtitle}>
                {project && (
                  <Text numberOfLines={1} style={[TYPE.caption, { color: theme.inkMuted, fontSize: 12, lineHeight: 16, flexShrink: 1 }]}>
                    {project.name} ·
                  </Text>
                )}
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  hitSlop={{ top: 2, bottom: 10, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Choose model"
                  accessibilityValue={{ text: model || 'None' }}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.modelChip,
                    wide && { backgroundColor: theme.fill, height: 28 },
                    (pressed || hovered) && { backgroundColor: theme.fill },
                  ]}
                >
                  <Text numberOfLines={1} style={[TYPE.codeLabel, { color: model ? theme.inkMuted : theme.danger, flexShrink: 1 }]}>
                    {model || 'Choose model'}
                  </Text>
                  <Icon name="chevron-down" size={12} color={theme.inkMuted} />
                </Pressable>
              </View>
            </View>
          ),
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TasksPill conversationId={conv.id} hideWhenIdle />
              <IconButton
                name="folder"
                onPress={() => setMoving(true)}
                label={project ? `In project ${project.name}. Move to another project` : 'Move to project'}
                color={project ? theme.ink : theme.inkMuted}
              />
            </View>
          ),
        }}
      />

      <View style={styles.flex}>
        {conv.messages.length === 0 ? (
          <ScrollView contentContainerStyle={[styles.emptyState, column]} keyboardShouldPersistTaps="handled">
            <View style={styles.emptyInner}>
              <View style={[styles.markTile, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Mark size={40} />
              </View>
              <Text style={[TYPE.display, styles.greeting, { color: theme.ink }]} accessibilityRole="header">
                {greeting()}
                {store.account ? `, ${store.account.user.name}` : ''}
              </Text>
              <Text style={[TYPE.body, { color: theme.inkMuted, textAlign: 'center', maxWidth: 360 }]}>
                Ask anything, build an app that runs right here, or save a memory.
              </Text>
              <View style={styles.suggestions}>
                {suggestionRows.map((row) => (
                  <View key={row.join('|')} style={styles.suggestionRow}>
                    {row.map((s) => (
                      <Pressable
                        key={s}
                        onPress={() => send(s)}
                        accessibilityRole="button"
                        accessibilityLabel={s}
                        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                          styles.suggestion,
                          { backgroundColor: pressed || hovered ? theme.fill : theme.surface, borderColor: theme.border },
                        ]}
                      >
                        <Icon name={SUGGESTION_ICONS[s] ?? 'message-circle'} size={16} color={theme.inkMuted} />
                        <Text style={{ color: theme.ink, fontSize: 14, lineHeight: 20 }}>{s}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
              {store.commands.length > 0 && (
                <Pressable onPress={startCommand} style={styles.hint} accessibilityRole="button" accessibilityLabel="Type slash to use plugin commands">
                  <Text style={[TYPE.caption, { color: theme.inkMuted }]}>
                    Type <Text style={[styles.inlineCode, { color: theme.ink, backgroundColor: theme.fill }]}> / </Text> to use plugin commands
                  </Text>
                </Pressable>
              )}
              {!model && (
                <Banner tone="danger" title="No model selected — open Settings" onPress={() => router.push('/settings')} style={{ marginTop: 16, alignSelf: 'stretch' }} />
              )}
            </View>
          </ScrollView>
        ) : (
          <FlatList
            inverted
            data={[...conv.messages].reverse()}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={{ paddingVertical: 16 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          />
        )}
        {slashOpen && (
          // Floats over the bottom of the conversation, just above the composer, and rises with the keyboard.
          <View style={[styles.slashLayer, wide && { left: 24, right: 24 }]}>
            <SlashMenu
              query={input.slice(1)}
              commands={store.commands}
              onSelect={pickCommand}
              onOpenPlugins={() => router.push('/plugins')}
              style={wide ? styles.wideInner : undefined}
            />
          </View>
        )}
      </View>

      <View style={[styles.composerWrap, wide && { paddingHorizontal: 24 }, { paddingBottom: composerBottom }]}>
        <View
          style={[
            styles.composer,
            wide && styles.wideInner,
            { backgroundColor: theme.surfaceRaised, borderColor: focused ? theme.accent : theme.border },
            shadow(theme, focused ? 'glow' : 'raised'),
          ]}
        >
          <PendingAttachments items={pending} onRemove={(aid) => setPending((p) => p.filter((x) => x.id !== aid))} />
          <View style={styles.composerRow}>
            {!recording && (
              <Pressable
                onPress={() => setAttachOpen(true)}
                disabled={attaching}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.roundBtn,
                  (pressed || hovered) && { backgroundColor: theme.fill },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Attach photos or files"
                accessibilityState={{ disabled: attaching, busy: attaching }}
              >
                {attaching ? <ActivityIndicator size="small" color={theme.inkMuted} /> : <Icon name="plus" size={20} color={theme.inkMuted} />}
              </Pressable>
            )}
            <TextInput
              ref={inputRef}
              value={input}
              onChangeText={setInput}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={conv.messages.length ? 'Reply to TryChat' : 'How can I help you today?'}
              multiline
              onKeyPress={(e) => {
                // Desktop/web: Enter sends, Shift+Enter adds a newline. Phones keep Return = newline.
                const ne = e.nativeEvent as { key: string; shiftKey?: boolean };
                if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              style={[styles.input, { color: theme.ink }, slashOpen && { fontFamily: FONT.mono, fontSize: 15 }]}
              accessibilityLabel="Message"
              testID="composer"
            />
            {!recording && (
              <IconButton name="mic" label="Record voice message" onPress={() => setRecording(true)} disabled={attaching || busy} />
            )}
            {!recording &&
              (busy ? (
                <Pressable
                  onPress={() => store.stop(id)}
                  hitSlop={2}
                  style={[styles.sendBtn, { backgroundColor: theme.ink }]}
                  accessibilityRole="button"
                  accessibilityLabel="Stop generating"
                >
                  <View style={[styles.stopSquare, { backgroundColor: theme.onAccent }]} />
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => send()}
                  disabled={sendDisabled}
                  hitSlop={2}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.sendBtn,
                    sendDisabled
                      ? { backgroundColor: theme.fill }
                      : [{ backgroundColor: pressed ? theme.accentPress : hovered ? theme.accentHover : theme.accent }, shadow(theme, 'glow')],
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  accessibilityState={{ disabled: sendDisabled }}
                >
                  <Icon name="arrow-up" size={22} color={sendDisabled ? theme.inkFaint : theme.onAccent} />
                </Pressable>
              ))}
          </View>
          {recording && (
            <VoiceRecorder onCancel={() => setRecording(false)} onSend={sendVoice} sending={sendingVoice} />
          )}
        </View>
        {wide && Platform.OS === 'web' && (
          <Text style={[styles.keysHint, { color: theme.inkFaint }]}>Enter sends · Shift+Enter makes a new line</Text>
        )}
      </View>

      <AttachSheet visible={attachOpen} onClose={() => setAttachOpen(false)} onPick={attach} />
      <MoveToProjectSheet conversationId={moving ? id : null} onClose={() => setMoving(false)} />
      <ModelPicker
        visible={pickerOpen}
        selected={model}
        onSelect={(m) => store.setConversationModel(id, m)}
        onClose={() => setPickerOpen(false)}
      />
      <TextPrompt
        visible={renaming}
        title="Rename chat"
        initialValue={conv.title}
        onSubmit={(t) => store.renameConversation(id, t)}
        onClose={() => setRenaming(false)}
      />
    </KeyboardPadded>
  );
}

/** Copy / Regenerate under the last reply: faint until hovered or pressed. */
function MessageAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.action,
        (pressed || hovered) && { backgroundColor: theme.fill },
      ]}
    >
      {({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => (
        <>
          <Icon name={icon} size={16} color={pressed || hovered ? theme.ink : theme.inkFaint} />
          <Text style={{ color: pressed || hovered ? theme.ink : theme.inkFaint, fontSize: 13, lineHeight: 18, fontWeight: '500' }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/** A user bubble for a slash command: the command token in mono under a tiny "command" label. */
function CommandText({ text }: { text: string }) {
  const theme = useTheme();
  const m = text.match(/^(\/\S+)([\s\S]*)$/);
  return (
    <View>
      <View style={styles.commandLabel}>
        <Icon name="terminal" size={12} color={theme.inkMuted} />
        <Text style={{ color: theme.inkMuted, fontSize: 12, lineHeight: 16 }}>command</Text>
      </View>
      <Text selectable style={[TYPE.body, { color: theme.ink }]}>
        {m ? (
          <>
            <Text style={{ fontFamily: FONT.mono, fontSize: 15 }}>{m[1]}</Text>
            {m[2]}
          </>
        ) : (
          text
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  phoneColumn: { paddingHorizontal: 16 },
  wideInner: { width: '100%', maxWidth: SIZE.contentMax - 48, alignSelf: 'center' },
  titleBlock: { alignItems: 'center' },
  titleBlockWide: { flexDirection: 'row', gap: 10 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  subtitle: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  modelChip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 8, borderRadius: RADIUS.pill, flexShrink: 1 },
  emptyState: { flexGrow: 1, justifyContent: 'center', paddingVertical: 32 },
  emptyInner: { width: '100%', maxWidth: 560, alignSelf: 'center', alignItems: 'center', gap: 12 },
  markTile: { width: 64, height: 64, borderRadius: RADIUS.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  greeting: { textAlign: 'center', marginTop: 8 },
  suggestions: { alignSelf: 'stretch', gap: 8, marginTop: 16 },
  suggestionRow: { flexDirection: 'row', gap: 8 },
  suggestion: { flex: 1, minHeight: 72, gap: 8, padding: 12, borderRadius: RADIUS.md, borderWidth: 1 },
  hint: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  inlineCode: { fontFamily: FONT.mono, borderRadius: RADIUS.xs },
  userRow: { alignItems: 'flex-end', marginVertical: 10 },
  userBubble: {
    maxWidth: '85%',
    borderRadius: RADIUS.lg,
    borderBottomRightRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  assistantRow: { marginVertical: 10 },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: RADIUS.md, paddingLeft: 12, paddingRight: 8, marginTop: 8 },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20, paddingVertical: 12 },
  actions: { flexDirection: 'row', gap: 4, marginTop: 8, marginLeft: -10 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 10, borderRadius: RADIUS.pill },
  slashLayer: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 8,
    bottom: 6,
    justifyContent: 'flex-end',
    pointerEvents: 'box-none',
  },
  commandLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  composerWrap: { paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  composer: { borderWidth: 1, borderRadius: RADIUS.lg, padding: 4 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  // The composer card already shows focus; drop the browser's focus rectangle on web/desktop.
  input: {
    flex: 1,
    minWidth: 0,
    maxHeight: 160,
    minHeight: 44,
    fontSize: 16,
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 12,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  roundBtn: { width: SIZE.controlMd, height: SIZE.controlMd, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  sendBtn: { width: 40, height: 40, margin: 2, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 12, height: 12, borderRadius: 3 },
  keysHint: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
});
