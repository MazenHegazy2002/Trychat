import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { HtmlView } from '../../components/HtmlView';
import { prototypeDocument, useDesign } from '../../lib/designs';

/** Full-screen interactive prototype: links between boards (href="Board.html") navigate. */
export default function PlayDesign() {
  const { id, board } = useLocalSearchParams<{ id: string; board?: string }>();
  const design = useDesign(id);
  const html = useMemo(() => (design ? prototypeDocument(design, board) : ''), [design, board]);
  return (
    <View style={{ flex: 1, backgroundColor: '#1F1E1D' }}>
      <Stack.Screen options={{ title: design?.title ?? 'Preview' }} />
      {!!design && <HtmlView html={html} background="#1F1E1D" />}
    </View>
  );
}
