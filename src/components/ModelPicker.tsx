import { useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listModels } from '../lib/api';
import { useStore } from '../lib/store';
import { FONT, RADIUS, TYPE, WIDE_BREAKPOINT, shadow, useTheme } from '../lib/theme';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Text } from './Text';
import { Icon, SearchField, TextAction } from './ui';

interface Props {
  visible: boolean;
  selected: string;
  onSelect: (model: string) => void;
  onClose: () => void;
}

export function ModelPicker({ visible, selected, onSelect, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useWindowDimensions().width >= WIDE_BREAKPOINT;
  const { settings } = useStore();
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  // Loaded each time the sheet opens (from the Modal's onShow event).
  const load = () => {
    setLoading(true);
    setError('');
    listModels(settings)
      .then(setModels)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  const filtered = models.filter((m) => m.toLowerCase().includes(query.toLowerCase()));
  const custom = query.trim() && !models.includes(query.trim()) ? query.trim() : '';

  return (
    <Modal
      visible={visible}
      animationType={wide ? 'fade' : 'slide'}
      onRequestClose={onClose}
      onShow={load}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
    >
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={-insets.bottom} style={[styles.backdrop, wide && styles.backdropWide]}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]} onPress={onClose} accessibilityLabel="Close" />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: theme.surfaceRaised },
            shadow(theme, 'sheet'),
            wide ? styles.dialog : { paddingBottom: insets.bottom + 12 },
          ]}
        >
          {!wide && <View style={[styles.grabber, { backgroundColor: theme.borderStrong }]} />}
          <View style={styles.header}>
            <Text style={[TYPE.headline, { color: theme.ink, flex: 1 }]} accessibilityRole="header">
              Choose a model
            </Text>
            <TextAction title="Done" onPress={onClose} />
          </View>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search or type a model id"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => {
              const q = query.trim();
              if (q) {
                onSelect(q);
                onClose();
              }
            }}
            style={styles.search}
            inputStyle={{ fontFamily: FONT.mono, fontSize: 14 }}
          />
          {loading && <ActivityIndicator style={{ margin: 16 }} color={theme.inkMuted} />}
          {!!error && (
            <Text style={[TYPE.caption, { color: theme.danger, marginHorizontal: 16, marginVertical: 8 }]}>
              Couldn’t load models: {error}
              {'\n'}You can still type a model id above.
            </Text>
          )}
          <FlatList
            data={custom ? [custom, ...filtered] : filtered}
            keyExtractor={(m) => m}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const on = item === selected;
              return (
                <Pressable
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.row,
                    { backgroundColor: on ? theme.accentSoft : pressed || hovered ? theme.fill : 'transparent' },
                  ]}
                >
                  {item === custom ? (
                    <Text style={[TYPE.callout, { color: theme.ink, flex: 1 }]} numberOfLines={1}>
                      Use “<Text style={styles.mono}>{item}</Text>”
                    </Text>
                  ) : (
                    <Text style={[styles.mono, { color: theme.ink, flex: 1 }, on && { fontFamily: FONT.monoSemibold }]} numberOfLines={1}>
                      {item}
                    </Text>
                  )}
                  {on && <Icon name="check" size={18} color={theme.accent} />}
                </Pressable>
              );
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropWide: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { height: '80%', borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, paddingTop: 8 },
  dialog: { width: '100%', maxWidth: 440, height: '70%', maxHeight: 640, borderRadius: RADIUS.lg, paddingTop: 12, paddingBottom: 12 },
  grabber: { width: 36, height: 5, borderRadius: RADIUS.pill, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 12, minHeight: 52 },
  search: { marginHorizontal: 16, marginBottom: 8 },
  list: { paddingHorizontal: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 12, borderRadius: RADIUS.sm },
  mono: { fontFamily: FONT.mono, fontSize: 14, lineHeight: 20 },
});
