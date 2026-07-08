import { describe, it, expect, beforeEach } from "vitest";
import { useQueueStore } from "../../useQueue";
import type { QueueWorkflowDiff } from "@/utils/workflowDiff";

const diff = (): QueueWorkflowDiff => ({ prompts: [], nodeChanges: [] });

describe("recordWorkflowDiff insertion order", () => {
  beforeEach(() => {
    useQueueStore.setState({ workflowDiffs: {} });
  });

  it("re-inserts an updated prompt at the end so the cap doesn't trim a fresh diff", () => {
    const s = useQueueStore.getState();
    s.recordWorkflowDiff("a", diff());
    s.recordWorkflowDiff("b", diff());
    // Updating "a" must move it to the end of enumeration order (most-recent),
    // not leave it first where capWorkflowDiffs would evict it as oldest.
    s.recordWorkflowDiff("a", diff());
    expect(Object.keys(useQueueStore.getState().workflowDiffs)).toEqual(["b", "a"]);
  });
});

describe("discardRecoverableJobs", () => {
  beforeEach(() => {
    useQueueStore.setState({ recoverableJobIds: [], shadowQueueJobs: {} });
  });

  it("drops the recoverable jobs' shadow records so they can't be re-detected", () => {
    const job = (id: string) => ({
      originalPromptId: id,
      prompt: {},
      outputsToExecute: [],
      number: 0,
      status: "pending" as const,
      queuedAt: 0,
    });
    useQueueStore.setState({
      shadowQueueJobs: { a: job("a"), b: job("b"), c: job("c") },
      recoverableJobIds: ["a", "b"],
    });
    useQueueStore.getState().discardRecoverableJobs();
    const state = useQueueStore.getState();
    expect(state.recoverableJobIds).toEqual([]);
    // Discarded jobs are gone for good; the unrelated shadow job survives.
    expect(Object.keys(state.shadowQueueJobs)).toEqual(["c"]);
    // A later detect pass over the remaining shadow jobs can't resurface them.
    expect(state.detectRecoverableJobs()).toEqual(["c"]);
  });
});

describe("markPromptCompleted", () => {
  beforeEach(() => {
    useQueueStore.setState({ completing: [], recoverableJobIds: [], shadowQueueJobs: {} });
  });

  it("dismisses a completing card locally without touching the running job", () => {
    useQueueStore.setState({
      completing: [
        { number: 0, prompt_id: "x", prompt: {}, extra: {}, outputs_to_execute: [] },
      ] as never,
    });
    useQueueStore.getState().markPromptCompleted("x");
    expect(useQueueStore.getState().completing).toEqual([]);
  });
});
