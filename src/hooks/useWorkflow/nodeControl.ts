import {
  type ItemRef,
    makeLocationPointer,
  parseLocationPointer,
  collectScopedMembership,
  scopedNodeKey,
  findItemInLayout,
          removeGroupFromLayoutByKey,
} from "@/utils/mobileLayout";
import type {
  Workflow,
      WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphLink,
} from "@/api/types";
import {
  annotateWorkflowWithHierarchicalKeys,
    buildSubgraphParentMap,
    clearNodeUiStateForTargets,
  collectBypassContainerTargetNodesFromLayout,
  collectBypassGroupTargetNodes,
  collectBypassSubgraphTargetNodes,
  collectDescendantSubgraphs,
  collectGroupHierarchicalKeys,
  collectNodeHierarchicalKeys,
    findSubgraphHierarchicalKey,
  getParentSubgraphIdFromContainer,
  getSubgraphChildMap,
      layoutRecordFromPointerRecord,
              reconcilePointerRegistry,
  resolveContainerIdentityFromHierarchicalKey,
  resolveNodeIdentityFromHierarchicalKey,
} from "@/utils/workflowHierarchy";
import {
  buildLayoutForWorkflow,
    removeNodesFromWorkflow,
  updateNodeWidgetValues,
  updateNodeWidgetsValues,
} from "./layoutOps";
import { dissolveSubgraph } from "@/utils/dissolveSubgraph";
import { findConnectedNode } from "@/utils/nodeOrdering";
import {
            getActiveNodeInputDefinitions,
  rebuildDynamicComboNode,
} from "@/utils/workflowInputs";
import {
    resolveScopeForHierarchicalKey,
  resolveNodeByHierarchicalKey,
    getLinkId,
      getLinkTargetId,
  getLinkTargetSlot,
        } from "@/utils/canonicalWorkflowOps";
import { getSetGetName, isGetNode, isSetNode } from "@/utils/setGetNodes";
import { resolveWorkflowColor, themeColors } from "@/theme/colors";
import { stripNodeWidgetIndexMap } from "./helpers";
import { t } from "@/i18n";
import { usePinnedWidgetStore } from "@/hooks/usePinnedWidget";
import {
  useWorkflowErrorsStore,
} from "@/hooks/useWorkflowErrors";
import { userScrolledSince } from "@/utils/scrollInterrupt";
import type { WorkflowGet, WorkflowSet, WorkflowState } from "./state";

/**
 * Node / container / visibility control actions for the useWorkflow store:
 * widget and title updates, bypassing, hidden/collapsed toggling,
 * connection highlighting, node reveal, and container deletion/renaming.
 * Extracted verbatim from the useWorkflow store body (mirrors
 * `./metadataNormalization`); the bodies are unchanged, only the scope moves.
 */
export function createNodeControlActions(set: WorkflowSet, get: WorkflowGet) {

      const cycleConnectionHighlight: WorkflowState["cycleConnectionHighlight"] =
        (itemKey) => {
          set((state) => {
            const canonicalHierarchicalKey =
              state.itemKeyByPointer[itemKey] ?? itemKey;
            const current =
              state.connectionHighlightModes[canonicalHierarchicalKey] ?? "off";
            const next =
              current === "off"
                ? "inputs"
                : current === "inputs"
                  ? "outputs"
                  : current === "outputs"
                    ? "both"
                    : "off";
            if (next === "off") {
              const nextModes = { ...state.connectionHighlightModes };
              delete nextModes[canonicalHierarchicalKey];
              return { connectionHighlightModes: nextModes };
            }
            return {
              connectionHighlightModes: { [canonicalHierarchicalKey]: next },
            };
          });
        };
      const setConnectionHighlightMode: WorkflowState["setConnectionHighlightMode"] =
        (itemKey, mode) => {
          set((state) => {
            const canonicalHierarchicalKey =
              state.itemKeyByPointer[itemKey] ?? itemKey;
            if (mode === "off") {
              const nextModes = { ...state.connectionHighlightModes };
              delete nextModes[canonicalHierarchicalKey];
              return { connectionHighlightModes: nextModes };
            }
            return {
              connectionHighlightModes: { [canonicalHierarchicalKey]: mode },
            };
          });
        };
      const setItemHidden: WorkflowState["setItemHidden"] = (
        itemKey,
        hidden,
      ) => {
        if (!itemKey) return;
        set((state) => {
          const canonicalHierarchicalKey =
            state.itemKeyByPointer[itemKey] ?? itemKey;
          const pointerKey = state.pointerByHierarchicalKey[canonicalHierarchicalKey];
          const next = { ...state.hiddenItems };
          if (hidden) {
            next[canonicalHierarchicalKey] = true;
          } else {
            delete next[itemKey];
            delete next[canonicalHierarchicalKey];
            if (pointerKey) delete next[pointerKey];
          }
          return { hiddenItems: next };
        });
      };
      const revealNodeWithParents: WorkflowState["revealNodeWithParents"] = (
        itemKey,
      ) => {
        const { workflow, pointerByHierarchicalKey } = get();
        if (!workflow) return;
        const identity = resolveNodeIdentityFromHierarchicalKey(
          workflow,
          itemKey,
          pointerByHierarchicalKey,
        );
        if (!identity) return;

        const subgraphs = workflow.definitions?.subgraphs ?? [];
        const targetSubgraphId = identity.subgraphId ?? null;

        // Under the canonical model, root nodes are in workflow.nodes and inner nodes in sg.nodes.
        const subgraphById = new Map(subgraphs.map((sg) => [sg.id, sg]));
        const scopedNodes = targetSubgraphId
          ? (subgraphById.get(targetSubgraphId)?.nodes ?? [])
          : workflow.nodes;
        const node = scopedNodes.find((entry) => entry.id === identity.nodeId);
        if (!node) return;

        const parentMap = buildSubgraphParentMap(subgraphs);
        const rootNodes = workflow.nodes;
        const collectParentIds = () => {
          const parents = new Set<number>();
          const stack = [node.id];
          if (targetSubgraphId !== null) {
            const subgraph = subgraphById.get(targetSubgraphId);
            const incoming = new Map<number, number[]>();
            subgraph?.links?.forEach((link) => {
              const list = incoming.get(link.target_id) ?? [];
              list.push(link.origin_id);
              incoming.set(link.target_id, list);
            });
            while (stack.length > 0) {
              const current = stack.pop();
              if (current === undefined) continue;
              const parentList = incoming.get(current) ?? [];
              parentList.forEach((parentId) => {
                if (parents.has(parentId)) return;
                parents.add(parentId);
                stack.push(parentId);
              });
            }
            return parents;
          }
          while (stack.length > 0) {
            const current = stack.pop();
            if (current === undefined) continue;
            const currentNode = workflow.nodes.find(
              (entry) => entry.id === current,
            );
            if (!currentNode) continue;
            currentNode.inputs?.forEach((input, index) => {
              if (input.link === null) return;
              const connected = findConnectedNode(workflow, current, index);
              if (!connected) return;
              const parentId = connected.node.id;
              if (parents.has(parentId)) return;
              parents.add(parentId);
              stack.push(parentId);
            });
          }
          return parents;
        };
        const parentIds = collectParentIds();
        const parentSubgraphId = targetSubgraphId;

        set((state) => {
          const nextHiddenItems = { ...state.hiddenItems };
          for (const itemKey of collectNodeHierarchicalKeys(
            workflow,
            state.itemKeyByPointer,
            identity.nodeId,
            targetSubgraphId,
          )) {
            delete nextHiddenItems[itemKey];
          }
          parentIds.forEach((parentId) => {
            for (const itemKey of collectNodeHierarchicalKeys(
              workflow,
              state.itemKeyByPointer,
              parentId,
              parentSubgraphId,
            )) {
              delete nextHiddenItems[itemKey];
            }
          });
          const nextCollapsedItems = { ...state.collapsedItems };

          const revealGroup = (
            groupId: number | null | undefined,
            subgraphId: string | null = null,
          ) => {
            if (groupId === null || groupId === undefined) return;
            for (const key of collectGroupHierarchicalKeys(
              state.mobileLayout,
              groupId,
              subgraphId,
            )) {
              delete nextHiddenItems[key];
              delete nextCollapsedItems[key];
            }
          };

          // Reveal the WHOLE chain of groups a node sits in — its innermost group
          // plus every ancestor group it's nested under — so a node buried in a
          // folded group within a folded group is fully exposed, not just one level.
          const layoutMembership = collectScopedMembership(state.mobileLayout);
          const revealGroupChainForNode = (
            nodeId: number,
            subgraphId: string | null,
          ) => {
            const startKey = layoutMembership.get(scopedNodeKey(nodeId, subgraphId))?.groupKey;
            const seen = new Set<string>();
            let currentKey: string | null | undefined = startKey;
            while (currentKey && !seen.has(currentKey)) {
              seen.add(currentKey);
              const parsed = parseLocationPointer(currentKey);
              if (parsed?.type === "group") {
                revealGroup(parsed.groupId, parsed.subgraphId);
              }
              const parent = state.mobileLayout.groupParents?.[currentKey];
              currentKey = parent?.scope === "group" ? parent.groupKey : null;
            }
          };

          const expandSubgraph = (subgraphId: string | null | undefined) => {
            if (!subgraphId) return;
            const key = findSubgraphHierarchicalKey(workflow, subgraphId);
            if (!key) return;
            delete nextCollapsedItems[key];
            delete nextHiddenItems[key];
          };

          if (targetSubgraphId === null) {
            // Root-scope node: reveal its full group chain and those of its parents.
            revealGroupChainForNode(node.id, null);
            parentIds.forEach((parentId) => {
              revealGroupChainForNode(parentId, null);
            });
          } else {
            // Inner subgraph node: expand the subgraph section, reveal its group,
            // and also reveal the root group containing the placeholder node for this subgraph.
            expandSubgraph(targetSubgraphId);
            const subgraph = subgraphById.get(targetSubgraphId);
            if (subgraph) {
              revealGroupChainForNode(node.id, targetSubgraphId);
            }

            // Under the canonical model: find the placeholder node in root scope
            // to reveal its parent group chain.
            const placeholderNode = rootNodes.find((n) => n.type === targetSubgraphId);
            if (placeholderNode) {
              revealGroupChainForNode(placeholderNode.id, null);
            }

            if (subgraph) {
              parentIds.forEach((parentId) => {
                revealGroupChainForNode(parentId, targetSubgraphId);
              });
            }

            const stack = [targetSubgraphId];
            const visited = new Set<string>();
            while (stack.length > 0) {
              const current = stack.pop();
              if (!current || visited.has(current)) continue;
              visited.add(current);
              const parents = parentMap.get(current) ?? [];
              for (const parent of parents) {
                expandSubgraph(parent.parentId);
                const parentDef = subgraphById.get(parent.parentId);
                if (parentDef) {
                  revealGroupChainForNode(parent.nodeId, parent.parentId);
                }
                if (!visited.has(parent.parentId)) {
                  stack.push(parent.parentId);
                }
              }
            }
          }

          return {
            hiddenItems: nextHiddenItems,
            collapsedItems: nextCollapsedItems,
          };
        });
      };
      const updateNodeWidget: WorkflowState["updateNodeWidget"] = (
        itemKey,
        widgetIndex,
        value,
        widgetName,
      ) => {
        const { workflow, nodeTypes } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;

        // Resolve nested DynamicCombo children by their fully-qualified name.
        // Bare-name lookup is intentionally limited to top-level inputs so two
        // active branches can safely reuse a child name.
        const typeDef = nodeTypes?.[node.type];
        const activeInputs = typeDef ? getActiveNodeInputDefinitions(typeDef, node) : [];
        const activeInput = activeInputs.find(
          (definition) => definition.qualifiedName === widgetName,
        ) ?? activeInputs.find(
          (definition) => definition.widgetIndex === widgetIndex,
        );
        const inputDef = activeInput?.inputDef ?? (widgetName && typeDef
          ? typeDef.input?.required?.[widgetName] ?? typeDef.input?.optional?.[widgetName]
          : undefined);
        const resolvedInputName = activeInput?.qualifiedName ?? widgetName;
        const rebuilt = inputDef && typeDef && resolvedInputName
          ? rebuildDynamicComboNode(
              node,
              typeDef,
              resolvedInputName,
              inputDef,
              widgetIndex,
              value,
            )
          : null;

        let nextLinks: Array<WorkflowLink | WorkflowSubgraphLink> = scope.links;
        let nextNodes: WorkflowNode[];
        if (rebuilt) {
          const removedLinkIds = new Set(rebuilt.removedLinkIds);
          const newSlotByLinkId = new Map<number, number>();
          rebuilt.node.inputs.forEach((input, index) => {
            if (input.link != null) newSlotByLinkId.set(input.link, index);
          });
          nextLinks = scope.links
            .filter((link) => !removedLinkIds.has(getLinkId(link)))
            .map((link) => {
              if (getLinkTargetId(link) !== node.id) return link;
              const targetSlot = newSlotByLinkId.get(getLinkId(link));
              if (targetSlot === undefined || targetSlot === getLinkTargetSlot(link)) return link;
              if (Array.isArray(link)) {
                const nextLink: WorkflowLink = [...link];
                nextLink[4] = targetSlot;
                return nextLink;
              }
              return { ...link, target_slot: targetSlot };
            });
          nextNodes = scope.nodes.map((candidate) => {
            let nextNode = candidate.id === node.id ? rebuilt.node : candidate;
            if (removedLinkIds.size > 0) {
              const outputs = (nextNode.outputs ?? []).map((output) => {
                const links = output.links?.filter((linkId) => !removedLinkIds.has(linkId)) ?? null;
                return links === output.links
                  ? output
                  : { ...output, links: links && links.length > 0 ? links : null };
              });
              nextNode = { ...nextNode, outputs };
            }
            return nextNode;
          });
        } else {
          nextNodes = scope.nodes.map((candidate) =>
            candidate.id === node.id
              ? updateNodeWidgetValues(candidate, widgetIndex, value, widgetName)
              : candidate,
          );
        }
        let nextWorkflow = scope.applyPatch(workflow, {
          nodes: nextNodes,
          ...(rebuilt
            ? {
                links: scope.subgraphId == null
                  ? (nextLinks as WorkflowLink[])
                  : (nextLinks as WorkflowSubgraphLink[]),
              }
            : {}),
        });
        if (rebuilt && scope.subgraphId == null) {
          // Workflow-level widget-index maps (Lora Manager metadata) recorded
          // the pre-rebuild slot layout; a stale entry would override the
          // schema walk and shift every submitted value. Node ids are only
          // unambiguous at root scope, so inner rebuilds leave the maps alone.
          nextWorkflow = stripNodeWidgetIndexMap(nextWorkflow, node.id);
        }
        set({ workflow: nextWorkflow });
        useWorkflowErrorsStore.getState().clearNodeError(node.id);
        if (rebuilt && typeDef && scope.subgraphId == null) {
          // A branch switch renumbers the slots after the combo, so any pin on
          // this node must follow its input to the new index — or disappear
          // with the retired branch. Without this, the by-index pin would
          // silently edit whichever widget now occupies the old slot.
          const rebuiltDefinitions = getActiveNodeInputDefinitions(typeDef, rebuilt.node);
          usePinnedWidgetStore.getState().reconcilePinsForNode(
            node.id,
            get().currentWorkflowKey,
            (pin) => {
              const target = pin.inputName ?? pin.widgetName;
              const definition = rebuiltDefinitions.find(
                (candidate) => candidate.qualifiedName === target || candidate.name === target,
              );
              return definition?.widgetIndex ?? null;
            },
          );
        }
      };
      const renameSetGetNode: WorkflowState["renameSetGetNode"] = (itemKey, newName) => {
        const { workflow } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const target = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!target) return;
        const oldName = getSetGetName(target);
        const trimmed = newName.trim();
        if (!trimmed || trimmed === oldName) return;
        // Renaming a SetNode also renames every GetNode in this scope that was
        // reading the old name, so the name-matched link isn't broken.
        const syncGets = isSetNode(target) && Boolean(oldName);
        const nextNodes = scope.nodes.map((n) => {
          if (n.id === target.id) return updateNodeWidgetValues(n, 0, trimmed, "value");
          if (syncGets && isGetNode(n) && getSetGetName(n) === oldName) {
            return updateNodeWidgetValues(n, 0, trimmed, "value");
          }
          return n;
        });
        set({ workflow: scope.applyPatch(workflow, { nodes: nextNodes }) });
      };
      const updateNodeWidgets: WorkflowState["updateNodeWidgets"] = (
        itemKey,
        updates,
      ) => {
        const { workflow } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        const nextNodes = scope.nodes.map((n) =>
          n.id === node.id ? updateNodeWidgetsValues(n, updates) : n,
        );
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({ workflow: nextWorkflow });
        useWorkflowErrorsStore.getState().clearNodeError(node.id);
      };
      const updateSubgraphInnerNodeWidget: WorkflowState["updateSubgraphInnerNodeWidget"] = (
        subgraphId,
        innerNodeId,
        innerWidgetIndex,
        value,
        widgetName,
      ) => {
        updateNodeWidget(
          makeLocationPointer({ type: 'node', nodeId: innerNodeId, subgraphId }),
          innerWidgetIndex,
          value,
          widgetName,
        );
      };
      const updateNodeProperties: WorkflowState["updateNodeProperties"] = (
        itemKey,
        properties,
      ) => {
        const { workflow } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        const nextNodes = scope.nodes.map((n) => {
          if (n.id !== node.id) return n;
          return {
            ...n,
            properties: {
              ...(n.properties ?? {}),
              ...properties,
            },
          };
        });
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({ workflow: nextWorkflow });
      };
      const updateNodeTitle: WorkflowState["updateNodeTitle"] = (
        itemKey,
        title,
      ) => {
        const { workflow } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        const normalized = title?.trim() ?? "";
        const nextNodes = scope.nodes.map((n) => {
          if (n.id !== node.id) return n;
          const nextProps = { ...(n.properties ?? {}) } as Record<
            string,
            unknown
          >;
          const nextNode = {
            ...n,
            properties: nextProps,
          } as WorkflowNode & { title?: string };
          // node.title is the canonical label. Older builds also mirrored it into
          // properties.title, which nothing reads and which leaked into the bottom
          // "Note" display — scrub that key and keep the label only on node.title.
          delete nextProps.title;
          if (normalized) {
            nextNode.title = normalized;
          } else {
            delete nextNode.title;
          }
          return nextNode as WorkflowNode;
        });
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({ workflow: nextWorkflow });
      };
      const convertImageOutputNode: WorkflowState["convertImageOutputNode"] = (
        itemKey,
        target,
      ) => {
        const { workflow } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        if (node.type !== 'PreviewImage' && node.type !== 'SaveImage') return;
        if (node.type === target) return;
        const nextNodes = scope.nodes.map((n) => {
          if (n.id !== node.id) return n;
          const next: WorkflowNode = {
            ...n,
            type: target,
            properties: { ...(n.properties ?? {}) },
          };
          // Keep %NodeName.widget% text-replacement tokens working: the S&R
          // name follows the type change when it was the default (a custom
          // S&R name is the user's own token — leave it alone).
          if (next.properties["Node name for S&R"] === n.type) {
            next.properties["Node name for S&R"] = target;
          }
          if (target === 'SaveImage') {
            // SaveImage has a single string widget (filename_prefix). Restore
            // a prefix stashed by an earlier convert-to-Preview, else default
            // to "ComfyUI" — matches the built-in node's default.
            const stashed = next.properties["mobile.filenamePrefix"];
            next.widgets_values = [
              typeof stashed === 'string' && stashed ? stashed : 'ComfyUI',
            ];
            delete next.properties["mobile.filenamePrefix"];
          } else {
            // PreviewImage takes no widgets; drop the filename_prefix so the
            // queued prompt doesn't carry stray values the node won't accept,
            // but stash a custom prefix so converting back doesn't lose it.
            const prefix = Array.isArray(n.widgets_values) ? n.widgets_values[0] : undefined;
            if (typeof prefix === 'string' && prefix && prefix !== 'ComfyUI') {
              next.properties["mobile.filenamePrefix"] = prefix;
            }
            delete next.widgets_values;
          }
          return next;
        });
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({ workflow: nextWorkflow });
      };
      const toggleBypass: WorkflowState["toggleBypass"] = (itemKey) => {
        const { workflow } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        const currentMode = node.mode || 0;
        const newMode = currentMode === 4 ? 0 : 4;
        const nextNodes = scope.nodes.map((n) => {
          if (n.id !== node.id) return n;
          return { ...n, mode: newMode };
        });
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({ workflow: nextWorkflow });

        // A bypassed node is excluded from the queued prompt, so it can never be
        // the cause of a real error — clear any stale validation error it carries
        // (e.g. a load-time "missing image option") so it doesn't keep flagging.
        // Validation re-runs on load / queue, so un-bypassing resurfaces it if the
        // value is still invalid.
        if (newMode === 4) {
          const errorsStore = useWorkflowErrorsStore.getState();
          if (errorsStore.nodeErrors[String(node.id)]?.length) {
            errorsStore.clearNodeError(node.id);
            const remaining = Object.values(
              useWorkflowErrorsStore.getState().nodeErrors,
            ).flat();
            if (remaining.length === 0) {
              errorsStore.setError(null);
            } else if (remaining.every((e) => e.type === "workflow_load")) {
              errorsStore.setError(
                remaining.length === 1
                  ? t("Workflow load error: {count} input references missing options.", { count: remaining.length })
                  : t("Workflow load error: {count} inputs reference missing options.", { count: remaining.length }),
                "workflow-load",
              );
            }
          }
        }
      };
      const scrollToNode: WorkflowState["scrollToNode"] = (
        itemKey,
        label,
        flashConnectionDomId,
      ) => {
        const { hiddenItems, workflow, pointerByHierarchicalKey } = get();
        if (!workflow) return;
        const identity = resolveNodeIdentityFromHierarchicalKey(
          workflow,
          itemKey,
          pointerByHierarchicalKey,
        );
        if (!identity) return;
        const nodeId = identity.nodeId;
        const isNodeHidden = Boolean(hiddenItems[itemKey]);
        if (isNodeHidden) {
          get().setItemHidden(itemKey, false);
        }
        if (document.body.dataset.textareaFocus === "true") {
          return;
        }
        get().setItemCollapsed(itemKey, false);
        // If the user starts manually scrolling/dragging after this reveal kicks
        // off, abort: don't keep retrying to find the node or re-correcting the
        // alignment, which would fight them and yank the viewport back.
        const startedAt = Date.now();
        const attemptScroll = (
          attemptsLeft: number,
          delayedAttemptsLeft: number,
        ) => {
          if (userScrolledSince(startedAt)) return;
          const anchor =
            document.getElementById(`node-anchor-${nodeId}`) ??
            document.getElementById(`node-${nodeId}`);
          const nodeEl =
            document.getElementById(`node-card-${nodeId}`) ??
            document.getElementById(`node-${nodeId}`);
          // Retry if element not found, or found but has zero height (inside a collapsed group
          // that hasn't re-expanded yet after revealNodeWithParents updated the state).
          if (!anchor || !nodeEl || nodeEl.getBoundingClientRect().height === 0) {
            if (attemptsLeft > 0) {
              requestAnimationFrame(() =>
                attemptScroll(attemptsLeft - 1, delayedAttemptsLeft),
              );
            } else if (delayedAttemptsLeft > 0) {
              setTimeout(() => attemptScroll(10, delayedAttemptsLeft - 1), 200);
            }
            return;
          }
          const container = anchor.closest<HTMLElement>(
            '[data-node-list="true"]',
          );
          const scrollContainer = container || window;
          let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;
          // Offset of the anchor from the container's top (0 = aligned at top).
          const measureOffset = () =>
            container
              ? anchor.getBoundingClientRect().top -
                container.getBoundingClientRect().top
              : anchor.getBoundingClientRect().top;

          // True once the container can't scroll any further down, in which
          // case a positive offset is as close as the anchor will ever get and
          // correcting toward it just re-runs the settle cycle for nothing.
          const atScrollEnd = () =>
            container
              ? container.scrollTop + container.clientHeight >=
                container.scrollHeight - 1
              : false;

          const alignNow = () => {
            if (container) {
              const targetTop = Math.max(
                0,
                container.scrollTop + measureOffset(),
              );
              container.scrollTo({ top: targetTop, behavior: "smooth" });
            } else {
              anchor.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          };

          const highlight = () => {
            document
              .querySelectorAll(".highlight-pulse")
              .forEach((el) => el.classList.remove("highlight-pulse"));
            nodeEl.classList.add("highlight-pulse");
            setTimeout(() => nodeEl.classList.remove("highlight-pulse"), 1200);
            // Flash the reciprocal connection button in the SAME instant and for
            // the same duration as the node pulse, so the two read as one event.
            document
              .querySelectorAll(".connection-highlight-pulse")
              .forEach((el) => el.classList.remove("connection-highlight-pulse"));
            const connectionEl = flashConnectionDomId
              ? document.getElementById(flashConnectionDomId)
              : null;
            if (connectionEl) {
              connectionEl.classList.add("connection-highlight-pulse");
              setTimeout(
                () => connectionEl.classList.remove("connection-highlight-pulse"),
                1200,
              );
            }
            if ("vibrate" in navigator) navigator.vibrate(10);

            if (label) {
              window.dispatchEvent(
                new CustomEvent("node-show-label", {
                  detail: { nodeId, label },
                }),
              );
            }
          };

          // The destination's connections section is unfolded and its card is
          // un-collapsed (and parents revealed) right before this scroll — those
          // animate open AFTER the initial scroll target is computed, growing the
          // content and leaving the smooth scroll short of (or past) the node.
          // So once scrolling settles, re-measure and correct, bounded, until the
          // anchor actually sits at the top (or we run out of attempts).
          let corrections = 0;
          const MAX_CORRECTIONS = 5;

          // The flash is the arrival cue, so it fires as soon as the node is
          // near enough to read as arrived — not when the scroll has fully
          // settled. Smooth scrolling spends its last stretch easing over a
          // handful of pixels, and waiting that out (plus the settle debounce,
          // plus any corrective pass) put a visible dead beat between the node
          // sliding into place and its outline lighting up.
          const ARRIVAL_SLACK = 24;
          let flashed = false;
          const flashOnArrival = () => {
            if (flashed) return;
            flashed = true;
            highlight();
          };

          const cleanup = () => {
            if (scrollEndTimeout) {
              clearTimeout(scrollEndTimeout);
              scrollEndTimeout = null;
            }
            scrollContainer.removeEventListener(
              "scroll",
              handleScroll as EventListener,
            );
          };

          const finalize = () => {
            cleanup();
            // User took over the scroll — stop correcting (and skip the arrival
            // highlight); they're deliberately looking somewhere else.
            if (userScrolledSince(startedAt)) return;
            const offset = measureOffset();
            // Flash before deciding on a corrective pass: the corrections are
            // sub-card nudges, and gating the cue on them is what made the
            // outline appear long after the node stopped moving.
            flashOnArrival();
            if (
              container &&
              Math.abs(offset) > 2 &&
              corrections < MAX_CORRECTIONS &&
              !(offset > 0 && atScrollEnd())
            ) {
              corrections += 1;
              alignNow();
              watchForSettle();
            }
          };

          function handleScroll() {
            if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
            scrollEndTimeout = setTimeout(finalize, 120);
            if (Math.abs(measureOffset()) <= ARRIVAL_SLACK) flashOnArrival();
          }

          function watchForSettle() {
            scrollContainer.addEventListener(
              "scroll",
              handleScroll as EventListener,
              { passive: true },
            );
            // Fallback in case the corrective growth doesn't emit scroll events.
            scrollEndTimeout = setTimeout(finalize, 200);
          }

          // The destination's card un-collapses and its connections section
          // unfolds as this runs, so measuring immediately aims at a layout
          // that is still growing. Wait for the content height to hold still,
          // then make one smooth move to a target that will not shift.
          let lastHeight = -1;
          let stableFrames = 0;
          const settleThenAlign = (framesLeft: number) => {
            if (userScrolledSince(startedAt)) return;
            const height = container
              ? container.scrollHeight
              : document.documentElement.scrollHeight;
            stableFrames = height === lastHeight ? stableFrames + 1 : 0;
            lastHeight = height;
            if (stableFrames >= 2 || framesLeft <= 0) {
              alignNow();
              // Already parked at the target: no scroll events are coming, so
              // don't sit through the settle fallback before lighting it up.
              if (Math.abs(measureOffset()) <= ARRIVAL_SLACK) flashOnArrival();
              watchForSettle();
              return;
            }
            requestAnimationFrame(() => settleThenAlign(framesLeft - 1));
          };
          settleThenAlign(30);
        };

        attemptScroll(10, 2);
      };
      const showAllHiddenNodes: WorkflowState["showAllHiddenNodes"] = () => {
        set({ hiddenItems: {} });
      };
      const setItemCollapsed: WorkflowState["setItemCollapsed"] = (
        itemKey,
        collapsed,
      ) => {
        set((state) => {
          const canonicalHierarchicalKey =
            state.itemKeyByPointer[itemKey] ?? itemKey;
          const pointerKey = state.pointerByHierarchicalKey[canonicalHierarchicalKey];
          const nextCollapsed = { ...state.collapsedItems };
          if (collapsed) {
            nextCollapsed[canonicalHierarchicalKey] = true;
          } else {
            delete nextCollapsed[itemKey];
            delete nextCollapsed[canonicalHierarchicalKey];
            if (pointerKey) delete nextCollapsed[pointerKey];
          }
          return { collapsedItems: nextCollapsed };
        });
      };
      const bypassAllInContainer: WorkflowState["bypassAllInContainer"] = (
        itemKey,
        bypass,
      ) => {
        const { workflow, pointerByHierarchicalKey } = get();
        if (!workflow) return;
        const resolved = resolveContainerIdentityFromHierarchicalKey(
          workflow,
          itemKey,
          pointerByHierarchicalKey,
        );
        if (!resolved) return;
        if (resolved.type === "group") {
          const targetNodes = collectBypassGroupTargetNodes(
            workflow,
            resolved.groupId,
            resolved.subgraphId,
          );
          if (targetNodes.length === 0) return;
          const rootTargetIds = new Set<number>(
            targetNodes
              .filter((target) => target.subgraphId == null)
              .map((target) => target.nodeId),
          );
          const subgraphTargetsById = new Map<string, Set<number>>();
          for (const target of targetNodes) {
            if (target.subgraphId == null) continue;
            const targetSet = subgraphTargetsById.get(target.subgraphId) ?? new Set<number>();
            targetSet.add(target.nodeId);
            subgraphTargetsById.set(target.subgraphId, targetSet);
          }
          const mode = bypass ? 4 : 0;
          const nextRootNodes = (workflow.nodes ?? []).map((node) =>
            rootTargetIds.has(node.id) ? { ...node, mode } : node,
          );
          const rootChanged = nextRootNodes.some(
            (node, index) => node !== (workflow.nodes ?? [])[index],
          );

          const subgraphs = workflow.definitions?.subgraphs ?? [];
          const nextSubgraphs = subgraphs.map((sg) => {
            const targetIds = subgraphTargetsById.get(sg.id);
            if (!targetIds || targetIds.size === 0) return sg;
            const nextNodes = (sg.nodes ?? []).map((node) =>
              targetIds.has(node.id) ? { ...node, mode } : node,
            );
            const changed = nextNodes.some((n, i) => n !== (sg.nodes ?? [])[i]);
            return changed ? { ...sg, nodes: nextNodes } : sg;
          });
          const subgraphsChanged = nextSubgraphs.some((sg, i) => sg !== subgraphs[i]);
          if (!rootChanged && !subgraphsChanged) return;
          const nextWorkflow = {
            ...workflow,
            ...(rootChanged ? { nodes: nextRootNodes } : {}),
            ...(subgraphsChanged
              ? {
                  definitions: {
                    ...(workflow.definitions ?? {}),
                    subgraphs: nextSubgraphs,
                  },
                }
              : {}),
          };
          set({
            workflow: nextWorkflow,
          });
          return;
        }
        if (resolved.type !== "subgraph") return;
        const targetNodes = collectBypassSubgraphTargetNodes(
          workflow,
          resolved.subgraphId,
        );
        if (targetNodes.length === 0) return;
        const targetIdsBySubgraph = new Map<string, Set<number>>();
        for (const target of targetNodes) {
          if (!target.subgraphId) continue;
          const targetSet = targetIdsBySubgraph.get(target.subgraphId) ?? new Set<number>();
          targetSet.add(target.nodeId);
          targetIdsBySubgraph.set(target.subgraphId, targetSet);
        }
        const mode = bypass ? 4 : 0;
        // In canonical model, subgraph inner nodes are in definitions.subgraphs[i].nodes
        const subgraphs = workflow.definitions?.subgraphs ?? [];
        const nextSubgraphs = subgraphs.map((sg) => {
          const targetIds = targetIdsBySubgraph.get(sg.id);
          if (!targetIds || targetIds.size === 0) return sg;
          const nextNodes = (sg.nodes ?? []).map((node) =>
            targetIds.has(node.id) ? { ...node, mode } : node
          );
          const changed = nextNodes.some((n, i) => n !== (sg.nodes ?? [])[i]);
          return changed ? { ...sg, nodes: nextNodes } : sg;
        });
        const subgraphsChanged = nextSubgraphs.some((sg, i) => sg !== subgraphs[i]);
        if (!subgraphsChanged) return;
        // Also bypass/unbypass the placeholder node in workflow.nodes
        const nextNodes = workflow.nodes.map((node) =>
          node.type === resolved.subgraphId ? { ...node, mode } : node
        );
        const nodesChanged = nextNodes.some((n, i) => n !== workflow.nodes[i]);

        const nextWorkflow = {
          ...workflow,
          ...(nodesChanged ? { nodes: nextNodes } : {}),
          definitions: {
            ...(workflow.definitions ?? {}),
            subgraphs: nextSubgraphs,
          },
        };
        set({
          workflow: nextWorkflow,
        });
      };
      const deleteContainer: WorkflowState["deleteContainer"] = (
        itemKey,
        options,
      ) => {
        const {
          workflow,
          itemKeyByPointer,
          pointerByHierarchicalKey,
        } = get();
        if (!workflow) return;
        const resolved = resolveContainerIdentityFromHierarchicalKey(
          workflow,
          itemKey,
          pointerByHierarchicalKey,
        );
        if (!resolved) return;
        if (resolved.type === "group") {
          const {
            hiddenItems,
            connectionHighlightModes,
            mobileLayout,
            collapsedItems,
          } = get();
          const groupId = resolved.groupId;
          const subgraphId = resolved.subgraphId ?? null;
          const groupHierarchicalKeys = collectGroupHierarchicalKeys(
            mobileLayout,
            groupId,
            subgraphId,
          );
          const keysToRemoveSet = new Set<string>(groupHierarchicalKeys);
          keysToRemoveSet.add(resolved.itemKey);
          const keysToRemove =
            keysToRemoveSet.size > 0
              ? [...keysToRemoveSet]
              : [resolved.itemKey];
          const deleteNodes = options?.deleteNodes ?? false;
          const targetNodes = deleteNodes
            ? collectBypassContainerTargetNodesFromLayout(
                workflow,
                mobileLayout,
                itemKey,
              )
            : [];

          let nextWorkflow: Workflow = workflow;
          if (subgraphId) {
            const subgraphs = workflow.definitions?.subgraphs ?? [];
            const nextSubgraphs = subgraphs.map((subgraph) => {
              if (subgraph.id !== subgraphId) return subgraph;
              return {
                ...subgraph,
                groups: (subgraph.groups ?? []).filter(
                  (group) => group.id !== groupId,
                ),
              };
            });
            nextWorkflow = {
              ...workflow,
              definitions: {
                ...(workflow.definitions ?? {}),
                subgraphs: nextSubgraphs,
              },
            };
          } else {
            nextWorkflow = {
              ...workflow,
              groups: (workflow.groups ?? []).filter(
                (group) => group.id !== groupId,
              ),
            };
          }

          if (targetNodes.length > 0) {
            nextWorkflow = removeNodesFromWorkflow(nextWorkflow, targetNodes);
            // Remove orphaned subgraph definitions, preserving nested descendants
            // that are still reachable from retained root placeholders.
            const nextSubgraphDefsAll = nextWorkflow.definitions?.subgraphs ?? [];
            const definedSubgraphIds = new Set(nextSubgraphDefsAll.map((sg) => sg.id));
            const rootPlaceholderIds = (nextWorkflow.nodes ?? [])
              .map((node) => node.type)
              .filter((type): type is string => definedSubgraphIds.has(type));
            const reachableSubgraphIds = collectDescendantSubgraphs(
              rootPlaceholderIds,
              getSubgraphChildMap(nextWorkflow),
            );
            const nextSubgraphDefs = nextSubgraphDefsAll.filter((sg) =>
              reachableSubgraphIds.has(sg.id),
            );
            if (
              nextSubgraphDefs.length !==
              nextSubgraphDefsAll.length
            ) {
              nextWorkflow = {
                ...nextWorkflow,
                definitions: {
                  ...(nextWorkflow.definitions ?? {}),
                  subgraphs: nextSubgraphDefs,
                },
              };
            }
          }

          const uiCleanup = clearNodeUiStateForTargets(
            workflow,
            itemKeyByPointer,
            hiddenItems,
            connectionHighlightModes,
            targetNodes,
          );
          const nextHiddenItems = uiCleanup.hiddenItems;
          const nextHighlightModes = uiCleanup.connectionHighlightModes;

          const nextMobileLayout = deleteNodes
            ? buildLayoutForWorkflow(
                nextWorkflow,
                layoutRecordFromPointerRecord(nextHiddenItems, pointerByHierarchicalKey),
              )
            : (() => {
                let patched = mobileLayout;
                for (const groupKey of keysToRemove) {
                  patched = removeGroupFromLayoutByKey(
                    patched,
                    groupKey,
                  );
                }
                return patched;
              })();

          const nextCollapsedItems = { ...collapsedItems };
          for (const groupKey of keysToRemove) {
            delete nextCollapsedItems[groupKey];
            delete nextHiddenItems[groupKey];
          }
          const reconciled = reconcilePointerRegistry(
            nextMobileLayout,
            itemKeyByPointer,
            pointerByHierarchicalKey,
          );
          const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
            nextWorkflow,
            reconciled.layoutToStable,
          );

          set({
            workflow: nextWorkflowWithHierarchicalKeys,
            hiddenItems: nextHiddenItems,
            connectionHighlightModes: nextHighlightModes,
            mobileLayout: nextMobileLayout,
            itemKeyByPointer: reconciled.layoutToStable,
            pointerByHierarchicalKey: reconciled.stableToLayout,
            collapsedItems: nextCollapsedItems,
          });
          return;
        }
        if (resolved.type !== "subgraph") return;

        const {
          hiddenItems,
          connectionHighlightModes,
          mobileLayout,
          collapsedItems,
        } = get();

        const deleteNodes = options?.deleteNodes ?? false;
        const subgraphId = resolved.subgraphId;
        const subgraphDefs = workflow.definitions?.subgraphs ?? [];
        const targetSubgraph = subgraphDefs.find((sg) => sg.id === subgraphId);
        if (!targetSubgraph) return;

        const subgraphRef: ItemRef = { type: "subgraph", id: subgraphId };
        const location = findItemInLayout(mobileLayout, subgraphRef);
        const parentSubgraphId = location
          ? getParentSubgraphIdFromContainer(location.containerId, mobileLayout)
          : null;

        if (deleteNodes) {
          const subgraphChildMap = getSubgraphChildMap(workflow);
          const removedSubgraphIds = collectDescendantSubgraphs(
            [subgraphId],
            subgraphChildMap,
          );
          const targetNodes = collectBypassSubgraphTargetNodes(
            workflow,
            subgraphId,
          );
          const uiCleanup = clearNodeUiStateForTargets(
            workflow,
            itemKeyByPointer,
            hiddenItems,
            connectionHighlightModes,
            targetNodes,
          );
          const nextHiddenItems = uiCleanup.hiddenItems;
          const nextHighlightModes = uiCleanup.connectionHighlightModes;

          const nextSubgraphs = subgraphDefs.filter(
            (sg) => !removedSubgraphIds.has(sg.id),
          );

          let nextWorkflow = removeNodesFromWorkflow(workflow, targetNodes);
          nextWorkflow = {
            ...nextWorkflow,
            definitions: {
              ...(nextWorkflow.definitions ?? {}),
              subgraphs: nextSubgraphs,
            },
          };

          const nextLayout = buildLayoutForWorkflow(
            nextWorkflow,
            layoutRecordFromPointerRecord(nextHiddenItems, pointerByHierarchicalKey),
          );
          const reconciled = reconcilePointerRegistry(
            nextLayout,
            itemKeyByPointer,
            pointerByHierarchicalKey,
          );
          const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
            nextWorkflow,
            reconciled.layoutToStable,
          );
          const nextCollapsedItems = { ...collapsedItems };
          const nextHiddenSubgraphs = { ...nextHiddenItems };
          const removedSubgraphHierarchicalKeys = new Set(
            subgraphDefs
              .filter((sg) => removedSubgraphIds.has(sg.id))
              .map((sg) => sg.itemKey)
              .filter((key): key is string => typeof key === "string"),
          );
          for (const removedHierarchicalKey of removedSubgraphHierarchicalKeys) {
            delete nextCollapsedItems[removedHierarchicalKey];
            delete nextHiddenSubgraphs[removedHierarchicalKey];
          }

          set({
            workflow: nextWorkflowWithHierarchicalKeys,
            hiddenItems: nextHiddenSubgraphs,
            connectionHighlightModes: nextHighlightModes,
            mobileLayout: nextLayout,
            itemKeyByPointer: reconciled.layoutToStable,
            pointerByHierarchicalKey: reconciled.stableToLayout,
            collapsedItems: nextCollapsedItems,
          });
          return;
        }

        // Delete container only: dissolve the placeholder — promote inner
        // nodes/links/groups into the parent scope with fresh IDs, bridge the
        // boundary connections, and bake promoted widget values into the
        // promoted nodes.
        const dissolved = dissolveSubgraph(
          workflow,
          subgraphId,
          parentSubgraphId,
          get().nodeTypes,
        );
        if (!dissolved) return;
        const idMap = dissolved.groupIdMap;
        const nextWorkflow = dissolved.workflow;

        const nextLayout = buildLayoutForWorkflow(
          nextWorkflow,
          layoutRecordFromPointerRecord(
            hiddenItems,
            pointerByHierarchicalKey,
          ),
        );
        const reconciled = reconcilePointerRegistry(
          nextLayout,
          itemKeyByPointer,
          pointerByHierarchicalKey,
        );
        const nextCollapsedItems = { ...collapsedItems };
        const nextHiddenSubgraphs = { ...hiddenItems };
        const deletedSubgraphHierarchicalKey =
          targetSubgraph.itemKey ?? findSubgraphHierarchicalKey(workflow, subgraphId);
        if (deletedSubgraphHierarchicalKey) {
          delete nextCollapsedItems[deletedSubgraphHierarchicalKey];
          delete nextHiddenSubgraphs[deletedSubgraphHierarchicalKey];
        }

        // Remap any persisted group state that referenced promoted group ids from the deleted subgraph scope.
        const remapGroupState = (
          state: Record<string, boolean>,
        ): Record<string, boolean> => {
          const nextState: Record<string, boolean> = {};
          for (const [itemKey, value] of Object.entries(state)) {
            if (!value) continue;
            const identity = resolveContainerIdentityFromHierarchicalKey(
              workflow,
              itemKey,
              pointerByHierarchicalKey,
            );
            if (identity?.type === "group" && identity.subgraphId === subgraphId) {
              const mappedId = idMap.get(identity.groupId);
              if (mappedId == null) continue;
              const mappedKeys = collectGroupHierarchicalKeys(
                nextLayout,
                mappedId,
                parentSubgraphId,
              );
              for (const mappedKey of mappedKeys) {
                nextState[mappedKey] = true;
              }
              continue;
            }
            nextState[itemKey] = true;
          }
          return nextState;
        };

        const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
          nextWorkflow,
          reconciled.layoutToStable,
        );
        set(() => ({
          workflow: nextWorkflowWithHierarchicalKeys,
          mobileLayout: nextLayout,
          itemKeyByPointer: reconciled.layoutToStable,
          pointerByHierarchicalKey: reconciled.stableToLayout,
          collapsedItems: remapGroupState(nextCollapsedItems),
          hiddenItems: nextHiddenSubgraphs,
        }));
      };
      const updateContainerTitle: WorkflowState["updateContainerTitle"] = (
        itemKey,
        title,
      ) => {
        const { workflow, pointerByHierarchicalKey } = get();
        if (!workflow) return;
        const resolved = resolveContainerIdentityFromHierarchicalKey(
          workflow,
          itemKey,
          pointerByHierarchicalKey,
        );
        if (!resolved) return;
        const nextTitle = title.trim();
        if (resolved.type === "group") {
          const { groupId, subgraphId } = resolved;
          if (subgraphId) {
            const subgraphs = workflow.definitions?.subgraphs ?? [];
            const nextSubgraphs = subgraphs.map((subgraph) => {
              if (subgraph.id !== subgraphId) return subgraph;
              const groups = subgraph.groups ?? [];
              const nextGroups = groups.map((group) =>
                group.id === groupId ? { ...group, title: nextTitle } : group,
              );
              return { ...subgraph, groups: nextGroups };
            });
            useWorkflowErrorsStore.getState().setError(null);
            const nextWorkflow = {
              ...workflow,
              definitions: {
                ...(workflow.definitions ?? {}),
                subgraphs: nextSubgraphs,
              },
            };
            set({
              workflow: nextWorkflow,
            });
            return;
          }
          const nextGroups = (workflow.groups ?? []).map((group) =>
            group.id === groupId ? { ...group, title: nextTitle } : group,
          );
          const nextWorkflow = { ...workflow, groups: nextGroups };
          set({
            workflow: nextWorkflow,
          });
          return;
        }
        if (resolved.type === "subgraph") {
          const subgraphId = resolved.subgraphId;
          const subgraphs = workflow.definitions?.subgraphs ?? [];
          const nextSubgraphs = subgraphs.map((subgraph) =>
            subgraph.id === subgraphId
              ? { ...subgraph, name: nextTitle }
              : subgraph,
          );
          const nextWorkflow = {
            ...workflow,
            definitions: {
              ...(workflow.definitions ?? {}),
              subgraphs: nextSubgraphs,
            },
          };
          set({
            workflow: nextWorkflow,
          });
        }
      };
      const updateWorkflowItemColor: WorkflowState["updateWorkflowItemColor"] = (
        itemKey,
        color,
      ) => {
        const { workflow, pointerByHierarchicalKey } = get();
        if (!workflow) return;
        const resolved = resolveContainerIdentityFromHierarchicalKey(
          workflow,
          itemKey,
          pointerByHierarchicalKey,
        );
        const nextColor = resolveWorkflowColor(color.trim());
        if (!nextColor) return;

        if (resolved) {
          if (resolved.type === "group") {
            const { groupId, subgraphId } = resolved;
            if (subgraphId) {
              const subgraphs = workflow.definitions?.subgraphs ?? [];
              const nextSubgraphs = subgraphs.map((subgraph) => {
                if (subgraph.id !== subgraphId) return subgraph;
                const groups = subgraph.groups ?? [];
                const nextGroups = groups.map((group) =>
                  group.id === groupId ? { ...group, color: nextColor } : group,
                );
                return { ...subgraph, groups: nextGroups };
              });
              const nextWorkflow = {
                ...workflow,
                definitions: {
                  ...(workflow.definitions ?? {}),
                  subgraphs: nextSubgraphs,
                },
              };
              set({
                workflow: nextWorkflow,
              });
              return;
            }

            const nextGroups = (workflow.groups ?? []).map((group) =>
              group.id === groupId ? { ...group, color: nextColor } : group,
            );
            const nextWorkflow = { ...workflow, groups: nextGroups };
            set({
              workflow: nextWorkflow,
            });
            return;
          }

          if (resolved.type === "subgraph") {
            const noColorValue = resolveWorkflowColor("nocolor");
            const nextSubgraphColor =
              nextColor === noColorValue ? themeColors.brand.blue500 : nextColor;
            const nextSubgraphs = (workflow.definitions?.subgraphs ?? []).map(
              (subgraph) => {
                if (subgraph.id !== resolved.subgraphId) return subgraph;
                return {
                  ...subgraph,
                  state: {
                    ...(subgraph.state ?? {}),
                    color: nextSubgraphColor,
                  },
                };
              },
            );
            const nextWorkflow = {
              ...workflow,
              definitions: {
                ...(workflow.definitions ?? {}),
                subgraphs: nextSubgraphs,
              },
            };
            set({
              workflow: nextWorkflow,
            });
            return;
          }
        }

        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const targetNode = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!targetNode) return;
        const nextNodes = scope.nodes.map((n) => {
          if (n.id !== targetNode.id) return n;
          return { ...n, color: nextColor, bgcolor: nextColor };
        });
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({
          workflow: nextWorkflow,
        });
      };

  return {
    cycleConnectionHighlight,
    setConnectionHighlightMode,
    setItemHidden,
    revealNodeWithParents,
    updateNodeWidget,
    renameSetGetNode,
    updateNodeWidgets,
    updateSubgraphInnerNodeWidget,
    updateNodeProperties,
    updateNodeTitle,
    convertImageOutputNode,
    toggleBypass,
    scrollToNode,
    showAllHiddenNodes,
    setItemCollapsed,
    bypassAllInContainer,
    deleteContainer,
    updateContainerTitle,
    updateWorkflowItemColor,
  };
}
