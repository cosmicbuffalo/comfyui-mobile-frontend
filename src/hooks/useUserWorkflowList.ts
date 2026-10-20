import { useI18n } from '@/i18n';
import type { UserDataFile } from '@/api/client/workflows';
import { useEffect, useSyncExternalStore } from 'react';
import {
  dismissUserWorkflowListError, getUserWorkflowListSnapshot,
  listUserWorkflows, subscribeUserWorkflowList,
} from '@/api/client/userWorkflowList';

const EMPTY: UserDataFile[] = [];

export function useUserWorkflowList(enabled: boolean) {
  const { t } = useI18n();
  const state = useSyncExternalStore(subscribeUserWorkflowList, getUserWorkflowListSnapshot);
  useEffect(() => {
    if (!enabled || document.visibilityState === 'hidden') return;
    void listUserWorkflows().catch(() => {}); // Error lives in the shared snapshot.
  }, [enabled, state.revision]);
  return {
    files: state.files ?? EMPTY,
    loading: state.files === null && (state.status === 'idle' || state.status === 'loading'),
    error: state.error ? t('Failed to list workflows') : null,
    refresh: () => { void listUserWorkflows({ force: true }).catch(() => {}); },
    dismissError: dismissUserWorkflowListError,
  };
}
