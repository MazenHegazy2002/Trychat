import { useSyncExternalStore } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { getStorageIssues, resolveStorageIssue, subscribeStorageIssues } from '../lib/storage';
import type { StorageIssue } from '../lib/storage';
import { useTheme } from '../lib/theme';

function runAction(issue: StorageIssue) {
  const action = issue.action;
  if (!action) return;
  Alert.alert(action.label, action.confirm, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: action.label,
      style: action.destructive ? 'destructive' : 'default',
      onPress: () =>
        resolveStorageIssue(issue.key).catch((e) =>
          Alert.alert("Couldn't fix it", e instanceof Error ? e.message : String(e)),
        ),
    },
  ]);
}

function showDetails(issue: StorageIssue) {
  Alert.alert(issue.title, `${issue.message}\n\nDetails: ${issue.detail}`, [
    { text: 'Close', style: 'cancel' },
    ...(issue.action ? [{ text: issue.action.label, onPress: () => runAction(issue) }] : []),
  ]);
}

/** Problems reading or saving data (e.g. chats that couldn't be loaded); nothing is wiped silently. */
export function StorageIssuesBanner() {
  const theme = useTheme();
  const issues = useSyncExternalStore(subscribeStorageIssues, getStorageIssues);
  if (!issues.length) return null;
  return (
    <View>
      {issues.map((issue) => (
        <Pressable
          key={issue.key}
          onPress={() => showDetails(issue)}
          accessibilityRole="button"
          style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.danger }]}
        >
          <Text style={{ color: theme.text, fontWeight: '600' }}>{issue.title}</Text>
          <Text style={{ color: theme.muted, marginTop: 2 }}>{issue.message}</Text>
          <Text style={{ color: theme.primary, marginTop: 6, fontWeight: '600' }}>Details</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { margin: 16, marginBottom: 0, padding: 14, borderRadius: 12, borderWidth: 1 },
});
