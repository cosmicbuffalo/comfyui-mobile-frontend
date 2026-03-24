import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowInput, WorkflowNode } from '@/api/types';
import { useWorkflowStore, getWidgetDefinitions, getInputWidgetDefinitions, getWidgetIndexForInput, findSeedWidgetIndex, resolveSubgraphPlaceholderWidgetDefs, resolveSubgraphPlaceholderInputWidgetDefs, resolveSubgraphProxyWidgetDefs, resolveSubgraphProxyInputWidgetDefs } from '@/hooks/useWorkflow';
import type { ProxyWidgetRoute } from '@/utils/widgetDefinitions';
import { isSubgraphPlaceholder } from '@/utils/canonicalWorkflowOps';
import { isLoraManagerNodeType } from '@/utils/loraManager';
import { useSeedStore } from '@/hooks/useSeed';
import { useBookmarksStore } from '@/hooks/useBookmarks';
import { usePinnedWidgetStore } from '@/hooks/usePinnedWidget';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { useOverallProgress } from '@/hooks/useOverallProgress';
import { useQueueStore } from '@/hooks/useQueue';
import { useNodeErrorPopover } from '@/hooks/useNodeErrorPopover';
import { getImageUrl } from '@/api/client';
import { getMediaType } from '@/utils/media';
import { NodeCardMenu } from './NodeCard/Menu';
import { NodeCardErrorPopover } from './NodeCard/ErrorPopover';
import { NodeCardNote } from './NodeCard/Note';
import { NodeCardOutputPreview } from './NodeCard/OutputPreview';
import { NodeCardHeader } from './NodeCard/Header';
import { DeleteNodeModal } from '@/components/modals/DeleteNodeModal';
import { ErrorHighlightBadge } from './NodeCard/ErrorHighlightBadge';
import { NodeCardConnectionsSection } from './NodeCard/ConnectionsSection';
import { NodeCardParameters } from './NodeCard/Parameters';
import { resolveLoadImagePreview } from '@/utils/loadImagePreview';
import { requireHierarchicalKey } from '@/utils/itemKeys';
import { hexToRgba } from '@/utils/grouping';
import { resolveWorkflowColor, themeColors } from '@/theme/colors';

const EMPTY_IMAGES: Array<{ filename: string; subfolder: string; type: string }> = [];
type ImageLike = (typeof EMPTY_IMAGES)[number];

interface NodeCardProps {
  node: WorkflowNode;
  isExecuting?: boolean;
  isConnectionHighlighted?: boolean;
  errorBadgeLabel?: string | null;
  onImageClick?: (images: Array<{ src: string; alt?: string }>, index: number) => void;
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
  const setItemCollapsed = useWorkflowStore((s) => s.setItemCollapsed);
  const setItemHidden = useWorkflowStore((s) => s.setItemHidden);
  const collapsedItems = useWorkflowStore((s) => s.collapsedItems);
  const nodeHierarchicalKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
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
  const latentPreviewUrl = useWorkflowStore((s) =>
    s.latentPreviews[nodeHierarchicalKey] ?? null
  );
  const nodeTextOutput = useWorkflowStore((s) => s.nodeTextOutputs[String(node.id)] ?? null);
  const nodeErrors = useWorkflowErrorsStore((s) => s.nodeErrors[String(node.id)]);
  const progress = useWorkflowStore((s) => s.progress);
  const executingPromptId = useWorkflowStore((s) => s.executingPromptId);
  const workflowDurationStats = useWorkflowStore((s) => s.workflowDurationStats);
  const storeIsExecuting = useWorkflowStore((s) => s.isExecuting);
  const running = useQueueStore((s) => s.running);
  const runKey = executingPromptId || (running[0]?.prompt_id ?? null);
  const overallProgress = useOverallProgress({
    workflow,
    runKey,
    isRunning: storeIsExecuting || running.length > 0,
    workflowDurationStats,
  });
  const displayNodeProgress = overallProgress === 100 ? 100 : progress;
  const handleSetPinnedWidget = useCallback(
    (pin: {
      nodeId: number;
      widgetIndex: number;
      widgetName: string;
      widgetType: string;
      options?: Record<string, unknown> | unknown[];
    } | null) => {
      setPinnedWidget(pin, currentWorkflowKey);
    },
    [currentWorkflowKey, setPinnedWidget]
  );
  const resolvedImages = nodeImages ?? EMPTY_IMAGES;
  const [previewImage, setPreviewImage] = useState<ImageLike | null>(null);
  const { errorPopoverOpen, setErrorPopoverOpen, resetErrorPopover } = useNodeErrorPopover();
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

  useEffect(() => {
    const handleShowLabel = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.nodeId === node.id) {
        setHighlightLabel(detail.label);
        const timer = setTimeout(() => setHighlightLabel(null), 1000);
        return () => clearTimeout(timer);
      }
    };
    window.addEventListener('node-show-label', handleShowLabel as EventListener);
    return () => window.removeEventListener('node-show-label', handleShowLabel as EventListener);
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
    ? `${latestImage.filename}|${latestImage.subfolder}|${latestImage.type}`
    : null;
  const previewKey = previewImage
    ? `${previewImage.filename}|${previewImage.subfolder}|${previewImage.type}`
    : null;

  useEffect(() => {
    if (!latestImage) return;
    if (latestKey === previewKey) return;
    const nextSrc = getImageUrl(latestImage.filename, latestImage.subfolder, latestImage.type);
    const img = new Image();
    img.onload = () => setPreviewImage(latestImage);
    img.src = nextSrc;
  }, [latestKey, previewKey, latestImage]);

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
  const isKSampler = node.type === 'KSampler';
  const isLoraManagerNode = isLoraManagerNodeType(node.type);
  const isFastGroupsBypasser = /fast\s+groups/i.test(node.type) && /\(rgthree\)/i.test(node.type);
  const isBypassed = node.mode === 4;
  const isCollapsed = Boolean(collapsedItems[nodeHierarchicalKey]);
  const isLoadImageNode = /LoadImage/i.test(node.type);
  const inputImagePreview = useMemo(() => {
    if (!isLoadImageNode || !workflow || !nodeTypes) return null;
    return resolveLoadImagePreview(workflow, nodeTypes, node);
  }, [isLoadImageNode, node, nodeTypes, workflow]);
  const effectivePreviewImage = inputImagePreview ?? previewImage;

  // Unfiltered widget defs — used for proxy route extraction before seed filtering.
  const allResolvedWidgets = useMemo(() => {
    if (isPlaceholder && workflow) {
      const slotPromoted = resolveSubgraphPlaceholderWidgetDefs(node, workflow, nodeTypes);
      const proxyPromoted = resolveSubgraphProxyWidgetDefs(node, workflow, nodeTypes);
      return [...slotPromoted, ...proxyPromoted];
    }
    return getWidgetDefinitions(nodeTypes, node);
  }, [nodeTypes, node, isPlaceholder, workflow]);

  const widgets = useMemo(() => {
    if (!isKSampler) return allResolvedWidgets;
    // Filter seed widgets — for proxy widgets the display name may be "InnerTitle: seed"
    return allResolvedWidgets.filter((widget) => {
      const baseName = widget.name.split(': ').pop() ?? widget.name;
      return baseName !== 'seed';
    });
  }, [allResolvedWidgets, isKSampler]);

  // Get input widgets (COMBO dropdowns). For placeholder nodes, derive from both mechanisms.
  const inputWidgets = useMemo(() => {
    if (isPlaceholder && workflow) {
      const slotPromoted = resolveSubgraphPlaceholderInputWidgetDefs(node, workflow, nodeTypes);
      const proxyPromoted = resolveSubgraphProxyInputWidgetDefs(node, workflow, nodeTypes);
      return [...slotPromoted, ...proxyPromoted];
    }
    return getInputWidgetDefinitions(nodeTypes, node);
  }, [nodeTypes, node, isPlaceholder, workflow]);
  const visibleInputWidgets = useMemo(
    () => inputWidgets.filter((inputWidget) => !inputWidget.connected),
    [inputWidgets]
  );
  const visibleWidgets = useMemo(
    () => widgets.filter((widget) => !widget.connected),
    [widgets]
  );
  const noteText = useMemo<string | null>(() => {
    const props = node.properties as Record<string, unknown> | undefined;
    const candidateKeys = ['text', 'note', 'description', 'label', 'title'];
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
          className="text-blue-600 underline break-all"
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
    const items: Array<{ widgetIndex: number; name: string; type: string; options?: Record<string, unknown> | unknown[] }> = [];
    const isPinEligible = (widgetType: string, widgetName: string) => {
      if (widgetType.startsWith('LM_LORA')) return false;
      if (widgetType.startsWith('TW_')) return false;
      if (isLoraManagerNode && widgetName === 'text') return false;
      return true;
    };
    visibleInputWidgets.forEach((w) => {
      if (!isPinEligible(w.type, w.name)) return;
      items.push({ widgetIndex: w.widgetIndex, name: w.name, type: w.type, options: w.options });
    });
    visibleWidgets.forEach((w) => {
      if (!isPinEligible(w.type, w.name)) return;
      items.push({ widgetIndex: w.widgetIndex, name: w.name, type: w.type, options: w.options });
    });
    return items;
  }, [visibleInputWidgets, visibleWidgets, isLoraManagerNode]);

  // Filter inputs to only show those that are actual connections (connected or connectable without widget values)
  const isWidgetInput = useCallback((input: WorkflowInput) => {
    // Promoted widgets on placeholder nodes have link set (to subgraph boundary),
    // but should render as widget controls, not connection buttons.
    if (isPlaceholder && input.widget != null) return true;
    if (input.link != null) return false;
    if (input.widget) return true;
    const inputDef = typeDef?.input?.required?.[input.name] || typeDef?.input?.optional?.[input.name];
    if (!inputDef) return false;
    const [typeOrOptions, options] = inputDef;
    if (Array.isArray(typeOrOptions)) return true;
    const normalized = String(typeOrOptions).toUpperCase();
    const hasDefault = Object.prototype.hasOwnProperty.call(options ?? {}, 'default');
    return [
      'INT',
      'FLOAT',
      'BOOLEAN',
      'STRING',
    ].includes(normalized) ||
      normalized.includes('AUTOCOMPLETE_TEXT_LORAS') ||
      normalized.includes('AUTOCOMPLETE_TEXT_PROMPT') ||
      hasDefault;
  }, [typeDef, isPlaceholder]);

  const connectionInputs = useMemo(() => {
    return node.inputs.filter((input) => {
      if (isWidgetInput(input)) return false;
      const isOptConnection = String(input.type).toUpperCase() === 'OPT_CONNECTION';
      if (isOptConnection && input.link == null) return false;
      return true;
    });
  }, [node.inputs, isWidgetInput]);


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

  const hasImageOutput = node.outputs.some((o) =>
    String(o.type).toUpperCase() === 'IMAGE'
  );
  const isImageOutputNode = Boolean(
    typeDef?.output_node ||
    /PreviewImage|SaveImage|SaveAnimatedPNG|SaveAnimatedWEBP|SaveVideo/i.test(node.type)
  );

  // Helper to check if a widget is pinned
  const isWidgetPinned = (widgetIndex: number) => {
    return pinnedWidgetForThisNode?.widgetIndex === widgetIndex;
  };

  // Helper to toggle pin for a widget
  const toggleWidgetPin = (widgetIndex: number, widgetName: string, widgetType: string, options?: Record<string, unknown> | unknown[]) => {
    if (isWidgetPinned(widgetIndex)) {
      handleSetPinnedWidget(null);
    } else {
      handleSetPinnedWidget({
        nodeId: node.id,
        widgetIndex,
        widgetName,
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

  const showImagePreview = (hasImageOutput || isImageOutputNode) && !!effectivePreviewImage;
  const showTextPreview = typeof nodeTextOutput === 'string' && nodeTextOutput.length > 0;
  const inputConnectionCount = node.inputs?.filter((input) => input.link != null).length ?? 0;
  const outputConnectionCount = node.outputs?.reduce((count, output) => count + (output.links?.length ?? 0), 0) ?? 0;
  const hasNodeConnections = inputConnectionCount > 0 || outputConnectionCount > 0;
  const leftLineCount = Math.min(3, inputConnectionCount);
  const rightLineCount = Math.min(3, outputConnectionCount);
  const previewList = effectivePreviewImage
    ? (() => {
        const { filename, subfolder, type } = effectivePreviewImage;
        const src = getImageUrl(filename, subfolder, type);
        const filePath = subfolder ? `${subfolder}/${filename}` : filename;
        const mediaType = getMediaType(filename);
        return [{
          src,
          alt: displayName,
          filename,
          mediaType,
          file: {
            id: `${type}/${filePath}`,
            name: filename,
            type: mediaType === 'video' ? 'video' : 'image',
            fullUrl: src
          }
        }];
      })()
    : [];

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

  const handleUpdateNodeWidget = useCallback(
    (widgetIndex: number, value: unknown, widgetName?: string) => {
      const proxy = proxyRoutes.get(widgetIndex);
      if (proxy) {
        updateSubgraphInnerNodeWidget(proxy.subgraphId, proxy.innerNodeId, proxy.innerWidgetIndex, value);
      } else {
        updateNodeWidget(nodeHierarchicalKey, widgetIndex, value, widgetName);
      }
    },
    [nodeHierarchicalKey, updateNodeWidget, updateSubgraphInnerNodeWidget, proxyRoutes]
  );

  // Resolve a widget value, following proxy routes to inner nodes when needed.
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
      const values = Array.isArray(node.widgets_values) ? node.widgets_values : [];
      return values[widgetIndex];
    },
    [node, workflow, proxyRoutes]
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
            value
          );
        } else {
          directUpdates[widgetIndex] = value;
        }
      }
      if (Object.keys(directUpdates).length > 0) {
        updateNodeWidgets(nodeHierarchicalKey, directUpdates);
      }
    },
    [nodeHierarchicalKey, updateNodeWidgets, updateSubgraphInnerNodeWidget, proxyRoutes]
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
    !isConnectionHighlighted &&
    !isExecuting &&
    rawNodeColor.length > 0;
  const nodeCardBorderClass = hasErrors
    ? '!border-2 !border-red-700'
    : isConnectionHighlighted
      ? 'border-orange-500 shadow-orange-200'
      : isExecuting
        ? 'border-green-500 shadow-green-200'
        : isPlaceholder
          ? 'border-blue-500/60 shadow-blue-100'
          : 'border-transparent';
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
        border-2
        ${nodeCardBorderClass}
        ${isBypassed ? 'bg-purple-100/50' : 'bg-white'}
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
        errorIconRef={errorIconRef}
        errorPopoverOpen={errorPopoverOpen}
        setErrorPopoverOpen={setErrorPopoverOpen}
        toggleNodeFold={() => {
          setItemCollapsed(nodeHierarchicalKey, !isCollapsed);
        }}
        expandedBorderColor={canUseNodeTint ? nodeHeaderBorderColor : undefined}
        rightSlot={(
          <NodeCardMenu
            nodeId={node.id}
            nodeHierarchicalKey={nodeHierarchicalKey}
            isLoraManagerNode={isLoraManagerNode}
            showFastGroupsConfigAction={isFastGroupsBypasser}
            isBypassed={isBypassed}
            onEnterSubgraph={onEnterSubgraph}
            onEditLabel={handleEditLabel}
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
            onMoveNode={onMoveNode ?? (() => {})}
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
          {nodeTitle && (
            <div className="node-card-subtitle text-[10px] text-center font-semibold uppercase tracking-wider text-gray-400 mb-2 px-1">
              {typeDef?.display_name || node.type}
            </div>
          )}

          <div id={`node-content-${node.id}`} className={`node-expanded-content ${isBypassed ? 'opacity-60 grayscale' : ''}`}>
            <NodeCardConnectionsSection
              nodeId={node.id}
              nodeType={node.type}
              inputs={connectionInputs}
              outputs={visibleOutputs}
              allInputs={node.inputs}
              allOutputs={node.outputs}
            />

            <NodeCardParameters
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
              setSeedMode={handleSetSeedMode}
              isWidgetPinned={isWidgetPinned}
              toggleWidgetPin={toggleWidgetPin}
              resolveWidgetValue={resolveWidgetValue}
              showFastGroupConfig={showFastGroupConfig}
              setShowFastGroupConfig={setShowFastGroupConfig}
            />
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

            <NodeCardOutputPreview
              show={showImagePreview || showTextPreview || !!latentPreviewUrl}
              previewImage={effectivePreviewImage}
              latentPreviewUrl={latentPreviewUrl}
              previewText={showTextPreview ? nodeTextOutput : null}
              displayName={displayName}
              onImageClick={() => onImageClick?.(previewList, 0)}
              isExecuting={Boolean(isExecuting)}
              overallProgress={overallProgress}
              displayNodeProgress={displayNodeProgress}
            />
          </div>
        </div>
      </div>
      </div>

      <NodeCardErrorPopover
        nodeId={node.id}
        open={errorPopoverOpen && hasErrors}
        errors={nodeErrors ?? []}
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
