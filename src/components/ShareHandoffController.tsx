import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadUserWorkflow } from '@/api/client';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { resolveInputWidget } from '@/utils/workflowOperations';
import { collectScopedWorkflowNodes } from '@/utils/workflowNodes';
import { isLoadImageType } from '@/utils/bulkProcess';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { isInNativeApp } from '@/utils/nativeApp';
import { useI18n } from '@/i18n';

/**
 * Handles the native iOS app's share-to-app hand-off. The app uploads the
 * shared image to ComfyUI's input dir and navigates here with two query
 * params:
 *
 *   /mobile/?loadWorkflow=<userdata-relative-path>&useImage=<input-filename>
 *
 * The visible app hand-off loads the workflow, walks for LoadImage-style nodes,
 *   - 0 matches: toast + clear params
 *   - 1 match : auto-fill, show a dismiss-only confirmation banner
 *   - N matches: pop a picker with one row per LoadImage node
 *
 * The share extension uses an isolated hidden WebView with `autoQueue=1` and
 * `enqueueOnly=1`. That mode is accepted only when WebKit has installed the
 * `cueForgeShareQueue` native message handler: URL parameters and the easily
 * spoofed User-Agent marker alone cannot authorize a headless generation. It
 * stages into the first compatible LoadImage node in workflow order, submits
 * exactly one run, reports a structured result to Swift, and renders no tab UI.
 *
 * Tracks the iOS app side: https://github.com/cosmicbuffalo/comfyui-mobile-frontend-private/issues/34
 */
type Phase =
  | 'idle'                  // no handoff params present
  | 'loading'               // loadUserWorkflow in flight
  | 'staging'               // workflow loaded; deciding on UX based on node count
  | 'queueing'              // staged; exactly one native-requested run in flight
  | 'banner'                // exactly one LoadImage; auto-filled; awaiting dismiss
  | 'picker'                // multiple LoadImage nodes; user picks
  | 'error'                 // load/no-loadimage failure; momentarily visible
  | 'done';                 // dismissed; nothing more to render

interface State {
  phase: Phase;
  workflowPath: string;
  imageFilename: string;
  errorText: string;
  autoQueue: boolean;
  enqueueOnly: boolean;
  alreadyQueued: boolean;
  /** Set after we've successfully written the widget — drives the banner copy. */
  stagedNodeLabel: string | null;
}

const initialState: State = {
  phase: 'idle',
  workflowPath: '',
  imageFilename: '',
  errorText: '',
  autoQueue: false,
  enqueueOnly: false,
  alreadyQueued: false,
  stagedNodeLabel: null,
};

type ShareQueueResult =
  | { status: 'success' }
  | { status: 'error'; code: string; message: string };

interface ShareQueueBridge {
  postMessage: (result: ShareQueueResult) => void;
}

function getShareQueueBridge(): ShareQueueBridge | null {
  if (typeof window === 'undefined') return null;
  const webkit = (window as unknown as {
    webkit?: { messageHandlers?: { cueForgeShareQueue?: unknown } };
  }).webkit;
  const bridge = webkit?.messageHandlers?.cueForgeShareQueue;
  if (!bridge || typeof (bridge as { postMessage?: unknown }).postMessage !== 'function') {
    return null;
  }
  return bridge as ShareQueueBridge;
}

function clearHandoffParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete('loadWorkflow');
  url.searchParams.delete('useImage');
  url.searchParams.delete('autoQueue');
  url.searchParams.delete('enqueueOnly');
  url.searchParams.delete('openSharedWorkflowIfRoom');
  url.searchParams.delete('shareAlreadyQueued');
  window.history.replaceState({}, '', url.toString());
}

export function ShareHandoffController() {
  const { t } = useI18n();
  const [state, setState] = useState<State>(initialState);

  // Pull each store slice we need. Note: we re-read the workflow + nodeTypes
  // on render so the `staging` phase below can react to the freshly-loaded
  // workflow once loadWorkflow has finished updating the store.
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const currentFilename = useWorkflowStore((s) => s.currentFilename);
  const loadWorkflowAction = useWorkflowStore((s) => s.loadWorkflow);
  const updateNodeWidget = useWorkflowStore((s) => s.updateNodeWidget);
  const queueWorkflow = useWorkflowStore((s) => s.queueWorkflow);
  const reportedQueueResult = useRef(false);

  const reportEnqueueOnlyResult = useCallback((result: ShareQueueResult) => {
    if (reportedQueueResult.current) return;
    reportedQueueResult.current = true;
    try {
      getShareQueueBridge()?.postMessage(result);
    } finally {
      clearHandoffParams();
      setState({ ...initialState, phase: 'done' });
    }
  }, []);

  const failHandoff = useCallback((message: string, code: string, enqueueOnly: boolean) => {
    if (enqueueOnly) {
      reportEnqueueOnlyResult({ status: 'error', code, message });
      return;
    }
    setState((prev) => ({ ...prev, phase: 'error', errorText: message }));
  }, [reportEnqueueOnlyResult]);

  // Read URL params exactly once at mount. Visible hand-offs require the app's
  // UA marker. The headless share extension has its own stronger capability:
  // the named WKScriptMessageHandler that receives the final result.
  const readOnce = useRef(false);
  useEffect(() => {
    if (readOnce.current) return;
    readOnce.current = true;
    const queueBridge = getShareQueueBridge();
    if (!isInNativeApp() && !queueBridge) return;
    const params = new URLSearchParams(window.location.search);
    const workflowPath = params.get('loadWorkflow');
    const imageFilename = params.get('useImage');
    // loadWorkflow alone (no staged image) is the app's plain open-a-workflow
    // link: there is nothing to hand off, so it loads the workflow and gets out
    // of the way without any share-handoff chrome. Like every other branch here
    // it is behind the native gate above — this is not a general web deep link.
    if (workflowPath && !imageFilename) {
      (async () => {
        try {
          const data = await loadUserWorkflow(workflowPath);
          loadWorkflowAction(data, workflowPath, {
            fresh: true,
            source: { type: 'user', filename: workflowPath },
          });
        } catch (err) {
          // No banner to fail into on this path, and a stale bookmark is the
          // likely cause — so say so where the user is looking rather than
          // leaving the tap doing nothing at all.
          console.error('Failed to open workflow from link:', err);
          useWorkflowErrorsStore.getState().setError(t('Failed to load workflow'));
        }
        clearHandoffParams();
      })();
      return;
    }
    if (!workflowPath || !imageFilename) return;
    const enqueueOnly = params.get('enqueueOnly') === '1';
    const alreadyQueued = params.get('shareAlreadyQueued') === '1';
    const autoQueue = params.get('autoQueue') === '1' && !alreadyQueued;
    // A hidden page must be able to prove Swift is waiting for its result, and
    // enqueue-only without auto-queue is a contradictory request. Ignore an
    // untrusted URL rather than loading or mutating the user's workflow.
    if (enqueueOnly && (!autoQueue || !queueBridge)) {
      if (queueBridge) {
        reportEnqueueOnlyResult({
          status: 'error',
          code: 'invalid_handoff',
          message: t('Failed to queue workflow'),
        });
      }
      return;
    }
    setState({
      ...initialState,
      phase: 'loading',
      workflowPath,
      imageFilename,
      autoQueue,
      enqueueOnly,
      alreadyQueued,
    });
    (async () => {
      try {
        const data = await loadUserWorkflow(workflowPath);
        loadWorkflowAction(data, workflowPath, {
          fresh: true,
          source: { type: 'user', filename: workflowPath },
        });
        setState((prev) => ({ ...prev, phase: 'staging' }));
      } catch {
        // loadUserWorkflow throws untranslated English; the structured code
        // carries the cause for the native side, so show the localized copy.
        failHandoff(t('Failed to load workflow'), 'workflow_load_failed', enqueueOnly);
      }
    })();
  }, [failHandoff, loadWorkflowAction, reportEnqueueOnlyResult, t]);

  // Identify LoadImage nodes the same way the bulk-process flow does: walk
  // root and subgraph scopes, and skip disabled (mode 4) nodes so a bypassed
  // Load Image left over from an earlier session can never be the auto-stage
  // target for a hidden enqueue.
  const loadImageNodes = useMemo(() => {
    if (!workflow) return [];
    return collectScopedWorkflowNodes(workflow)
      .filter(({ node }) => isLoadImageType(node.type) && node.mode !== 4)
      .map(({ node, subgraphId }) => ({
        node,
        subgraphId,
        itemKey:
          node.itemKey
          ?? makeLocationPointer({ type: 'node', nodeId: node.id, subgraphId }),
      }));
  }, [workflow]);

  // Once the workflow's been loaded into the store and we're in the staging
  // phase, branch on the LoadImage count and either auto-fill or pop the
  // picker. Run-once-per-staging via the phase guard so we don't re-fire when
  // workflow re-renders later (e.g. a queue update mutating store state).
  useEffect(() => {
    if (state.phase !== 'staging') return;
    if (!workflow || !nodeTypes) return;
    // The workflow we wanted has to be the active one before we touch widgets.
    if (currentFilename !== state.workflowPath) return;

    if (loadImageNodes.length === 0) {
      failHandoff(
        t(
          "This workflow doesn't have a Load Image node, so the shared image can't be staged into it.",
        ),
        'load_image_node_missing',
        state.enqueueOnly,
      );
      return;
    }

    if (loadImageNodes.length === 1 || state.autoQueue) {
      // A hidden bulk enqueue cannot show a node picker. Select the first node
      // in workflow order that actually exposes a writable image widget. The
      // visible, stage-only flow keeps its picker whenever there is ambiguity.
      const candidate = loadImageNodes
        .map(({ node, subgraphId, itemKey }) => ({
          node,
          itemKey,
          widget: resolveInputWidget({ workflow, nodeTypes, nodeId: node.id, subgraphId }),
        }))
        .find(({ widget }) => widget !== null);
      if (!candidate?.widget) {
        failHandoff(
          t(
            "The Load Image node in this workflow doesn't expose an image input we can stage into.",
          ),
          'load_image_input_missing',
          state.enqueueOnly,
        );
        return;
      }
      const { node, widget, itemKey } = candidate;
      updateNodeWidget(itemKey, widget.index, state.imageFilename, widget.name);
      const stagedNodeLabel = nodeLabel(node);
      if (state.autoQueue) {
        setState((prev) => ({ ...prev, phase: 'queueing', stagedNodeLabel }));
        void queueWorkflow(1).then((queued) => {
          if (!queued) {
            failHandoff(
              t('Failed to queue workflow'),
              'queue_failed',
              state.enqueueOnly,
            );
            return;
          }
          if (state.enqueueOnly) {
            reportEnqueueOnlyResult({ status: 'success' });
            return;
          }
          clearHandoffParams();
          setState((prev) => ({ ...prev, phase: 'banner', alreadyQueued: true }));
        }).catch(() => {
          failHandoff(t('Failed to queue workflow'), 'queue_failed', state.enqueueOnly);
        });
        return;
      }
      setState((prev) => ({
        ...prev,
        phase: 'banner',
        stagedNodeLabel,
      }));
      return;
    }

    // Multiple LoadImage nodes — let the user pick which one to stage into.
    setState((prev) => ({ ...prev, phase: 'picker' }));
  }, [
    state.phase,
    state.workflowPath,
    state.imageFilename,
    state.autoQueue,
    state.enqueueOnly,
    workflow,
    nodeTypes,
    currentFilename,
    loadImageNodes,
    updateNodeWidget,
    queueWorkflow,
    failHandoff,
    reportEnqueueOnlyResult,
    t,
  ]);

  // Auto-dismiss errors after a few seconds; failure surface is non-blocking.
  useEffect(() => {
    if (state.phase !== 'error') return;
    const t = window.setTimeout(() => {
      clearHandoffParams();
      setState({ ...initialState, phase: 'done' });
    }, 4500);
    return () => window.clearTimeout(t);
  }, [state.phase]);

  if (state.phase === 'idle' || state.phase === 'done') return null;

  return (
    <>
      {state.phase === 'loading' && <LoadingChrome label={t('Loading workflow from share…')} />}
      {state.phase === 'queueing' && !state.enqueueOnly && (
        <LoadingChrome label={t('Queueing shared workflow…')} />
      )}

      {state.phase === 'banner' && (
        <Banner
          stagedNodeLabel={state.stagedNodeLabel ?? t('a Load Image node')}
          alreadyQueued={state.alreadyQueued}
          onDismiss={() => {
            clearHandoffParams();
            setState({ ...initialState, phase: 'done' });
          }}
        />
      )}

      {state.phase === 'picker' && workflow && nodeTypes && (
        <PickerModal
          nodes={loadImageNodes.map(({ node, itemKey }) => ({
            id: node.id,
            itemKey,
            label: nodeLabel(node),
          }))}
          onPick={(itemKey) => {
            const picked = loadImageNodes.find((entry) => entry.itemKey === itemKey);
            const widget = picked
              ? resolveInputWidget({
                  workflow,
                  nodeTypes,
                  nodeId: picked.node.id,
                  subgraphId: picked.subgraphId,
                })
              : null;
            if (!widget || !picked) {
              setState((prev) => ({
                ...prev,
                phase: 'error',
                errorText: t("Couldn't stage the image into that node."),
              }));
              return;
            }
            updateNodeWidget(picked.itemKey, widget.index, state.imageFilename, widget.name);
            setState((prev) => ({
              ...prev,
              phase: 'banner',
              stagedNodeLabel: nodeLabel(picked.node),
            }));
          }}
          onDismiss={() => {
            clearHandoffParams();
            setState({ ...initialState, phase: 'done' });
          }}
        />
      )}

      {state.phase === 'error' && <ErrorToast text={state.errorText} />}
    </>
  );
}

function nodeLabel(node: { id: number; type: string; title?: string }): string {
  // Prefer the user-set title if there is one; fall back to the node type so
  // the banner reads naturally even for un-renamed nodes.
  return node.title?.trim() || node.type;
}

// --- UI bits --------------------------------------------------------------

function LoadingChrome({ label }: { label: string }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[2200] px-4 pb-4 pointer-events-none">
      <div className="max-w-lg mx-auto rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-sm px-4 py-3 text-sm text-slate-200 shadow-lg flex items-center gap-3">
        <span className="inline-block w-3 h-3 rounded-full border-2 border-cyan-300 border-t-transparent animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}

interface BannerProps {
  stagedNodeLabel: string;
  alreadyQueued: boolean;
  onDismiss: () => void;
}

function Banner({ stagedNodeLabel, alreadyQueued, onDismiss }: BannerProps) {
  const { t } = useI18n();
  // Centered card. Outer layer is pointer-events-none so the workflow
  // underneath stays scrollable / pan-able and the banner doesn't feel
  // like a full-blocking modal; the card itself enables pointer events
  // so its dismiss button works.
  return (
    <div className="fixed inset-0 z-[2200] flex items-center justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md rounded-xl border border-cyan-300/40 bg-slate-900/98 backdrop-blur-sm px-5 py-4 text-sm text-slate-100 shadow-2xl">
        <div className="font-semibold text-slate-100 text-base">
          {alreadyQueued ? t('Generation queued from share') : t('Image staged from share')}
        </div>
        <div className="text-slate-300 mt-1">
          {t('Filled into {node}.', { node: stagedNodeLabel })}
        </div>
        <div className="flex items-center justify-end mt-4">
          <button
            type="button"
            onClick={onDismiss}
            className="text-sm text-slate-300 hover:text-slate-100 px-3 py-1.5 rounded-lg"
          >
            {t('Dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PickerNode {
  id: number;
  itemKey: string;
  label: string;
}

interface PickerModalProps {
  nodes: PickerNode[];
  onPick: (itemKey: string) => void;
  onDismiss: () => void;
}

function PickerModal({ nodes, onPick, onDismiss }: PickerModalProps) {
  const { t } = useI18n();
  return (
    <div
      className="fixed inset-0 z-[2150] bg-black/50 flex items-center justify-center p-4"
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-handoff-picker-title"
    >
      <div
        className="w-full max-w-sm bg-slate-900 border border-white/10 text-slate-100 rounded-xl shadow-lg overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          id="share-handoff-picker-title"
          className="px-4 py-3 text-sm font-semibold text-slate-100 border-b border-white/10"
        >
          {t('Stage shared image into…')}
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {nodes.map((n) => (
            <button
              key={`share-handoff-node-${n.id}`}
              className="w-full text-left px-4 py-3 text-sm hover:bg-white/10 flex items-center gap-2"
              onClick={() => onPick(n.itemKey)}
            >
              <span className="text-slate-400">#{n.id}</span>
              <span className="flex-1 text-slate-100 truncate">{n.label}</span>
            </button>
          ))}
        </div>
        <div className="px-4 py-2 text-right border-t border-white/10">
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-slate-400 hover:text-slate-100 px-2 py-1"
          >
            {t('Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorToast({ text }: { text: string }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[2200] px-4 pb-4 pointer-events-none">
      <div className="max-w-lg mx-auto rounded-xl border border-red-500/30 bg-red-950/95 backdrop-blur-sm px-4 py-3 text-sm text-red-100 shadow-lg">
        {text}
      </div>
    </div>
  );
}
