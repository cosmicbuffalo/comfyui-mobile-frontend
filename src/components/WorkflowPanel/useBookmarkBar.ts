import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import type { NodeTypes, Workflow } from "@/api/types";
import { useBookmarksStore } from "@/hooks/useBookmarks";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { getGroupKey, scopedNodeKey, type ItemRef } from "@/utils/mobileLayout";
import { requireHierarchicalKey } from "@/utils/itemKeys";
import {
  findWorkflowNodeInScope,
  resolveWorkflowNodeDisplayName,
} from "@/utils/subgraphPlaceholderLabels";
import { resolveWorkflowColor } from "@/theme/colors";
import {
  GROUP_TINT_ALPHA,
  PANEL_SURFACE,
  compositeOver,
  groupBorderSurface,
  groupHeaderSurface,
  nodeCardBorderSurface,
  nodeCardSurface,
} from "@/utils/workflowSurfaceColor";

/** Highest the bookmark bar may sit inside the panel. */
const BOOKMARK_BAR_MIN_TOP = 16;
/** Gap kept between the bottom of the bar and the bottom bar. */
const BOOKMARK_BAR_BOTTOM_GAP = 8;
/**
 * Below this many bookmarks the gutter carries only the forward cycle button:
 * a short list is quick to step through in one direction, and a second pinned
 * control would eat more of the gutter than it earns.
 */
const BOOKMARK_REVERSE_CYCLE_MIN = 6;
/**
 * Depth of the fade at each end of the scrolling bookmark list, and of the tap
 * zone that scrolls it. Matches the tab bar's edge-indicator treatment.
 */
const BOOKMARK_EDGE_FADE = 28;
/**
 * Momentum scrolling settles at fractional offsets, so "fully scrolled" often
 * reads a fraction of a pixel short. Without this the fade lingers at ~1% and
 * its tap zone keeps swallowing presses meant for the end bookmark.
 */
const BOOKMARK_EDGE_EPSILON = 2;

/** How far a press may drift and still count as a tap rather than a drag. */
const BOOKMARK_TAP_SLOP = 6;

/** Height of the exit-subgraph button, matching the collapsed gutter button. */
const BOOKMARK_BAR_EXIT_BUTTON_SIZE = 40;
/** The gap stacked connection buttons keep in the node cards (`gap-1.5`). */
const CONTROL_STACK_GAP = 6;
/** How far the reposition outline and its wash are painted outside the bar. */
const BOOKMARK_REPOSITION_HALO = 6;

/**
 * Height the desktop left gutter gives up to the exit-subgraph button, which is
 * pinned at its top and has to stay reachable however the bar is arranged. The
 * bar starts below it rather than beside it: the gutter is one column, and
 * stepping sideways out of it would put the bar over the node list.
 *
 * The gap left is the one two stacked circular buttons keep everywhere else in
 * the app — measured from the bar's outermost painted edge, so the reposition
 * outline crowds the button no more than the bar itself does.
 */
const BOOKMARK_BAR_EXIT_CLEARANCE =
  BOOKMARK_BAR_EXIT_BUTTON_SIZE + CONTROL_STACK_GAP + BOOKMARK_REPOSITION_HALO;

type BookmarksState = ReturnType<typeof useBookmarksStore.getState>;
type WorkflowStoreState = ReturnType<typeof useWorkflowStore.getState>;

interface BookmarkBarDeps {
  workflow: Workflow | null;
  nodeTypes: NodeTypes | null;
  isDesktop: boolean;
  mobileLayout: WorkflowStoreState["mobileLayout"];
  nodeItemKeyByScopedKey: Map<string, string>;
  subgraphItemKeyById: Map<string, string>;
  jumpToWorkflowItem: WorkflowStoreState["jumpToWorkflowItem"];
  revealNodeWithParents: WorkflowStoreState["revealNodeWithParents"];
  bookmarkedItems: BookmarksState["bookmarkedItems"];
  bookmarkBarSide: BookmarksState["bookmarkBarSide"];
  bookmarkBarTop: BookmarksState["bookmarkBarTop"];
  setBookmarkBarPosition: BookmarksState["setBookmarkBarPosition"];
  bookmarkBarCollapsed: BookmarksState["bookmarkBarCollapsed"];
  bookmarkBarCollapsedTop: BookmarksState["bookmarkBarCollapsedTop"];
  /**
   * True while the desktop exit-subgraph button occupies the top of the left
   * gutter, so the bar starts below it instead of on top of it.
   */
  leftGutterReserved: boolean;
  setBookmarkBarCollapsed: BookmarksState["setBookmarkBarCollapsed"];
  wrapperRef: RefObject<HTMLDivElement | null>;
  previousTopBarHeightRef: RefObject<number | null>;
  topBarHeight: number;
}

export function useBookmarkBar(deps: BookmarkBarDeps) {
  const {
    workflow,
    nodeTypes,
    isDesktop,
    mobileLayout,
    nodeItemKeyByScopedKey,
    subgraphItemKeyById,
    jumpToWorkflowItem,
    bookmarkedItems,
    bookmarkBarSide,
    bookmarkBarTop,
    setBookmarkBarPosition,
    bookmarkBarCollapsed,
    bookmarkBarCollapsedTop,
    leftGutterReserved,
    setBookmarkBarCollapsed,
    wrapperRef,
    previousTopBarHeightRef,
    topBarHeight,
  } = deps;

  const [bookmarkCycleIndex, setBookmarkCycleIndex] = useState(0);
  const [isBookmarkRepositioning, setIsBookmarkRepositioning] = useState(false);
  const [isBookmarkDragging, setIsBookmarkDragging] = useState(false);
  // Mirrored in a ref as well as state: `pointerup` can land before React has
  // re-rendered the final `pointermove`, so a handler reading state would
  // finalise a fast flick from a stale position — flinging the bar across the
  // midline and back to the side it started on. The ref is written
  // synchronously on every move, so it is always the position the finger last
  // had.
  const latestBookmarkDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const [bookmarkDragPosition, setBookmarkDragPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const bookmarkBarRef = useRef<HTMLDivElement>(null);

  const bookmarkLongPressRef = useRef<number | null>(null);
  const bookmarkLongPressTriggeredRef = useRef(false);
  const bookmarkPointerRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    pointerId: number;
    isButtonPress: boolean;
    /**
     * Whether reposition mode was already on when this press began. A press
     * that STARTED the mode ends with the finger still down, and must not be
     * read as the tap that finishes it.
     */
    startedInRepositioning: boolean;
  } | null>(null);
  const bookmarkDragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  // `color` is the raw workflow colour; `surfaceColor` / `borderColor` are the
  // opaque colours that item actually paints in the panel, so a bookmark chip
  // reproduces it exactly instead of showing the same hue at a different
  // strength. Note a node card's outline is a neutral white wash, not its
  // colour at all. See utils/workflowSurfaceColor.ts.
  type BookmarkSurface = { surfaceColor: string; borderColor: string };
  type BookmarkParent = BookmarkSurface & {
    itemKey: string;
    label: string;
    color: string;
    type: "group" | "subgraph";
  };
  type BookmarkEntry =
    | (BookmarkSurface & { itemKey: string; type: "node"; nodeId: number; subgraphId: string | null; text: string; compactText: string; color: string; parents: BookmarkParent[] })
    | (BookmarkSurface & { itemKey: string; type: "group"; groupId: number; subgraphId: string | null; groupKey: string; text: string; compactText: string; color: string; parents: BookmarkParent[] })
    | (BookmarkSurface & { itemKey: string; type: "subgraph"; subgraphId: string; text: string; compactText: string; color: string; parents: BookmarkParent[] });

  const bookmarkEntryByHierarchicalKey = useMemo(() => {
    const byHierarchicalKey = new Map<string, BookmarkEntry>();
    const visitedGroups = new Set<string>();
    const visitedSubgraphs = new Set<string>();
    const resolveGroupTitle = (groupId: number, subgraphId: string | null) => {
      const groups = subgraphId
        ? workflow?.definitions?.subgraphs?.find((entry) => entry.id === subgraphId)?.groups
        : workflow?.groups;
      return groups?.find((group) => group.id === groupId)?.title?.trim() || `Group ${groupId}`;
    };
    const resolveGroupColor = (groupId: number, subgraphId: string | null) => {
      const groups = subgraphId
        ? workflow?.definitions?.subgraphs?.find((entry) => entry.id === subgraphId)?.groups
        : workflow?.groups;
      return resolveWorkflowColor(
        groups?.find((group) => group.id === groupId)?.color,
      );
    };
    const resolveRawNodeColor = (node: ReturnType<typeof findWorkflowNodeInScope>) => {
      const rawColor = typeof node?.bgcolor === "string" && node.bgcolor.trim()
        ? node.bgcolor
        : typeof node?.color === "string"
          ? node.color
          : undefined;
      return rawColor?.trim() ? rawColor : undefined;
    };
    const resolveNodeColor = (node: ReturnType<typeof findWorkflowNodeInScope>) =>
      resolveWorkflowColor(resolveRawNodeColor(node));
    // Each enclosing *group* paints its wrapper fill before its children draw on
    // top, so the colour a card ends up rendering depends on the whole chain.
    // Subgraphs are a separate scope rather than a nested surface, so they add
    // no layer.
    const backdropFor = (parents: BookmarkParent[]) =>
      parents.reduce(
        (backdrop, parent) =>
          parent.type === "group"
            ? compositeOver(parent.color, GROUP_TINT_ALPHA, backdrop)
            : backdrop,
        PANEL_SURFACE,
      );
    const resolveNodeSurface = (
      node: ReturnType<typeof findWorkflowNodeInScope>,
      parents: BookmarkParent[],
    ): BookmarkSurface => {
      const surfaceColor = nodeCardSurface(
        resolveNodeColor(node),
        Boolean(resolveRawNodeColor(node)),
        backdropFor(parents),
      );
      return { surfaceColor, borderColor: nodeCardBorderSurface(surfaceColor) };
    };
    const resolveGroupSurface = (
      groupId: number,
      subgraphId: string | null,
      parents: BookmarkParent[],
    ): BookmarkSurface => {
      const groupColor = resolveGroupColor(groupId, subgraphId);
      const backdrop = backdropFor(parents);
      return {
        surfaceColor: groupHeaderSurface(groupColor, backdrop),
        borderColor: groupBorderSurface(groupColor, backdrop),
      };
    };
    const visit = (
      refs: ItemRef[],
      currentSubgraphId: string | null,
      parents: BookmarkParent[],
    ) => {
      refs.forEach((ref) => {
        if (ref.type === "node") {
          const itemKey = requireHierarchicalKey(
            nodeItemKeyByScopedKey.get(scopedNodeKey(ref.id, currentSubgraphId)),
            `layout node ref ${ref.id}`,
          );
          const node = findWorkflowNodeInScope(workflow, ref.id, currentSubgraphId);
          byHierarchicalKey.set(itemKey, {
            itemKey,
            type: "node",
            nodeId: ref.id,
            subgraphId: currentSubgraphId,
            text: node
              ? resolveWorkflowNodeDisplayName(workflow, node, nodeTypes)
              : String(ref.id),
            compactText: String(ref.id),
            color: resolveNodeColor(node),
            ...resolveNodeSurface(node, parents),
            parents,
          });
          return;
        }
        if (ref.type === "group") {
          const itemKey = getGroupKey(ref.id, ref.subgraphId);
          if (itemKey) {
            byHierarchicalKey.set(itemKey, {
              itemKey,
              type: "group",
              groupId: ref.id,
              subgraphId: currentSubgraphId,
              groupKey: getGroupKey(ref.id, ref.subgraphId),
              text: resolveGroupTitle(ref.id, currentSubgraphId),
              compactText: `G${ref.id}`,
              color: resolveGroupColor(ref.id, currentSubgraphId),
              ...resolveGroupSurface(ref.id, currentSubgraphId, parents),
              parents,
            });
          }
          if (visitedGroups.has(getGroupKey(ref.id, ref.subgraphId))) return;
          visitedGroups.add(getGroupKey(ref.id, ref.subgraphId));
          visit(
            mobileLayout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [],
            currentSubgraphId,
            [
              ...parents,
              {
                itemKey,
                label: resolveGroupTitle(ref.id, currentSubgraphId),
                color: resolveGroupColor(ref.id, currentSubgraphId),
                ...resolveGroupSurface(ref.id, currentSubgraphId, parents),
                type: "group",
              },
            ],
          );
          return;
        }
        if (ref.type === "subgraph") {
          // Key the entry by the PLACEHOLDER's own itemKey, not the subgraph
          // definition's. A subgraph is bookmarked through its placeholder
          // card, and NodeCard toggles `node.itemKey` — so a definition-keyed
          // entry matched nothing in `bookmarkedItems` and the mark never
          // appeared in the gutter. It is also the only key that identifies
          // ONE instance: every placeholder of a reusable type shares the
          // definition key, and jumpToWorkflowItem resolves a node identity
          // from what it is given, which a definition key has never had.
          // The definition key remains the fallback for a legacy layout ref
          // that recorded no placeholder id.
          const placeholderItemKey = typeof ref.nodeId === "number"
            ? nodeItemKeyByScopedKey.get(scopedNodeKey(ref.nodeId, currentSubgraphId))
            : undefined;
          const itemKey = requireHierarchicalKey(
            placeholderItemKey ?? subgraphItemKeyById.get(ref.id),
            `layout subgraph ref ${ref.id}`,
          );
          const scopedNodes = currentSubgraphId
            ? workflow?.definitions?.subgraphs?.find(
                (entry) => entry.id === currentSubgraphId,
              )?.nodes
            : workflow?.nodes;
          const placeholder = typeof ref.nodeId === "number"
            ? findWorkflowNodeInScope(workflow, ref.nodeId, currentSubgraphId)
            : scopedNodes?.find((node) => node.type === ref.id) ?? null;
          const subgraphName = placeholder
            ? resolveWorkflowNodeDisplayName(workflow, placeholder, nodeTypes)
            : workflow?.definitions?.subgraphs?.find((entry) => entry.id === ref.id)?.name?.trim()
              || "Subgraph";
          byHierarchicalKey.set(itemKey, {
            itemKey,
            type: "subgraph",
            subgraphId: ref.id,
            text: subgraphName,
            compactText: "SG",
            color: resolveNodeColor(placeholder),
            // A subgraph is bookmarked through its placeholder, which renders
            // as a NodeCard.
            ...resolveNodeSurface(placeholder, parents),
            parents,
          });
          if (visitedSubgraphs.has(ref.id)) return;
          visitedSubgraphs.add(ref.id);
          visit(mobileLayout.subgraphs[ref.id] ?? [], ref.id, [
            ...parents,
            {
              itemKey,
              label: subgraphName,
              color: resolveNodeColor(placeholder),
              ...resolveNodeSurface(placeholder, parents),
              type: "subgraph",
            },
          ]);
        }
      });
    };
    visit(mobileLayout.root, null, []);
    return byHierarchicalKey;
  }, [mobileLayout, nodeItemKeyByScopedKey, nodeTypes, subgraphItemKeyById, workflow]);

  const bookmarkEntries = useMemo<BookmarkEntry[]>(
    () =>
      Array.from(bookmarkEntryByHierarchicalKey.values()).filter((entry) =>
        bookmarkedItems.includes(entry.itemKey),
      ),
    [bookmarkEntryByHierarchicalKey, bookmarkedItems],
  );

  const revealBookmarkButton = useCallback(
    (itemKey: string, behavior: ScrollBehavior) => {
      const button = document.querySelector<HTMLElement>(
        `[data-bookmark-flash-key="${CSS.escape(itemKey)}"]`,
      );
      const list = button?.closest<HTMLElement>('[data-bookmark-scroll="true"]');
      if (!button || !list) return button ?? null;
      const buttonBox = button.getBoundingClientRect();
      const listBox = list.getBoundingClientRect();
      // Clear the edge fade, not just the edge: stopping flush with the
      // container would leave the bookmark sitting under the opacity ramp and
      // flashing half-faded. Capped so the two limits can't cross on a list
      // barely taller than one bookmark; at either end of the list the scroll
      // clamps anyway, and the fade there is gone.
      const buffer = Math.min(
        BOOKMARK_EDGE_FADE,
        Math.max(0, (listBox.height - buttonBox.height) / 2),
      );
      const topLimit = listBox.top + buffer;
      const bottomLimit = listBox.bottom - buffer;
      const delta =
        buttonBox.top < topLimit
          ? buttonBox.top - topLimit
          : buttonBox.bottom > bottomLimit
            ? buttonBox.bottom - bottomLimit
            : 0;
      if (delta) list.scrollTo({ top: list.scrollTop + delta, behavior });
      return button;
    },
    [],
  );

  const flashBookmarkButton = useCallback((itemKey: string) => {
    // Snap rather than animate: by now the smooth reveal started at click time
    // has had the whole scroll-and-settle to land.
    const button = revealBookmarkButton(itemKey, "auto");
    if (!button) return;
    document
      .querySelectorAll(".bookmark-highlight-pulse")
      .forEach((el) => el.classList.remove("bookmark-highlight-pulse"));
    button.classList.add("bookmark-highlight-pulse");
    window.setTimeout(
      () => button.classList.remove("bookmark-highlight-pulse"),
      1200,
    );
  }, [revealBookmarkButton]);

  // A node jump only flashes once the smooth scroll has settled, which can be a
  // few hundred ms after the click, so the button waits for that same instant
  // rather than firing on the press and reading as two separate events.
  const pendingBookmarkFlashRef = useRef<{ itemKey: string; expiresAt: number } | null>(null);
  const armBookmarkFlash = useCallback((itemKey: string) => {
    pendingBookmarkFlashRef.current = { itemKey, expiresAt: Date.now() + 5000 };
  }, []);

  useEffect(() => {
    const handleArrival = () => {
      const pending = pendingBookmarkFlashRef.current;
      pendingBookmarkFlashRef.current = null;
      // Drop a jump that never landed rather than firing it on the next
      // unrelated highlight.
      if (!pending || Date.now() > pending.expiresAt) return;
      flashBookmarkButton(pending.itemKey);
    };
    window.addEventListener("workflow-node-highlighted", handleArrival);
    return () =>
      window.removeEventListener("workflow-node-highlighted", handleArrival);
  }, [flashBookmarkButton]);

  /**
   * Go to a bookmark.
   *
   * Everything about getting there — travelling to its scope, revealing its
   * ancestors, waiting for the render, scrolling, flashing — belongs to
   * `jumpToWorkflowItem` and is the same for every kind. What stays here is the
   * part that is actually about bookmarks: flashing the chip in the gutter, so
   * the control that was pressed answers at the same moment the destination
   * lights up.
   */
  const activateBookmarkEntry = useCallback(
    (entry: BookmarkEntry) => {
      armBookmarkFlash(entry.itemKey);
      if (entry.type === "group") {
        jumpToWorkflowItem({
          kind: "group",
          itemKey: entry.itemKey,
          groupKey: entry.groupKey,
        });
        return;
      }
      jumpToWorkflowItem({
        kind: entry.type === "subgraph" ? "subgraph" : "node",
        itemKey: entry.itemKey,
      });
    },
    [armBookmarkFlash, jumpToWorkflowItem],
  );

  const navigateToBookmarkEntry = activateBookmarkEntry;

  const stopBookmarkRepositioning = useCallback(() => {
    bookmarkLongPressTriggeredRef.current = false;
    setIsBookmarkRepositioning(false);
    setIsBookmarkDragging(false);
    latestBookmarkDragPositionRef.current = null;
    setBookmarkDragPosition(null);
  }, []);

  /**
   * True when the press that just ended was a long press (or the bar is being
   * repositioned), meaning the click that follows it should not also act. Every
   * control in the gutter has to ask, because the gutter itself is a drag
   * surface and the browser still fires a click after the hold.
   */
  /** Set when a swipe has already acted, so the click it spawns is ignored. */
  const bookmarkGestureConsumedRef = useRef(false);

  const consumeBookmarkPressIntent = useCallback(() => {
    if (bookmarkGestureConsumedRef.current) {
      bookmarkGestureConsumedRef.current = false;
      return true;
    }
    if (bookmarkLongPressTriggeredRef.current) {
      bookmarkLongPressTriggeredRef.current = false;
      return true;
    }
    if (isBookmarkRepositioning) {
      stopBookmarkRepositioning();
      return true;
    }
    return false;
  }, [isBookmarkRepositioning, stopBookmarkRepositioning]);

  const handleBookmarkButtonClick = useCallback(
    (entry: BookmarkEntry, index: number) => () => {
      if (consumeBookmarkPressIntent()) return;
      setBookmarkCycleIndex(index);
      revealBookmarkButton(entry.itemKey, "smooth");
      navigateToBookmarkEntry(entry);
    },
    [consumeBookmarkPressIntent, revealBookmarkButton, navigateToBookmarkEntry],
  );

  const cycleBookmarks = useCallback(
    (step: 1 | -1) => {
      if (isBookmarkRepositioning) {
        stopBookmarkRepositioning();
        return;
      }
      const total = bookmarkEntries.length;
      if (!total) return;
      // `+ total` so stepping back off the first entry wraps round to the last
      // rather than landing on a negative index.
      const nextIndex = (bookmarkCycleIndex + step + total) % total;
      setBookmarkCycleIndex(nextIndex);
      const entry = bookmarkEntries[nextIndex];
      if (!entry) return;
      // Cycling can land on a bookmark scrolled out of the gutter; start moving
      // it into view now so it has settled by the time the jump arrives and
      // flashes.
      revealBookmarkButton(entry.itemKey, "smooth");
      navigateToBookmarkEntry(entry);
    },
    [
      bookmarkEntries,
      bookmarkCycleIndex,
      isBookmarkRepositioning,
      revealBookmarkButton,
      navigateToBookmarkEntry,
      stopBookmarkRepositioning,
    ],
  );

  const handleBookmarkCycleClick = useCallback(
    () => cycleBookmarks(1),
    [cycleBookmarks],
  );

  const handleBookmarkCycleBackClick = useCallback(
    () => cycleBookmarks(-1),
    [cycleBookmarks],
  );

  const handleBookmarkParentClick = useCallback(
    (itemKey: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (bookmarkLongPressTriggeredRef.current) {
        bookmarkLongPressTriggeredRef.current = false;
        return;
      }
      if (isBookmarkRepositioning) {
        stopBookmarkRepositioning();
        return;
      }
      const parentEntry = bookmarkEntryByHierarchicalKey.get(itemKey);
      if (!parentEntry) return;
      revealBookmarkButton(parentEntry.itemKey, "smooth");
      navigateToBookmarkEntry(parentEntry);
    },
    [
      bookmarkEntryByHierarchicalKey,
      isBookmarkRepositioning,
      revealBookmarkButton,
      navigateToBookmarkEntry,
      stopBookmarkRepositioning,
    ],
  );

  const clearBookmarkLongPress = useCallback(() => {
    if (bookmarkLongPressRef.current != null) {
      window.clearTimeout(bookmarkLongPressRef.current);
      bookmarkLongPressRef.current = null;
    }
  }, []);

  const getBottomBarOffset = useCallback(() => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(
      "--bottom-bar-offset",
    );
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }, []);

  // Only on the side the exit button is actually on — the other has nothing
  // above it to clear. Taken as an argument rather than read from state,
  // because a drop that crosses sides has to be clamped against the side it is
  // landing on, not the one it left.
  const bookmarkTopReserveFor = useCallback(
    (side: BookmarksState["bookmarkBarSide"]) =>
      leftGutterReserved && side === "left" ? BOOKMARK_BAR_EXIT_CLEARANCE : 0,
    [leftGutterReserved],
  );
  const bookmarkTopReserve = bookmarkTopReserveFor(bookmarkBarSide);

  const getBookmarkBounds = useCallback((side = bookmarkBarSide) => {
    // (BOOKMARK_BAR_MIN_TOP / BOOKMARK_BAR_BOTTOM_GAP are shared with the
    // bar's own max-height below, so the two never disagree.)
    const wrapper = wrapperRef.current;
    const bar = bookmarkBarRef.current;
    if (!wrapper || !bar) return null;
    // `offsetHeight`, not the bounding rect: the rect is the *transformed* box,
    // and the expand animation scales the bar as it opens. Measuring mid-
    // animation therefore reported a shorter bar than the one about to exist,
    // and the position computed from it was wrong until something re-rendered.
    const wrapperHeight = wrapper.offsetHeight;
    const barHeight = bar.offsetHeight;
    const minTop = BOOKMARK_BAR_MIN_TOP + bookmarkTopReserveFor(side);
    const bottomMargin = getBottomBarOffset() + BOOKMARK_BAR_BOTTOM_GAP;
    // The tallest the bar may ever be: the wrapper already starts below the top
    // bar (and tab bar, which lives inside it), so this is the whole gutter.
    // The bar's own max-height is the same expression in CSS.
    const availableHeight = wrapperHeight - minTop - bottomMargin;
    // While the panel is (re)mounting — e.g. swiping back to it — the wrapper may
    // not be laid out yet, so its measured height is ~0. Report "no bounds" until
    // there's genuine room, so callers skip clamping rather than destroying the
    // saved position (which is still rendered directly from bookmarkBarTop).
    // Note this must NOT fire when the bar exactly fills the gutter — a full-height
    // bar would then never be clamped and would keep a stale top, growing up
    // behind the top bar.
    if (availableHeight <= 0) return null;
    const maxTop = Math.max(
      minTop,
      wrapperHeight - Math.min(barHeight, availableHeight) - bottomMargin,
    );
    return { minTop, maxTop };
  }, [bookmarkBarSide, bookmarkTopReserveFor, getBottomBarOffset, wrapperRef]);

  const clampBookmarkTop = useCallback(
    (nextTop: number, side?: BookmarksState["bookmarkBarSide"]) => {
      const bounds = getBookmarkBounds(side);
      if (!bounds) return nextTop;
      return Math.min(Math.max(nextTop, bounds.minTop), bounds.maxTop);
    },
    [getBookmarkBounds],
  );

  /**
   * Keep the expanded bar inside the panel.
   *
   * Deliberately not tied to the expand itself: the bar can end up out of
   * bounds several ways — opened where a 40px button was parked, grown past its
   * old offset by bookmarks added while it was away, or squeezed by the panel
   * getting shorter — and clamping only on the one transition fixes only the
   * one case. Running on every commit makes it self-correcting instead, and the
   * `nextTop === bookmarkBarTop` exit keeps that from looping.
   *
   * A layout effect, so the correction lands before the browser paints and the
   * bar never shows up in the wrong place first. Skipped mid-drag, when the
   * user's finger owns the position.
   */
  const wasBookmarkBarCollapsedRef = useRef(bookmarkBarCollapsed);
  useLayoutEffect(() => {
    // Opening anchors on the button the user just pressed; after that the bar
    // is corrected against wherever it already is.
    const justExpanded = wasBookmarkBarCollapsedRef.current && !bookmarkBarCollapsed;
    wasBookmarkBarCollapsedRef.current = bookmarkBarCollapsed;
    // Not gated on repositioning MODE, only on an active drag: the mode stays
    // on between drags, and a bar dropped somewhere it may not sit has to be
    // corrected then rather than waiting for the mode to end.
    if (bookmarkBarCollapsed || isBookmarkDragging) return;
    const anchor = justExpanded ? (bookmarkBarCollapsedTop ?? bookmarkBarTop) : bookmarkBarTop;
    if (anchor == null) return;
    const nextTop = clampBookmarkTop(anchor);
    if (nextTop !== bookmarkBarTop) setBookmarkBarPosition({ top: nextTop });
  });

  // A commit is not the only thing that changes the bar's height — the expand
  // animation settling, a long label wrapping, the panel resizing. Watch the
  // element itself so the position is corrected whenever its size lands,
  // whether or not React rendered anything.
  useEffect(() => {
    const bar = bookmarkBarRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const { bookmarkBarTop: currentTop } = useBookmarksStore.getState();
      if (currentTop == null) return;
      const nextTop = clampBookmarkTop(currentTop);
      if (nextTop !== currentTop) setBookmarkBarPosition({ top: nextTop });
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, [clampBookmarkTop, setBookmarkBarPosition]);

  useEffect(() => {
    const previousTopBarHeight = previousTopBarHeightRef.current;
    previousTopBarHeightRef.current = topBarHeight;
    if (
      previousTopBarHeight == null ||
      bookmarkBarTop == null ||
      isBookmarkDragging ||
      isBookmarkRepositioning
    ) {
      return;
    }
    const delta = topBarHeight - previousTopBarHeight;
    if (delta === 0) return;
    const nextTop = clampBookmarkTop(bookmarkBarTop - delta);
    if (nextTop !== bookmarkBarTop) {
      setBookmarkBarPosition({ top: nextTop });
    }
  }, [
    bookmarkBarTop,
    clampBookmarkTop,
    isBookmarkDragging,
    isBookmarkRepositioning,
    previousTopBarHeightRef,
    setBookmarkBarPosition,
    topBarHeight,
  ]);

  const updateBookmarkDragPosition = useCallback(
    (clientX: number, clientY: number) => {
      const wrapper = wrapperRef.current;
      const offset = bookmarkDragOffsetRef.current;
      if (!wrapper || !offset) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      // Clamped to the panel: an unclamped drag carries the bar past an edge
      // and off screen, and releasing out there leaves it somewhere it cannot
      // snap back from sensibly.
      const barWidth = bookmarkBarRef.current?.getBoundingClientRect().width ?? 0;
      const maxX = Math.max(0, wrapperRect.width - barWidth);
      const nextX = Math.min(
        Math.max(clientX - wrapperRect.left - offset.x, 0),
        maxX,
      );
      const nextY = clampBookmarkTop(clientY - wrapperRect.top - offset.y);
      latestBookmarkDragPositionRef.current = { x: nextX, y: nextY };
      setBookmarkDragPosition({ x: nextX, y: nextY });
    },
    [clampBookmarkTop, wrapperRef],
  );

  const startBookmarkDrag = useCallback(
    (clientX: number, clientY: number) => {
      const wrapper = wrapperRef.current;
      const bar = bookmarkBarRef.current;
      if (!wrapper || !bar) return;
      const barRect = bar.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      bookmarkDragOffsetRef.current = {
        x: clientX - barRect.left,
        y: clientY - barRect.top,
      };
      const nextX = barRect.left - wrapperRect.left;
      const nextY = clampBookmarkTop(barRect.top - wrapperRect.top);
      latestBookmarkDragPositionRef.current = { x: nextX, y: nextY };
      setBookmarkDragPosition({ x: nextX, y: nextY });
      setIsBookmarkDragging(true);
    },
    [clampBookmarkTop, wrapperRef],
  );

  const handleBookmarkPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const isButtonPress = (event.target as HTMLElement).closest("button");
      const pointerTarget = event.currentTarget;
      bookmarkPointerRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startTime: Date.now(),
        pointerId: event.pointerId,
        isButtonPress: Boolean(isButtonPress),
        startedInRepositioning: isBookmarkRepositioning,
      };
      if (isBookmarkRepositioning) {
        event.preventDefault();
        startBookmarkDrag(event.clientX, event.clientY);
        pointerTarget.setPointerCapture(event.pointerId);
        return;
      }
      bookmarkLongPressRef.current = window.setTimeout(() => {
        bookmarkLongPressTriggeredRef.current = true;
        setIsBookmarkRepositioning(true);
        startBookmarkDrag(event.clientX, event.clientY);
        // Captured here rather than at pointerdown when the press began on a
        // button: with capture active the browser retargets the following
        // `click` to the capturing element, so capturing up front stopped every
        // button in the gutter — the collapsed one included — from ever being
        // clicked at all.
        if (isButtonPress) pointerTarget.setPointerCapture(event.pointerId);
      }, 500);
      if (!isButtonPress) {
        event.preventDefault();
        pointerTarget.setPointerCapture(event.pointerId);
      }
    },
    [isBookmarkRepositioning, startBookmarkDrag],
  );

  const handleBookmarkPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isBookmarkDragging) {
        updateBookmarkDragPosition(event.clientX, event.clientY);
        return;
      }
      const pointerState = bookmarkPointerRef.current;
      if (!pointerState) return;
      const dx = event.clientX - pointerState.startX;
      const dy = event.clientY - pointerState.startY;
      if (Math.hypot(dx, dy) > 8) {
        clearBookmarkLongPress();
      }
    },
    [clearBookmarkLongPress, isBookmarkDragging, updateBookmarkDragPosition],
  );

  // Settle the bar on whichever edge it ended up nearest. Always clears the drag
  // state first, so a drop the geometry can't be read for still leaves the bar
  // parked rather than stuck mid-drag.
  const finalizeBookmarkPosition = useCallback(() => {
    // From the ref, not state: on a fast flick the last `pointermove` may not
    // have rendered yet, and state would still describe the side the drag
    // started on — which is what made a quick left-to-right throw snap back.
    const dropPosition = latestBookmarkDragPositionRef.current;
    latestBookmarkDragPositionRef.current = null;
    setBookmarkDragPosition(null);
    const wrapper = wrapperRef.current;
    const bar = bookmarkBarRef.current;
    if (!wrapper || !bar || !dropPosition) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const barWidth = bar.getBoundingClientRect().width;
    const centerX = dropPosition.x + barWidth / 2;
    const nextSide = centerX < wrapperRect.width / 2 ? "left" : "right";
    // Against the side being dropped onto: dragging across from the right used
    // to be clamped with the right side's rules and land on the exit button.
    const nextTop = clampBookmarkTop(dropPosition.y, nextSide);
    setBookmarkBarPosition({
      side: nextSide,
      // Only the form actually being carried moves. The side is shared, so it
      // is always written: the two forms are one gutter on one edge.
      ...(bookmarkBarCollapsed ? { collapsedTop: nextTop } : { top: nextTop }),
    });
  }, [bookmarkBarCollapsed, clampBookmarkTop, setBookmarkBarPosition, wrapperRef]);

  const handleBookmarkPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      clearBookmarkLongPress();
      const pointerState = bookmarkPointerRef.current;
      bookmarkPointerRef.current = null;
      if (isBookmarkDragging) {
        finalizeBookmarkPosition();
        setIsBookmarkDragging(false);
        if (!pointerState?.isButtonPress) {
          bookmarkLongPressTriggeredRef.current = false;
        }
        // A press that went nowhere is a tap, and a tap in reposition mode
        // means "done". Handled here rather than in the buttons' own click
        // handlers because the mode captures the pointer, and a captured
        // pointer retargets the click away from the button that was pressed —
        // so the collapsed gutter, which IS one button, had no way out at all.
        //
        // Only for a press that began with the mode already on: the hold that
        // TURNS IT ON also ends with a stationary finger, and would otherwise
        // switch the mode straight back off as it was released.
        const dx = pointerState ? event.clientX - pointerState.startX : 0;
        const dy = pointerState ? event.clientY - pointerState.startY : 0;
        if (pointerState?.startedInRepositioning && Math.hypot(dx, dy) <= BOOKMARK_TAP_SLOP) {
          stopBookmarkRepositioning();
        }
        return;
      }
      if (bookmarkLongPressTriggeredRef.current && !pointerState?.isButtonPress) {
        bookmarkLongPressTriggeredRef.current = false;
      }
      if (isBookmarkRepositioning || !pointerState) return;
      const dx = event.clientX - pointerState.startX;
      const dy = event.clientY - pointerState.startY;
      const dt = Date.now() - pointerState.startTime;
      if (!isDesktop && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) && dt < 500) {
        // Toward the edge it is pinned to means "get out of the way"; away from
        // it still means "move to the other side". One gesture, read by its
        // direction, because both are about where the bar should sit.
        const towardPinnedEdge = bookmarkBarSide === "left" ? dx < 0 : dx > 0;
        if (towardPinnedEdge) {
          setBookmarkBarCollapsed(true);
        } else {
          setBookmarkBarPosition({ side: bookmarkBarSide === "left" ? "right" : "left" });
        }
        // A flick that began on a bookmark still ends in that button's click.
        // Without swallowing it, swiping the bar away would also navigate to
        // whichever bookmark the finger happened to start on.
        if (pointerState.isButtonPress) bookmarkGestureConsumedRef.current = true;
      }
    },
    [
      bookmarkBarSide,
      clearBookmarkLongPress,
      finalizeBookmarkPosition,
      isBookmarkDragging,
      isBookmarkRepositioning,
      isDesktop,
      setBookmarkBarPosition,
      setBookmarkBarCollapsed,
      stopBookmarkRepositioning,
    ],
  );

  const handleBookmarkPointerCancel = useCallback(() => {
    clearBookmarkLongPress();
    bookmarkPointerRef.current = null;
    bookmarkLongPressTriggeredRef.current = false;
    if (isBookmarkDragging) {
      // The browser can cancel a drag mid-flight (an edge-swipe gesture being
      // the usual culprit when you throw the bar at a side). Settle it where it
      // got to rather than dropping it back on the side it came from.
      finalizeBookmarkPosition();
    } else {
      latestBookmarkDragPositionRef.current = null;
      setBookmarkDragPosition(null);
    }
    setIsBookmarkDragging(false);
  }, [clearBookmarkLongPress, finalizeBookmarkPosition, isBookmarkDragging]);


  useEffect(() => {
    if (!bookmarkEntries.length) return;
    const frame = window.requestAnimationFrame(() => {
      const bounds = getBookmarkBounds();
      if (!bounds) return;
      const { minTop, maxTop } = bounds;
      if (bookmarkBarTop == null) {
        setBookmarkBarPosition({ top: maxTop });
      } else {
        const nextTop = Math.min(Math.max(bookmarkBarTop, minTop), maxTop);
        if (nextTop !== bookmarkBarTop) {
          setBookmarkBarPosition({ top: nextTop });
        }
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    bookmarkEntries.length,
    bookmarkBarTop,
    getBookmarkBounds,
    setBookmarkBarPosition,
  ]);

  useEffect(() => {
    if (!isBookmarkRepositioning) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const bar = bookmarkBarRef.current;
      if (!bar || !event.target) return;
      if (bar.contains(event.target as Node)) return;
      stopBookmarkRepositioning();
      clearBookmarkLongPress();
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
    };
  }, [clearBookmarkLongPress, isBookmarkRepositioning, stopBookmarkRepositioning]);

  const activeBookmarkTop = bookmarkBarCollapsed
    ? (bookmarkBarCollapsedTop ?? bookmarkBarTop)
    : bookmarkBarTop;
  const bookmarkBarTopValue = bookmarkDragPosition?.y ?? activeBookmarkTop ?? 0;
  const bookmarkBarLeftValue = bookmarkDragPosition
    ? `${bookmarkDragPosition.x}px`
    : isDesktop
    // The node list is centered at max-w-3xl (48rem). Start the bookmark bar
    // just beyond that column's right edge so it never covers node content.
      ? bookmarkBarSide === "right"
        ? "calc(50% + 24rem + 0.75rem)"
        : undefined
      : bookmarkBarSide === "left"
        ? "0.75rem"
        : undefined;
  const bookmarkBarRightValue = bookmarkDragPosition
    ? undefined
    : isDesktop
      ? bookmarkBarSide === "left"
        ? "calc(50% + 24rem + 0.75rem)"
        : undefined
      : bookmarkBarSide === "right"
        ? "0.75rem"
        : undefined;
  // Fade the ends of the scrolling list rather than letting it cut bookmarks off
  // at a hard line. Applied as a mask on the list itself — an overlay would need
  // a solid colour and the gutter has to stay see-through over the node list.
  const bookmarkListRef = useRef<HTMLDivElement>(null);
  const [bookmarkTopFade, setBookmarkTopFade] = useState(0);
  const [bookmarkBottomFade, setBookmarkBottomFade] = useState(0);

  const updateBookmarkScrollFades = useCallback(() => {
    const list = bookmarkListRef.current;
    if (!list) return;
    const maxScroll = list.scrollHeight - list.clientHeight;
    const hiddenAbove = list.scrollTop;
    const hiddenBelow = maxScroll - list.scrollTop;
    setBookmarkTopFade(
      hiddenAbove <= BOOKMARK_EDGE_EPSILON
        ? 0
        : Math.min(1, hiddenAbove / BOOKMARK_EDGE_FADE),
    );
    setBookmarkBottomFade(
      hiddenBelow <= BOOKMARK_EDGE_EPSILON
        ? 0
        : Math.min(1, hiddenBelow / BOOKMARK_EDGE_FADE),
    );
  }, []);

  // While the bar is being dragged to a new spot, freeze its list: otherwise the
  // same finger movement that moves the bar also scrolls the bookmarks under it.
  // Toggling `overflow` can clamp `scrollTop`, so the position is put back when
  // the drag ends rather than snapping the list to the top.
  const lockedScrollTopRef = useRef(0);
  const wasRepositioningRef = useRef(false);
  useEffect(() => {
    const list = bookmarkListRef.current;
    if (!list) return;
    if (isBookmarkRepositioning) {
      lockedScrollTopRef.current = list.scrollTop;
      wasRepositioningRef.current = true;
      return;
    }
    if (!wasRepositioningRef.current) return;
    wasRepositioningRef.current = false;
    list.scrollTop = lockedScrollTopRef.current;
    // After layout, so the fades read the restored position.
    const frame = window.requestAnimationFrame(updateBookmarkScrollFades);
    return () => window.cancelAnimationFrame(frame);
  }, [isBookmarkRepositioning, updateBookmarkScrollFades]);

  useEffect(() => {
    // Measured after layout: the list's height only settles once the bar has
    // been clamped into the gutter.
    const frame = window.requestAnimationFrame(updateBookmarkScrollFades);
    const list = bookmarkListRef.current;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateBookmarkScrollFades);
    if (list) observer?.observe(list);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [bookmarkEntries.length, isDesktop, updateBookmarkScrollFades]);

  // Tapping a faded end scrolls the bookmark clipped there fully clear of the
  // fade, rather than activating the sliver of it that shows through.
  const scrollBookmarkEdge = useCallback((direction: "up" | "down") => {
    const list = bookmarkListRef.current;
    if (!list) return;
    const listBox = list.getBoundingClientRect();
    const entries = Array.from(
      list.querySelectorAll<HTMLElement>("[data-bookmark-flash-key]"),
    );
    if (direction === "up") {
      const clipped = entries
        .filter((entry) => entry.getBoundingClientRect().top < listBox.top - 1)
        .pop();
      if (!clipped) {
        list.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      list.scrollBy({
        top: clipped.getBoundingClientRect().top - listBox.top - BOOKMARK_EDGE_FADE,
        behavior: "smooth",
      });
      return;
    }
    const clipped = entries.find(
      (entry) => entry.getBoundingClientRect().bottom > listBox.bottom + 1,
    );
    if (!clipped) {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
      return;
    }
    list.scrollBy({
      top: clipped.getBoundingClientRect().bottom - listBox.bottom + BOOKMARK_EDGE_FADE,
      behavior: "smooth",
    });
  }, []);

  const bookmarkListMaskStyle = useMemo(() => {
    if (!bookmarkTopFade && !bookmarkBottomFade) return undefined;
    const top = Math.round(bookmarkTopFade * BOOKMARK_EDGE_FADE);
    const bottom = Math.round(bookmarkBottomFade * BOOKMARK_EDGE_FADE);
    const mask = `linear-gradient(to bottom, transparent 0px, #000 ${top}px, #000 calc(100% - ${bottom}px), transparent 100%)`;
    return { maskImage: mask, WebkitMaskImage: mask } as const;
  }, [bookmarkBottomFade, bookmarkTopFade]);

  const bookmarkBarStyle = {
    top: `${bookmarkBarTopValue}px`,
    left: bookmarkBarLeftValue,
    right: bookmarkBarRightValue,
    // Bookmarks are unlimited, so cap the bar at the tallest it could ever be
    // in the gutter: the entry list inside it scrolls past that and the cycle
    // button stays pinned below. `100%` is the panel wrapper, this bar's
    // containing block. Deliberately measured from the *highest* the bar may
    // sit rather than from where it currently sits — the latter feeds the bar's
    // own height back into its cap and pins it at whatever height it had.
    // `getBookmarkBounds` then pulls `top` up so the taller bar still fits.
    maxHeight: `calc(100% - ${BOOKMARK_BAR_MIN_TOP + bookmarkTopReserve}px - var(--bottom-bar-offset, 0px) - ${BOOKMARK_BAR_BOTTOM_GAP}px)`,
    // The desktop gutter reserves a column's width for its entry list.
    // Collapsed there is no list, so it hugs the one button instead — otherwise
    // the reposition outline is drawn around the reserved width and stands out
    // either side of the button it is supposed to be tracing.
    width: isDesktop && !bookmarkBarCollapsed ? "max-content" : undefined,
    minWidth: isDesktop && !bookmarkBarCollapsed ? "6.5rem" : undefined,
    maxWidth: isDesktop && !bookmarkBarCollapsed ? "calc(50% - 25.5rem)" : undefined,
    opacity: bookmarkBarTop == null && bookmarkDragPosition == null ? 0 : 1,
    touchAction: isBookmarkRepositioning ? "none" : "pan-y",
    pointerEvents:
      bookmarkBarTop == null && bookmarkDragPosition == null ? "none" : "auto",
  } as const;


  return {
    bookmarkBarRef,
    bookmarkListRef,
    bookmarkListMaskStyle,
    bookmarkTopFade,
    bookmarkBottomFade,
    bookmarkEdgeFadeSize: BOOKMARK_EDGE_FADE,
    bookmarkListScrollLocked: isBookmarkRepositioning,
    canCycleBookmarks: bookmarkEntries.length > 1,
    canCycleBookmarksBack: bookmarkEntries.length >= BOOKMARK_REVERSE_CYCLE_MIN,
    updateBookmarkScrollFades,
    scrollBookmarkEdge,
    bookmarkEntries,
    isBookmarkRepositioning,
    bookmarkBarStyle,
    handleBookmarkButtonClick,
    handleBookmarkParentClick,
    handleBookmarkCycleClick,
    handleBookmarkCycleBackClick,
    consumeBookmarkPressIntent,
    handleBookmarkPointerDown,
    handleBookmarkPointerMove,
    handleBookmarkPointerUp,
    handleBookmarkPointerCancel,
  };
}
