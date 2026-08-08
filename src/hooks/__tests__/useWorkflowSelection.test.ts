import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';

const reset = () =>
  useWorkflowSelectionStore.setState({
    selectionMode: false,
    selectedKeys: [],
    actionMenuOpen: false,
  });

describe('useWorkflowSelection', () => {
  beforeEach(reset);

  it('toggleSelectionMode enters, and exits clearing selection + menu', () => {
    const store = useWorkflowSelectionStore.getState();
    store.toggleSelectionMode();
    expect(useWorkflowSelectionStore.getState().selectionMode).toBe(true);

    useWorkflowSelectionStore.setState({ selectedKeys: ['a'], actionMenuOpen: true });
    useWorkflowSelectionStore.getState().toggleSelectionMode();
    const s = useWorkflowSelectionStore.getState();
    expect(s.selectionMode).toBe(false);
    expect(s.selectedKeys).toEqual([]);
    expect(s.actionMenuOpen).toBe(false);
  });

  it('toggleKey adds companion keys only when turning a key ON', () => {
    const store = useWorkflowSelectionStore.getState();
    // Selecting a group also selects its members (companions).
    store.toggleKey('group', ['n1', 'n2']);
    expect(useWorkflowSelectionStore.getState().selectedKeys).toEqual(['group', 'n1', 'n2']);
  });

  it('toggling a group OFF removes only the group, leaving members as-is', () => {
    useWorkflowSelectionStore.setState({ selectedKeys: ['group', 'n1', 'n2'] });
    // Turning the group off must NOT pull its members back out.
    useWorkflowSelectionStore.getState().toggleKey('group', ['n1', 'n2']);
    expect(useWorkflowSelectionStore.getState().selectedKeys).toEqual(['n1', 'n2']);
  });

  it('a member stays deselected independent of its group', () => {
    useWorkflowSelectionStore.setState({ selectedKeys: ['group', 'n1', 'n2'] });
    // Deselect one member while the group remains selected.
    useWorkflowSelectionStore.getState().toggleKey('n1');
    expect(useWorkflowSelectionStore.getState().selectedKeys).toEqual(['group', 'n2']);
  });

  it('selectKeys dedupes and deselectKeys removes', () => {
    const store = useWorkflowSelectionStore.getState();
    store.selectKeys(['a', 'b', 'a']);
    expect(useWorkflowSelectionStore.getState().selectedKeys).toEqual(['a', 'b']);
    useWorkflowSelectionStore.getState().deselectKeys(['a', 'z']);
    expect(useWorkflowSelectionStore.getState().selectedKeys).toEqual(['b']);
  });
});
