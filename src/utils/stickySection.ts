export function getStickySectionScrollTarget(
  section: HTMLElement,
  scrollContainer: HTMLElement,
  stickyTop: number,
): number | null {
  const header = section.querySelector<HTMLElement>('[data-sticky-section-header]');
  if (!header) return null;

  const containerRect = scrollContainer.getBoundingClientRect();
  const headerRect = header.getBoundingClientRect();
  const stickyViewportTop = containerRect.top + stickyTop;
  const isPinned =
    headerRect.top <= stickyViewportTop + 1 &&
    headerRect.bottom > containerRect.top;

  if (!isPinned) return null;

  const sectionRect = section.getBoundingClientRect();
  return Math.max(
    0,
    scrollContainer.scrollTop + sectionRect.top - stickyViewportTop,
  );
}
