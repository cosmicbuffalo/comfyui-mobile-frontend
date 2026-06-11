import { describe, expect, it, vi } from 'vitest';
import { getStickySectionScrollTarget } from '../stickySection';

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

describe('getStickySectionScrollTarget', () => {
  it('returns the natural section position when its header is pinned', () => {
    const scrollContainer = document.createElement('div');
    const section = document.createElement('div');
    const header = document.createElement('div');
    header.dataset.stickySectionHeader = '';
    section.appendChild(header);

    Object.defineProperty(scrollContainer, 'scrollTop', { value: 500, writable: true });
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue(rect(100, 700));
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(rect(-200, 500));
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(rect(84, 124));

    expect(getStickySectionScrollTarget(section, scrollContainer, -16)).toBe(216);
  });

  it('does nothing when the header has not reached its sticky position', () => {
    const scrollContainer = document.createElement('div');
    const section = document.createElement('div');
    const header = document.createElement('div');
    header.dataset.stickySectionHeader = '';
    section.appendChild(header);

    Object.defineProperty(scrollContainer, 'scrollTop', { value: 100, writable: true });
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue(rect(100, 700));
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(rect(200, 600));
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(rect(200, 240));

    expect(getStickySectionScrollTarget(section, scrollContainer, -16)).toBeNull();
  });
});
