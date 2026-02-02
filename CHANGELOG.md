# Changelog

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
