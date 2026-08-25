# Refactoring Tracker

Live list of refactoring opportunities, mirroring the `__init__.py` split (big file
→ cohesion by domain, public API preserved). Update status as items land.

Statuses: ⬜ not started · 🔨 in progress · ✅ done · ♻️ superseded/dropped

## Done

- [x] **__init__.py thin-wiring split** — domain modules (`mobile_routes_*.py`, etc.)
      already extracted; entry point reduced to wiring.
      Follow-up fix (this session): `__init__.py` is now a no-op in bare Python
      (pytest) via a `_COMFYUI_RUNTIME` guard — `server` import is optional, all
      wiring moved into `_bootstrap()`, called only when ComfyUI modules exist.

## Python

- [ ] **1. Split `mobile_file_state.py` (1517 LOC, 39 funcs)**
      Four concerns, four candidate modules (keep `mobile_file_state` as the public
      API surface):
      - *Fingerprinting*: `FileChangedDuringHash`, `_stat_signature`, `_full_sha256_*`,
        `_content_id_*`, `content_id` (L146–215) → `file_hashing.py`
      - *Cache core*: `_load`/`_save`/`_add_entry`/`_remove_entry`/`set_state`/
        `remove_path`/`rename_path` (L226–1040)
      - *Listing annotation / view layer*: `annotate_listing`, `get_hidden_listing_view`,
        activity dates (L517–1358)
      - *Migration*: `migrate_legacy` (L1367, only caller: `__init__.py` startup)

- [ ] **2. Deduplicate sha256 helpers**
      `model_metadata._sha256_sync` (L393) vs. `mobile_file_state._full_sha256_with_stat`
      / `_content_id_with_stat`. Two hand-rolled chunked-read loops. Consolidate into a
      shared helper (stat-change detection as default, plain variant opt-in); ~40 LOC gone.
      (Naturally paired with #1 — land after/with it.)

- [ ] **3. Extract CivitAI network layer from `model_metadata.py` (660 LOC)**
      Local scanning (L110–393) vs. network half (L406+): `requests` sessions, WebP
      preview optimization, fetch orchestration → `model_metadata_civitai.py`, using the
      same optional-dep pattern as `mobile_app_push.py` (`_REQUESTS_AVAILABLE`).
      Scanning half then imports clean.

- [ ] **4. Consolidate `migrate_legacy_cache` ×3**
      `mobile_hidden_items.py:90`, `mobile_input_aliases.py:96`,
      `mobile_file_prefix_aliases.py:40` — same migration shape, subtly different bodies
      (merge-all vs. copy-first-hit). One parameterized helper in `json_cache_io.py`.
      Medium payoff (runs once per install).

- [ ] **5. Split `mobile_progress_ws.py` (1010 LOC)**
      WS transport (clients, send loops, backoff — L569–899+ aoi) vs. *pure*
      Live-Activity payload builders (`_node_totals`, `_live_activity_payload`,
      `_fraction`, L232–568) → extract payload module; becomes unit-testable without
      aiohttp stubs.

- [ ] **6. Legacy sweep pass**
      - `mobile_file_state._full_sha256` — marked "only for the transitional legacy fallback"
      - `mobile_file_favorites` — v3.1.1 legacy import kept in `__init__.py` by merge-policy note
      Decide: deprecation window, then delete.

## JavaScript

- [x] **7. ⭐ Split `src/hooks/useWorkflow.ts` (7216 LOC)** — **DONE** ✅
      Extracted into `src/hooks/useWorkflow/` modules (precedent:
      `metadataNormalization.ts`, `workflowInputs.ts`). Public API preserved
      via re-exports; all moved code copied verbatim (no rewrites).

      **Pass 1** (pure logic out of the store file):
      - `layoutOps.ts` — `buildLayoutForWorkflow`, `findPathToRepositionTarget`,
        `removeNodesFromWorkflow`, `updateNodeWidgetValues(s)`, `RepositionScrollTarget`
      - `seedExpansion.ts` — `buildSubgraphSeedWidgetDescriptors`,
        `applySeedOverridesForExpansion`, `inferSeedMode`, `deriveSeedModes`
      - `comboValues.ts` — `collectWorkflowLoadErrors`, `normalizeWorkflowComboValues`
      - `sessions.ts` — session runtime: `MAX_WORKFLOW_SESSIONS`,
        `capPromptToSession`, `clearedWorkflowContent`, `generateSessionId`,
        `reconcileRehydratedSessions`, `normalizeSessionInPlace`,
        `stripLatentPreviewsFromSnapshots`
      - `signature.ts` — `getWorkflowSignature`, `isWorkflowModified` (+ cache)

      **Pass 2** (types + remaining helpers, `useWorkflow.ts` → **5843 LOC**):
      - `state.ts` — canonical state types: `WorkflowState` interface,
        `WorkflowSession{Snapshot,Meta}` shapes, `SESSION_STATE_FIELDS`,
        `SavedNodeState`/`SavedWorkflowState`, `NodeComparerOutput`/`Deno*`,
        `WorkflowSource`, `PendingWorkflowOpen`, `LoadWorkflowOptions`,
        `SeedLastValues`. Single type location; kills the
        `sessions.ts → useWorkflow.ts` cross-import (now `sessions → state`).
      - `helpers.ts` — `yieldToBrowserPaint`, `workflowDisplayName`,
        `queueWorkflowLabel`, `stripNodeWidgetIndexMap`
      - `sessions.ts` now re-exports its former session types from `state.ts`
        so previous importers keep working.

      **Pass 3** (store-body actions → sibling modules, `useWorkflow.ts` → **4377 LOC**):
      - `state.ts` gains `WorkflowSet`/`WorkflowGet` (zustand's own
        `StoreApi<WorkflowState>["setState"]` / `() => WorkflowState`) so action
        factories extracted out of the `(set, get) =>` closure keep full typing.
      - `writeTarget.ts` — parked-session write routing: `resolveWriteTarget`,
        `patchParkedSession`, `resolveWriteContext`, `writeNodeKeyedField`.
        All pure functions of `state` (no `set`/`get`), so plain top-level exports.
      - `nodeControl.ts` (19 actions via `createNodeControlActions(set, get)`):
        `updateNodeWidget(s)`, `updateNodeProperties`, `updateNodeTitle(s)`,
        `updateSubgraphInnerNodeWidget`, `renameSetGetNode`,
        `convertImageOutputNode`, `toggleBypass`, `bypassAllInContainer`,
        `deleteContainer`, `updateContainerTitle`, `updateWorkflowItemColor`,
        `cycleConnectionHighlight`, `setConnectionHighlightMode`, `setItemHidden`,
        `setItemCollapsed`, `revealNodeWithParents`, `showAllHiddenNodes`,
        `scrollToNode`. Cross-calls that bridge the boundary resolve the names
        from the store scope: `popWidgetToPrimitive` (still in the store body)
        calls `updateNodeWidget`/`updateNodeTitle` via the destructured factory
        result; its parked-session writes use `./writeTarget`.

      **Pass 4** (store-body actions → 3 domain factories, `useWorkflow.ts` → **423 LOC**;
      7216 → 423, 94% smaller, over the whole effort):
      - `nodeErrors.ts` — `createApplyNodeErrors(set, get)`: the shared
        error-unhiding helper (used by both `queueWorkflow` and `loadWorkflow`,
        i.e. straddling two other clusters, so it got its own leaf module).
      - `graphEdit.ts` (21 actions via `createGraphEditActions(set, get)`):
        `deleteNode`, `collapseSetGetNodes`, `connectNodes`, `disconnectInput`,
        `addNode`, `duplicateNode`, `pasteClipboard`, `copyContainer`,
        `pasteIntoContainer`, `addGroupNearNode`, `copySelectedItems`,
        `deleteSelectedItems`, `createGroupFromItems`, `addNodeAndConnect`,
        `ensureWidgetInputSlot`, `popWidgetToPrimitive`, `enterSubgraph`,
        `exitSubgraph`, `exitToRoot`, `exitToDepth`,
        `navigateToSubgraphTrail`. Owns the `currentScopeSubgraphId` helper,
        `PRIMITIVE_NODE_TYPE_BY_VALUE_TYPE` table, and the
        `editContainerLabelRequestId` counter. Cross-boundary calls
        (`deleteContainer`, `updateNodeWidget`, `updateNodeTitle`) go through
        `get()` (store API), so no import cycle with `nodeControl.ts`.
      - `execution.ts` (20 actions via `createExecutionActions(set, get)`):
        `queueWorkflow` (719L), `setExecutionState`, `applyControlAfterGenerate`,
        node/comparer/text output setters + clearers, latent preview tiles,
        prompt outputs, and the run-state setters (`setRunCount`,
        `setInfiniteLoop`, `setIsStopping`, `setSavingSessionId`,
        `setFollowQueue`). Owns the `queueLatentSeq` counter.
      - `sessionActions.ts` (22 actions via `createSessionActions(set, get)`):
        `switchToSession`, `closeSession`, `resolveCloseForNewWorkflow`,
        `cancelCloseForNewWorkflow`, `loadWorkflow`, `unloadWorkflow`,
        `setSavedWorkflow`, `saveCurrentWorkflowState`, `setMobileLayout`,
        `commitRepositionLayout`, `setNodeTypes`, `addInputComboOption`,
        `setSearchQuery/Open`, `requestAddNodeModal` (+ clearers),
        `prepareRepositionScrollTarget`, `toggleConnectionButtonsVisible`,
        `updateWorkflowDuration`, `clearWorkflowCache`,
        `ensureHierarchicalKeysAndRepair`. Owns the
        `captureActiveSnapshot`/`parkActiveSession`/`flatFieldsFromSnapshot`
        closures and the `addNodeModalRequestId` counter.
      - Cross-cluster dependency: `loadWorkflow` and `queueWorkflow` each
        instantiate `createApplyNodeErrors(set, get)` inside their own factory —
        a leaf module referenced one-directionally, no cycles.
      - Result: `useWorkflow.ts` is now a pure store-assembly module —
        imports/re-exports + 4 factory destructures + state defaults + return
        object + persist config (423 LOC).

      **Package shape** (7603 LOC total):
      | module | LOC | role |
      |---|---|---|
      | nodeControl.ts | 1490 | 19 node/container/visibility actions |
      | graphEdit.ts | 1395 | 21 node/graph/subgraph editing actions |
      | execution.ts | 1274 | 20 queue/execution/output actions |
      | sessionActions.ts | 1172 | 22 session/admin actions |
      | state.ts | 516 | state types + `WorkflowSet`/`WorkflowGet` |
      | sessions.ts | 332 | session record primitives |
      | layoutOps.ts | 242 | layout rebuild/path ops |
      | comboValues.ts | 178 | combo option normalization |
      | seedExpansion.ts | 171 | seed widget expansion |
      | metadataNormalization.ts | 140 | client-metadata strip/restore |
      | writeTarget.ts | 92 | parked-session write routing |
      | helpers.ts | 63 | paint yield/labels/etc. |
      | signature.ts | 59 | workflow signature |
      | nodeErrors.ts | 56 | shared error-unhide helper |

      Verified: `tsc --noEmit -p tsconfig.app.json` ✓, `eslint` 0 problems ✓,
      vitest 182 files / 1653 tests ✓, `pytest` 350 passed / 5 skipped ✓.

- [ ] **8. Second-tier JS candidates** (after #7)
      - `src/components/WorkflowPanel.tsx` (2044) — `WorkflowPanel/NodeCard/Parameters.tsx`
        already exists, precedent in place
      - `src/components/QueuePanel/QueueCard.tsx` (1980) — `QueuePanel/` split started
      - `src/components/OutputsPanel.tsx` (1978)
      - `src/hooks/useWebSocket.ts` (1502)

## Conventions

- Public API surface preserved via re-exports so importers don't churn.
- Every extraction validated by the full suite: `pytest -q` (350 passed / 5 skipped)
  + `npx vitest run` (182 files / 1653 tests).
- ComfyUI runtime path re-verified with the stub simulation if `__init__.py` wiring is
  touched (stub `server`/`aiohttp`/`folder_paths`, import as a package, expect
  "Mobile UI enabled at: /mobile").
