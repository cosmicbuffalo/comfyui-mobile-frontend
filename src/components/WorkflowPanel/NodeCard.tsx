import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryOutputImage, WorkflowInput, WorkflowNode } from '@/api/types';
import { useWorkflowStore, getWidgetDefinitions, getInputWidgetDefinitions, getWidgetIndexForInput, findSeedWidgetIndex, findSeedControlWidgetIndex, resolveSubgraphPlaceholderWidgetDefs, resolveSubgraphPlaceholderInputWidgetDefs, resolveSubgraphProxyWidgetDefs, resolveSubgraphProxyInputWidgetDefs, resolveSubgraphBoundaryWidgetDefs, resolveSubgraphBoundaryInputWidgetDefs, isPlaceholderPromotedConnection } from '@/hooks/useWorkflow';
import type { LinkedWidgetRoute, ProxyWidgetRoute } from '@/utils/widgetDefinitions';
import { isSubgraphPlaceholder } from '@/utils/canonicalWorkflowOps';
import { isLoraManagerNodeType } from '@/utils/loraManager';
import { useSeedStore } from '@/hooks/useSeed';
import { useBookmarksStore } from '@/hooks/useBookmarks';
import { usePinnedWidgetStore } from '@/hooks/usePinnedWidget';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { useOverallProgress } from '@/hooks/useOverallProgress';
import { useQueueStore } from '@/hooks/useQueue';
import { useNodeErrorPopover } from '@/hooks/useNodeErrorPopover';
import { useConnectionSectionFoldsStore } from '@/hooks/useConnectionSectionFolds';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { useWorkflowClipboardStore } from '@/hooks/useWorkflowClipboard';
import { buildNodeClipboardPayload } from '@/utils/workflowClipboard';
import {
  getImageUrl,
  getImagePreviewUrl,
  getMediaThumbnailUrl,
  getPlayableVideoUrl,
} from '@/api/client';
import { getMediaType } from '@/utils/media';
import { NodeCardMenu } from './NodeCard/Menu';
import { SelectionCheckbox } from '@/components/buttons/SelectionCheckbox';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';
import { NodeCardErrorPopover } from './NodeCard/ErrorPopover';
import { NodeCardNote } from './NodeCard/Note';
import { NodeCardOutputPreview } from './NodeCard/OutputPreview';
import { NodeCardImageComparer } from './NodeCard/ImageComparer';
import { DenoVideoCompare } from './NodeCard/DenoVideoCompare';
import { isGetNode, isSetGetNode, isSetNode } from '@/utils/setGetNodes';
import { isUninstalledNodeType } from '@/utils/missingNodes';
import { useCustomNodesManager } from '@/hooks/useCustomNodesManager';
import { useSetGetNameEditStore } from '@/hooks/useSetGetNameEdit';
import { NodeCardHeader } from './NodeCard/Header';
import { DeleteNodeModal } from '@/components/modals/DeleteNodeModal';
import { ErrorHighlightBadge } from './NodeCard/ErrorHighlightBadge';
import { NodeCardConnectionsSection } from './NodeCard/ConnectionsSection';
import { NodeCardParameters } from './NodeCard/Parameters';
import { resolveLoadImagePreview } from '@/utils/loadImagePreview';
import {
  getRevealFrontendPreviewUpdate,
  getNodeFrontendPreviewPolicy,
  getOasisWidgetState,
  resolveNodeFrontendMediaPreview,
} from '@/utils/nodeFrontendPreviews';
import { requireHierarchicalKey } from '@/utils/itemKeys';
import { hexToRgba } from '@/utils/grouping';
import { resolveWorkflowColor, themeColors } from '@/theme/colors';

const EMPTY_IMAGES: HistoryOutputImage[] = [];
type ImageLike = (typeof EMPTY_IMAGES)[number];
const EMPTY_DURATION_STATS: Record<string, { avgMs: number; count: number }> = {};

interface NodeCardProps {
  node: WorkflowNode;
  isExecuting?: boolean;
  isConnectionHighlighted?: boolean;
  errorBadgeLabel?: string | null;
  onImageClick?: (images: Array<{ src: string; alt?: string }>, index: number, enableFollowQueue?: boolean) => void;
  inGroup?: boolean;
  onMoveNode?: () => void;
  onEnterSubgraph?: () => void;
}

export const NodeCard = memo(function NodeCard({
  node,
  isExecuting,
  isConnectionHighlighted = false,
  errorBadgeLabel,
  onImageClick,
  inGroup = false,
  onMoveNode,
  onEnterSubgraph,
}: NodeCardProps) {
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const workflow = useWorkflowStore((s) => s.workflow);
  const updateNodeWidget = useWorkflowStore((s) => s.updateNodeWidget);
  const updateNodeWidgets = useWorkflowStore((s) => s.updateNodeWidgets);
  const updateSubgraphInnerNodeWidget = useWorkflowStore((s) => s.updateSubgraphInnerNodeWidget);
  const updateNodeTitle = useWorkflowStore((s) => s.updateNodeTitle);
  const updateWorkflowItemColor = useWorkflowStore((s) => s.updateWorkflowItemColor);
  const toggleBypass = useWorkflowStore((s) => s.toggleBypass);
  const convertImageOutputNode = useWorkflowStore((s) => s.convertImageOutputNode);
  const setItemCollapsed = useWorkflowStore((s) => s.setItemCollapsed);
  const setItemHidden = useWorkflowStore((s) => s.setItemHidden);
  const collapsedItems = useWorkflowStore((s) => s.collapsedItems);
  const nodeHierarchicalKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
  // Select mode: replace the kebab menu with a selection checkbox for this node.
  const selectionMode = useWorkflowSelectionStore((s) => s.selectionMode);
  const isNodeSelected = useWorkflowSelectionStore((s) =>
    s.selectedKeys.includes(nodeHierarchicalKey),
  );
  const toggleSelectionKey = useWorkflowSelectionStore((s) => s.toggleKey);
  const setConnectionHighlightMode = useWorkflowStore((s) => s.setConnectionHighlightMode);
  const connectionHighlightMode = useWorkflowStore((s) => s.connectionHighlightModes[nodeHierarchicalKey] ?? 'off');
  const setSeedMode = useSeedStore((s) => s.setSeedMode);
  const currentWorkflowKey = useWorkflowStore((s) => s.currentWorkflowKey);
  // Only subscribe to whether THIS node has a pinned widget (reduces re-renders)
  const pinnedWidgetForThisNode = usePinnedWidgetStore((s) =>
    s.pinnedWidget?.nodeId === node.id ? s.pinnedWidget : null
  );
  const setPinnedWidget = usePinnedWidgetStore((s) => s.setPinnedWidget);
  const bookmarkedItems = useBookmarksStore((s) => s.bookmarkedItems);
  const toggleBookmark = useBookmarksStore((s) => s.toggleBookmark);
  const nodeImages = useWorkflowStore((s) => s.nodeOutputs[String(node.id)]);
  const comparerOutput = useWorkflowStore((s) => s.nodeComparerOutputs[String(node.id)]);
  const latentPreviewUrl = useWorkflowStore((s) =>
    s.latentPreviews[nodeHierarchicalKey] ?? null
  );
  const nodeTextOutput = useWorkflowStore((s) => s.nodeTextOutputs[String(node.id)] ?? null);
  const nodeErrors = useWorkflowErrorsStore((s) => s.nodeErrors[String(node.id)]);
  // Execution-state subscriptions are gated on THIS card executing. Ungated,
  // every sampler step re-rendered all N cards (scalar `progress`), the 2s
  // queue poll re-rendered them again (fresh `running` array identity), and
  // every card ran its own 200ms overall-progress ticker.
  const progress = useWorkflowStore((s) => (isExecuting ? s.progress : 0));
  const executingPromptId = useWorkflowStore((s) =>
    isExecuting ? s.executingPromptId : null,
  );
  const workflowDurationStats = useWorkflowStore((s) =>
    isExecuting ? s.workflowDurationStats : EMPTY_DURATION_STATS,
  );
  const storeIsExecuting = useWorkflowStore((s) => (isExecuting ? s.isExecuting : false));
  const firstRunningPromptId = useQueueStore((s) =>
    isExecuting ? (s.running[0]?.prompt_id ?? null) : null,
  );
  const hasRunning = useQueueStore((s) => (isExecuting ? s.running.length > 0 : false));
  const runKey = executingPromptId || firstRunningPromptId;
  // With workflow null the hook is inert (no interval) — only the executing
  // card runs a ticker instead of one per card.
  const overallProgress = useOverallProgress({
    workflow: isExecuting ? workflow : null,
    runKey,
    isRunning: storeIsExecuting || hasRunning,
    workflowDurationStats,
  });
  const displayNodeProgress = overallProgress === 100 ? 100 : progress;
  const handleSetPinnedWidget = useCallback(
    (pin: {
      nodeId: number;
      widgetIndex: number;
      widgetName: string;
      inputName?: string;
      widgetType: string;
      options?: Record<string, unknown> | unknown[];
    } | null) => {
      setPinnedWidget(pin, currentWorkflowKey);
    },
    [currentWorkflowKey, setPinnedWidget]
  );
  const resolvedImages = nodeImages ?? EMPTY_IMAGES;
  const [previewMedia, setPreviewMedia] = useState<ImageLike | null>(null);
  const { errorPopoverOpen, setErrorPopoverOpen, resetErrorPopover } = useNodeErrorPopover();
  const openCustomNodesManager = useCustomNodesManager((s) => s.open);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState('');
  const labelInputRef = useRef<HTMLInputElement>(null);
  const lastNoteTapRef = useRef<number>(0);
  const errorIconRef = useRef<HTMLButtonElement>(null);
  const [highlightLabel, setHighlightLabel] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showFastGroupConfig, setShowFastGroupConfig] = useState(false);
  const deleteNode = useWorkflowStore((s) => s.deleteNode);
  const duplicateNode = useWorkflowStore((s) => s.duplicateNode);
  const pasteClipboard = useWorkflowStore((s) => s.pasteClipboard);
  const setClipboardPayload = useWorkflowClipboardStore((s) => s.setPayload);
  const clipboardSummary = useWorkflowClipboardStore((s) => s.payload?.summary ?? null);

  useEffect(() => {
    // A return value from an event handler is discarded, so the hide timer
    // must be tracked here: clear it on re-fire and on unmount.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleShowLabel = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.nodeId === node.id) {
        setHighlightLabel(detail.label);
        if (timer != null) clearTimeout(timer);
        timer = setTimeout(() => setHighlightLabel(null), 1000);
      }
    };
    window.addEventListener('node-show-label', handleShowLabel as EventListener);
    return () => {
      window.removeEventListener('node-show-label', handleShowLabel as EventListener);
      if (timer != null) clearTimeout(timer);
    };
  }, [node.id]);

  // Check if this node has errors
  const hasErrors = nodeErrors && nodeErrors.length > 0;

  // Get set of widget/input names that have errors
  const errorInputNames = useMemo(() => {
    if (!nodeErrors) return new Set<string>();
    return new Set(nodeErrors.map(e => e.inputName).filter((n): n is string => !!n));
  }, [nodeErrors]);
  const latestImage = resolvedImages.length > 0
    ? resolvedImages[resolvedImages.length - 1]
    : null;
  const latestKey = latestImage
    ? `${latestImage.filename}|${latestImage.subfolder}|${latestImage.type}|${latestImage.cacheToken ?? ''}`
    : null;
  const latestOutputIsVideo = Boolean(
    latestImage && getMediaType(latestImage.filename) === 'video',
  );
  const previewKey = previewMedia
    ? `${previewMedia.filename}|${previewMedia.subfolder}|${previewMedia.type}|${previewMedia.cacheToken ?? ''}`
    : null;

  useEffect(() => {
    if (!latestImage) return;
    if (latestKey === previewKey) return;
    // Videos load through their own seekable playback + poster endpoints. Do
    // not gate them behind `new Image()`: that path can decode only a still (or
    // fail entirely) and was the reason video-output nodes never became an
    // inline player on iOS.
    if (latestOutputIsVideo) return;
    // Preload the same WebP preview the inline OutputPreview displays, so the
    // gate reflects (and primes the cache for) the fast image, not the full PNG.
    const nextSrc = getImagePreviewUrl(latestImage.filename, latestImage.subfolder, latestImage.type);
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (!cancelled) setPreviewMedia(latestImage);
    };
    img.src = nextSrc;
    return () => {
      cancelled = true;
    };
  }, [latestKey, previewKey, latestImage, latestOutputIsVideo]);

  const typeDef = nodeTypes?.[node.type];
  const isPlaceholder = useMemo(
    () => workflow != null && isSubgraphPlaceholder(node, workflow),
    [node, workflow],
  );
  const nodeTitle = useMemo(() => {
    return node.title?.trim() || null;
  }, [node]);
  const placeholderSubgraphName = useMemo(() => {
    if (!isPlaceholder || !workflow) return null;
    const sg = workflow.definitions?.subgraphs?.find((s) => s.id === node.type);
    return sg?.name ?? null;
  }, [isPlaceholder, workflow, node.type]);
  const displayName: string = nodeTitle || placeholderSubgraphName || typeDef?.display_name || node.type;
  // A node whose custom-node type isn't installed on the server — outline it in
  // red and badge it, mirroring desktop; the MissingNodesDialog lists them all.
  const isMissingNode = useMemo(
    () => !isPlaceholder && isUninstalledNodeType(node, nodeTypes),
    [isPlaceholder, node, nodeTypes],
  );
  const isKSampler = node.type === 'KSampler';
  const isLoraManagerNode = isLoraManagerNodeType(node.type);
  const isFastGroupsBypasser = /fast\s+groups/i.test(node.type) && /\(rgthree\)/i.test(node.type);
  const isImageComparer = /image\s*comparer/i.test(node.type);
  const isDenoVideoCompare = node.type === 'DenoVideoCompare';
  // SetNode/GetNode (KJNodes wireless relays) render a compact relay control in
  // place of their parameters; their real slots still use the connections section.
  const isSetGet = isSetGetNode(node);
  const isBypassed = node.mode === 4;
  const isCollapsed = Boolean(collapsedItems[nodeHierarchicalKey]);
  const expandConnectionsSection = useConnectionSectionFoldsStore((s) => s.expand);
  // Bumped when the card is unfolded, to reset any nested in-Parameters folds
  // (e.g. CR-LoRA groups) back to open so unfolding reveals everything.
  const [unfoldNonce, setUnfoldNonce] = useState(0);
  const startEditSetGetName = useSetGetNameEditStore((s) => s.startEdit);
  const expandParametersSection = useParameterSectionFoldsStore((s) => s.expand);
  const isLoadImageNode = /LoadImage/i.test(node.type);
  const inputImagePreview = useMemo(() => {
    if (!isLoadImageNode || !workflow || !nodeTypes) return null;
    return resolveLoadImagePreview(workflow, nodeTypes, node);
  }, [isLoadImageNode, node, nodeTypes, workflow]);
  const frontendMediaPreview = useMemo(
    () => workflow
      ? resolveNodeFrontendMediaPreview(workflow, nodeTypes, node)
      : null,
    [workflow, nodeTypes, node],
  );
  const isOasisMediaPreview = frontendMediaPreview?.source === 'oasis-widget';
  // Oasis owns a serialized scene-bar playlist. Its volatile node output only
  // marks a fresh arrival for autoplay; it must not replace that playlist with
  // the generic batch grid after the second result.
  const effectivePreviewImage = isOasisMediaPreview
    ? null
    : inputImagePreview ?? (latestOutputIsVideo ? latestImage : previewMedia);
  const frontendPreviewPolicy = useMemo(
    () => workflow
      ? getNodeFrontendPreviewPolicy(workflow, nodeTypes, node)
      : null,
    [workflow, nodeTypes, node],
  );
  const previewSuppressed = frontendPreviewPolicy?.hidden === true;
  const revealFrontendPreviewUpdate = useMemo(
    () => workflow
      ? getRevealFrontendPreviewUpdate(workflow, nodeTypes, node)
      : null,
    [workflow, nodeTypes, node],
  );
  const effectiveFrontendMediaPreview = useMemo(() => {
    if (effectivePreviewImage || previewSuppressed || !frontendMediaPreview) return null;
    return isOasisMediaPreview && resolvedImages.length > 0
      ? { ...frontendMediaPreview, autoPlay: true }
      : frontendMediaPreview;
  }, [
    effectivePreviewImage,
    frontendMediaPreview,
    isOasisMediaPreview,
    previewSuppressed,
    resolvedImages.length,
  ]);

  const handleFrontendPreviewStateChange = useCallback((change: {
    activeIndex?: number;
    playMode?: 'off' | 'loop' | 'cycle';
  }) => {
    if (!workflow) return;
    const oasis = getOasisWidgetState(workflow, nodeTypes, node);
    if (!oasis) return;
    const currentPreview = oasis.state.preview && typeof oasis.state.preview === 'object'
      && !Array.isArray(oasis.state.preview)
      ? oasis.state.preview as Record<string, unknown>
      : {};
    const currentUiState = oasis.state.uiState && typeof oasis.state.uiState === 'object'
      && !Array.isArray(oasis.state.uiState)
      ? oasis.state.uiState as Record<string, unknown>
      : {};
    const next = {
      ...oasis.state,
      ...(change.activeIndex === undefined
        ? {}
        : { preview: { ...currentPreview, activeIdx: change.activeIndex } }),
      ...(change.playMode === undefined
        ? {}
        : { uiState: { ...currentUiState, playMode: change.playMode } }),
    };
    const widgetIndex = getWidgetIndexForInput(
      workflow,
      nodeTypes,
      node,
      oasis.widgetName,
    );
    updateNodeWidget(
      nodeHierarchicalKey,
      widgetIndex ?? -1,
      JSON.stringify(next),
      oasis.widgetName,
    );
  }, [node, nodeHierarchicalKey, nodeTypes, updateNodeWidget, workflow]);

  // Unfiltered widget defs — used for proxy route extraction before seed filtering.
  const allResolvedWidgets = useMemo(() => {
    if (isPlaceholder && workflow) {
      const slotPromoted = resolveSubgraphPlaceholderWidgetDefs(node, workflow, nodeTypes);
      const proxyPromoted = resolveSubgraphProxyWidgetDefs(node, workflow, nodeTypes);
      const boundaryPromoted = resolveSubgraphBoundaryWidgetDefs(node, workflow, nodeTypes);
      return [...slotPromoted, ...proxyPromoted, ...boundaryPromoted];
    }
    return getWidgetDefinitions(nodeTypes, node);
  }, [nodeTypes, node, isPlaceholder, workflow]);

  const widgets = useMemo(() => {
    return allResolvedWidgets.filter((widget) => {
      const baseName = widget.name.split(': ').pop() ?? widget.name;
      // These are serialized transport blobs owned by custom desktop DOM
      // widgets. Showing raw JSON as an editable text field is both confusing
      // and can break their websocket result routing.
      if (baseName === 'video_oasis_ui' || baseName === 'ltx23_oasis_ui') return false;
      // Filter seed widgets — for proxy widgets the display name may be
      // "InnerTitle: seed".
      return !isKSampler || baseName !== 'seed';
    });
  }, [allResolvedWidgets, isKSampler]);

  // Get input widgets (COMBO dropdowns). For placeholder nodes, derive from both mechanisms.
  const inputWidgets = useMemo(() => {
    if (isPlaceholder && workflow) {
      const slotPromoted = resolveSubgraphPlaceholderInputWidgetDefs(node, workflow, nodeTypes);
      const proxyPromoted = resolveSubgraphProxyInputWidgetDefs(node, workflow, nodeTypes);
      const boundaryPromoted = resolveSubgraphBoundaryInputWidgetDefs(node, workflow, nodeTypes);
      return [...slotPromoted, ...proxyPromoted, ...boundaryPromoted];
    }
    return getInputWidgetDefinitions(nodeTypes, node);
  }, [nodeTypes, node, isPlaceholder, workflow]);
  // A widget overridden by a connection (popped out / wired up) is hidden from
  // the parameters section — its value isn't used while the input is connected.
  const visibleInputWidgets = useMemo(
    () => inputWidgets.filter((inputWidget) => (
      !inputWidget.connected &&
      !['video_oasis_ui', 'ltx23_oasis_ui'].includes(
        inputWidget.name.split(': ').pop() ?? inputWidget.name,
      )
    )),
    [inputWidgets]
  );
  const visibleWidgets = useMemo(
    () => widgets.filter((widget) => !widget.connected),
    [widgets]
  );
  const noteText = useMemo<string | null>(() => {
    const props = node.properties as Record<string, unknown> | undefined;
    // Note *body* keys only. 'title'/'label' are naming fields, not note content —
    // including them made an edited node label leak into the bottom note display.
    const candidateKeys = ['text', 'note', 'description'];
    if (props) {
      for (const key of candidateKeys) {
        const value = props[key];
        if (typeof value === 'string' && value.trim()) {
          return value;
        }
      }
    }

    const isNoteLike = /note|comment|sticky|label/i.test(node.type);
    if (isNoteLike && Array.isArray(node.widgets_values)) {
      const widgetText = node.widgets_values.find(
        (value) => typeof value === 'string' && value.trim()
      );
      if (typeof widgetText === 'string' && widgetText.trim()) {
        return widgetText;
      }
    }

    return null;
  }, [node.properties, node.widgets_values, node.type]);
  const noteWidgetIndex = useMemo<number | null>(() => {
    const isNoteLike = /note|comment|sticky|label/i.test(node.type);
    if (!isNoteLike || !Array.isArray(node.widgets_values)) return null;
    const index = node.widgets_values.findIndex(
      (value) => typeof value === 'string' && value.trim()
    );
    return index >= 0 ? index : null;
  }, [node.type, node.widgets_values]);

  const handleGetWidgetIndexForInput = (name: string) => {
    if (!workflow || !nodeTypes) return null;
    return getWidgetIndexForInput(workflow, nodeTypes, node, name);
  };

  const handleFindSeedWidgetIndex = () => {
    if (!workflow || !nodeTypes) return null;
    return findSeedWidgetIndex(workflow, nodeTypes, node, {
      widgetDescriptors: [...inputWidgets, ...widgets],
    });
  };

  const handleFindSeedControlWidgetIndex = () => {
    if (!workflow || !nodeTypes) return null;
    return findSeedControlWidgetIndex([...inputWidgets, ...widgets]);
  };

  const handleUpdateNote = (value: string) => {
    if (noteWidgetIndex === null) return;
    updateNodeWidget(nodeHierarchicalKey, noteWidgetIndex, value);
  };

  const noteLinkified = useMemo(() => {
    if (!noteText) return null;
    const parts: React.ReactNode[] = [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let keyIndex = 0;

    while ((match = urlRegex.exec(noteText)) !== null) {
      const [url] = match;
      const start = match.index;
      if (start > lastIndex) {
        parts.push(noteText.slice(lastIndex, start));
      }
      parts.push(
        <a
          key={`note-link-${keyIndex++}`}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-cyan-300 underline break-all"
        >
          {url}
        </a>
      );
      lastIndex = start + url.length;
    }

    if (lastIndex < noteText.length) {
      parts.push(noteText.slice(lastIndex));
    }

    return parts;
  }, [noteText]);

  const handleNoteTap = () => {
    const now = Date.now();
    if (now - lastNoteTapRef.current < 300) {
      setIsEditingNote(true);
    }
    lastNoteTapRef.current = now;
  };

  // Collect all pinnable widgets for the pin submenu
  const pinnableWidgets = useMemo(() => {
    const items: Array<{ widgetIndex: number; name: string; inputName?: string; type: string; options?: Record<string, unknown> | unknown[] }> = [];
    const isPinEligible = (widgetType: string, widgetName: string) => {
      if (widgetType.startsWith('LM_LORA')) return false;
      if (widgetType.startsWith('TW_')) return false;
      if (isLoraManagerNode && widgetName === 'text') return false;
      return true;
    };
    visibleInputWidgets.forEach((w) => {
      if (!isPinEligible(w.type, w.name)) return;
      items.push({ widgetIndex: w.widgetIndex, name: w.name, inputName: w.inputName, type: w.type, options: w.options });
    });
    visibleWidgets.forEach((w) => {
      if (!isPinEligible(w.type, w.name)) return;
      items.push({ widgetIndex: w.widgetIndex, name: w.name, inputName: w.inputName, type: w.type, options: w.options });
    });
    return items;
  }, [visibleInputWidgets, visibleWidgets, isLoraManagerNode]);

  // Filter inputs to only show those that are actual connections (connected or connectable without widget values)
  const isWidgetInput = useCallback((input: WorkflowInput) => {
    // Promoted widgets on placeholder nodes normally render as widget controls
    // even though they carry a link to the subgraph boundary — EXCEPT when the
    // input is wired to an upstream node with no resolvable value. That is a live
    // data connection (e.g. a promoted frame_rate fed by another node), which
    // must render as a connection button rather than an empty widget control.
    if (isPlaceholder && input.widget != null) {
      if (isPlaceholderPromotedConnection(input)) return false;
      return true;
    }
    if (input.link != null) return false;
    if (input.widget) return true;
    return [...allResolvedWidgets, ...inputWidgets].some(
      (widget) => (widget.inputName ?? widget.name) === input.name,
    );
  }, [allResolvedWidgets, inputWidgets, isPlaceholder]);

  const connectionInputs = useMemo(() => {
    const real = node.inputs.filter((input) => {
      if (isWidgetInput(input)) return false;
      const isOptConnection = String(input.type).toUpperCase() === 'OPT_CONNECTION';
      if (isOptConnection && input.link == null) return false;
      return true;
    });
    // A GetNode reads its value wirelessly (by name) and has no real input slot —
    // synthesize one so it renders an input connection button that jumps to the
    // matching SetNode. Its type mirrors the Get's output so the button is typed.
    if (isGetNode(node)) {
      const valueType = node.outputs?.[0]?.type ?? '*';
      const synthetic: WorkflowInput = { name: 'get', type: String(valueType), link: null };
      return [synthetic, ...real];
    }
    return real;
  }, [node, isWidgetInput]);


  // Filter outputs to exclude helper outputs like "show_help"
  const visibleOutputs = useMemo(() =>
    node.outputs.filter(output => {
      const name = (output.name || '').toLowerCase().replace(/[_\s]/g, '');
      if (name === 'showhelp') return false;
      const isOptConnection = String(output.type).toUpperCase() === 'OPT_CONNECTION';
      if (isOptConnection && !(output.links?.length)) return false;
      return true;
    }),
    [node.outputs]
  );

  // Helper to check if a widget is pinned
  const isWidgetPinned = (widgetIndex: number) => {
    return pinnedWidgetForThisNode?.widgetIndex === widgetIndex;
  };

  // Helper to toggle pin for a widget
  const toggleWidgetPin = (widgetIndex: number, widgetName: string, widgetType: string, options?: Record<string, unknown> | unknown[], inputName?: string) => {
    if (isWidgetPinned(widgetIndex)) {
      handleSetPinnedWidget(null);
    } else {
      handleSetPinnedWidget({
        nodeId: node.id,
        widgetIndex,
        widgetName,
        inputName,
        widgetType,
        options
      });
    }
  };

  const singlePinnableWidget = pinnableWidgets.length === 1 ? pinnableWidgets[0] : null;
  const isSingleWidgetPinned = singlePinnableWidget
    ? isWidgetPinned(singlePinnableWidget.widgetIndex)
    : false;
  const hasPinnedWidget = Boolean(pinnedWidgetForThisNode);
  const isNodeBookmarked = bookmarkedItems.includes(nodeHierarchicalKey);
  const totalBookmarkCount = bookmarkedItems.length;
  const canAddNodeBookmark = totalBookmarkCount < 5 || isNodeBookmarked;

  const showComparer = Boolean(
    comparerOutput && (
      isDenoVideoCompare && comparerOutput.video ||
      isImageComparer && (comparerOutput.a.length > 0 || comparerOutput.b.length > 0)
    ),
  );
  // Executed media descriptors are stronger evidence than a node's declared
  // slots. Custom video nodes frequently expose no IMAGE output (and some rely
  // entirely on a frontend extension), while still publishing a standard
  // images/gifs/videos payload that the websocket layer has already captured.
  const showImagePreview = !showComparer && !previewSuppressed && Boolean(
    effectivePreviewImage || effectiveFrontendMediaPreview,
  );
  const showTextPreview = typeof nodeTextOutput === 'string' && nodeTextOutput.length > 0;
  const inputConnectionCount = node.inputs?.filter((input) => input.link != null).length ?? 0;
  const outputConnectionCount = node.outputs?.reduce((count, output) => count + (output.links?.length ?? 0), 0) ?? 0;
  const hasNodeConnections = inputConnectionCount > 0 || outputConnectionCount > 0;
  const leftLineCount = Math.min(3, inputConnectionCount);
  const rightLineCount = Math.min(3, outputConnectionCount);
  // A node that produced more than one output is a batch: tile the whole batch
  // instead of just the latest image. The LoadImage input preview stays single.
  const isBatchOutput =
    !previewSuppressed && !inputImagePreview && !isOasisMediaPreview && resolvedImages.length > 1;

  // The viewer/click target list — the full batch when tiling, else the single
  // gated preview image.
  const previewList = useMemo(() => {
    const list: ImageLike[] = isBatchOutput
      ? resolvedImages
      : effectivePreviewImage
        ? [effectivePreviewImage]
        : [];
    return list.map((img) => {
      const { filename, subfolder, type } = img;
      const src = getImageUrl(filename, subfolder, type, img.cacheToken);
      const filePath = subfolder ? `${subfolder}/${filename}` : filename;
      const mediaType = getMediaType(filename);
      return {
        src,
        displaySrc: mediaType === 'image'
          ? getImagePreviewUrl(filename, subfolder, type)
          : undefined,
        alt: displayName,
        filename,
        mediaType,
        file: {
          id: `${type}/${filePath}`,
          name: filename,
          type: mediaType === 'video' ? 'video' : 'image',
          fullUrl: src,
        },
      };
    });
  }, [isBatchOutput, resolvedImages, effectivePreviewImage, displayName]);

  // Two-column thumbnails for the batch grid; null in the single-image case.
  const batchTiles = useMemo(() => {
    if (!isBatchOutput) return null;
    return resolvedImages.map((img) => {
      const mediaType = getMediaType(img.filename);
      if (mediaType === 'video') {
        const src = getImageUrl(img.filename, img.subfolder, img.type, img.cacheToken);
        return {
          displaySrc: getPlayableVideoUrl(src),
          poster: getMediaThumbnailUrl(
            img.filename,
            img.subfolder,
            img.type,
            img.cacheToken,
          ),
          mediaType,
          alt: displayName,
        };
      }
      return {
        displaySrc: getImagePreviewUrl(img.filename, img.subfolder, img.type),
        mediaType,
        alt: displayName,
      };
    });
  }, [isBatchOutput, resolvedImages, displayName]);

  useEffect(() => {
    if (!isEditingLabel) return;
    const input = labelInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isEditingLabel]);

  const handleEditLabel = () => {
    setLabelValue(displayName);
    setIsEditingLabel(true);
  };

  const handleLabelBlur = () => {
    const nextValue = labelValue.trim();
    updateNodeTitle(nodeHierarchicalKey, nextValue.length > 0 ? nextValue : null);
    setIsEditingLabel(false);
  };

  // Map from widgetIndex → proxy routing info for proxy widget updates.
  const proxyRoutes = useMemo(() => {
    if (!isPlaceholder) return new Map<number, ProxyWidgetRoute>();
    const map = new Map<number, ProxyWidgetRoute>();
    const extract = (defs: Array<{ widgetIndex: number; options?: Record<string, unknown> | unknown[] }>) => {
      for (const def of defs) {
        const proxy = (def.options as Record<string, unknown>)?.__proxy;
        if (proxy && typeof proxy === 'object') {
          map.set(def.widgetIndex, proxy as ProxyWidgetRoute);
        }
      }
    };
    extract(allResolvedWidgets);
    extract(inputWidgets);
    return map;
  }, [isPlaceholder, allResolvedWidgets, inputWidgets]);

  const linkedSourceRoutes = useMemo(() => {
    if (!isPlaceholder) return new Map<number, LinkedWidgetRoute>();
    const map = new Map<number, LinkedWidgetRoute>();
    const extract = (defs: Array<{ widgetIndex: number; options?: Record<string, unknown> | unknown[] }>) => {
      for (const def of defs) {
        if (!def.options || Array.isArray(def.options)) continue;
        const linkedSource = def.options.__linkedSource;
        if (linkedSource && typeof linkedSource === 'object') {
          map.set(def.widgetIndex, linkedSource as LinkedWidgetRoute);
        }
      }
    };
    extract(allResolvedWidgets);
    extract(inputWidgets);
    return map;
  }, [isPlaceholder, allResolvedWidgets, inputWidgets]);

  const findLinkedSourceNode = useCallback(
    (route: LinkedWidgetRoute): WorkflowNode | null => {
      if (!workflow) return null;
      const nodes = route.subgraphId == null
        ? workflow.nodes
        : workflow.definitions?.subgraphs?.find((sg) => sg.id === route.subgraphId)?.nodes;
      return nodes?.find((candidate) =>
        candidate.id === route.nodeId ||
        Boolean(route.itemKey && candidate.itemKey === route.itemKey)
      ) ?? null;
    },
    [workflow]
  );

  const readLinkedSourceValue = useCallback(
    (route: LinkedWidgetRoute): unknown => {
      const sourceNode = findLinkedSourceNode(route);
      if (!sourceNode) return undefined;
      const values = sourceNode.widgets_values;
      if (Array.isArray(values)) {
        if (route.widgetIndex >= 0 && route.widgetIndex < values.length) {
          return values[route.widgetIndex];
        }
        return route.widgetIndex !== 0 ? values[0] : undefined;
      }
      if (values && typeof values === 'object') {
        const record = values as Record<string, unknown>;
        if (route.widgetName && record[route.widgetName] !== undefined) {
          return record[route.widgetName];
        }
        return record[String(route.widgetIndex)];
      }
      return undefined;
    },
    [findLinkedSourceNode]
  );

  const updateLinkedSourceWidget = useCallback(
    (route: LinkedWidgetRoute, value: unknown): boolean => {
      if (route.subgraphId != null) {
        updateSubgraphInnerNodeWidget(
          route.subgraphId,
          route.nodeId,
          route.widgetIndex,
          value,
          route.widgetName,
        );
        return true;
      }
      const sourceNode = findLinkedSourceNode(route);
      const sourceItemKey = route.itemKey ?? sourceNode?.itemKey;
      if (!sourceItemKey) return false;
      updateNodeWidget(
        sourceItemKey,
        route.widgetIndex,
        value,
        route.widgetName,
      );
      return true;
    },
    [findLinkedSourceNode, updateNodeWidget, updateSubgraphInnerNodeWidget]
  );

  const handleUpdateNodeWidget = useCallback(
    (widgetIndex: number, value: unknown, widgetName?: string) => {
      const proxy = proxyRoutes.get(widgetIndex);
      if (proxy) {
        updateSubgraphInnerNodeWidget(
          proxy.subgraphId,
          proxy.innerNodeId,
          proxy.innerWidgetIndex,
          value,
          proxy.innerWidgetName ?? widgetName,
        );
      } else {
        const linkedSource = linkedSourceRoutes.get(widgetIndex);
        if (linkedSource && updateLinkedSourceWidget(linkedSource, value)) {
          return;
        }
        updateNodeWidget(nodeHierarchicalKey, widgetIndex, value, widgetName);
      }
    },
    [
      linkedSourceRoutes,
      nodeHierarchicalKey,
      proxyRoutes,
      updateLinkedSourceWidget,
      updateNodeWidget,
      updateSubgraphInnerNodeWidget,
    ]
  );

  // Resolve a widget value, following promoted/proxy routes to source nodes when needed.
  const resolveWidgetValue = useCallback(
    (widgetIndex: number): unknown => {
      const proxy = proxyRoutes.get(widgetIndex);
      if (proxy && workflow) {
        const sg = workflow.definitions?.subgraphs?.find((s) => s.id === proxy.subgraphId);
        const innerNode = sg?.nodes?.find((n) => n.id === proxy.innerNodeId);
        if (innerNode) {
          const values = Array.isArray(innerNode.widgets_values) ? innerNode.widgets_values : [];
          return values[proxy.innerWidgetIndex];
        }
      }
      const linkedSource = linkedSourceRoutes.get(widgetIndex);
      if (linkedSource) {
        const linkedValue = readLinkedSourceValue(linkedSource);
        if (linkedValue !== undefined) return linkedValue;
      }
      const values = Array.isArray(node.widgets_values) ? node.widgets_values : [];
      return values[widgetIndex];
    },
    [linkedSourceRoutes, node.widgets_values, readLinkedSourceValue, workflow, proxyRoutes]
  );

  const handleUpdateNodeWidgets = useCallback(
    (updates: Record<number, unknown>) => {
      const directUpdates: Record<number, unknown> = {};
      for (const [idxStr, value] of Object.entries(updates)) {
        const widgetIndex = Number.parseInt(idxStr, 10);
        if (!Number.isFinite(widgetIndex)) continue;
        const proxy = proxyRoutes.get(widgetIndex);
        if (proxy) {
          updateSubgraphInnerNodeWidget(
            proxy.subgraphId,
            proxy.innerNodeId,
            proxy.innerWidgetIndex,
            value,
            proxy.innerWidgetName,
          );
        } else {
          const linkedSource = linkedSourceRoutes.get(widgetIndex);
          if (linkedSource && updateLinkedSourceWidget(linkedSource, value)) {
            continue;
          }
          directUpdates[widgetIndex] = value;
        }
      }
      if (Object.keys(directUpdates).length > 0) {
        updateNodeWidgets(nodeHierarchicalKey, directUpdates);
      }
    },
    [
      linkedSourceRoutes,
      nodeHierarchicalKey,
      proxyRoutes,
      updateLinkedSourceWidget,
      updateNodeWidgets,
      updateSubgraphInnerNodeWidget,
    ]
  );
  const handleSetSeedMode = useCallback(
    (nodeId: number, mode: 'fixed' | 'randomize' | 'increment' | 'decrement') => {
      if (!workflow || !nodeTypes) return;
      const seedWidgetIndex = findSeedWidgetIndex(workflow, nodeTypes, node, {
        widgetDescriptors: [...inputWidgets, ...widgets],
      });
      setSeedMode(nodeId, mode, {
        workflow,
        nodeTypes,
        seedWidgetIndex,
        updateNodeWidgets: (_rawNodeId, updates) => handleUpdateNodeWidgets(updates)
      });
    },
    [workflow, nodeTypes, node, inputWidgets, widgets, setSeedMode, handleUpdateNodeWidgets]
  );
  const showHighlightLabel = Boolean(highlightLabel && !/^error\b/i.test(highlightLabel));
  const rawNodeColor = (typeof node.bgcolor === 'string' && node.bgcolor.trim())
    ? node.bgcolor.trim()
    : (typeof node.color === 'string' ? node.color.trim() : '');
  const nodeColor = resolveWorkflowColor(rawNodeColor);
  const nodeTintColor = hexToRgba(nodeColor, 0.4);
  const nodeHeaderBorderColor = themeColors.border.nodeHeaderTint;
  const canUseNodeTint =
    !isBypassed &&
    !hasErrors &&
    !isMissingNode &&
    !isConnectionHighlighted &&
    !isExecuting &&
    rawNodeColor.length > 0;
  const nodeCardBorderClass = hasErrors || isMissingNode
    ? '!border !border-red-600'
    : isConnectionHighlighted
      ? 'border-cyan-400 shadow-cyan-900/20'
      : isExecuting
        ? 'border-emerald-500 shadow-emerald-900/20'
        : isPlaceholder
          ? 'border-cyan-400/50 shadow-cyan-900/20'
          : 'border-white/10';
  return (
    <div
      id={`node-card-wrapper-${node.id}`}
      className="relative node-card-outer"
    >
      <div id={`node-anchor-${node.id}`} className="absolute -top-3 left-0 right-0 h-0 node-scroll-anchor" />

      {showHighlightLabel && (
        <ErrorHighlightBadge label={highlightLabel ?? ''} />
      )}

      {errorBadgeLabel && (
        <div className="absolute top-2 right-2 z-[110] animate-in fade-in duration-150">
          <div className="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg whitespace-nowrap uppercase tracking-tighter ring-2 ring-white">
            {errorBadgeLabel}
          </div>
        </div>
      )}


      <div
        id={`node-card-${node.id}`}
        className={`
        node-card-inner
        ${inGroup ? `rounded-lg shadow-sm ${isCollapsed && isBypassed ? 'pt-1 pb-0' : 'py-1'}` : `rounded-xl shadow-md px-2 ${isCollapsed && isBypassed ? 'pt-1 pb-0' : 'py-1'} mb-3`}
        border
        ${nodeCardBorderClass}
        ${isBypassed ? 'bg-purple-950/35' : 'bg-slate-900/95'}
      `}
        style={{
          overflow: 'hidden',
          ...(canUseNodeTint
            ? {
                backgroundColor: nodeTintColor,
              }
            : {}),
        }}
      >
      <NodeCardHeader
        nodeId={node.id}
        displayName={displayName}
        isEditingLabel={isEditingLabel}
        labelValue={labelValue}
        labelInputRef={labelInputRef}
        onLabelChange={setLabelValue}
        onLabelBlur={handleLabelBlur}
        isCollapsed={isCollapsed}
        isBypassed={isBypassed}
        isExecuting={isExecuting}
        overallProgress={overallProgress}
        hasErrors={hasErrors}
        isMissing={isMissingNode}
        errorIconRef={errorIconRef}
        errorPopoverOpen={errorPopoverOpen}
        setErrorPopoverOpen={setErrorPopoverOpen}
        toggleNodeFold={() => {
          const willUnfold = isCollapsed;
          setItemCollapsed(nodeHierarchicalKey, !isCollapsed);
          if (!willUnfold) return;
          // Unfolding a node reveals everything: open all of its nested foldable
          // sections (expand* is idempotent, so already-open ones are untouched)
          // and reset nested in-Parameters folds (e.g. CR-LoRA groups) to open.
          expandParametersSection(nodeHierarchicalKey);
          expandConnectionsSection(nodeHierarchicalKey);
          setUnfoldNonce((n) => n + 1);
        }}
        expandedBorderColor={canUseNodeTint ? nodeHeaderBorderColor : undefined}
        rightSlot={selectionMode ? (
          <SelectionCheckbox
            selected={isNodeSelected}
            ariaLabel={isNodeSelected ? 'Deselect' : 'Select'}
            onClick={(event) => {
              event.stopPropagation();
              toggleSelectionKey(nodeHierarchicalKey);
            }}
          />
        ) : (
          <NodeCardMenu
            nodeId={node.id}
            nodeHierarchicalKey={nodeHierarchicalKey}
            nodeType={node.type}
            isLoraManagerNode={isLoraManagerNode}
            showFastGroupsConfigAction={isFastGroupsBypasser}
            isBypassed={isBypassed}
            onEnterSubgraph={onEnterSubgraph}
            onEditLabel={handleEditLabel}
            onEditSetName={
              isSetNode(node)
                ? () => {
                    expandConnectionsSection(nodeHierarchicalKey);
                    startEditSetGetName(nodeHierarchicalKey);
                  }
                : undefined
            }
            onEditFastGroupsConfig={() => setShowFastGroupConfig(true)}
            nodeColor={nodeColor}
            onChangeColor={(color) => updateWorkflowItemColor(nodeHierarchicalKey, color)}
            pinnableWidgets={pinnableWidgets}
            singlePinnableWidget={singlePinnableWidget}
            isSingleWidgetPinned={isSingleWidgetPinned}
            hasPinnedWidget={hasPinnedWidget}
            toggleWidgetPin={toggleWidgetPin}
            setPinnedWidget={handleSetPinnedWidget}
            isNodeBookmarked={isNodeBookmarked}
            canAddNodeBookmark={canAddNodeBookmark}
            onToggleNodeBookmark={() => toggleBookmark(nodeHierarchicalKey)}
            toggleBypass={toggleBypass}
            setItemHidden={setItemHidden}
            onDeleteNode={() => setShowDeleteModal(true)}
            onDuplicateNode={() => duplicateNode(nodeHierarchicalKey)}
            onCopyNode={() => {
              if (!workflow) return;
              const payload = buildNodeClipboardPayload(workflow, nodeHierarchicalKey);
              if (payload) setClipboardPayload(payload);
            }}
            onPasteBelow={() => pasteClipboard(nodeHierarchicalKey)}
            pasteSummary={clipboardSummary}
            onMoveNode={onMoveNode ?? (() => {})}
            onConvertImageOutputNode={(target) =>
              convertImageOutputNode(nodeHierarchicalKey, target)
            }
            connectionHighlightMode={connectionHighlightMode}
            setConnectionHighlightMode={setConnectionHighlightMode}
            leftLineCount={leftLineCount}
            rightLineCount={rightLineCount}
          />
        )}
      />

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div
          className={`collapse-container overflow-hidden transition-opacity px-1 duration-200 ease-out ${
            isCollapsed ? "opacity-0" : "opacity-100"
          }`}
        >
          <div id={`node-content-${node.id}`} className={`node-expanded-content ${isBypassed ? 'opacity-60 grayscale' : ''}`}>
            {isMissingNode ? (
              <div className="missing-node-body px-2 py-3 text-center">
                <div className="text-sm font-semibold text-red-300">Missing Node</div>
                <div className="mt-0.5 font-mono text-xs text-slate-400 [overflow-wrap:anywhere]">{node.type}</div>
                <div className="mt-1 text-xs text-slate-500">Not installed — tap the red icon to install.</div>
              </div>
            ) : (
            <>
            <NodeCardConnectionsSection
              nodeId={node.id}
              nodeHierarchicalKey={nodeHierarchicalKey}
              nodeType={node.type}
              inputs={connectionInputs}
              outputs={visibleOutputs}
              allInputs={node.inputs}
              allOutputs={node.outputs}
            />

            {!isSetGet && <NodeCardParameters
              node={node}
              isBypassed={isBypassed}
              isKSampler={isKSampler}
              workflowExists={Boolean(workflow)}
              nodeTypesExists={Boolean(nodeTypes)}
              visibleInputWidgets={visibleInputWidgets}
              visibleWidgets={visibleWidgets}
              errorInputNames={errorInputNames}
              onUpdateNodeWidget={handleUpdateNodeWidget}
              onUpdateNodeWidgets={handleUpdateNodeWidgets}
              getWidgetIndexForInput={handleGetWidgetIndexForInput}
              findSeedWidgetIndex={handleFindSeedWidgetIndex}
              findSeedControlWidgetIndex={handleFindSeedControlWidgetIndex}
              isPlaceholder={isPlaceholder}
              setSeedMode={handleSetSeedMode}
              isWidgetPinned={isWidgetPinned}
              toggleWidgetPin={toggleWidgetPin}
              resolveWidgetValue={resolveWidgetValue}
              showFastGroupConfig={showFastGroupConfig}
              setShowFastGroupConfig={setShowFastGroupConfig}
              unfoldNonce={unfoldNonce}
              hasOutputsBelow={
                Boolean(noteText) ||
                (showComparer && Boolean(comparerOutput)) ||
                showImagePreview ||
                showTextPreview ||
                !!latentPreviewUrl ||
                isBatchOutput ||
                Boolean(revealFrontendPreviewUpdate)
              }
            />}
            {noteText && (
              <NodeCardNote
                noteText={noteText}
                noteLinkified={noteLinkified}
                noteWidgetIndex={noteWidgetIndex}
                isEditingNote={isEditingNote}
                setIsEditingNote={setIsEditingNote}
                onUpdateNote={handleUpdateNote}
                noteTextareaRef={noteTextareaRef}
                onNoteTap={handleNoteTap}
              />
            )}

            {revealFrontendPreviewUpdate && (
              <button
                type="button"
                className="mb-3 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-300"
                onClick={() => {
                  const widgetIndex = handleGetWidgetIndexForInput(
                    revealFrontendPreviewUpdate.widgetName,
                  );
                  updateNodeWidget(
                    nodeHierarchicalKey,
                    widgetIndex ?? -1,
                    revealFrontendPreviewUpdate.value,
                    revealFrontendPreviewUpdate.widgetName,
                  );
                }}
              >
                Show video preview
              </button>
            )}

            {showComparer && comparerOutput && (
              isDenoVideoCompare && comparerOutput.video ? (
                <DenoVideoCompare
                  output={comparerOutput}
                  displayName={displayName}
                  onWidgetChange={(widgetName, value) => {
                    const widgetIndex = handleGetWidgetIndexForInput(widgetName);
                    if (widgetIndex === null) return;
                    handleUpdateNodeWidget(widgetIndex, value, widgetName);
                  }}
                />
              ) : (
                <NodeCardImageComparer
                  show={showComparer}
                  aImages={comparerOutput.a}
                  bImages={comparerOutput.b}
                  displayName={displayName}
                  onOpenViewer={onImageClick}
                />
              )
            )}

            <NodeCardOutputPreview
              show={showImagePreview || showTextPreview || !!latentPreviewUrl || isBatchOutput}
              previewImage={effectivePreviewImage}
              previewImages={batchTiles}
              frontendPreview={effectiveFrontendMediaPreview}
              latentPreviewUrl={latentPreviewUrl}
              previewText={showTextPreview ? nodeTextOutput : null}
              displayName={displayName}
              onImageClick={() => onImageClick?.(previewList, 0)}
              onPreviewImageClick={(i) => onImageClick?.(previewList, i)}
              isExecuting={Boolean(isExecuting)}
              overallProgress={overallProgress}
              displayNodeProgress={displayNodeProgress}
              videoAutoPlay={frontendPreviewPolicy?.autoPlay ?? true}
              videoLoop={frontendPreviewPolicy?.loop ?? false}
              videoPlaybackRate={frontendPreviewPolicy?.playbackRate ?? 1}
              onFrontendPreviewStateChange={isOasisMediaPreview
                ? handleFrontendPreviewStateChange
                : undefined}
            />
            </>
            )}
          </div>
          {nodeTitle && (
            <div className="node-card-subtitle text-[10px] text-center font-semibold uppercase tracking-wider text-slate-500 mb-1">
              {typeDef?.display_name || node.type}
            </div>
          )}
        </div>
      </div>
      </div>

      <NodeCardErrorPopover
        nodeId={node.id}
        open={errorPopoverOpen && (hasErrors || isMissingNode)}
        errors={nodeErrors ?? []}
        isMissing={isMissingNode}
        nodeType={node.type}
        onInstall={() => {
          resetErrorPopover();
          // Open the manager filtered to Missing AND searched for this exact node
          // type, so the pack that installs it is front and center.
          openCustomNodesManager('Missing', node.type);
        }}
        anchorRef={errorIconRef}
        onClose={resetErrorPopover}
      />

      {showDeleteModal && (
        <DeleteNodeModal
          nodeId={node.id}
          displayName={displayName}
          hasConnections={hasNodeConnections}
          onCancel={() => setShowDeleteModal(false)}
          onDelete={(reconnect) => {
            deleteNode(nodeHierarchicalKey, reconnect);
            setShowDeleteModal(false);
          }}
        />
      )}
    </div>
  );
});
