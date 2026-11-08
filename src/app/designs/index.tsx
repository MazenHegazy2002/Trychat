import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { BoardThumb } from '../../components/DesignViews';
import { TextPrompt } from '../../components/TextPrompt';
import { EmptyState, Icon, IconButton, PillButton, ScreenIntro, SectionLabel } from '../../components/ui';
import { DESIGN_TEMPLATES } from '../../lib/designTemplates';
import type { DesignTemplate } from '../../lib/designTemplates';
import { createDesign, deleteDesign, renameDesign, useDesigns } from '../../lib/designs';
import type { Design } from '../../lib/designs';
import { RADIUS, SIZE, WIDE_BREAKPOINT, useTheme } from '../../lib/theme';
import { Text } from '../../components/Text';

/** "edited 2h ago", or the date once it is a week old. */
function edited(at: number): string {
  const min = Math.floor((Date.now() - at) / 60_000);
  if (min < 1) return 'edited just now';
  if (min < 60) return `edited ${min}m ago`;
  if (min < 60 * 24) return `edited ${Math.floor(min / 60)}h ago`;
  if (min < 60 * 24 * 7) return `edited ${Math.floor(min / 1440)}d ago`;
  return `edited ${new Date(at).toLocaleDateString()}`;
}

type PressState = { pressed: boolean; hovered?: boolean };

/** The Design studio: your designs, a blank start, and templates. */
export default function DesignsScreen() {
  const theme = useTheme();
  const designs = useDesigns();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const cols = wide ? 3 : 2;
  const gutter = wide ? 24 : 16;
  const [naming, setNaming] = useState(false);
  const [renaming, setRenaming] = useState<Design | null>(null);
  const tile = { width: `${100 / cols}%` as const, padding: 6 };
  const cardStyle = ({ pressed, hovered }: PressState) => [
    styles.card,
    { backgroundColor: pressed || hovered ? theme.fill : theme.surface, borderColor: theme.border },
  ];

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
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{
        paddingHorizontal: gutter - 6,
        paddingTop: 12,
        paddingBottom: 48,
        maxWidth: SIZE.contentMax + (gutter - 6) * 2,
        width: '100%',
        alignSelf: 'center',
      }}
    >
      <View style={{ paddingHorizontal: 6 }}>
        <ScreenIntro title="Design">
          Describe screens and Claude designs them on a canvas — phone and desktop frames you can click through, refine, and export.
        </ScreenIntro>
      </View>

      {designs.length ? (
        <>
          <View style={{ paddingHorizontal: 6 }}>
            <SectionLabel style={{ marginTop: 4 }}>Your designs</SectionLabel>
          </View>
          <View style={styles.grid}>
            <View style={tile}>
              <Pressable
                onPress={() => setNaming(true)}
                accessibilityRole="button"
                accessibilityLabel="New design"
                style={({ pressed, hovered }: PressState) => [
                  styles.newTile,
                  { borderColor: theme.borderStrong, backgroundColor: pressed || hovered ? theme.fill : 'transparent' },
                ]}
              >
                <View style={[styles.plus, { backgroundColor: theme.fill }]}>
                  <Icon name="plus" size={20} color={theme.ink} />
                </View>
                <Text style={{ color: theme.ink, fontSize: 15, lineHeight: 21, fontWeight: '600' }}>New design</Text>
              </Pressable>
            </View>
            {designs.map((d) => (
              <View key={d.id} style={tile}>
                <Pressable
                  onPress={() => router.push(`/designs/${d.id}`)}
                  onLongPress={() => more(d)}
                  accessibilityRole="button"
                  accessibilityLabel={d.title}
                  style={cardStyle}
                >
                  <BoardThumb board={d.boards[0]} height={THUMB} />
                  <View style={styles.meta}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: theme.ink, fontSize: 15, lineHeight: 21, fontWeight: '600' }} numberOfLines={1}>
                        {d.title}
                      </Text>
                      <Text style={{ color: theme.inkMuted, fontSize: 12, lineHeight: 16 }} numberOfLines={1}>
                        {d.boards.length} screen{d.boards.length === 1 ? '' : 's'} · {edited(d.updatedAt)}
                      </Text>
                    </View>
                    <IconButton name="more-horizontal" size={18} label={`More for ${d.title}`} onPress={() => more(d)} style={{ marginRight: -8 }} />
                  </View>
                </Pressable>
              </View>
            ))}
          </View>
        </>
      ) : (
        <EmptyState
          icon="pen-tool"
          title="No designs yet"
          style={{ paddingVertical: 24 }}
          action={<PillButton title="New design" icon="plus" onPress={() => setNaming(true)} />}
        >
          Start one here, or ask in any chat: “design a meditation app” or “make me a landing page”.
        </EmptyState>
      )}

      <View style={{ paddingHorizontal: 6 }}>
        <SectionLabel>Start from a template</SectionLabel>
      </View>
      <View style={styles.grid}>
        {DESIGN_TEMPLATES.map((t) => (
          <View key={t.key} style={tile}>
            <Pressable onPress={() => fromTemplate(t)} accessibilityRole="button" accessibilityLabel={`Use the ${t.subtitle} template`} style={cardStyle}>
              <BoardThumb board={{ ...t.boards[0], id: t.key, x: 0, y: 0 }} height={THUMB} />
              <View style={[styles.meta, { minHeight: 60 }]}>
                <Icon name={t.icon} size={16} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: theme.ink, fontSize: 15, lineHeight: 21, fontWeight: '600' }} numberOfLines={1}>
                    {t.subtitle}
                  </Text>
                  <Text style={{ color: theme.inkMuted, fontSize: 12, lineHeight: 16 }} numberOfLines={1}>
                    {t.title}
                  </Text>
                </View>
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

const THUMB = 168;

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { borderWidth: 1, borderRadius: RADIUS.md, overflow: 'hidden' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 12, paddingRight: 4, paddingVertical: 8, minHeight: 60 },
  // Same height as a design card (thumbnail + meta row + borders).
  newTile: { height: THUMB + 60 + 2, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', gap: 10 },
  plus: { width: 44, height: 44, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
});
