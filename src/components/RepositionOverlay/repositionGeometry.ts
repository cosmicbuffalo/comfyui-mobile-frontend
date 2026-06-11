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
  return `subgraph-${target.id}`;
}

export function itemRefToDataKey(ref: ItemRef): string {
  if (ref.type === "node") return `node-${ref.id}`;
  if (ref.type === "group") return `group-${getGroupKey(ref.id, ref.subgraphId)}`;
  if (ref.type === "subgraph") return `subgraph-${ref.id}`;
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

/** Collect all group and subgraph container IDs from the layout. */
export function collectAllContainerIds(layout: MobileLayout): {
  groupKeys: string[];
  subgraphIds: string[];
} {
  return {
    groupKeys: Object.keys(layout.groups),
    subgraphIds: Object.keys(layout.subgraphs),
  };
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
