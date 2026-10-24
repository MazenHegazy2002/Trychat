import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { BoardThumb } from '../../components/DesignViews';
import { TextPrompt } from '../../components/TextPrompt';
import { Icon, PillButton, ScreenIntro, SectionLabel } from '../../components/ui';
import { DESIGN_TEMPLATES } from '../../lib/designTemplates';
import type { DesignTemplate } from '../../lib/designTemplates';
import { createDesign, deleteDesign, renameDesign, useDesigns } from '../../lib/designs';
import type { Design } from '../../lib/designs';
import { useTheme } from '../../lib/theme';

/** The Design studio: your designs, a blank start, and templates. */
export default function DesignsScreen() {
  const theme = useTheme();
  const designs = useDesigns();
  const { width } = useWindowDimensions();
  const cols = width >= 900 ? 3 : width >= 560 ? 2 : 1;
  const [naming, setNaming] = useState(false);
  const [renaming, setRenaming] = useState<Design | null>(null);
  const tile = { width: `${100 / cols}%` as const, padding: 6 };

  const fromTemplate = async (t: DesignTemplate) => {
    const d = await createDesign(t.title, t.notes, t.boards);
    router.push(`/designs/${d.id}`);
  };

  const more = (d: Design) =>
    Alert.alert(d.title, undefined, [
      { text: 'Rename', onPress: () => setRenaming(d) },
      { text: 'Delete', style: 'destructive', onPress: () => deleteDesign(d.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: 14, paddingBottom: 48, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
      <View style={{ paddingHorizontal: 6 }}>
        <ScreenIntro title="Design">
          Describe screens and Claude designs them on a canvas — phone and desktop frames you can click through, refine, and export.
        </ScreenIntro>
        <PillButton title="New design" icon="plus" onPress={() => setNaming(true)} style={{ alignSelf: 'flex-start' }} />
      </View>

      <View style={{ paddingHorizontal: 6 }}>
        <SectionLabel>Start from a template</SectionLabel>
      </View>
      <View style={styles.grid}>
        {DESIGN_TEMPLATES.map((t) => (
          <View key={t.key} style={tile}>
            <Pressable
              onPress={() => fromTemplate(t)}
              accessibilityRole="button"
              accessibilityLabel={`Use the ${t.subtitle} template`}
              style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.85 }]}
            >
              <BoardThumb board={{ ...t.boards[0], id: t.key, x: 0, y: 0 }} height={150} />
              <View style={styles.meta}>
                <Icon name={t.icon} size={16} color={theme.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontWeight: '600' }} numberOfLines={1}>{t.subtitle}</Text>
                  <Text style={{ color: theme.muted, fontSize: 12 }} numberOfLines={1}>{t.title}</Text>
                </View>
              </View>
            </Pressable>
          </View>
        ))}
      </View>

      <View style={{ paddingHorizontal: 6 }}>
        <SectionLabel>Your designs</SectionLabel>
        {!designs.length && (
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>
            Nothing yet. Start one here, or ask in any chat: “design a meditation app” or “make me a landing page”.
          </Text>
        )}
      </View>
      <View style={styles.grid}>
        {designs.map((d) => (
          <View key={d.id} style={tile}>
            <Pressable
              onPress={() => router.push(`/designs/${d.id}`)}
              onLongPress={() => more(d)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.85 }]}
            >
              <BoardThumb board={d.boards[0]} height={170} />
              <View style={styles.meta}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontWeight: '600' }} numberOfLines={1}>{d.title}</Text>
                  <Text style={{ color: theme.muted, fontSize: 12 }}>
                    {d.boards.length} board{d.boards.length === 1 ? '' : 's'} · {new Date(d.updatedAt).toLocaleDateString()}
                  </Text>
                </View>
                <Pressable onPress={() => more(d)} hitSlop={12} accessibilityLabel={`More for ${d.title}`}>
                  <Icon name="more-horizontal" size={18} />
                </Pressable>
              </View>
            </Pressable>
          </View>
        ))}
      </View>

      <TextPrompt
        visible={naming}
        title="New design"
        placeholder="e.g. Recipe app for busy parents"
        onClose={() => setNaming(false)}
        onSubmit={async (title) => {
          setNaming(false);
          const d = await createDesign(title || 'Untitled design');
          router.push(`/designs/${d.id}`);
        }}
      />
      <TextPrompt
        visible={!!renaming}
        title="Rename design"
        initialValue={renaming?.title}
        onClose={() => setRenaming(null)}
        onSubmit={(t) => {
          if (renaming) renameDesign(renaming.id, t);
          setRenaming(null);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
});
