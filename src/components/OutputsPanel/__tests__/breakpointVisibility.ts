/**
 * jsdom applies no stylesheets, so "is this badge actually on screen?" has to be
 * answered from the Tailwind classes themselves. These helpers walk an element's
 * ancestor chain and report whether any of them hides it at a given breakpoint —
 * enough to catch the class of regression where a state badge is only rendered
 * inside an `lg:hidden` block whose desktop counterpart is conditionally gone.
 */

export type Breakpoint = 'mobile' | 'desktop';

const DESKTOP_UNHIDE = [
  'lg:block',
  'lg:flex',
  'lg:grid',
  'lg:inline',
  'lg:inline-block',
  'lg:inline-flex',
];

function hidesAt(classes: string[], breakpoint: Breakpoint): boolean {
  // `invisible` without a hover override means the element only appears while
  // the card is hovered, which is not "always visible" for our purposes.
  if (classes.includes('invisible')) return true;
  if (breakpoint === 'mobile') return classes.includes('hidden');
  if (classes.includes('lg:hidden')) return true;
  return classes.includes('hidden') && !DESKTOP_UNHIDE.some((c) => classes.includes(c));
}

/** True when no ancestor up to (and including) `root` hides `el` at `breakpoint`. */
export function isVisibleAt(el: Element, root: Element, breakpoint: Breakpoint): boolean {
  let node: Element | null = el;
  while (node) {
    const classes = (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    if (hidesAt(classes, breakpoint)) return false;
    if (node === root) return true;
    node = node.parentElement;
  }
  return true;
}

/** The matching elements that are actually visible at `breakpoint`. */
export function visibleMatches(
  root: Element,
  selector: string,
  breakpoint: Breakpoint,
): Element[] {
  return Array.from(root.querySelectorAll(selector))
    .filter((el) => isVisibleAt(el, root, breakpoint));
}

export const FAVORITE_INDICATORS =
  '.favorite-badge-container, .favorite-badge-icon, button[aria-label="Unfavorite"]';
export const REJECTED_INDICATORS =
  '.rejected-badge-container, .rejected-badge-icon, button[aria-label="Clear rejected mark"]';
