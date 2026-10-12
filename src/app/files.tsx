import { ScrollView, StyleSheet } from 'react-native';

import { ScreenIntro } from '../components/ui';
import { useTheme } from '../lib/theme';

export default function FilesScreen() {
  const theme = useTheme();
  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.page}>
      <ScreenIntro title="Files">Every file sent, received and shared, kept on this device.</ScreenIntro>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ page: { padding: 16 } });
