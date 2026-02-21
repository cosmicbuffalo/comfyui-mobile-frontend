# Changelog

## 2.2.1 - 2026-02-20

### Added

- Load workflow from videos in the media viewer — the viewer checks for an associated image sidecar to extract embedded workflow metadata, and shows the Load Workflow button when one is found
- New backend endpoint `GET /mobile/api/workflow-availability` to check whether a file has an associated workflow without fetching full metadata

### Changed

- Loading a workflow from the image/outputs viewer now first resolves against in-memory run history before falling back to a network fetch
- Extracted shared path resolution and workflow extraction logic into helper functions in the backend, reused across file-metadata and workflow-availability endpoints

### Fixed

- Missing stable keys on nodes, groups, and subgraphs are now repaired on every workflow load, preventing crashes when loading externally-generated or older workflows
- Hidden items, collapsed state, and bookmarks had various small but annoying bugs related to failed stable key mappings, causing bookmarks to disappear or groups to get stuck folded
- Embed workflow sync now propagates the full node state (mode, flags, properties, title, color, bgcolor) back to the embed workflow, not just widget values

## 2.2.0 - 2026-02-17

### Added

- LoRA Manager integration layer:
  - Support for LoraManager nodes and websocket integration (thanks @pccr10001!)
- Node text output previews are now rendered in the workflow panel
- Focused unit/integration coverage for LoRA Manager and related serialization behavior:
  - `loraManager` utils
  - `triggerWordToggle` utils
  - LoRA manager store/action flows
  - viewer image building and temp-source workflow path resolution

### Changed

- Queue/Image Viewer media pipeline now includes preview/temp images in the same generated order instead of output-only lists
- Follow Queue mode now advances using all generated media (including previews), not just saved output files

### Fixed

- Loading workflow metadata from temp images now resolves `temp` as a first-class source instead of incorrectly defaulting to `output`
- Queue card image ordering mismatch that could open the wrong media item when previews were present

## 2.1.0 - 2026-02-15

### Added

- Expanded workflow editing support: add/remove nodes, reconnect node inputs/outputs, and reposition items on the mobile layout
- Generic container editing actions for both groups and subgraphs (hide, bookmark, bypass nested nodes, delete container-only or container + nested contents)
- Outputs panel rename actions for both files and folders

### Changed

- Unified group/subgraph rendering into shared container components across workflow and repositioning views
- Migrated workflow UI state handling to stable identity keys for item-level state operations
- Consolidated context-menu trigger button variants into shared reusable button components

### Fixed

- Move modal now respects hidden-folder visibility settings when selecting destination folders
- Multiple container and bookmark state consistency issues after key/state refactors

## 2.0.6 - 2026-02-08

### Fixed

- Fix image loading bug in media viewer
- Minor cosmetic UI fixes

## 2.0.5 - 2026-02-07

### Added

- Workflow and template search

## 2.0.4 - 2026-02-06

### Changed

- README updates and documentation fixes
- Added `pyproject.toml`
- Added automatic publish action setup
- Added initial test suite setup

## 2.0.3 - 2026-02-06

### Fixed

- Bugfixes for movement and selection of files/folders in the outputs panel

### Changed

- Added screenshots to project documentation

## 2.0.2 - 2026-02-02

### Fixed

- Fix pinch-to-zoom and panning being janky and unresponsive in the image viewer
- Fix pinned widget edit modal appearing behind the image viewer

## 2.0.1 - 2026-02-02

### Fixed

- Fix delete and load workflow confirmation modals appearing behind the image viewer
- Fix widget edit modal content being hidden behind the bottom bar when text is long; content area is now scrollable

## 2.0.0 - 2026-01-27

### Added

- **Outputs panel** - Browse, search, filter, and manage files in your outputs and inputs folders directly from the app
- **Multi-panel navigation** - Swipe between Workflow, Queue, and Outputs panels, or use top bar menu options
- **Group and subgraph support** - Collapse, expand, and hide node groups and subgraphs
- **Pinned widget overlay** - Pin a frequently-used widget to the bottom bar for one-tap editing from anywhere
- **Node bookmarks** - Pin up to 5 nodes to a floating bookmark bar for quick access
- **Node search** - Search workflow nodes by name, type, or group
- **Media viewer** - View images and videos with enhanced control overlays
- **Batch selection** - Select multiple output files for bulk actions
- **File operations** - Delete, move, and organize input/output files and folders
- **Favorites** - Star favorite output files for quick access
- **Output filtering** - Filter outputs by file type, filename, change sort order

### Changed

- Massive refactors to app internal structure to inch away from vibecoded nonsense to something a bit more maintainable
