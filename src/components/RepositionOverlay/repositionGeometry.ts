/**
 * Pure geometry, layout-search, and key helpers for the reposition overlay's
 * drag machinery. Extracted from RepositionOverlay.tsx so the container/insert
 * math is isolated and testable. No React, no component state.
 *
 * Note: findGroupSubgraphIdInLayout intentionally differs from
 * canonicalWorkflowOps/workflowHierarchy's findGroupSubgraphIdByHierarchicalKey
 * — it adds a layout tree-walk fallback when groupParents lacks an entry.
 */
import type { MobileLayout, ItemRef, ContainerId } from "@/utils/mobileLayout";
import { getGroupKey, makeLocationPointer } from "@/utils/mobileLayout";
import type { RepositionTarget } from "@/hooks/useRepositionMode";

export function findGroupHierarchicalKeyInLayout(
  layout: MobileLayout,
  groupId: number,
  subgraphId: string | null
): string | null {
  let firstMatch: string | null = null;
  const visit = (refs: ItemRef[], currentSubgraphId: string | null): string | null => {
    for (const ref of refs) {
      if (ref.type === "group") {
        if (ref.id === groupId && firstMatch == null) {
          firstMatch = getGroupKey(ref.id, ref.subgraphId);
        }
        if (ref.id === groupId && currentSubgraphId === subgraphId) {
          return getGroupKey(ref.id, ref.subgraphId);
        }
        const nested = visit(layout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [], currentSubgraphId);
        if (nested) return nested;
        continue;
      }
      if (ref.type === "subgraph") {
        const nested = visit(layout.subgraphs[ref.id] ?? [], ref.id);
        if (nested) return nested;
      }
    }
    return null;
  };
  return visit(layout.root, null) ?? firstMatch;
}

export function findGroupSubgraphIdInLayout(
  layout: MobileLayout,
  groupHierarchicalKey: string
): string | null {
  const parent = layout.groupParents?.[groupHierarchicalKey];
  if (!parent) {
    const visit = (refs: ItemRef[], currentSubgraphId: string | null): string | null => {
      for (const ref of refs) {
        if (ref.type === "group") {
          if (getGroupKey(ref.id, ref.subgraphId) === groupHierarchicalKey) return currentSubgraphId;
          const nested = visit(layout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [], currentSubgraphId);
          if (nested !== null) return nested;
          continue;
        }
        if (ref.type === "subgraph") {
          const nested = visit(layout.subgraphs[ref.id] ?? [], ref.id);
          if (nested !== null) return nested;
        }
      }
      return null;
    };
    return visit(layout.root, null);
  }
  if (parent.scope === "subgraph") return parent.subgraphId;
  if (parent.scope === "root") return null;
  return findGroupSubgraphIdInLayout(layout, parent.groupKey);
}

/**
 * The reposition key for a subgraph placeholder.
 *
 * Keyed by the INSTANCE, not the definition. Every instance of a shared type
 * used to render the same `subgraph-<definition>` key, so the twenty-three
 * placeholders in a workflow with two shared types produced two distinct keys
 * between them: `querySelector` found the first one whatever you had grabbed,
 * and a drag resolved to whichever instance the layout listed first.
 *
 * The definition alone is still the key for a subgraph used as a CONTAINER,
 * where the contents genuinely are shared, so the two forms are distinguished
 * by the separator rather than by guessing.
 */
export function subgraphDataKey(subgraphId: string, nodeId?: number): string {
  return nodeId == null ? `subgraph-${subgraphId}` : `subgraph-${subgraphId}::${nodeId}`;
}

/** The definition id and instance a subgraph key names. */
export function parseSubgraphDataKey(key: string): { id: string; nodeId?: number } {
  const body = key.slice("subgraph-".length);
  const separator = body.lastIndexOf("::");
  if (separator === -1) return { id: body };
  const nodeId = Number(body.slice(separator + 2));
  return Number.isFinite(nodeId)
    ? { id: body.slice(0, separator), nodeId }
    : { id: body };
}

export function targetToDataKey(target: RepositionTarget, layout?: MobileLayout): string {
  if (target.type === "node") return `node-${target.id}`;
  if (target.type === "group") {
    const groupKey = layout
      ? findGroupHierarchicalKeyInLayout(layout, target.id, target.subgraphId ?? null)
      : null;
    if (groupKey) return `group-${groupKey}`;
    return `group-${makeLocationPointer({
      type: "group",
      groupId: target.id,
      subgraphId: target.subgraphId ?? null,
    })}`;
  }
  return subgraphDataKey(target.id, target.nodeId);
}

export function itemRefToDataKey(ref: ItemRef): string {
  if (ref.type === "node") return `node-${ref.id}`;
  if (ref.type === "group") return `group-${getGroupKey(ref.id, ref.subgraphId)}`;
  if (ref.type === "subgraph") return subgraphDataKey(ref.id, ref.nodeId);
  return `hidden-${ref.blockId}`;
}

export function containerIdEquals(a: ContainerId, b: ContainerId): boolean {
  if (a.scope !== b.scope) return false;
  if (a.scope === "root") return true;
  if (a.scope === "group" && b.scope === "group") return a.groupKey === b.groupKey;
  if (a.scope === "subgraph" && b.scope === "subgraph")
    return a.subgraphId === b.subgraphId;
  return false;
}

export function containerIdToKey(c: ContainerId): string {
  if (c.scope === "root") return "root";
  if (c.scope === "group") return `group-${c.groupKey}`;
  return `subgraph-${c.subgraphId}`;
}

/**
 * Every group in the layout, as drop targets for a drag.
 *
 * Groups only. A subgraph is a scope rather than a container you can drop into
 * from outside — putting a node inside one moves it to another graph, with its
 * connections rewritten to cross the boundary, which is what **Move into
 * subgraph** does. A drag cannot express any of that, and the placeholder cards
 * this list used to include are drawn as leaves anyway.
 */
export function collectAllGroupKeys(layout: MobileLayout): string[] {
  return Object.keys(layout.groups);
}

export interface IndexedBounds {
  idx: number;
  top: number;
  bottom: number;
  height: number;
}

export function collectSiblingBounds(
  container: HTMLElement,
  itemKeys: string[],
  excludedKey?: string,
): IndexedBounds[] {
  const siblings: IndexedBounds[] = [];
  itemKeys.forEach((key, idx) => {
    if (key === excludedKey) return;
    const el = container.querySelector(
      `[data-reposition-item="${key}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    siblings.push({
      idx,
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
    });
  });
  return siblings;
}

export function isContainerEnteredByDrag(
  draggedRect: DOMRect,
  containerRect: DOMRect,
  thresholdRatio: number,
): boolean {
  const overlapTop = Math.max(draggedRect.top, containerRect.top);
  const overlapBottom = Math.min(draggedRect.bottom, containerRect.bottom);
  const overlapHeight = Math.max(0, overlapBottom - overlapTop);
  return overlapHeight >= draggedRect.height * thresholdRatio;
}

export function isWithinContainerByBoundaryRows(
  draggedRect: DOMRect,
  containerRect: DOMRect,
  headerRect: DOMRect | null,
  footerRect: DOMRect | null,
  movingDown: boolean,
  thresholdRatio: number,
): boolean {
  const intersectsContainer =
    draggedRect.bottom >= containerRect.top &&
    draggedRect.top <= containerRect.bottom;
  if (!intersectsContainer) return false;

  // Fallback for containers without measurable boundary rows.
  if (!headerRect || !footerRect) {
    return isContainerEnteredByDrag(draggedRect, containerRect, thresholdRatio);
  }

  if (movingDown) {
    const enteredThroughHeader =
      draggedRect.bottom > headerRect.top + headerRect.height * thresholdRatio;
    const exitedThroughFooter =
      draggedRect.bottom > footerRect.top + footerRect.height * thresholdRatio;
    return enteredThroughHeader && !exitedThroughFooter;
  }

  const enteredThroughFooter =
    draggedRect.top < footerRect.bottom - footerRect.height * thresholdRatio;
  const exitedThroughHeader =
    draggedRect.top < headerRect.bottom - headerRect.height * thresholdRatio;
  return enteredThroughFooter && !exitedThroughHeader;
}

export function computeInsertPositionByThreshold(
  siblings: IndexedBounds[],
  movingDown: boolean,
  draggedTop: number,
  draggedBottom: number,
  thresholdRatio: number,
): number {
  if (siblings.length === 0) return 0;
  if (movingDown) {
    let insertAt = 0;
    for (const sibling of siblings) {
      const passThreshold = sibling.top + sibling.height * thresholdRatio;
      if (draggedBottom > passThreshold) {
        insertAt = sibling.idx + 1;
        continue;
      }
      break;
    }
    return insertAt;
  }
  let insertAt = siblings.length;
  for (let i = siblings.length - 1; i >= 0; i -= 1) {
    const sibling = siblings[i];
    const passThreshold = sibling.bottom - sibling.height * thresholdRatio;
    if (draggedTop < passThreshold) {
      insertAt = sibling.idx;
      continue;
    }
    break;
  }
  return insertAt;
}
