/**
 * Finding and lighting up whatever a jump is aimed at.
 *
 * The panel draws its items three different ways, and each needs asking for
 * differently:
 *
 * - a node card carries a scroll anchor (`node-anchor-<id>`) and a card
 *   (`node-card-<id>`), and is the only kind the alignment engine in
 *   `scrollToNode` can drive — it measures against that anchor;
 * - a group and a subgraph placeholder are containers, drawn with a reposition
 *   wrapper and no anchor, so they are scrolled into view directly;
 * - a boundary slot is a connection button in the subgraph connections section.
 *
 * Keeping the three schemes in one place is what lets a jump take a target kind
 * as an argument rather than each caller knowing the markup.
 */

/** How long to keep the arrival pulse on. */
const FLASH_MS = 1200;

/** Long enough for a smooth scroll to settle before the pulse starts. */
const FLASH_AFTER_SCROLL_MS = 300;

/**
 * A row-level target's pulse (a widget row, a boundary slot's button) waits
 * longer the further away it starts: a long smooth scroll can spend most of a
 * second travelling, and a flash timed for the short hop is over before the
 * row is even on screen. Scaled by how far off-screen the target begins,
 * capped so a huge workflow still flashes promptly after arrival.
 */
const SCALED_FLASH_DELAY_MAX_MS = 900;
const SCALED_FLASH_DELAY_PER_PX = 0.25;

/**
 * Where a jump puts its target in the visible list.
 *
 * `start` is the default: flush with the top, showing as much of the target as
 * will fit — what you want when you asked to go and look at something.
 *
 * `belowTopThird` leaves the first third of the panel showing whatever the
 * target sits under. That is the right landing for something just created out
 * of a selection: arriving with the new card hard against the top edge and
 * nothing recognisable above it reads as the list having jumped somewhere
 * arbitrary, rather than as "here is the thing you made, where it came from".
 */
export type JumpAlignment = 'start' | 'belowTopThird';

/** How far down the panel `belowTopThird` puts the target's top edge. */
const TOP_THIRD = 1 / 3;

/**
 * A late re-align, for the content that renders after the first one.
 *
 * The list fills in as cards mount, so a position computed the instant a jump
 * starts can be stale by the time the smooth scroll finishes. Long enough to
 * land after that scroll, short enough that the user has not taken over.
 */
const REALIGN_MS = 400;

export type JumpElementTarget =
  | { kind: 'node'; nodeId: number }
  | { kind: 'container'; nodeId: number }
  | { kind: 'group'; groupKey: string }
  | { kind: 'connection'; domId: string }
  | { kind: 'widgetRow'; domId: string };

interface JumpElements {
  /** Scrolled into view. */
  scroll: Element | null;
  /** Pulsed on arrival. */
  flash: HTMLElement | null;
}

function resolveJumpElements(target: JumpElementTarget): JumpElements {
  if (target.kind === 'connection' || target.kind === 'widgetRow') {
    const element = document.getElementById(target.domId);
    return { scroll: element, flash: element };
  }
  if (target.kind === 'group') {
    // The wrapper is the only thing a group actually renders with a stable
    // hook; a `data-group-id` header selector was tried here once and never
    // matched anything.
    const wrapper = document.querySelector(`[data-reposition-item="group-${target.groupKey}"]`);
    return { scroll: wrapper, flash: wrapper instanceof HTMLElement ? wrapper : null };
  }
  const wrapper = document.querySelector(`[data-reposition-item="node-${target.nodeId}"]`);
  const card = document.getElementById(`node-card-${target.nodeId}`);
  if (target.kind === 'node') {
    const anchor = document.getElementById(`node-anchor-${target.nodeId}`);
    return { scroll: anchor ?? wrapper, flash: card ?? (wrapper instanceof HTMLElement ? wrapper : null) };
  }
  // A placeholder may be drawn as a card or expanded into a container; the
  // wrapper is there either way, and the card is the nicer thing to light up.
  return { scroll: wrapper, flash: card ?? (wrapper instanceof HTMLElement ? wrapper : null) };
}

/**
 * Scroll the node list so `element` sits at the requested fraction down it.
 *
 * Returns false when there is no list to scroll — the caller falls back to
 * `scrollIntoView`, which is all that is available for anything drawn outside
 * the panel.
 */
function alignWithinList(element: Element | null, alignment: JumpAlignment): boolean {
  const container = element?.closest<HTMLElement>('[data-node-list="true"]');
  if (!element || !container) return false;

  const offsetWithinList =
    element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const inset = alignment === 'belowTopThird' ? container.clientHeight * TOP_THIRD : 0;
  // Clamped: near either end of the list the target lands as close as the
  // content allows, which is the best that can be offered.
  const top = Math.max(
    0,
    Math.min(
      container.scrollTop + offsetWithinList - inset,
      container.scrollHeight - container.clientHeight,
    ),
  );
  container.scrollTo({ top, behavior: 'smooth' });
  return true;
}

/** Pulse an element, clearing any pulse already running elsewhere. */
export function flashJumpTarget(element: HTMLElement | null): void {
  if (!element) return;
  document
    .querySelectorAll(
      '.highlight-pulse, .connection-highlight-pulse, .widget-input-highlight-pulse, .widget-label-highlight-pulse',
    )
    .forEach((el) => {
      el.classList.remove('highlight-pulse');
      el.classList.remove('connection-highlight-pulse');
      el.classList.remove('widget-input-highlight-pulse');
      el.classList.remove('widget-label-highlight-pulse');
    });

  // A widget row does not take the generic card rectangle: the cue is a cyan
  // ring around the control's input — right where a promoted widget wears its
  // pink one — with the slot name in the label tinted in unison. Every standard control
  // marks its actual border surface through controlStyles, including react-select. Rows whose
  // control draws no standard input (the specialised blocks) fall back to the
  // rectangle rather than flashing nothing.
  if (element.id.startsWith('widget-row-')) {
    const input = element.querySelector<HTMLElement>('.widget-jump-surface');
    if (input) {
      const labelBit =
        element.querySelector<HTMLElement>('.boundary-jump')
        ?? element.querySelector<HTMLElement>('label');
      input.classList.add('widget-input-highlight-pulse');
      labelBit?.classList.add('widget-label-highlight-pulse');
      setTimeout(() => {
        input.classList.remove('widget-input-highlight-pulse');
        labelBit?.classList.remove('widget-label-highlight-pulse');
      }, FLASH_MS);
      if ('vibrate' in navigator) navigator.vibrate(10);
      return;
    }
  }

  // A connection button is a small circle whose own border carries the pulse;
  // everything else is a card or container that takes the outline version.
  const isConnectionButton = element.id.startsWith('connection-button-');
  const className = isConnectionButton ? 'connection-highlight-pulse' : 'highlight-pulse';
  element.classList.add(className);
  setTimeout(() => element.classList.remove(className), FLASH_MS);
  // The slot's name joins the button's pulse, mirroring how a widget arrival
  // tints the label — the name is what the jump was aimed at.
  if (isConnectionButton) {
    const slotLabel =
      element.parentElement?.querySelector<HTMLElement>('.connection-slot-label');
    if (slotLabel) {
      slotLabel.classList.add('widget-label-highlight-pulse');
      setTimeout(() => slotLabel.classList.remove('widget-label-highlight-pulse'), FLASH_MS);
    }
  }
  if ('vibrate' in navigator) navigator.vibrate(10);
}

/**
 * Scroll a target into view and pulse it once it has arrived.
 *
 * Used for the kinds the alignment engine cannot drive. The pulse waits for the
 * smooth scroll rather than firing with it: starting the animation while the
 * element is still travelling — usually still off screen — reads as a jump with
 * no highlight at all. An element already in view is pulsed at once, since
 * there is no arrival to wait for.
 */
export function revealJumpTarget(
  target: JumpElementTarget,
  alignment: JumpAlignment = 'start',
): boolean {
  const { scroll, flash } = resolveJumpElements(target);
  if (!scroll && !flash) return false;

  const rect = scroll?.getBoundingClientRect();
  const alreadyInView =
    rect != null && rect.bottom > 0 && rect.top < window.innerHeight;
  const aligned = alignment === 'start' ? false : alignWithinList(scroll, alignment);
  if (!aligned) {
    scroll?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    setTimeout(() => alignWithinList(scroll, alignment), REALIGN_MS);
  }
  const flashOnArrival = () => {
    flashJumpTarget(flash);
    // Bookmarks wait for their destination's arrival rather than flashing on
    // the press. Containers (groups and subgraph placeholders) use this path
    // instead of scrollToNode, so they must announce their arrival here too.
    window.dispatchEvent(new CustomEvent('workflow-node-highlighted'));
  };
  if (alreadyInView) {
    flashOnArrival();
  } else {
    // How far off-screen the target starts, for the distance-scaled delay.
    const offscreenDistance = rect == null
      ? 0
      : rect.bottom < 0
        ? -rect.bottom
        : Math.max(0, rect.top - window.innerHeight);
    const delay = target.kind === 'widgetRow' || target.kind === 'connection'
      ? Math.min(
          SCALED_FLASH_DELAY_MAX_MS,
          FLASH_AFTER_SCROLL_MS + offscreenDistance * SCALED_FLASH_DELAY_PER_PX,
        )
      : FLASH_AFTER_SCROLL_MS;
    setTimeout(flashOnArrival, delay);
  }
  return true;
}
