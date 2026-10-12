import { useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listModels } from '../lib/api';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';

interface Props {
  visible: boolean;
  selected: string;
  onSelect: (model: string) => void;
  onClose: () => void;
}

export function ModelPicker({ visible, selected, onSelect, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={load} transparent>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.bg, paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>Choose a model</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={{ color: theme.primary, fontSize: 16, fontWeight: '600' }}>Done</Text>
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search or type a model id"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.search, { backgroundColor: theme.surface, color: theme.text }]}
          />
          {loading && <ActivityIndicator style={{ margin: 16 }} color={theme.primary} />}
          {!!error && (
            <Text style={{ color: theme.danger, margin: 12 }}>
              Couldn’t load models: {error}
              {'\n'}You can still type a model id above.
            </Text>
          )}
          <FlatList
            data={custom ? [custom, ...filtered] : filtered}
            keyExtractor={(m) => m}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
                style={[styles.row, { borderBottomColor: theme.border }]}
              >
                <Text style={{ color: theme.text, fontSize: 15, flex: 1 }} numberOfLines={1}>
                  {item === custom ? `Use “${item}”` : item}
                </Text>
                {item === selected && <Text style={{ color: theme.primary, fontSize: 16 }}>✓</Text>}
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { height: '80%', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  search: { marginHorizontal: 16, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  row: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
});
