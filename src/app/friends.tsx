import { ScrollView, StyleSheet } from 'react-native';

import { ScreenIntro } from '../components/ui';
import { useTheme } from '../lib/theme';

export default function FriendsScreen() {
  const theme = useTheme();
  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.page}>
      <ScreenIntro title="Friends">Friends and the files you share with them.</ScreenIntro>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ page: { padding: 16 } });
