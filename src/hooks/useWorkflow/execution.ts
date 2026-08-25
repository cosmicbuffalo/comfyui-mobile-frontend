import {t} from "@/i18n";
import type {Workflow, WorkflowNode} from "@/api/types";
import {useWorkflowErrorsStore, type NodeError} from "@/hooks/useWorkflowErrors";
import * as api from "@/api/client";
import {useQueueStore} from "@/hooks/useQueue";
import {computeQueueWorkflowDiff, selectDiffBase} from "@/utils/workflowDiff";
import {QUEUE_WORKFLOW_LABEL_EXTRA_DATA_KEY} from "@/utils/queueWorkflowLabel";
import {useSeedStore} from "@/hooks/useSeed";
import {useGenerationSettingsStore} from "@/hooks/useGenerationSettings";
import {obfuscateQueuedInputPaths} from "@/utils/inputPathAliases";
import {buildWorkflowPromptInputs, getNodeWidgetIndexMap} from "@/utils/workflowInputs";
import {expandWorkflowSubgraphs} from "@/utils/expandWorkflowSubgraphs";
import {type SeedMode, DEFAULT_SPECIAL_SEED_RANGE, isSpecialSeedValue, findSeedWidgetIndex, generateSeedFromNode, clampSeedToNodeBounds, hasSeedControlWidget, findSeedControlWidgetIndex, resolveSpecialSeedToUse} from "@/utils/seedUtils";
import {injectMarketingNote} from "@/utils/marketingNote";
import {collectOasisPreviewIoIds, ensureOasisPreviewIoIds} from "@/utils/nodeFrontendPreviews";
import {isSetGetNode} from "@/utils/setGetNodes";
import {isUseEverywhereNode, resolveUseEverywhereForPrompt} from "@/utils/useEverywhere";
import {isSubgraphPlaceholder} from "@/utils/canonicalWorkflowOps";
import {resolveNodeIdentityFromHierarchicalKey} from "@/utils/workflowHierarchy";
import {validateAndNormalizeWorkflow} from "@/utils/workflowValidator";
import {HIDDEN_WORKFLOW_EXTRA_DATA_KEY, isWorkflowHidden} from "@/utils/workflowHidden";
import {stripWorkflowClientMetadata} from "./metadataNormalization";
import {applySeedOverridesForExpansion, buildSubgraphSeedWidgetDescriptors, inferSeedMode} from "./seedExpansion";
import {capPromptToSession} from "./sessions";
import {getWorkflowSignature} from "./signature";
import {queueWorkflowLabel, yieldToBrowserPaint} from "./helpers";
import {patchParkedSession, resolveWriteTarget, writeNodeKeyedField} from "./writeTarget";
import type {SeedLastValues, WorkflowGet, WorkflowSet, WorkflowState} from "./state";
import {createApplyNodeErrors} from "./nodeErrors";

let queueLatentSeq = 0;

export function createExecutionActions(set: WorkflowSet, get: WorkflowGet) {
    const applyNodeErrors = createApplyNodeErrors(set, get);

const setExecutionState: WorkflowState["setExecutionState"] = (
  isExecuting,
  executingNodeHierarchicalKey,
  executingPromptId,
  progress,
  executingNodePath,
  sessionId,
) => {
  set((state) => {
    // Route execution updates for a parked (background-executing) session
    // into its snapshot. Only the scalar execution fields are tracked
    // there; per-node duration stats are intentionally skipped for
    // non-visible sessions.
    const parked = resolveWriteTarget(state, sessionId);
    if (parked) {
      const identity =
        isExecuting && executingNodeHierarchicalKey && parked.workflow
          ? resolveNodeIdentityFromHierarchicalKey(
              parked.workflow,
              executingNodeHierarchicalKey,
              parked.pointerByHierarchicalKey,
            )
          : null;
      const nextPromptId = isExecuting
        ? (executingPromptId ?? parked.executingPromptId)
        : null;
      return {
        parkedSessions: {
          ...state.parkedSessions,
          [sessionId as string]: {
            ...parked,
            isExecuting,
            progress,
            executingPromptId: nextPromptId,
            executingNodeId: isExecuting
              ? (identity ? String(identity.nodeId) : parked.executingNodeId)
              : null,
            executingNodeHierarchicalKey: isExecuting
              ? (executingNodeHierarchicalKey ??
                 parked.executingNodeHierarchicalKey)
              : null,
            executingNodePath: isExecuting
              ? (executingNodePath !== undefined
                  ? executingNodePath
                  : parked.executingNodePath)
              : null,
          },
        },
      };
    }

    const now = Date.now();
    const resolvedExecutingNodeId =
      isExecuting && executingNodeHierarchicalKey && state.workflow
        ? (() => {
            const identity = resolveNodeIdentityFromHierarchicalKey(
              state.workflow,
              executingNodeHierarchicalKey,
              state.pointerByHierarchicalKey,
            );
            return identity ? String(identity.nodeId) : null;
          })()
        : null;
    const nextExecutingPromptId = isExecuting
      ? (executingPromptId ?? state.executingPromptId)
      : null;
    const promptChanged =
      Boolean(nextExecutingPromptId) &&
      nextExecutingPromptId !== state.executingPromptId;
    const nextExecutingNodeId = !isExecuting
      ? null
      : resolvedExecutingNodeId !== null
        ? resolvedExecutingNodeId
        : promptChanged
          ? null
          : state.executingNodeId;
    const nextExecutingHierarchicalKey = !isExecuting
      ? null
      : executingNodeHierarchicalKey !== null
        ? executingNodeHierarchicalKey
        : promptChanged
          ? null
          : state.executingNodeHierarchicalKey;
    const nextExecutingNodePath = !isExecuting
      ? null
      : executingNodePath !== undefined
        ? executingNodePath
        : promptChanged
          ? null
          : state.executingNodePath;
    const nextState: Partial<WorkflowState> = {
      isExecuting,
      executingNodeId: nextExecutingNodeId,
      executingNodeHierarchicalKey: nextExecutingHierarchicalKey,
      executingNodePath: nextExecutingNodePath,
      executingPromptId: nextExecutingPromptId,
      progress,
    };

    const updateNodeDuration = (
      nodeId: string | null,
      durationMs: number,
    ) => {
      if (!nodeId || durationMs <= 0) return state.nodeDurationStats;
      const node = state.workflow?.nodes.find(
        (n) => String(n.id) === nodeId,
      );
      if (node?.mode === 4) return state.nodeDurationStats;
      const key = String(nodeId);
      const prev = state.nodeDurationStats[key];
      const count = (prev?.count ?? 0) + 1;
      const avgMs = prev
        ? (prev.avgMs * prev.count + durationMs) / count
        : durationMs;
      return {
        ...state.nodeDurationStats,
        [key]: {
          avgMs,
          count,
        },
      };
    };

    if (!isExecuting) {
      if (state.currentNodeStartTime && state.executingNodeId) {
        const durationMs = now - state.currentNodeStartTime;
        nextState.nodeDurationStats = updateNodeDuration(
          state.executingNodeId,
          durationMs,
        );
      }
      if (state.executionStartTime && state.workflow) {
        const durationMs = now - state.executionStartTime;
        const signature = getWorkflowSignature(state.workflow);
        const prev = state.workflowDurationStats[signature];
        const count = (prev?.count ?? 0) + 1;
        const avgMs = prev
          ? (prev.avgMs * prev.count + durationMs) / count
          : durationMs;
        nextState.workflowDurationStats = {
          ...state.workflowDurationStats,
          [signature]: { avgMs, count },
        };
      }
      nextState.executionStartTime = null;
      nextState.currentNodeStartTime = null;
      return nextState;
    }

    const nodeChanged =
      nextExecutingNodeId &&
      nextExecutingNodeId !== state.executingNodeId;

    if (promptChanged) {
      nextState.executionStartTime = now;
      nextState.currentNodeStartTime = now;
    }

    if (
      nodeChanged &&
      state.currentNodeStartTime &&
      state.executingNodeId
    ) {
      const durationMs = now - state.currentNodeStartTime;
      nextState.nodeDurationStats = updateNodeDuration(
        state.executingNodeId,
        durationMs,
      );
      nextState.currentNodeStartTime = now;
    } else if (!state.currentNodeStartTime) {
      nextState.currentNodeStartTime = now;
    }

    return nextState;
  });
};

const setNodeOutput: WorkflowState["setNodeOutput"] = (
  itemKey,
  images,
  sessionId,
) => {
  set((state) =>
    writeNodeKeyedField(state, sessionId, itemKey, "nodeOutputs", images),
  );
};

const setNodeComparerOutput: WorkflowState["setNodeComparerOutput"] = (
  itemKey,
  output,
  sessionId,
) => {
  set((state) =>
    writeNodeKeyedField(
      state,
      sessionId,
      itemKey,
      "nodeComparerOutputs",
      output,
    ),
  );
};

const setNodeTextOutput: WorkflowState["setNodeTextOutput"] = (
  itemKey,
  text,
  sessionId,
) => {
  set((state) =>
    writeNodeKeyedField(
      state,
      sessionId,
      itemKey,
      "nodeTextOutputs",
      text,
    ),
  );
};

const clearNodeOutputs: WorkflowState["clearNodeOutputs"] = () => {
  set({ nodeOutputs: {}, nodeComparerOutputs: {}, nodeTextOutputs: {} });
};

const setLatentPreviewTiles: WorkflowState["setLatentPreviewTiles"] = (urls, itemKey) => {
  const fresh = urls.filter((url): url is string => Boolean(url));
  if (!itemKey) { fresh.forEach((url) => URL.revokeObjectURL(url)); return; }
  // The node card renders whatever is current, so the outgoing frames are
  // never referenced again once this set() commits — unlike the queue
  // card, which needs the one-generation buffer below.
  const previousTiles = get().latentPreviewTiles[itemKey];
  const previousSingle = get().latentPreviews[itemKey];
  const retired = new Set<string>(previousTiles
    ? previousTiles.filter((url): url is string => Boolean(url))
    : (previousSingle ? [previousSingle] : []));
  for (const url of fresh) retired.delete(url);
  retired.forEach((url) => URL.revokeObjectURL(url));

  const first = fresh[0];
  set((state) => {
    const latentPreviews = { ...state.latentPreviews };
    if (first) latentPreviews[itemKey] = first;
    else delete latentPreviews[itemKey];
    const latentPreviewTiles = { ...state.latentPreviewTiles };
    if (urls.length > 1) latentPreviewTiles[itemKey] = urls;
    else delete latentPreviewTiles[itemKey];
    return { latentPreviews, latentPreviewTiles };
  });
};

const setLatentPreview: WorkflowState["setLatentPreview"] = (url, itemKey) => {
  setLatentPreviewTiles([url], itemKey);
};

const clearAllLatentPreviews: WorkflowState["clearAllLatentPreviews"] = () => {
  const { latentPreviews, latentPreviewTiles } = get();
  const revoked = new Set<string>(Object.values(latentPreviews));
  for (const tiles of Object.values(latentPreviewTiles)) {
    for (const url of tiles) if (url) revoked.add(url);
  }
  revoked.forEach((url) => URL.revokeObjectURL(url));
  set({ latentPreviews: {}, latentPreviewTiles: {} });
};

const setQueueLatentPreviewTiles: WorkflowState["setQueueLatentPreviewTiles"] = (
  promptId,
  urls,
) => {
  const fresh = urls.filter((url): url is string => Boolean(url));
  if (!promptId || fresh.length === 0) { fresh.forEach((url) => URL.revokeObjectURL(url)); return; }
  const prev = get().latentPreviewByPrompt[promptId];
  // Keep a one-frame buffer: revoke the frames TWO generations back (which the
  // card has long stopped referencing) but keep the immediately-previous
  // set alive, so a still-decoding displayed frame is never revoked out
  // from under the <img>. Without this the streaming previews would still be
  // freed each step, but the currently-shown one stays valid.
  const retired = new Set<string>();
  if (prev?.prevTiles) {
    for (const url of prev.prevTiles) {
      if (url) retired.add(url);
    }
  } else if (prev?.prevUrl) {
    retired.add(prev.prevUrl);
  }
  // A tile that has not changed this generation is carried forward by
  // reference, so it must survive the retirement sweep.
  for (const url of fresh) retired.delete(url);
  retired.forEach((url) => URL.revokeObjectURL(url));

  queueLatentSeq += 1;
  set((state) => ({
    latentPreviewByPrompt: {
      ...state.latentPreviewByPrompt,
      [promptId]: {
        url: fresh[0],
        prevUrl: prev?.url,
        seq: queueLatentSeq,
        ...(urls.length > 1 ? { tiles: urls, prevTiles: prev?.tiles } : {}),
      },
    },
  }));
};

const setQueueLatentPreview: WorkflowState["setQueueLatentPreview"] = (promptId, url) => {
  setQueueLatentPreviewTiles(promptId, [url]);
};

// Revoke + drop every prompt's latent preview. Called at run start (not at
// run end) so the just-finished run's last frame keeps painting in the
// queue card until its real output decodes and swaps in — avoiding a flash
// of a revoked blob URL.

const clearQueueLatentPreviews: WorkflowState["clearQueueLatentPreviews"] = () => {
  const previews = get().latentPreviewByPrompt;
  if (Object.keys(previews).length === 0) return;
  const revoked = new Set<string>();
  for (const entry of Object.values(previews)) {
    revoked.add(entry.url);
    if (entry.prevUrl) revoked.add(entry.prevUrl);
    for (const url of entry.tiles ?? []) if (url) revoked.add(url);
    for (const url of entry.prevTiles ?? []) if (url) revoked.add(url);
  }
  revoked.forEach((url) => URL.revokeObjectURL(url));
  set({ latentPreviewByPrompt: {} });
};

const addPromptOutputs: WorkflowState["addPromptOutputs"] = (
  promptId,
  images,
  sessionId,
) => {
  if (!promptId || images.length === 0) return;
  set((state) => {
    const parked = resolveWriteTarget(state, sessionId);
    if (parked) {
      return patchParkedSession(state, sessionId as string, {
        promptOutputs: {
          ...parked.promptOutputs,
          [promptId]: [
            ...(parked.promptOutputs[promptId] ?? []),
            ...images,
          ],
        },
      });
    }
    return {
      promptOutputs: {
        ...state.promptOutputs,
        [promptId]: [...(state.promptOutputs[promptId] ?? []), ...images],
      },
    };
  });
};

const clearPromptOutputs: WorkflowState["clearPromptOutputs"] = (
  promptId,
  sessionId,
) => {
  if (!promptId) {
    set((state) => {
      // When a session is named, scope the clear to that session only —
      // a single session's event must never wipe every tab's outputs/routing.
      if (sessionId) {
        const parked = resolveWriteTarget(state, sessionId);
        if (parked) {
          return patchParkedSession(state, sessionId as string, {
            promptOutputs: {},
          });
        }
        return { promptOutputs: {} };
      }
      // Only a truly unscoped call (no promptId AND no sessionId) clears all.
      const parkedSessions = Object.fromEntries(
        Object.entries(state.parkedSessions).map(([sid, snap]) => [
          sid,
          { ...snap, promptOutputs: {} },
        ]),
      );
      return {
        promptOutputs: {},
        parkedSessions,
        promptToSession: {},
      };
    });
    return;
  }
  set((state) => {
    const parked = resolveWriteTarget(state, sessionId);
    // Intentionally leave the promptToSession entry in place: it's bounded
    // by capPromptToSession and pruned on session close, and keeping it
    // means a late straggler message for this finished prompt still routes
    // to its owning tab instead of falling back to the active one.
    if (parked) {
      if (!parked.promptOutputs[promptId]) return {};
      const nextPromptOutputs = { ...parked.promptOutputs };
      delete nextPromptOutputs[promptId];
      return patchParkedSession(state, sessionId as string, {
        promptOutputs: nextPromptOutputs,
      });
    }
    if (!state.promptOutputs[promptId]) return {};
    const next = { ...state.promptOutputs };
    delete next[promptId];
    return { promptOutputs: next };
  });
};

const setRunCount: WorkflowState["setRunCount"] = (count) => {
  set({ runCount: Math.max(1, Math.floor(count)) });
};

const setInfiniteLoop: WorkflowState["setInfiniteLoop"] = (val) => {
  // Toggling infinite mode for the visible session is the single source of
  // truth: enabling it for the active session implicitly disables it for
  // whichever other session previously held it.
  const { activeSessionId } = get();
  set({
    infiniteLoop: val,
    infiniteLoopSessionId: val ? activeSessionId : null,
    // Arming waits for an explicit Run; disarming clears the wait.
    infiniteLoopAwaitingRun: val,
  });
};

const setIsStopping: WorkflowState["setIsStopping"] = (val) => {
  set({ isStopping: val });
};

const setSavingSessionId: WorkflowState["setSavingSessionId"] = (id) => {
  set({ savingSessionId: id });
};

const setFollowQueue: WorkflowState["setFollowQueue"] = (followQueue) => {
  set({ followQueue });
};

const applyControlAfterGenerate: WorkflowState["applyControlAfterGenerate"] =
  (sessionId) => {
    const state = get();
    const parked = resolveWriteTarget(state, sessionId);
    const workflow = parked ? parked.workflow : state.workflow;
    if (!workflow) return;

    let hasChanges = false;
    const newNodes = workflow.nodes.map((node) => {
      // Handle PrimitiveNode with control_after_generate
      if (node.type === "PrimitiveNode") {
        if (!Array.isArray(node.widgets_values)) {
          return node;
        }
        const outputType = node.outputs?.[0]?.type;
        const normalizedType = String(outputType).toUpperCase();

        // Only numeric types support control_after_generate
        if (normalizedType !== "INT" && normalizedType !== "FLOAT") {
          return node;
        }

        const controlMode = node.widgets_values?.[1] as
          | string
          | undefined;
        if (!controlMode || controlMode === "fixed") {
          return node;
        }

        const currentValue = node.widgets_values?.[0];
        if (typeof currentValue !== "number") {
          return node;
        }

        let newValue = currentValue;
        if (controlMode === "increment") {
          newValue =
            normalizedType === "INT"
              ? currentValue + 1
              : currentValue + 0.01;
        } else if (controlMode === "decrement") {
          newValue =
            normalizedType === "INT"
              ? currentValue - 1
              : currentValue - 0.01;
        } else if (controlMode === "randomize") {
          // For INT, generate a random seed within the safe universal
          // ceiling (2^32-1). A primitive feeds its value to a consumer by
          // connection, whose seed max isn't known here; 2^32-1 is accepted
          // by ~every node (going higher made nodes like Qwen-VL reject the
          // branch at validation). For FLOAT, generate between 0 and 1.
          newValue =
            normalizedType === "INT"
              ? Math.floor(Math.random() * (DEFAULT_SPECIAL_SEED_RANGE + 1))
              : Math.random();
        }

        if (newValue !== currentValue) {
          hasChanges = true;
          const newWidgetValues = [...node.widgets_values];
          newWidgetValues[0] = newValue;
          return { ...node, widgets_values: newWidgetValues };
        }
      }

      return node;
    });

    if (hasChanges) {
      const nextWorkflow = { ...workflow, nodes: newNodes };
      if (parked) {
        set({
          parkedSessions: {
            ...get().parkedSessions,
            [sessionId as string]: { ...parked, workflow: nextWorkflow },
          },
        });
      } else {
        set({ workflow: nextWorkflow });
      }
    }
  };

const queueWorkflow: WorkflowState["queueWorkflow"] = async (
  count,
  sessionId,
  isInfiniteReEnqueue,
  queueFront,
) => {
  const state = get();
  const sid = sessionId ?? state.activeSessionId;
  // A null sid (no sessions registered yet — e.g. tests that set workflow
  // directly) still targets the flat "active" fields.
  const isActive = sid == null || sid === state.activeSessionId;
  const parked = !isActive ? state.parkedSessions[sid!] : null;
  const nodeTypes = state.nodeTypes;
  const sourceWorkflow = isActive ? state.workflow : parked?.workflow ?? null;
  // Seeds: the seed store always mirrors the active session; parked
  // sessions carry their own seed maps in their snapshot.
  const seedModes = isActive
    ? useSeedStore.getState().seedModes
    : parked?.seedModes ?? {};
  const seedLastValues = isActive
    ? useSeedStore.getState().seedLastValues
    : parked?.seedLastValues ?? {};

  if (count < 1 || (!isActive && !parked)) return false;
  if (!sourceWorkflow || !nodeTypes) {
    useWorkflowErrorsStore
      .getState()
      .setError(t("Node types are still loading. Try again in a moment."));
    return false;
  }

  // Write helpers route per-iteration mutations to flat fields (active) or
  // the owning session's snapshot (parked).
  //
  // CRITICAL: these run AFTER awaits (the paint yield + each /api/prompt
  // round-trip). The user can switch tabs mid-enqueue, which folds this
  // session from active→parked. So each write must re-resolve where session
  // `sid` lives RIGHT NOW — trusting the captured `isActive` here would
  // write this enqueue's seed/workflow mutations into whatever tab became
  // active, silently overwriting it.
  const liveTarget = (): "active" | "parked" | "gone" => {
    const cur = get();
    if (sid == null || sid === cur.activeSessionId) return "active";
    if (sid && cur.parkedSessions[sid]) return "parked";
    return "gone"; // session was closed mid-flight — drop the write.
  };
  const writeWorkflow = (wf: Workflow) => {
    const target = liveTarget();
    if (target === "active") {
      set({ workflow: wf });
    } else if (target === "parked") {
      set((s) => ({
        parkedSessions: {
          ...s.parkedSessions,
          [sid!]: { ...s.parkedSessions[sid!], workflow: wf },
        },
      }));
    }
  };
  const writeSeedLastValues = (vals: SeedLastValues) => {
    const target = liveTarget();
    if (target === "active") {
      useSeedStore.getState().setSeedLastValues(vals);
    } else if (target === "parked") {
      set((s) => ({
        parkedSessions: {
          ...s.parkedSessions,
          [sid!]: { ...s.parkedSessions[sid!], seedLastValues: vals },
        },
      }));
    }
  };
  const writeExpandedMaps = (
    idMap: Record<string, string>,
    pathMap: Record<string, string>,
  ) => {
    const target = liveTarget();
    if (target === "active") {
      set({ expandedNodeIdMap: idMap, expandedNodePathMap: pathMap });
    } else if (target === "parked") {
      set((s) => ({
        parkedSessions: {
          ...s.parkedSessions,
          [sid!]: {
            ...s.parkedSessions[sid!],
            expandedNodeIdMap: idMap,
            expandedNodePathMap: pathMap,
          },
        },
      }));
    }
  };

  useWorkflowErrorsStore.getState().setError(null);
  if (liveTarget() === "active") set({ isLoading: true });
  if (sid) {
    set((s) => ({
      isLoadingBySession: { ...s.isLoadingBySession, [sid]: true },
    }));
  }

  try {
    await yieldToBrowserPaint();

    // Oasis preview results travel over an io_id-only websocket event.
    // Desktop's DOM widget normally mints that id, but it never runs in
    // this frontend, so guarantee a stable id before prompt construction
    // and persist it into the canonical workflow for event routing.
    const reservedOasisIds = [
      ...(isActive ? [] : [state.workflow]),
      ...Object.entries(state.parkedSessions)
        .filter(([otherSid]) => isActive || otherSid !== sid)
        .map(([, snapshot]) => snapshot.workflow),
    ].flatMap((otherWorkflow) => (
      collectOasisPreviewIoIds(otherWorkflow, nodeTypes)
    ));
    let currentWorkflow = ensureOasisPreviewIoIds(
      sourceWorkflow,
      nodeTypes,
      undefined,
      reservedOasisIds,
    );
    if (currentWorkflow !== sourceWorkflow) writeWorkflow(currentWorkflow);
    let nextSeedLastValues: SeedLastValues = { ...seedLastValues };

    // Process seed mode for a single node; mutates seedOverrides and
    // nextSeedLastValues in-place. Overrides are keyed by scoped key
    // ("nodeId" at root, "subgraphId:nodeId" inside a definition) so a
    // root node and an inner node sharing a numeric ID can't clobber
    // each other; queueing remaps them to expanded node IDs.
    const processSeedNode = (
      node: WorkflowNode,
      seedOverrides: Record<string, number>,
      scopeSubgraphId: string | null,
    ): WorkflowNode => {
      const isPlaceholder = isSubgraphPlaceholder(node, currentWorkflow);
      // Subgraph placeholders (e.g. a promoted noise_seed on a video
      // model's subgraph) aren't real ComfyUI node types, so nodeTypes
      // has no schema for them — findSeedWidgetIndex needs the same
      // resolved descriptor list the UI uses to locate a promoted seed.
      const widgetDescriptors = isPlaceholder
        ? buildSubgraphSeedWidgetDescriptors(currentWorkflow, nodeTypes, node)
        : undefined;
      const seedIndex = findSeedWidgetIndex(currentWorkflow, nodeTypes, node, {
        widgetDescriptors,
      });
      if (seedIndex === null) return node;
      if (!Array.isArray(node.widgets_values)) return node;

      // Subgraphs never promote a stock control_after_generate widget
      // adjacent to the seed by position — only an explicit
      // proxyWidgets entry can surface one. Guessing seedIndex + 1 for
      // a placeholder can land on an unrelated widget (e.g. a model
      // combo) that also happens to hold a non-empty string.
      const controlWidgetIndex = isPlaceholder
        ? findSeedControlWidgetIndex(widgetDescriptors)
        : seedIndex + 1;
      const hasControlWidget =
        controlWidgetIndex !== null &&
        hasSeedControlWidget(node, node.widgets_values[controlWidgetIndex]);
      const controlWidgetMode =
        hasControlWidget && typeof node.widgets_values[controlWidgetIndex!] === "string"
          ? (node.widgets_values[controlWidgetIndex!] as SeedMode)
          : null;
      const mode =
        controlWidgetMode ??
        seedModes[node.id] ??
        inferSeedMode(currentWorkflow, nodeTypes, node);

      if (hasControlWidget) {
        if (!mode || mode === "fixed") return node;
        const currentSeed = Number(node.widgets_values[seedIndex]) || 0;
        let nextSeed: number;
        switch (mode) {
          case "randomize": nextSeed = generateSeedFromNode(nodeTypes, node); break;
          case "increment": nextSeed = currentSeed + 1; break;
          case "decrement": nextSeed = currentSeed - 1; break;
          default: return node;
        }
        const newWidgetValues = [...node.widgets_values];
        newWidgetValues[seedIndex] = clampSeedToNodeBounds(nextSeed, nodeTypes, node);
        return { ...node, widgets_values: newWidgetValues };
      }

      const rawSeed = Number(node.widgets_values[seedIndex]);
      const lastSeed = nextSeedLastValues[node.id] ?? null;
      let seedToUse: number | null = null;
      if (isSpecialSeedValue(rawSeed)) {
        seedToUse = resolveSpecialSeedToUse(rawSeed, lastSeed, nodeTypes, node);
      } else if (mode && mode !== "fixed") {
        if (mode === "randomize") {
          seedToUse = generateSeedFromNode(nodeTypes, node);
        } else if (mode === "increment") {
          const base = typeof lastSeed === "number" ? lastSeed : rawSeed;
          seedToUse = base + 1;
        } else if (mode === "decrement") {
          const base = typeof lastSeed === "number" ? lastSeed : rawSeed;
          seedToUse = base - 1;
        }
      }
      if (seedToUse === null) return node;
      // Never hand the node a seed outside its declared range, or ComfyUI
      // silently drops that node's branch at validation.
      seedToUse = clampSeedToNodeBounds(seedToUse, nodeTypes, node);
      const overrideKey =
        scopeSubgraphId == null
          ? String(node.id)
          : `${scopeSubgraphId}:${node.id}`;
      seedOverrides[overrideKey] = seedToUse;
      nextSeedLastValues = { ...nextSeedLastValues, [node.id]: seedToUse };
      return node;
    };

    // ComfyUI implements `front` by assigning successively more-negative
    // queue numbers. Sending every member of a batch with `front: true`
    // therefore executes the batch backwards. The first response gives
    // us its authoritative priority; place later members fractionally
    // after it (but before the next integer priority) to retain the
    // workflow/seed order while the whole batch remains at the front.
    let frontBatchBaseNumber: number | null = null;
    for (let i = 0; i < count; i++) {
      const seedOverrides: Record<string, number> = {};
      // Handle seed modes for root nodes and inner subgraph nodes.
      const updatedNodes = currentWorkflow.nodes.map((node) =>
        processSeedNode(node, seedOverrides, null),
      );
      const subgraphDefsForSeed = currentWorkflow.definitions?.subgraphs ?? [];
      const updatedSubgraphDefs = subgraphDefsForSeed.map((sg) => {
        const updatedSgNodes = (sg.nodes ?? []).map((node) =>
          processSeedNode(node, seedOverrides, sg.id),
        );
        const changed = updatedSgNodes.some((n, idx) => n !== (sg.nodes ?? [])[idx]);
        return changed ? { ...sg, nodes: updatedSgNodes } : sg;
      });

      // Update current workflow with new seeds for this iteration
      currentWorkflow = {
        ...currentWorkflow,
        nodes: updatedNodes,
        definitions: currentWorkflow.definitions
          ? { ...currentWorkflow.definitions, subgraphs: updatedSubgraphDefs }
          : currentWorkflow.definitions,
      };
      writeSeedLastValues(nextSeedLastValues);
      writeWorkflow(currentWorkflow);

      // Repair link/slot consistency BEFORE building the executed prompt,
      // not only before embedding the workflow in the PNG (see below). An
      // edit can leave a link present in the `links` table while the target
      // node's inputs[].link still points elsewhere (e.g. after pasting and
      // wiring up a section). Persistence/embed already repairs this, so the
      // saved workflow looks correct — but the prompt is built from
      // inputs[].link, so without this it would silently drop that
      // connection and the downstream branch never executes.
      const validatedForQueue = validateAndNormalizeWorkflow(currentWorkflow);

      // Seed overrides recorded above for a promoted-seed placeholder (no
      // real control_after_generate on the boundary, so processSeedNode
      // took the ephemeral seedOverrides path rather than mutating
      // widgets_values) never landed in currentWorkflow.nodes itself.
      // Patch a throwaway clone, used only for this expansion pass, so
      // the fresh value propagates into the inner node it proxies to
      // instead of being overwritten by the stale saved one. See
      // applySeedOverridesForExpansion's own docstring for why.
      const workflowForExpansion = applySeedOverridesForExpansion(
        validatedForQueue,
        nodeTypes,
        seedOverrides,
      );

      // Expand JIT for prompt building (one-way, ephemeral — no sync-back needed).
      // promptKeyMap maps each expanded node's numeric ID to its hierarchical
      // execution ID (e.g. "50:7" for inner node 7 inside placeholder 50),
      // matching the ID scheme used by the main ComfyUI frontend.
      const { workflow: expandedForQueue, promptKeyMap } = expandWorkflowSubgraphs(workflowForExpansion, nodeTypes);

      // Build mapping from WS node IDs back to canonical itemKeys.
      // ComfyUI may report either expanded numeric IDs or hierarchical prompt keys,
      // so we store both forms for robust node-progress routing.
      {
        const idMap: Record<string, string> = {};
        const pathMap: Record<string, string> = {};

        // Build lookup: placeholder node ID → subgraph definition UUID.
        // Needed for deriving itemKeys of expanded inner nodes that lack one.
        const placeholderToSgId = new Map<string, string>();
        const subgraphDefs = currentWorkflow.definitions?.subgraphs ?? [];
        const sgIdSet = new Set(subgraphDefs.map((sg) => sg.id));
        for (const node of currentWorkflow.nodes) {
          if (sgIdSet.has(node.type)) {
            placeholderToSgId.set(String(node.id), node.type);
          }
        }

        for (const node of expandedForQueue.nodes) {
          const promptKey = promptKeyMap.get(node.id);
          let resolvedKey = node.itemKey ?? null;

          // Expanded subgraph inner nodes may lack itemKey when the user
          // hasn't navigated into that subgraph scope yet.  Derive from
          // the prompt key hierarchy: "placeholderId:innerNodeId".
          if (!resolvedKey && promptKey) {
            const colonIdx = promptKey.indexOf(':');
            if (colonIdx !== -1) {
              const placeholderId = promptKey.substring(0, colonIdx);
              const innerNodeId = promptKey.substring(colonIdx + 1);
              const sgId = placeholderToSgId.get(placeholderId);
              // Only handle single-level nesting (no further colons)
              if (sgId && !innerNodeId.includes(':')) {
                resolvedKey = `root/subgraph:${sgId}/node:${innerNodeId}`;
              }
            }
          }

          if (!resolvedKey) continue;
          idMap[String(node.id)] = resolvedKey;
          if (promptKey) idMap[promptKey] = resolvedKey;
        }
        for (const [expandedId, promptKey] of promptKeyMap) {
          pathMap[String(expandedId)] = promptKey;
          pathMap[promptKey] = promptKey;
        }
        writeExpandedMaps(idMap, pathMap);
      }

      // Remap scoped seed overrides ("nodeId" / "subgraphId:nodeId") to
      // expanded node IDs by walking each prompt key's placeholder path
      // down to the definition that owns the innermost node.
      const subgraphDefsById = new Map(
        (currentWorkflow.definitions?.subgraphs ?? []).map((sg) => [sg.id, sg]),
      );
      const scopedOverrideKeyForPromptKey = (promptKey: string): string | null => {
        const segments = promptKey.split(":");
        if (segments.length === 1) return segments[0];
        let scopeNodes = currentWorkflow.nodes;
        let scopeSgId: string | null = null;
        for (let s = 0; s < segments.length - 1; s += 1) {
          const placeholderId = Number(segments[s]);
          const placeholder = scopeNodes.find((n) => n.id === placeholderId);
          const sg = placeholder ? subgraphDefsById.get(placeholder.type) : undefined;
          if (!sg) return null;
          scopeSgId = sg.id;
          scopeNodes = sg.nodes ?? [];
        }
        return `${scopeSgId}:${segments[segments.length - 1]}`;
      };
      const expandedSeedOverrides: Record<number, number> = {};
      for (const node of expandedForQueue.nodes) {
        const promptKey = promptKeyMap.get(node.id) ?? String(node.id);
        const scopedKey = scopedOverrideKeyForPromptKey(promptKey);
        if (scopedKey != null && seedOverrides[scopedKey] !== undefined) {
          expandedSeedOverrides[node.id] = seedOverrides[scopedKey];
        }
      }

      const prompt: Record<string, unknown> = {};
      const allowedNodeIds = new Set<number>();
      const classTypeById = new Map<number, string>();

      // Use Everywhere broadcasts feed inputs that carry no link at all, so
      // they have to be resolved up front and handed to the input builder.
      const ueLinks = resolveUseEverywhereForPrompt(
        expandedForQueue,
        promptKeyMap,
      );

      for (const node of expandedForQueue.nodes) {
        if (node.mode === 4) continue;
        // SetNode/GetNode are virtual relays: consumers already resolve
        // through them to the real source (resolveSource), so drop them
        // from the prompt. Leaving them out of allowedNodeIds means the
        // emit loop below skips them too. Works whether or not the backend
        // has the KJNodes types installed.
        if (isSetGetNode(node)) continue;
        // Anything Everywhere nodes are no-op broadcasters with no outputs;
        // their routing is already baked into ueLinks. A `ue_convert` node
        // is a real node that also broadcasts, so it stays.
        if (isUseEverywhereNode(node)) continue;
        let classType: string | null = null;
        if (nodeTypes[node.type]) {
          classType = node.type;
        } else {
          const match = Object.entries(nodeTypes).find(
            ([, def]) =>
              def.display_name === node.type || def.name === node.type,
          );
          if (match) classType = match[0];
        }
        if (classType) {
          allowedNodeIds.add(node.id);
          classTypeById.set(node.id, classType);
        }
      }

      for (const node of expandedForQueue.nodes) {
        if (node.mode === 4) continue;
        const classType = classTypeById.get(node.id);
        if (!classType) continue;
        const inputs = buildWorkflowPromptInputs(
          expandedForQueue,
          nodeTypes,
          node,
          classType,
          allowedNodeIds,
          getNodeWidgetIndexMap(expandedForQueue, node),
          expandedSeedOverrides,
          promptKeyMap,
          ueLinks,
        );
        const promptKey = promptKeyMap.get(node.id) ?? String(node.id);
        prompt[promptKey] = { class_type: classType, inputs };
      }

      // Infinite-loop safety: if an infinite re-enqueue would submit the
      // exact same prompt as last time (e.g. a fixed seed), the loop would
      // just regenerate an identical result forever. Stop and explain.
      const promptSignature = JSON.stringify(prompt);
      if (
        isInfiniteReEnqueue &&
        sid &&
        promptSignature === get().lastPromptSignatureBySession[sid]
      ) {
        set({ infiniteLoopSessionId: null });
        if (isActive) set({ infiniteLoop: false });
        useWorkflowErrorsStore
          .getState()
          .setError(
            t("Infinite generation stopped: the workflow would re-run an identical prompt (likely a fixed seed), producing the same result over and over. Set a seed widget to randomize — or change an input — to keep generating new outputs."),
          );
        return false;
      }

      // Embed the canonical workflow (not expanded) so desktop ComfyUI can reload it correctly.
      // Run validateAndNormalizeWorkflow to repair any stale SubgraphIO.linkIds before embedding.
      let queuedWorkflow = validateAndNormalizeWorkflow(stripWorkflowClientMetadata(currentWorkflow));
      let queuedPrompt = prompt;
      if (useGenerationSettingsStore.getState().obfuscateSharedInputPaths) {
        const obfuscated = await obfuscateQueuedInputPaths(prompt, queuedWorkflow, nodeTypes);
        queuedPrompt = obfuscated.prompt;
        queuedWorkflow = obfuscated.workflow;
      }
      // Embed a hidden credit note above the top-left-most node (opt-out).
      // Only ever added to this embedded copy — never the in-app workflow —
      // so it stays invisible/unselectable in the mobile UI. Recomputed from
      // the current geometry each run, so it tracks the top-left node even
      // after a tidy-layout reflow.
      if (useGenerationSettingsStore.getState().marketingNoteEnabled) {
        queuedWorkflow = injectMarketingNote(queuedWorkflow);
      }
      const metadataFilename = isActive ? state.currentFilename : parked?.currentFilename ?? null;
      const metadataSource = isActive ? state.workflowSource : parked?.workflowSource ?? null;
      const metadataWorkflowLabel = queueWorkflowLabel(metadataFilename, metadataSource);
      const hiddenWorkflow = isWorkflowHidden(metadataSource, metadataFilename);
      const previewMethod = useGenerationSettingsStore.getState().previewMethod;
      // VHS's optional animated latent protocol is enabled through
      // workflow metadata rather than ComfyUI's preview_method field.
      // Write both true and false so a desktop-authored workflow cannot
      // override the mobile user's current latent-preview preference.
      queuedWorkflow = {
        ...queuedWorkflow,
        extra: {
          ...(queuedWorkflow.extra ?? {}),
          VHS_latentpreview: previewMethod !== 'none',
          VHS_latentpreviewrate:
            queuedWorkflow.extra?.VHS_latentpreviewrate ?? 0,
        },
      };
      const promptRequest: api.PromptQueueRequest = {
        prompt: queuedPrompt,
        client_id: api.clientId,
        ...(queueFront
          ? frontBatchBaseNumber == null
            ? { front: true }
            : { number: frontBatchBaseNumber + i / (count + 1) }
          : {}),
        extra_data: {
          [QUEUE_WORKFLOW_LABEL_EXTRA_DATA_KEY]: metadataWorkflowLabel,
          extra_pnginfo: {
            workflow: queuedWorkflow,
          },
          ...(hiddenWorkflow ? { [HIDDEN_WORKFLOW_EXTRA_DATA_KEY]: true } : {}),
          ...(previewMethod !== 'none' ? { preview_method: previewMethod } : {}),
        },
      };
      // Parse ComfyUI's node_errors map (array or {errors:[…]} form) into our
      // NodeError shape. ComfyUI returns this both on a hard reject (HTTP 400)
      // AND on a partial accept (HTTP 200) when it queues the valid output
      // nodes but excludes branches with a validation error (e.g. an
      // out-of-range value) — so we must check it on success too.
      const parseQueueNodeErrors = (raw: unknown): Record<string, NodeError[]> => {
        const parsed: Record<string, NodeError[]> = {};
        if (!raw || typeof raw !== "object") return parsed;
        for (const [nodeId, nodeError] of Object.entries(raw)) {
          const errorsArray = Array.isArray(nodeError)
            ? nodeError
            : (typeof nodeError === "object" &&
                nodeError !== null &&
                "errors" in nodeError &&
                Array.isArray((nodeError as { errors?: unknown[] }).errors))
            ? (nodeError as { errors: Array<{
                type: string;
                message: string;
                details: string;
                extra_info?: { input_name?: string };
              }> }).errors
            : [];
          if (errorsArray && errorsArray.length > 0) {
            parsed[nodeId] = errorsArray.map((e) => ({
              type: e.type,
              message: e.message,
              details: e.details,
              inputName: e.extra_info?.input_name,
            }));
          }
        }
        return parsed;
      };

      const response = await fetch('/api/prompt', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(promptRequest),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const getErrorMessage = (value: unknown): string | null => {
          if (typeof value === 'string') return value;
          if (value && typeof value === 'object') {
            const details = value as { message?: unknown; error?: unknown; details?: unknown };
            if (typeof details.message === 'string') return details.message;
            if (typeof details.error === 'string') return details.error;
            if (typeof details.details === 'string') return details.details;
          }
          return null;
        };

        const nodeErrors = parseQueueNodeErrors(errorData.node_errors);
        if (Object.keys(nodeErrors).length > 0) {
          applyNodeErrors(nodeErrors, true);
        }

        throw new Error(
          getErrorMessage(errorData.error) || t("Failed to queue prompt"),
        );
      }

      // Record which session owns this prompt_id for websocket routing.
      try {
        const okData = (await response.json()) as {
          prompt_id?: string;
          number?: unknown;
          node_errors?: unknown;
        };
        if (
          queueFront
          && i === 0
          && typeof okData.number === 'number'
          && Number.isFinite(okData.number)
        ) {
          frontBatchBaseNumber = okData.number;
        }
        // A 200 with node_errors means ComfyUI queued the valid outputs but
        // SILENTLY dropped the branches it couldn't validate. Surface those
        // loudly (fromRun) so the user sees which node failed — with
        // jump-to-node — on whatever panel they're on, instead of wondering
        // why part of their workflow never ran.
        const partialErrors = parseQueueNodeErrors(okData?.node_errors);
        if (Object.keys(partialErrors).length > 0) {
          applyNodeErrors(partialErrors, true);
        } else {
          // Clean accept — clear any stale validation errors from a prior
          // partial/failed queue so the badges don't linger after a fix.
          useWorkflowErrorsStore.getState().clearNodeErrors();
        }
        const promptId = okData?.prompt_id;
        if (promptId && sid) {
          // Prompts still in the backend queue must keep their routing
          // entry even if the map is over the cap (a long/infinite run can
          // accumulate >200 entries); only finished ones are safe to evict.
          const q = useQueueStore.getState();
          const activePromptIds = new Set<string>([
            promptId,
            ...q.running.map((item) => item.prompt_id),
            ...q.pending.map((item) => item.prompt_id),
          ]);
          set((s) => ({
            promptToSession: capPromptToSession(
              {
                ...s.promptToSession,
                [promptId]: sid,
              },
              activePromptIds,
            ),
            // A run was actually queued for the loop owner, so it is no
            // longer "armed but awaiting Run" — the idle-resume driver
            // may keep the loop going from here on.
            ...(sid === s.infiniteLoopSessionId && s.infiniteLoopAwaitingRun
              ? { infiniteLoopAwaitingRun: false }
              : {}),
          }));
        }
        if (promptId) {
          useQueueStore.getState().registerLocalPrompt(promptId);
          useQueueStore.getState().recordQueuedPrompt(promptId, promptRequest, {
            sessionId: sid,
          });
          let workflowDiffForMetadata: ReturnType<typeof computeQueueWorkflowDiff> | undefined;
          // Compute & store this queue item's workflow diff (prompt
          // preview) against the session's rolling base, then advance the
          // base for next time. See selectDiffBase for the "same diff
          // until you make a change" rule.
          try {
            const fresh = get();
            // Re-resolve where this session lives now (it may have been
            // switched active→parked during the fetch); see liveTarget.
            const diffTarget = liveTarget();
            const diffUseFlat = diffTarget === "active";
            const parkedForDiff =
              diffTarget === "parked" && sid ? fresh.parkedSessions[sid] : null;
            const diffBase = diffUseFlat
              ? fresh.diffBaseWorkflow
              : parkedForDiff?.diffBaseWorkflow ?? null;
            const lastEnqueued = diffUseFlat
              ? fresh.lastEnqueuedWorkflow
              : parkedForDiff?.lastEnqueuedWorkflow ?? null;
            const originalForSession = diffUseFlat
              ? fresh.originalWorkflow
              : parkedForDiff?.originalWorkflow ?? null;
            const { base, nextDiffBase } = selectDiffBase(
              currentWorkflow,
              lastEnqueued,
              diffBase,
              originalForSession,
              nodeTypes,
            );
            const diff = computeQueueWorkflowDiff(base, currentWorkflow);
            workflowDiffForMetadata = diff;
            useQueueStore.getState().recordWorkflowDiff(promptId, diff);
            const enqueuedSnapshot = structuredClone(currentWorkflow);
            if (diffUseFlat) {
              set({
                diffBaseWorkflow: nextDiffBase,
                lastEnqueuedWorkflow: enqueuedSnapshot,
              });
            } else if (diffTarget === "parked" && sid) {
              set((s) => ({
                parkedSessions: {
                  ...s.parkedSessions,
                  [sid]: {
                    ...s.parkedSessions[sid],
                    diffBaseWorkflow: nextDiffBase,
                    lastEnqueuedWorkflow: enqueuedSnapshot,
                  },
                },
              }));
            }
          } catch (diffErr) {
            console.warn("Failed to compute queue workflow diff:", diffErr);
          }
          api.upsertQueuePromptMetadata({
            promptId,
            workflowLabel: metadataWorkflowLabel,
            workflowSource: metadataSource ?? undefined,
            sessionId: sid ?? undefined,
            clientId: api.clientId,
            workflowDiff: workflowDiffForMetadata,
          }).catch((metadataErr) => {
            console.warn("Failed to save mobile queue metadata:", metadataErr);
          });
        }
        // Remember this prompt so an infinite loop can detect a stuck
        // (identical) re-enqueue on the next iteration.
        if (sid) {
          set((s) => ({
            lastPromptSignatureBySession: {
              ...s.lastPromptSignatureBySession,
              [sid]: promptSignature,
            },
          }));
        }
      } catch {
        // Response body not JSON / already consumed — routing falls back
        // to the active session in the websocket handler.
      }

    }
    return true;
  } catch (err) {
    console.error("Failed to queue prompt:", err);
    useWorkflowErrorsStore
      .getState()
      .setError(
        err instanceof Error ? err.message : t("Failed to queue workflow"),
      );
    return false;
  } finally {
    // Keep the submit feedback visible until the queued prompt is
    // observable, instead of flashing back to Run while queue sync lags.
    // This refresh is best-effort. The prompt POST above is the source of
    // truth for whether queueing succeeded; turning a later refresh
    // failure into a rejected result can make native callers retry and
    // accidentally submit the same generation twice.
    try {
      await useQueueStore.getState().fetchQueue();
    } catch (refreshErr) {
      console.warn("Failed to refresh queue after prompt submission:", refreshErr);
    }
    if (liveTarget() === "active") set({ isLoading: false });
    if (sid) {
      set((s) => {
        const next = { ...s.isLoadingBySession };
        delete next[sid];
        return { isLoadingBySession: next };
      });
    }
  }
};

  return { setExecutionState, setNodeOutput, setNodeComparerOutput, setNodeTextOutput, clearNodeOutputs, setLatentPreviewTiles, setLatentPreview, clearAllLatentPreviews, setQueueLatentPreviewTiles, setQueueLatentPreview, clearQueueLatentPreviews, addPromptOutputs, clearPromptOutputs, setRunCount, setInfiniteLoop, setIsStopping, setSavingSessionId, setFollowQueue, applyControlAfterGenerate, queueWorkflow };
}
