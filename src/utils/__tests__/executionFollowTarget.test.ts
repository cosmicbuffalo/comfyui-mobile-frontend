import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/api/types';
import type { ScopeFrame } from '@/utils/canonicalWorkflowOps';
import { resolveFollowTargetInScope } from '../executionFollowTarget';

const OUTER = 'sg-outer';
const INNER = 'sg-inner';

/** Root holds the OUTER placeholder; OUTER holds the INNER placeholder. */
const workflow = {
  nodes: [
    { id: 5, type: OUTER, itemKey: 'root/subgraph:sg-outer' },
    { id: 1, type: 'KSampler', itemKey: 'root/node:1' },
  ],
  links: [],
  groups: [],
  config: {},
  definitions: {
    subgraphs: [
      {
        id: OUTER,
        nodes: [{ id: 7, type: INNER, itemKey: 'root/subgraph:sg-outer/subgraph:sg-inner' }],
        links: [],
        inputs: [],
        outputs: [],
      },
      { id: INNER, nodes: [], links: [], inputs: [], outputs: [] },
    ],
  },
} as unknown as Workflow;

const root: ScopeFrame[] = [{ type: 'root' }];
const insideOuter: ScopeFrame[] = [
  { type: 'root' },
  { type: 'subgraph', id: OUTER, placeholderNodeId: 5 },
];

describe('resolveFollowTargetInScope', () => {
  it('follows a node in this scope directly', () => {
    expect(resolveFollowTargetInScope(workflow, root, 'root/node:1')).toBe('root/node:1');
  });

  it('follows execution one level down to the placeholder standing for it', () => {
    // Execution is inside OUTER; from root that is what OUTER's card represents.
    expect(
      resolveFollowTargetInScope(workflow, root, 'root/subgraph:sg-outer/node:9'),
    ).toBe('root/subgraph:sg-outer');
  });

  it('stops at the outermost placeholder, however deep execution goes', () => {
    // Two levels down, but from root there is still only one card to point at.
    expect(
      resolveFollowTargetInScope(
        workflow,
        root,
        'root/subgraph:sg-outer/subgraph:sg-inner/node:9',
      ),
    ).toBe('root/subgraph:sg-outer');
  });

  it('follows to the next placeholder down from wherever the user is standing', () => {
    // Inside OUTER, the next step down is INNER's placeholder — not root's.
    expect(
      resolveFollowTargetInScope(
        workflow,
        insideOuter,
        'root/subgraph:sg-outer/subgraph:sg-inner/node:9',
      ),
    ).toBe('root/subgraph:sg-outer/subgraph:sg-inner');
  });

  it('follows nothing when execution is on a branch this scope cannot see', () => {
    // Standing inside OUTER while execution runs at root: pointing anywhere
    // here would misrepresent where it is.
    expect(resolveFollowTargetInScope(workflow, insideOuter, 'root/node:1')).toBeNull();
  });

  it('follows nothing when the placeholder is missing from this scope', () => {
    const emptyRoot = { ...workflow, nodes: [] } as Workflow;
    expect(
      resolveFollowTargetInScope(emptyRoot, root, 'root/subgraph:sg-outer/node:9'),
    ).toBeNull();
  });
});
