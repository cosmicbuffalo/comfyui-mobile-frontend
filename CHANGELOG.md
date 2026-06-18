# Changelog

## 3.0.2 - 2026-06-18

### Added

- **Push notification backend.** Server-side completion detection (poll-and-diff on `PromptServer.instance.prompt_queue.history`) plus two delivery sinks:
  - **Native-app push** via a relay: `/mobile/api/push/app-targets` registers a `{relay_url, pairing_code, server_id, label}` target; the node POSTs `/event` to the relay on completion; the relay holds the APNs key and fans out to paired devices. `server_id` is forwarded so the iOS app can route a notification tap to the right server when multiple are paired.
  - **Web Push** (browser, self-hosted, no third party): `/mobile/api/push/{config,subscribe,unsubscribe,test}` for VAPID/pywebpush subscriptions; service worker shows the notification.
- `/mobile/api/push/preferences` toggles for `notifyOnComplete`, `notifyOnError`, and `includeThumbnail`.
- Regression tests for the native-app push module (`tests/test_mobile_app_push.py`).

### Notes

- **Web Push UI (in-app menu toggles, subscribe button, service worker registration) is intentionally not included in this release.** Those changes depend on other unrelated v3.1.0 work. Backend is functional for direct API callers (and for the iOS app, which doesn't use the web UI anyway). The Web Push browser UI will land in a later release alongside its supporting frontend changes.
- New runtime dep `pywebpush>=2.0` (declared in `requirements.txt`). If it's missing the node still loads; `/mobile/api/push/config` reports `{"enabled": false, "reason": …}` and web push is no-op'd.

## 3.0.1 - 2026-06-17

### Added

- **Load a workflow from an image:** drag an image onto the workflow panel or pick one via "From Device" to load the workflow embedded in its metadata, extracted entirely client-side from PNG `tEXt`/`iTXt` or WEBP/JPEG EXIF. The device picker now accepts images alongside `.json`, the panel shows a "Drop to load workflow" overlay while dragging, and a dismissible dialog explains when an image carries no embedded workflow
- **Image viewer zoom & pan (desktop):** zooming (Ctrl-scroll / trackpad pinch) now anchors at the cursor instead of growing from center, and a plain scroll wheel / trackpad pans the image once zoomed in (no more click-drag-only)

### Fixed

- **Workflows silently producing no output:** a stale closed-enum combo value (e.g. a captured action-widget placeholder) was sent verbatim, so ComfyUI dropped that node's whole branch and the prompt "succeeded" with no output. Closed-enum values now fall back to the default, while file-picker values are still kept as-is so the server can resolve or clearly reject them
- **Over-max seeds rejected at validation:** randomized/queued seeds are now clamped to each node's declared seed maximum (with a universal 2^32-1 ceiling), so nodes that cap the seed below 2^64 (e.g. Qwen-VL) no longer get silently dropped from the run
- **405 on Custom Nodes Manager install:** the queue reset/start calls now try `POST` and fall back to `GET`, so install/update works across ComfyUI-Manager versions that register those endpoints with either method
- **Prompt-preview overflow:** long unbroken values (file paths, seeds, hex tokens) in the prompt-preview diff now wrap instead of overflowing the container

## 3.0.0 - 2026-06-11

### Added

- **Multiple workflows open at once:** keep up to 10 workflows loaded and switch between them from a tab strip under the top bar. Exactly one workflow is active while the others are held in the background. Tabs show a per-workflow queue count (with progress ring) or an animated infinite-generation indicator, a `*` when there are unsaved changes, and a one-click close button when saved. Open workflows, the active tab, and which workflow is looping all survive a refresh
- **Per-workflow infinite generation:** at most one workflow loops at a time; switching tabs leaves the loop running on its workflow, and enabling it elsewhere moves it. A safety check stops the loop with an explanation if it would re-submit an identical prompt forever (e.g. a fixed seed)
- **Use an output in a specific open workflow:** the "use in workflow" picker now lets you choose which open workflow to load the image into when more than one is open
- **Rich model picker** with Lora Manager metadata, plus a standalone fallback when Lora Manager isn't installed
- **Image Comparer node support** with handle to drag for side by side comparison (rgthree)
- **Custom nodes manager modal** for browsing/managing custom nodes from the app
- **Workflow folders:** organize saved workflows into folders — create, rename, and delete folders from the Workflows panel, navigate in and out, and have folders sort by their most recently modified workflow
- **Bookmarks for workflows and templates:** a bookmark toggle on each item plus a "show bookmarks only" filter in both the Workflows and Templates panels. Bookmarks are stored per-device, follow workflows and folders through rename/move, and are cleared automatically when an item is deleted
- **Hidden workflows & folders:** mark saved workflows or folders as hidden (Workflows panel → Hide/Unhide), with a "show hidden" toggle. A declutter convenience only (not access control); the hidden list is saved to your ComfyUI user data and persists across sessions, and any output created from a hidden workflow is also hidden automatically in the outputs panel
- **Backend connection overlay:** a clear "connection lost / reconnecting" overlay when the ComfyUI backend goes away, and a notice on reconnect if a running/queued job was interrupted (with optional auto-restore)
- **Duplicate nodes and subgraphs:** a "Duplicate" action in the node menu copies a node — or an entire subgraph, internals and all — keeping its input connections and leaving outputs unconnected
- **Aliased paths:** an opt-in preference replaces local input paths and output filename prefixes with opaque aliases in the workflow embedded in shared images/JSON, so sharing a workflow doesn't leak your folder structure; the real values are restored automatically when loaded into the workflow panel
- **Animated tab favicon:** the browser-tab icon pulses green while a generation is running and is solid cyan when idle, so you can watch progress from another tab
- **Live outputs refresh:** while you're on the Outputs panel, images from a finished run appear in the folder you're viewing automatically
- **Paged queue history:** the Queue page loads runs as you scroll instead of stopping at a fixed count, and the header shows the true total run count in your server's history
- **Resolution everywhere:** the image viewer shows the source resolution under the filename, and queue/output thumbnails carry resolution and file-size badges (previews included)
- **Restart ComfyUI from the app:** a "Restart ComfyUI" button under Menu → Server restarts the backend (with a confirmation), then waits for it to come back and reloads automatically
- **Outputs panel improvements:** multiple tabs, download-to-device, hidden folders/outputs, prompt search, range selection
- **Beginnings of desktop support:** somewhat more responsive interface, keyboard controls!
  - arrows to move through the media viewer
  - delete - open the delete dialog + enter to submit
  - `f` to toggle favorite
  - `d` to download
  - `w` to load the image's embedded workflow
  - `u` to use the image in a workflow (images only)
  - `i` to toggle the metadata overlay
  - `q` to toggle follow-queue mode (or open the viewer in follow-queue mode from the workflow/queue panels)
  - `p` to toggle the pinned widget editor
  - escape to close the viewer (or the topmost open modal)

### Changed

- **Dark theme:** the entire UI was restyled to a slate/cyan dark palette, routed through shared style modules. This is now the only theme — light mode is dead
- **Faster image reuse:** reusing an output in a workflow now does a single server-side copy into the input folder instead of downloading and re-uploading the file, and no longer blocks on a node-types refresh
- Inline output and combo thumbnails load small webp previews instead of full-resolution images
- **Smoother queue & outputs panels:** the queue list and the outputs grid render incrementally and only re-render what changed, staying responsive with large histories and folders; queue scroll position stays put while images load and new runs arrive
- **More responsive server:** image-metadata, thumbnail/video-frame, and model-list work now runs off the web-server event loop, and model listings are cached, so browsing stays snappy under load
- **Pinned-widget editor leaves the bottom bar reachable** — you can queue/iterate while it's open (other full-screen modals still cover the bar)
- **Redesigned queue cards:** each run shows one media slot with a tab bar to switch between its previews and outputs (videos are pinned by default). The slot only swaps once the next image has decoded, so cards no longer flash or jump as results stream in
- **Move destinations** show the real source name (Inputs / Outputs / Temp) instead of "Root"

### Fixed

- Seed-related widgets had a few bugs that have since been fixed
- Batch downloads keep each file's real filename instead of naming them all `image.png`
- **Fixed input connection editor:** choosing an input connection now uses the same tap-to-select / Apply flow as outputs instead of immediately closing and scrolling the view
- **Stale image after delete:** regenerating an output that reuses the filename of one you just deleted now shows the new image instead of the cached deleted one

### Security

- Hardened directory checks on the file-serving endpoints so a crafted path can't escape the output/input folders, and restricted the model-preview endpoint to image/video files only

## 2.6.3 - 2026-05-24

### Fixed

- KSampler SDXL (Eff.) and other Efficient Nodes samplers now work correctly when the saved workflow keeps the `control_after_generate` slot but stores `null` in it. The previous fix in 2.6.2 only handled the case where the slot was stripped entirely; nulled slots still caused widget values to be read one position off, producing spurious "Missing on ComfyUI server" badges on `sampler_name`, `preview_method`, etc., and sometimes rejected queues (#57)

## 2.6.2 - 2026-05-23

### Fixed

- "Unsaved changes" confirmation dialog (triggered from the outputs panel viewer's load-workflow button) no longer leaves an unstyled gap at the top where the hidden top bar would be
- Seed overrides for `noise_seed` inputs (used by Efficient KSampler Adv, KSampler SDXL Eff., etc.) now resolve correctly at queue time. Previously the special-mode value `-1` was sent to the server, which rejected it due to `min: 0` (#57)
- Reading widget values for nodes whose JS strips the auto `control_after_generate` widget (Efficient KSampler family) no longer reads later inputs from the wrong array indices. This eliminates spurious "Missing on ComfyUI server" badges on sampler_name, scheduler, preview_method, and similar inputs

## 2.6.1 - 2026-05-18

### Added

- **Image favorites in the viewer:** new heart button next to the load-workflow and use-in-workflow buttons. Outline when not favorited, solid red when favorited. Toggling works the same in the queue follow-mode viewer and the outputs panel viewer — state is shared, so favoriting an image anywhere updates it everywhere
- **Seed (rgthree) node support:** dedicated controls matching the desktop rgthree Seed node — 🎲 Randomize each time, 🎲 New fixed random, and ♻️ Use last queued seed (with the last queued value shown in the button label). When randomize mode is selected the seed field displays `-1`, matching the desktop behavior

### Changed

- Heart icon (solid red) replaces the yellow bookmark indicator on favorited files in the Outputs panel
- Skip button in the bottom bar uses an SVG icon instead of an emoji
- Image viewer modals (delete, unsaved changes) now cover the full viewport instead of leaving an unstyled gap at the top where the (hidden) top bar would be
- Trash icon in the image viewer's delete button is nudged for better optical centering

### Fixed

- Run-count picker no longer briefly appears between clicking Stop and execution actually ending in infinite generation mode
- "Seed control" dropdown no longer renders blank for rgthree Seed nodes (and no longer overrides the seed widget with a real number on queue when the node has a stale empty control value)

## 2.6.0 - 2026-05-17

### Added

- **Infinite generation:** new ∞ toggle beside the run button starts an unbounded loop where each finished run automatically queues the next, similar to desktop's "Run (Instant)" (#54, thanks @mario-marin!). The run button becomes Stop, with a Skip button for advancing past the current iteration without ending the loop. Gated behind an opt-in "Enable infinite mode" preference under Menu → Server → Preferences
- **Image viewer keyboard navigation:** left/right arrow keys step through images (left → newer, right → older), and Escape closes the viewer

### Fixed

- Image viewer no longer hides in-progress previews when older runs in the same history already produced saved outputs — the preference is now applied per item, so each run shows its outputs if it has any and its previews otherwise

## 2.5.1 - 2026-05-14

### Fixed

- Mobile prompt generation now resolves KJNodes `GetNode`/`SetNode` virtual links, fixing workflows with subgraphs that previously failed validation with missing inputs.

## 2.5.0 - 2026-05-04

### Added

- **In-app feedback:** new "Send Feedback" button in the About section of the app menu opens a modal that lets you file a GitHub issue without needing a GitHub account. Submissions are forwarded through a small open-source Cloudflare Worker ([cosmicbuffalo/comfyui-mobile-frontend-feedback-worker](https://github.com/cosmicbuffalo/comfyui-mobile-frontend-feedback-worker)) that creates the issue on the project's GitHub repo on your behalf
- Optional **diagnostic info** checkbox attaches your ComfyUI version, OS, and other system info to help with debugging — opt-in only, with a preview shown before you submit so you can see exactly what's included
- Optional **contact field** for follow-up. Verified GitHub handles get `@-mentioned` in the public issue; anything else (email addresses, phone numbers, free text) is treated as private and forwarded to the maintainer's inbox instead of being written into the public issue body

## 2.4.1 - 2026-05-02

### Fixed

- Fast Groups Bypasser config modal now stays within the visible viewport on mobile screens
- Improved LoRA Manager node registration for subgraphs by sending the subgraph name and node bypass mode to the backend
- Fixed LoRA Manager text-widget resolution when metadata widgets are present, preventing metadata blobs from appearing in prompt fields
- Fixed LoRA name normalization so trigger-word lookups use the basename without model file extensions
- Prevented LoRA Text Loader nodes from gaining a phantom LoRA list widget when saving from mobile

## 2.4.0 - 2026-03-24

### Added

- **Follow executing node:** tap the progress overlay during generation to scroll to and follow the currently executing node. Automatically navigates into subgraphs when enabled (configurable in Preferences)
- **Use from outputs:** upload-capable combo widgets gain a "Use from outputs" button that opens a browsable folder picker over the ComfyUI output directory, letting you copy a generated image or video into inputs without leaving the mobile UI
- **Video upload:** combo widgets that accept video files (e.g. VHS LoadVideo) now show an "Upload video from device" button, auto-detected by widget name or file extensions
- **Preferences panel:** new submenu under Server section for configuring generation and execution behavior
- **Latent previews:** live preview images on sampler nodes during generation. Enable via Main Menu → Server → Preferences. Choose between Fast (latent2rgb) or Accurate (TAESD) preview methods. Off by default
- **Fast Groups Bypasser config editor:** Fast Groups Bypasser (rgthree) nodes now expose an "Edit config" action from the node context menu for updating group filters and sort behavior directly in the mobile UI

### Fixed

- Subgraph inner nodes now correctly resolve for execution tracking (progress, outputs, errors) even when the user hasn't navigated into that subgraph scope
- Upload and output picker errors now surface in the error toast instead of failing silently
- Root subgraph placeholder fold state now persists across refreshes

## 2.3.3 - 2026-03-22

### Added

- **Server Info** shown in app menu, includes GPU/VRAM/RAM, etc
- **Recent Workflows:** new "Recent" button in the Load section shows the 10 most recently opened workflows, including workflows loaded from output/queue files. Persisted locally with server backup sync
- **Wildcard connection grouping:** connection picker now shows concrete type matches at the top, with wildcard-compatible nodes listed below a "Wildcard *" separator
- Clear button on the Recent Workflows panel to reset the list

### Fixed

- Workflows loaded from output files now track their source file, display the filename, and can be reloaded from the Recent list
- Reload from source now supports file-sourced workflows

## 2.3.2 - 2026-03-17

### Added

- **Folder navigation in My Workflows:** browse into subfolders with drill-down navigation instead of a flat file list
- Search still flattens results across all folders, with subfolder path shown as a subtitle

### Fixed

- Workflows saved in subfolders now load correctly (fixes #38)
- Workflow title bar and save button display only the workflow name without folder path

## 2.3.1 - 2026-03-17

### Fixed

- Bookmark repositioning works again
- Also fixes resolution of bookmarks for nodes with repeated IDs in root/subgraph scopes

## 2.3.0 - 2026-03-17

### Added

- **Improved Subgraph Support:** subgraph placeholder nodes now render on the mobile frontend.
  use the "Enter subgraph" action to drill into the subgraph and manipulate its inner nodes
- Widget controls on subgraph placeholder nodes: promoted widgets (slot-promotion and
  proxyWidgets mechanisms) now appear as editable controls on the placeholder card
- Breadcrumb bar shows the current scope path (Root / Subgraph Name) when inside a
  subgraph; tap a crumb to jump back up the stack
- **Smart bookmarks:** bookmarks work across root/subgraph scopes; tapping a bookmark for a
  node inside a different scope will automatically navigate to that scope
- Add Group action in the workflow options menu now places the new group near the
  currently visible nodes rather than always at the document origin
- Reposition mode now syncs node positions and group bounding boxes in the workflow
  geometry when nodes move between groups or scopes in the mobile layout (experimental)

### Removed

- Light mode (temporarily? I just don't want to waste time tweaking colors in a theme I never use)
- Movement of nodes/groups across subgraph boundaries
- Legacy workflow state compatibility (Back up your mobile workflows before upgrading to v2.3.0 just in case)

### Fixed

- **ComfyUI Frontend compatibility:** Saving a carefully crafted desktop workflow containing subgraphs
  in the mobile frontend no longer butchers your workflow by dumping everything into the root scope!
- **Group display:** fixed various issues with group containment logic and colors

## 2.2.3 - 2026-03-15

### Added

- Visual bypass indicators for groups — groups with all nodes bypassed turn purple, collapsed groups with some bypassed nodes show a bypass icon with count badge
- Purple card outline on the Fast Groups Bypasser (rgthree) node for fully bypassed groups

### Fixed

- Collapsed bypassed nodes no longer show a bottom border color bleed
- Workflow saves not persisting across sessions — browser cache and workflow source tracking now update correctly after saving

## 2.2.2 - 2026-02-24

### Added

- Color picker for nodes and groups, tap "Change color" from the node/group context menu to choose from the standard ComfyUI palette

### Changed

- Cosmetic changes to the outputs panel and filter modal, moved some things around, changed some colors
- Cosmetic tweaks to node/container menus and fold animations

### Fixed

- Cycle detection in connection suggestions, results now filter out nodes that would create a cycle in the workflow graph
- Default sort and direction arrows in the outputs panel now look more intuitive

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
