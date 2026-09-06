import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';

beforeEach(() => {
  useWorkflowErrorsStore.setState({
    error: null,
    errorKind: null,
    nodeErrors: {},
    nodeErrorsByItemKey: {},
    nodeErrorsFromRun: false,
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

    it('defaults nodeErrorsFromRun to false (load-time errors)', () => {
      useWorkflowErrorsStore.getState().setNodeErrors({
        '1': [{ type: 'missing', message: 'err', details: '' }],
      });
      expect(useWorkflowErrorsStore.getState().nodeErrorsFromRun).toBe(false);
    });

    it('flags nodeErrorsFromRun when surfaced from a run/queue attempt', () => {
      useWorkflowErrorsStore.getState().setNodeErrors(
        { '7': [{ type: 'value_not_in_list', message: 'bad combo', details: '' }] },
        true,
      );
      expect(useWorkflowErrorsStore.getState().nodeErrorsFromRun).toBe(true);
    });

    it('clearNodeErrors resets the run flag', () => {
      useWorkflowErrorsStore.getState().setNodeErrors(
        { '7': [{ type: 'value_not_in_list', message: 'bad combo', details: '' }] },
        true,
      );
      useWorkflowErrorsStore.getState().clearNodeErrors();
      expect(useWorkflowErrorsStore.getState().nodeErrorsFromRun).toBe(false);
    });
  });

  describe('clearNodeError', () => {
    it('clears the workflow-load message after the final node error is fixed', () => {
      const nodeError = { type: 'workflow_load', message: 'Missing value', details: '' };
      useWorkflowErrorsStore.getState().setNodeErrors(
        { '1': [nodeError] },
        false,
        { 'root/node:1': [nodeError] },
      );
      useWorkflowErrorsStore.getState().setError(
        'Workflow load error: 1 input references missing options.',
        'workflow-load',
      );

      useWorkflowErrorsStore.getState().clearNodeError(1, 'root/node:1');

      const state = useWorkflowErrorsStore.getState();
      expect(state.nodeErrors).toEqual({});
      expect(state.nodeErrorsByItemKey).toEqual({});
      expect(state.error).toBeNull();
      expect(state.errorKind).toBeNull();
    });

    it('updates the workflow-load message when other node errors remain', () => {
      const firstError = { type: 'workflow_load', message: 'Missing first', details: '' };
      const secondError = { type: 'workflow_load', message: 'Missing second', details: '' };
      useWorkflowErrorsStore.getState().setNodeErrors({
        '1': [firstError],
        '2': [secondError],
      });
      useWorkflowErrorsStore.getState().setError(
        'Workflow load error: 2 inputs reference missing options.',
        'workflow-load',
      );

      useWorkflowErrorsStore.getState().clearNodeError(1);

      const state = useWorkflowErrorsStore.getState();
      expect(state.nodeErrors).toEqual({ '2': [secondError] });
      expect(state.error).toBe(
        'Workflow load error: 1 input references missing options.',
      );
      expect(state.errorKind).toBe('workflow-load');
    });

    it('does not clear an independent prompt error', () => {
      useWorkflowErrorsStore.getState().setNodeErrors({
        '1': [{ type: 'prompt', message: 'Bad value', details: '' }],
      });
      useWorkflowErrorsStore.getState().setError('Prompt rejected', 'prompt');

      useWorkflowErrorsStore.getState().clearNodeError(1);

      expect(useWorkflowErrorsStore.getState().error).toBe('Prompt rejected');
    });
  });
});
