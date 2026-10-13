import * as Clipboard from 'expo-clipboard';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachSheet, MessageAttachments, PendingAttachments } from '../../components/Attachments';
import type { AttachSource } from '../../components/Attachments';
import { FileCards } from '../../components/FileCards';
import { Icon } from '../../components/ui';
import { MONO, SlashMenu, isTypingSlashCommand } from '../../components/SlashMenu';
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
import { useTheme } from '../../lib/theme';
import type { Attachment, ChatMessage } from '../../lib/types';

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
  const keyboardVisible = useKeyboardState((k) => k.isVisible);
  const inputRef = useRef<TextInput>(null);

  if (!conv) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={{ color: theme.muted }}>This chat no longer exists.</Text>
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
        <Pressable onLongPress={() => onMessageLongPress(item)} style={styles.userRow}>
          {!!item.attachments?.length && <MessageAttachments items={item.attachments} />}
          {item.displayText ? (
            <View style={[styles.userBubble, { backgroundColor: theme.userBubble }]}>
              <CommandText text={item.displayText} />
            </View>
          ) : !!item.content && !item.attachments?.some((a) => a.voice?.transcriptError) && (
            <View style={[styles.userBubble, { backgroundColor: theme.userBubble }]}>
              <Text selectable style={{ color: theme.onUserBubble, fontSize: 16, lineHeight: 22 }}>
                {item.content}
              </Text>
            </View>
          )}
        </Pressable>
      );
    }
    const streaming = busy && item.id === lastAssistantId;
    return (
      <Pressable onLongPress={() => onMessageLongPress(item)} style={styles.assistantRow}>
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
        {streaming && !item.content && !item.toolCall && <ActivityIndicator color={theme.muted} style={{ alignSelf: 'flex-start' }} />}
        {!!item.error && (
          <View style={[styles.error, { borderColor: theme.danger }]}>
            <Text style={{ color: theme.danger }}>{item.error}</Text>
            <Pressable onPress={() => store.regenerate(id)} hitSlop={8}>
              <Text style={{ color: theme.primary, fontWeight: '600', marginTop: 6 }}>Retry</Text>
            </Pressable>
          </View>
        )}
        {!streaming && !item.error && !item.toolCall && item.id === lastAssistantId && (
          <View style={styles.actions}>
            <Pressable onPress={() => Clipboard.setStringAsync(item.content)} hitSlop={8}>
              <Text style={{ color: theme.muted, fontSize: 13 }}>Copy</Text>
            </Pressable>
            <Pressable onPress={() => store.regenerate(id)} hitSlop={8}>
              <Text style={{ color: theme.muted, fontSize: 13 }}>Regenerate</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    // Android draws edge-to-edge, so the window no longer shrinks for the keyboard:
    // keyboard-controller pads the screen by the keyboard's height on both platforms.
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior="padding" automaticOffset>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable onPress={() => setRenaming(true)} style={{ maxWidth: 220 }}>
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
                {conv.title}
              </Text>
              <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 11 }}>
                {project ? project.name : model || 'no model'}
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={() => setMoving(true)}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
              accessibilityLabel={project ? `In project ${project.name}. Move to another project` : 'Move to project'}
            >
              <Icon name="folder" size={20} color={project ? theme.primary : theme.text} />
            </Pressable>
          ),
        }}
      />

      <View style={styles.flex}>
        {conv.messages.length === 0 ? (
          <ScrollView contentContainerStyle={[styles.emptyState, { padding: 24 }]} keyboardShouldPersistTaps="handled">
            <View style={[styles.mark, { backgroundColor: theme.accent }]}>
              <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '700' }}>T</Text>
            </View>
            <Text style={{ color: theme.text, fontSize: 30, fontFamily: theme.serif, marginBottom: 8, textAlign: 'center' }}>
              {greeting()}
              {store.account ? `, ${store.account.user.name}` : ''}
            </Text>
            <Text style={{ color: theme.muted, textAlign: 'center', marginBottom: 20 }}>
              Chat, ask for apps and games (tap ▶ Preview to run them), or tell me things to remember.
            </Text>
            {[
              ...(githubConnected(store.settings) ? [TOOL_SUGGESTIONS[0]] : []),
              ...(laptopConnected(store.settings) ? [TOOL_SUGGESTIONS[1]] : []),
              ...SUGGESTIONS,
            ].slice(0, 5).map((s) => (
              <Pressable
                key={s}
                onPress={() => send(s)}
                style={[styles.suggestion, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <Text style={{ color: theme.text }}>{s}</Text>
              </Pressable>
            ))}
            {store.commands.length > 0 && (
              <Pressable onPress={startCommand} style={styles.hint} accessibilityRole="button" accessibilityLabel="Type slash to use plugin commands">
                <Text style={{ color: theme.muted, fontSize: 13 }}>
                  Type <Text style={{ fontFamily: MONO, color: theme.text }}>/</Text> to use plugin commands
                </Text>
              </Pressable>
            )}
            {!model && (
              <Pressable onPress={() => router.push('/settings')} style={{ marginTop: 16 }}>
                <Text style={{ color: theme.danger }}>No model selected — open Settings</Text>
              </Pressable>
            )}
          </ScrollView>
        ) : (
          <FlatList
            inverted
            data={[...conv.messages].reverse()}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={{ paddingVertical: 12 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          />
        )}
        {slashOpen && (
          // Floats over the bottom of the conversation, just above the composer, and rises with the keyboard.
          <View style={styles.slashLayer}>
            <SlashMenu
              query={input.slice(1)}
              commands={store.commands}
              onSelect={pickCommand}
              onOpenPlugins={() => router.push('/plugins')}
            />
          </View>
        )}
      </View>

      <View style={[styles.composerWrap, { paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 10) }]}>
        <View style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <PendingAttachments items={pending} onRemove={(aid) => setPending((p) => p.filter((x) => x.id !== aid))} />
          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={setInput}
            placeholder={conv.messages.length ? 'Reply to TryChat' : 'How can I help you today?'}
            placeholderTextColor={theme.faint}
            multiline
            style={[styles.input, { color: theme.text }]}
            accessibilityLabel="Message"
          />
          {recording ? (
            <VoiceRecorder onCancel={() => setRecording(false)} onSend={sendVoice} sending={sendingVoice} />
          ) : (
          <View style={styles.composerRow}>
            <Pressable
              onPress={() => setAttachOpen(true)}
              disabled={attaching}
              style={[styles.roundBtn, { borderColor: theme.border }]}
              accessibilityLabel="Attach photos or files"
              hitSlop={4}
            >
              {attaching ? <ActivityIndicator size="small" color={theme.muted} /> : <Icon name="plus" size={20} color={theme.text} />}
            </Pressable>
            <Pressable onPress={() => setPickerOpen(true)} style={styles.modelChip} accessibilityLabel="Choose model" hitSlop={4}>
              <Text style={{ color: theme.muted, fontSize: 13 }} numberOfLines={1}>
                {model || 'Choose model'}
              </Text>
              <Icon name="chevron-down" size={14} />
            </Pressable>
            <View style={{ flex: 1 }} />
            {busy ? (
              <Pressable
                onPress={() => store.stop(id)}
                style={[styles.sendBtn, { backgroundColor: theme.text }]}
                accessibilityLabel="Stop generating"
              >
                <Icon name="square" size={14} color={theme.bg} />
              </Pressable>
            ) : !canSend ? (
              <Pressable
                onPress={() => setRecording(true)}
                disabled={attaching}
                style={[styles.sendBtn, { backgroundColor: theme.surface2 }]}
                accessibilityRole="button"
                accessibilityLabel="Record voice message"
                hitSlop={4}
              >
                <Icon name="mic" size={20} color={theme.text} />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => send()}
                disabled={!canSend || attaching}
                style={[styles.sendBtn, { backgroundColor: canSend ? theme.accent : theme.surface2 }]}
                accessibilityLabel="Send"
              >
                <Icon name="arrow-up" size={20} color={canSend ? '#FFFFFF' : theme.faint} />
              </Pressable>
            )}
          </View>
          )}
        </View>
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
    </KeyboardAvoidingView>
  );
}

/** A user bubble for a slash command: the command token in mono under a tiny "command" label. */
function CommandText({ text }: { text: string }) {
  const theme = useTheme();
  const m = text.match(/^(\/\S+)([\s\S]*)$/);
  return (
    <View>
      <View style={styles.commandLabel}>
        <Icon name="terminal" size={11} color={theme.muted} />
        <Text style={{ color: theme.muted, fontSize: 11 }}>command</Text>
      </View>
      <Text selectable style={{ color: theme.onUserBubble, fontSize: 16, lineHeight: 22 }}>
        {m ? (
          <>
            <Text style={{ fontFamily: MONO, fontSize: 15 }}>{m[1]}</Text>
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
  emptyState: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  userRow: { alignItems: 'flex-end', paddingHorizontal: 12, marginVertical: 6 },
  userBubble: { maxWidth: '85%', borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 9 },
  assistantRow: { paddingHorizontal: 16, marginVertical: 8 },
  error: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 18, marginTop: 8 },
  suggestion: { width: '100%', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8 },
  hint: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, marginTop: 4 },
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
  composerWrap: { paddingHorizontal: 12, paddingTop: 6 },
  composer: { borderWidth: 1, borderRadius: 24, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 },
  input: { maxHeight: 160, minHeight: 40, fontSize: 16, paddingHorizontal: 4, paddingVertical: 8 },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modelChip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, maxWidth: 170, paddingHorizontal: 6 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
