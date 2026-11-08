import { useSyncExternalStore } from 'react';
import { Alert, View } from 'react-native';

import { getStorageIssues, resolveStorageIssue, subscribeStorageIssues } from '../lib/storage';
import type { StorageIssue } from '../lib/storage';
import { useTheme } from '../lib/theme';
import { Text } from './Text';
import { Banner } from './ui';

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

/** One sentence and what to do; the full explanation and the fix are behind the tap. */
function summary(issue: StorageIssue): string {
  if (issue.kind === 'save-failed') return issue.message;
  return issue.action ? 'Nothing was deleted. Tap for details and a fix.' : 'Nothing was deleted. Tap for details.';
}

/** Problems reading or saving data (e.g. chats that couldn't be loaded); nothing is wiped silently. */
export function StorageIssuesBanner() {
  const theme = useTheme();
  const issues = useSyncExternalStore(subscribeStorageIssues, getStorageIssues);
  if (!issues.length) return null;
  return (
    <View style={{ gap: 8, marginHorizontal: 16, marginTop: 12 }}>
      {issues.map((issue) => {
        // Data that couldn't be read is danger; old leftovers and a retried save are warnings.
        const tone = issue.kind === 'unreadable' ? 'danger' : 'warning';
        return (
          <Banner
            key={issue.key}
            tone={tone}
            title={issue.title}
            onPress={() => showDetails(issue)}
            style={{ borderWidth: 1, borderColor: tone === 'danger' ? theme.danger : theme.warning }}
          >
            <Text style={{ color: theme.inkMuted }}>{summary(issue)}</Text>
          </Banner>
        );
      })}
    </View>
  );
}
