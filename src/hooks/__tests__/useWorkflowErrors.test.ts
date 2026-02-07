import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';

beforeEach(() => {
  useWorkflowErrorsStore.setState({
    error: null,
    nodeErrors: {},
    errorCycleIndex: 0,
    errorsDismissed: false,
  });
});

describe('useWorkflowErrorsStore', () => {
  describe('setError', () => {
    it('resets errorsDismissed when setting an error', () => {
      useWorkflowErrorsStore.getState().setErrorsDismissed(true);
      useWorkflowErrorsStore.getState().setError('Something went wrong');

      const state = useWorkflowErrorsStore.getState();
      expect(state.error).toBe('Something went wrong');
      expect(state.errorsDismissed).toBe(false);
    });

    it('resets errorsDismissed when clearing an error', () => {
      useWorkflowErrorsStore.getState().setError('Some error');
      useWorkflowErrorsStore.getState().setErrorsDismissed(true);
      useWorkflowErrorsStore.getState().setError(null);

      const state = useWorkflowErrorsStore.getState();
      expect(state.error).toBeNull();
      expect(state.errorsDismissed).toBe(false);
    });
  });

  describe('clearNodeErrors', () => {
    it('clears both error string and node errors', () => {
      useWorkflowErrorsStore.getState().setError('Workflow load error: 2 inputs reference missing options.');
      useWorkflowErrorsStore.getState().setNodeErrors({
        '1': [{ type: 'missing', message: 'bad', details: '' }],
      });

      useWorkflowErrorsStore.getState().clearNodeErrors();

      const state = useWorkflowErrorsStore.getState();
      expect(state.error).toBeNull();
      expect(state.nodeErrors).toEqual({});
      expect(state.errorCycleIndex).toBe(0);
      expect(state.errorsDismissed).toBe(false);
    });

    it('clears stale error that was previously dismissed', () => {
      // Simulate: workflow A had errors, user dismissed, now loading workflow B
      useWorkflowErrorsStore.getState().setError('Workflow load error: 1 input references missing options.');
      useWorkflowErrorsStore.getState().setNodeErrors({
        '5': [{ type: 'missing', message: 'bad input', details: '' }],
      });
      useWorkflowErrorsStore.getState().setErrorsDismissed(true);

      // New workflow loads cleanly
      useWorkflowErrorsStore.getState().clearNodeErrors();

      const state = useWorkflowErrorsStore.getState();
      expect(state.error).toBeNull();
      expect(state.nodeErrors).toEqual({});
      // The stale error should not reappear
      expect(state.error).toBeNull();
    });
  });

  describe('setNodeErrors', () => {
    it('resets errorsDismissed and errorCycleIndex', () => {
      useWorkflowErrorsStore.getState().setErrorsDismissed(true);
      useWorkflowErrorsStore.getState().setErrorCycleIndex(3);

      useWorkflowErrorsStore.getState().setNodeErrors({
        '1': [{ type: 'missing', message: 'err', details: '' }],
      });

      const state = useWorkflowErrorsStore.getState();
      expect(state.errorsDismissed).toBe(false);
      expect(state.errorCycleIndex).toBe(0);
      expect(Object.keys(state.nodeErrors)).toHaveLength(1);
    });
  });
});
