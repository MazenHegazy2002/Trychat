import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { HtmlView } from '../../components/HtmlView';
import { IconButton } from '../../components/ui';
import { prototypeDocument, useDesign } from '../../lib/designs';
import { useTheme } from '../../lib/theme';

/** Full-screen interactive prototype: links between boards (href="Board.html") navigate. */
export default function PlayDesign() {
  const theme = useTheme();
  const { id, board } = useLocalSearchParams<{ id: string; board?: string }>();
  const design = useDesign(id);
  const html = useMemo(() => (design ? prototypeDocument(design, board) : ''), [design, board]);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/designs'));
  return (
    <View style={{ flex: 1, backgroundColor: theme.codeBg }}>
      <Stack.Screen
        options={{
          title: design?.title ?? 'Preview',
          // A full-screen modal has no back button on iOS, so it always offers Close.
          headerLeft: () => <IconButton name="x" label="Close" onPress={close} />,
        }}
      />
      {!!design && <HtmlView html={html} background={theme.codeBg} />}
    </View>
  );
}
