import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeTypes, Workflow, WorkflowInput, WorkflowNode } from '@/api/types';
import { useWorkflowStore, getWidgetDefinitions, getInputWidgetDefinitions, getWidgetIndexForInput, findSeedWidgetIndex } from '@/hooks/useWorkflow';
import { useSeedStore } from '@/hooks/useSeed';
import { useBookmarksStore } from '@/hooks/useBookmarks';
import { usePinnedWidgetStore } from '@/hooks/usePinnedWidget';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { useOverallProgress } from '@/hooks/useOverallProgress';
import { useQueueStore } from '@/hooks/useQueue';
import { getImageUrl } from '@/api/client';
import { getMediaType } from '@/utils/media';
import { NodeCardConnections } from './NodeCard/NodeCardConnections';
import { NodeCardMenu } from './NodeCard/NodeCardMenu';
import { NodeCardErrorPopover } from './NodeCard/NodeCardErrorPopover';
import { NodeCardNote } from './NodeCard/NodeCardNote';
import { NodeCardOutputPreview } from './NodeCard/NodeCardOutputPreview';
import { NodeCardHeader } from './NodeCard/NodeCardHeader';
import { NodeCardParameters } from './NodeCard/NodeCardParameters';

const EMPTY_IMAGES: Array<{ filename: string; subfolder: string; type: string }> = [];
type ImageLike = (typeof EMPTY_IMAGES)[number];

interface NodeCardProps {
  node: WorkflowNode;
  isExecuting?: boolean;
  isConnectionHighlighted?: boolean;
  errorBadgeLabel?: string | null;
  onImageClick?: (images: Array<{ src: string; alt?: string }>, index: number) => void;
  inGroup?: boolean;
}

export const NodeCard = memo(function NodeCard({ node, isExecuting, isConnectionHighlighted = false, errorBadgeLabel, onImageClick, inGroup = false }: NodeCardProps) {
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const workflow = useWorkflowStore((s) => s.workflow);
  const updateNodeWidget = useWorkflowStore((s) => s.updateNodeWidget);
  const updateNodeWidgets = useWorkflowStore((s) => s.updateNodeWidgets);
  const updateNodeTitle = useWorkflowStore((s) => s.updateNodeTitle);
  const toggleBypass = useWorkflowStore((s) => s.toggleBypass);
  const toggleNodeFold = useWorkflowStore((s) => s.toggleNodeFold);
  const hideNode = useWorkflowStore((s) => s.hideNode);
  const setConnectionHighlightMode = useWorkflowStore((s) => s.setConnectionHighlightMode);
  const connectionHighlightMode = useWorkflowStore((s) => s.connectionHighlightModes[node.id] ?? 'off');
  const setSeedMode = useSeedStore((s) => s.setSeedMode);
  const currentWorkflowKey = useWorkflowStore((s) => s.currentWorkflowKey);
  // Only subscribe to whether THIS node has a pinned widget (reduces re-renders)
  const pinnedWidgetForThisNode = usePinnedWidgetStore((s) =>
    s.pinnedWidget?.nodeId === node.id ? s.pinnedWidget : null
  );
  const setPinnedWidget = usePinnedWidgetStore((s) => s.setPinnedWidget);
  const bookmarkedNodeIds = useBookmarksStore((s) => s.bookmarkedNodeIds);
  const toggleNodeBookmark = useBookmarksStore((s) => s.toggleNodeBookmark);
  const nodeImages = useWorkflowStore((s) => s.nodeOutputs[String(node.id)]);
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
  const handleSetSeedMode = useCallback(
    (nodeId: number, mode: 'fixed' | 'randomize' | 'increment' | 'decrement') => {
      setSeedMode(nodeId, mode, { workflow, nodeTypes, updateNodeWidgets });
    },
    [nodeTypes, setSeedMode, updateNodeWidgets, workflow]
  );
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
  const [errorPopoverOpen, setErrorPopoverOpen] = useState(false);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState('');
  const labelInputRef = useRef<HTMLInputElement>(null);
  const lastNoteTapRef = useRef<number>(0);
  const errorIconRef = useRef<HTMLButtonElement>(null);
  const [highlightLabel, setHighlightLabel] = useState<string | null>(null);

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
  const nodeTitle = useMemo(() => {
    const directTitle = (node as { title?: unknown }).title;
    return typeof directTitle === 'string' && directTitle.trim()
      ? directTitle.trim()
      : null;
  }, [node]);
  const displayName: string = nodeTitle || typeDef?.display_name || node.type;
  const isKSampler = node.type === 'KSampler';
  const isBypassed = node.mode === 4;
  const isCollapsed = Boolean(node.flags?.collapsed);
  const isLoadImageNode = /LoadImage/i.test(node.type);
  const inputImagePreview = useMemo(() => {
    if (!isLoadImageNode || !workflow || !nodeTypes) return null;
    return resolveLoadImagePreview(workflow, nodeTypes, node);
  }, [isLoadImageNode, node, nodeTypes, workflow]);
  const effectivePreviewImage = inputImagePreview ?? previewImage;

  const widgets = useMemo(() => {
    const allWidgets = getWidgetDefinitions(nodeTypes, node);
    if (!isKSampler) return allWidgets;
    return allWidgets.filter((widget) => widget.name !== 'seed');
  }, [nodeTypes, node, isKSampler]);


  // Get input widgets (unconnected inputs that have options like ckpt_name, sampler_name, etc.)
  const inputWidgets = useMemo(() =>
    getInputWidgetDefinitions(nodeTypes, node),
    [nodeTypes, node]
  );
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
    return findSeedWidgetIndex(workflow, nodeTypes, node);
  };

  const handleUpdateNote = (value: string) => {
    if (noteWidgetIndex === null) return;
    updateNodeWidget(node.id, noteWidgetIndex, value);
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
    visibleInputWidgets.forEach((w) => {
      items.push({ widgetIndex: w.widgetIndex, name: w.name, type: w.type, options: w.options });
    });
    visibleWidgets.forEach((w) => {
      items.push({ widgetIndex: w.widgetIndex, name: w.name, type: w.type, options: w.options });
    });
    return items;
  }, [visibleInputWidgets, visibleWidgets]);

  // Filter inputs to only show those that are actual connections (connected or connectable without widget values)
  const isWidgetInput = useCallback((input: WorkflowInput) => {
    if (input.link != null) return false;
    if (input.widget) return true;
    const inputDef = typeDef?.input?.required?.[input.name] || typeDef?.input?.optional?.[input.name];
    if (!inputDef) return false;
    const [typeOrOptions, options] = inputDef;
    if (Array.isArray(typeOrOptions)) return true;
    const normalized = String(typeOrOptions).toUpperCase();
    const hasDefault = Object.prototype.hasOwnProperty.call(options ?? {}, 'default');
    return ['INT', 'FLOAT', 'BOOLEAN', 'STRING'].includes(normalized) || hasDefault;
  }, [typeDef]);

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
  const isNodeBookmarked = bookmarkedNodeIds.includes(node.id);
  const canAddNodeBookmark = bookmarkedNodeIds.length < 5 || isNodeBookmarked;

  const showImagePreview = (hasImageOutput || isImageOutputNode) && !!effectivePreviewImage;
  const inputConnectionCount = node.inputs?.filter((input) => input.link != null).length ?? 0;
  const outputConnectionCount = node.outputs?.reduce((count, output) => count + (output.links?.length ?? 0), 0) ?? 0;
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
    updateNodeTitle(node.id, nextValue.length > 0 ? nextValue : null);
    setIsEditingLabel(false);
  };

  const showHighlightLabel = Boolean(highlightLabel && !/^error\b/i.test(highlightLabel));
  return (
    <div id={`node-card-wrapper-${node.id}`} className="relative node-card-outer">
      <div id={`node-anchor-${node.id}`} className="absolute -top-3 left-0 right-0 h-0 node-scroll-anchor" />

      {/* Highlight Label Badge */}
      {showHighlightLabel && (
        <div
          className="absolute -top-6 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <div className="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg whitespace-nowrap uppercase tracking-tighter ring-2 ring-white">
            {highlightLabel}
          </div>
        </div>
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
        ${inGroup ? 'rounded-lg shadow-sm py-1' : 'rounded-xl shadow-md px-3 py-1 mb-3'}
        border-2
        ${hasErrors ? 'border-red-700 shadow-red-200' : (isConnectionHighlighted ? 'border-orange-500 shadow-orange-200' : (isExecuting ? 'border-green-500 shadow-green-200' : (isBypassed ? 'border-purple-300' : 'border-transparent')))}
        ${isBypassed ? (isCollapsed ? 'bg-purple-200' : 'bg-purple-100/50') : 'bg-white'}
      `}
        style={{ overflow: 'visible' }}
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
        toggleNodeFold={toggleNodeFold}
        rightSlot={(
          <NodeCardMenu
            nodeId={node.id}
            isBypassed={isBypassed}
            onEditLabel={handleEditLabel}
            pinnableWidgets={pinnableWidgets}
            singlePinnableWidget={singlePinnableWidget}
            isSingleWidgetPinned={isSingleWidgetPinned}
            hasPinnedWidget={hasPinnedWidget}
            toggleWidgetPin={toggleWidgetPin}
            setPinnedWidget={handleSetPinnedWidget}
            isNodeBookmarked={isNodeBookmarked}
            canAddNodeBookmark={canAddNodeBookmark}
            onToggleNodeBookmark={() => toggleNodeBookmark(node.id)}
            toggleBypass={toggleBypass}
            hideNode={hideNode}
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
          className={`overflow-hidden transition-opacity duration-200 ease-out ${
            isCollapsed ? "opacity-0" : "opacity-100"
          }`}
        >
          {nodeTitle && (
            <div className="node-card-subtitle text-[10px] text-center font-semibold uppercase tracking-wider text-gray-400 mb-2 px-1">
              {typeDef?.display_name || node.type}
            </div>
          )}

          <div id={`node-content-${node.id}`} className={`node-expanded-content ${isBypassed ? 'opacity-60 grayscale' : ''}`}>
            {/* Inputs & Outputs section - side by side at top */}
            <NodeCardConnections
              nodeId={node.id}
              inputs={connectionInputs}
              outputs={visibleOutputs}
              allInputs={node.inputs}
              allOutputs={node.outputs}
            />

            {/* Parameters section - editable values (both widget values and input widgets) */}
            <NodeCardParameters
              node={node}
              isBypassed={isBypassed}
              isKSampler={isKSampler}
              workflowExists={Boolean(workflow)}
              nodeTypesExists={Boolean(nodeTypes)}
              visibleInputWidgets={visibleInputWidgets}
              visibleWidgets={visibleWidgets}
              errorInputNames={errorInputNames}
              onUpdateNodeWidget={updateNodeWidget}
              onUpdateNodeWidgets={updateNodeWidgets}
              getWidgetIndexForInput={handleGetWidgetIndexForInput}
              findSeedWidgetIndex={handleFindSeedWidgetIndex}
              setSeedMode={handleSetSeedMode}
              isWidgetPinned={isWidgetPinned}
              toggleWidgetPin={toggleWidgetPin}
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
              show={showImagePreview}
              previewImage={effectivePreviewImage}
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
        onClose={() => setErrorPopoverOpen(false)}
      />
    </div>
  );
});

function resolveLoadImagePreview(workflow: Workflow, nodeTypes: NodeTypes | null, node: WorkflowNode): ImageLike | null {
  if (!nodeTypes) return null;
  const widgetIndex = getWidgetIndexForInput(workflow, nodeTypes, node, 'image') ??
    getWidgetIndexForInput(workflow, nodeTypes, node, 'filename') ??
    getWidgetIndexForInput(workflow, nodeTypes, node, 'file');
  if (widgetIndex == null || !Array.isArray(node.widgets_values)) return null;
  const rawValue = node.widgets_values[widgetIndex];
  return parseInputImageValue(rawValue);
}

function parseInputImageValue(value: unknown): ImageLike | null {
  if (typeof value === 'string' && value.trim()) {
    const { filename, subfolder } = splitSubfolder(value.trim());
    return { filename, subfolder, type: 'input' };
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const filename = typeof record.filename === 'string'
    ? record.filename
    : typeof record.name === 'string'
      ? record.name
      : null;
  if (!filename || !filename.trim()) return null;
  const subfolder = typeof record.subfolder === 'string' ? record.subfolder : '';
  const type = typeof record.type === 'string' ? record.type : 'input';
  const { filename: parsedName, subfolder: parsedSubfolder } = splitSubfolder(filename.trim());
  return {
    filename: parsedName,
    subfolder: subfolder || parsedSubfolder,
    type
  };
}

// Split a path like "folder/file.png" into subfolder + filename for /view.
function splitSubfolder(path: string): { filename: string; subfolder: string } {
  const normalized = path.replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return { filename: normalized, subfolder: '' };
  }
  const filename = parts.pop() ?? normalized;
  return { filename, subfolder: parts.join('/') };
}
