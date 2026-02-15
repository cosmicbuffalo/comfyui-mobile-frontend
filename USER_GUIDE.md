# ComfyUI Mobile User Guide

This guide walks through every feature in the mobile frontend as of `v2.0.0`

## Table of Contents

- [How-To](#how-to)
  - [How do I load a workflow?](#how-do-i-load-a-workflow)
  - [How do I save my workflow?](#how-do-i-save-my-workflow)
  - [How do I use an output image in my current workflow?](#how-do-i-use-an-output-image-in-my-current-workflow)
  - [How do I run my workflow multiple times?](#how-do-i-run-my-workflow-multiple-times)
  - [How do I watch outputs as they are generated?](#how-do-i-watch-outputs-as-they-are-generated)
  - [How do I find a specific node in my workflow?](#how-do-i-find-a-specific-node-in-my-workflow)
  - [How do I quickly edit a widget I change often?](#how-do-i-quickly-edit-a-widget-i-change-often)
  - [How do I skip (bypass) a node in my workflow?](#how-do-i-skip-bypass-a-node-in-my-workflow)
  - [How do I re-run a previous generation?](#how-do-i-re-run-a-previous-generation)
  - [How do I trace which nodes are connected to each other?](#how-do-i-trace-which-nodes-are-connected-to-each-other)
  - [How do I delete old outputs in bulk?](#how-do-i-delete-old-outputs-in-bulk)
  - [How do I organize my output files into folders?](#how-do-i-organize-my-output-files-into-folders)
  - [How do I switch between my outputs and input images?](#how-do-i-switch-between-my-outputs-and-input-images)
  - [How do I navigate between pages?](#how-do-i-navigate-between-pages)
- [Main Workspace](#main-workspace)
  - [Main Menu](#main-menu)
    - [Load Workflow](#load-workflow)
    - [Save Workflow](#save-workflow)
    - [Appearance](#appearance)
    - [About and Help](#about-and-help)
  - [Top Bar](#top-bar)
  - [Bottom Bar](#bottom-bar)
  - [Swipe Navigation](#swipe-navigation)
- [Workflow Page](#workflow-page)
  - [Workflow Options Menu](#workflow-options-menu)
  - [Containers (Groups and Subgraphs)](#containers-groups-and-subgraphs)
  - [Node Cards](#node-cards)
  - [Node Connections](#node-connections)
  - [Parameters and Widgets](#parameters-and-widgets)
  - [Bookmarks](#bookmarks)
  - [Reposition Mode](#reposition-mode)
  - [Search](#workflow-search)
  - [Notes](#notes)
  - [Output Preview](#output-preview)
  - [Errors](#errors)
- [Queue Page](#queue-page)
  - [Queue List and Status](#queue-list-and-status)
  - [Queue Options Menu](#queue-options-menu)
  - [Queue Card Details](#queue-card-details)
  - [Images, Previews, and Video](#images-previews-and-video)
  - [Queue Item Menu](#queue-item-menu)
- [Outputs Page](#outputs-page)
  - [Source Switching](#source-switching)
  - [Folder Navigation](#folder-navigation)
  - [View Modes](#view-modes)
  - [Filtering and Sorting](#filtering-and-sorting)
  - [Favorites](#favorites)
  - [Selection Mode](#select-mode)
  - [File Actions](#file-actions)
  - [Use in Workflow](#use-in-workflow)
  - [Outputs Viewer](#outputs-viewer)
- [Image Viewer](#image-viewer)
  - [Open and Navigate](#open-and-navigate)
  - [Zoom and Pan](#zoom-and-pan)
  - [Metadata Overlays](#metadata-overlays)
  - [Follow Queue Mode](#follow-queue-mode)
  - [Video Playback](#video-playback)

<a id="how-to"></a>
## How-To

### How do I load a workflow?

Open the [Main Menu](#main-menu) from the hamburger icon in the top-left corner. Under **Load Workflow**, you can browse your saved workflows on the server, pick from bundled templates, paste workflow JSON directly, or upload a JSON file from your device. See [Load Workflow](#load-workflow) for details on each option.

### How do I save my workflow?

Open the [Main Menu](#main-menu) and look under **Save Workflow**. Use **Save** to overwrite the current file, **Save As** to save under a new name on the server, or **Download to Device** to save a local copy as JSON. An unsaved-changes indicator (blue asterisk) appears in the [Top Bar](#top-bar) on the workflow page when you have edits that haven't been saved yet.

### How do I use an output image in my current workflow?

There are two ways. From the [Outputs Page](#outputs-page), tap the `...` on any image and select "Use in workflow" — or open any image in the [Image Viewer](#image-viewer) and tap the [Use in Workflow](#use-in-workflow) action button (the arrow pointing right). Either way, a modal will list all LoadImage nodes in your current workflow. Tap the node you want to load the image into, and the app will switch to the [Workflow Page](#workflow-page) and scroll to that node with the image already set.

### How do I run my workflow multiple times?

Use the run count buttons (minus/plus) in the [Bottom Bar](#bottom-bar) to set how many runs to enqueue, then tap the **Run** button. Each run is queued separately on the server. You can monitor all pending and running items on the [Queue Page](#queue-page).

### How do I watch outputs as they are generated?

Tap the queue/follow button in the [Bottom Bar](#bottom-bar) to open the [Image Viewer](#image-viewer) in [Follow Queue Mode](#follow-queue-mode). The viewer will automatically jump to each new output as it finishes generating. Tap the button again to pause or resume following.

### How do I find a specific node in my workflow?

Open the [Workflow Options Menu](#workflow-options-menu) (the `...` in the top-right on the workflow page) and tap **Search**. A search bar appears at the top of the node list where you can type to filter by node title, type, class name, or ID. The search uses fuzzy matching, so partial words work. See [Workflow Search](#workflow-search) for more details.

### How do I quickly edit a widget I change often?

You can pin a widget to the [Bottom Bar](#bottom-bar) so it's accessible from any page. Open the node's `...` menu, select **Pin widget**, and choose which widget to pin (when there are multiple widgets to choose from). A shortcut button appears in the bottom bar — tap it to open an overlay editor for that widget without navigating back to the node. See [Parameters and Widgets](#parameters-and-widgets) for more.

### How do I skip (bypass) a node in my workflow?

Open the node's `...` menu and tap **Bypass node**. The node will be visually dimmed and skipped during execution. To re-enable it, open the same menu and tap **Engage node**. You can also hide bypassed nodes entirely from the [Workflow Options Menu](#workflow-options-menu) using "Hide bypassed nodes." See [Node Cards](#node-cards) for details.

### How do I re-run a previous generation?

Go to the [Queue Page](#queue-page) and find the completed run you want to repeat. Tap its `...` menu and select **Load workflow** to load the exact workflow and settings used for that run. You can then tap **Run** to execute it again. See [Queue Item Menu](#queue-item-menu) for all available actions on completed runs.

### How do I trace which nodes are connected to each other?

Each node card has a connection trace button that cycles through highlighting its inputs, outputs, both, or none. Tap it to see which nodes are upstream or downstream from the selected node. You can also tap individual [connection buttons](#node-connections) to jump directly to the connected node. If a node has multiple connections, a menu lists all destinations. Jumping through connections will jump through hidden nodes.

### How do I delete old outputs in bulk?

Go to the [Outputs Page](#outputs-page) and enter [Select Mode](#select-mode) from the `...` menu or a file's context menu. Tap files to select them, then tap the selection actions button in the [Bottom Bar](#bottom-bar) and choose **Delete**. To clear queue history instead, use the [Queue Options Menu](#queue-options-menu) — "Clear empty items" removes runs with no saved outputs, and "Clear history" removes everything.

### How do I organize my output files into folders?

On the [Outputs Page](#outputs-page), you can create new folders from the bulk selection's **Move** action. In the move, navigate to where you'd like to create a new folder, then enter the new folder and click Submit to complete the move. See [File Actions](#file-actions) and [Folder Navigation](#folder-navigation) for more details.

### How do I switch between my outputs and input images?

On the [Outputs Page](#outputs-page), tap the `...` menu in the top-right and select the option to switch between **Outputs** and **Inputs**. Outputs shows your generated images and videos, while Inputs shows uploaded assets (including duplicates of any images the "User in Workflow" action was triggered on). The [Top Bar](#top-bar) title updates to reflect which source is active. See [Source Switching](#source-switching).

### How do I navigate between pages?

Use [Swipe Navigation](#swipe-navigation): swipe left from the Workflow page to reach the Queue page, or swipe right to reach the Outputs page. Swipe in the opposite direction to go back. You can also use the quick-navigation links in each page's `...` menu (e.g., "Go to queue" or "Go to outputs" in the [Workflow Options Menu](#workflow-options-menu)).

<a id="main-workspace"></a>
## Main Workspace

The main workspace consists of three pages framed by a top and bottom control bar:  Workflow, Queue, and Outputs.

<a id="main-menu"></a>
### Main Menu

Open the main menu from the top-left hamburger icon to access workflow load/save actions and general app settings and info

#### Load Workflow

- My Workflows: load saved workflows from the ComfyUI server.
- Templates: load bundled templates grouped by module name from installed custom nodes.
- Paste JSON: paste workflow JSON to load it directly.
- From Device: upload a local JSON workflow file.

#### Save Workflow

- Save: overwrites the current workflow file when it has a filename.
- Save As: saves to a new filename on the server.
- Download to Device: saves the current workflow JSON locally.

#### Appearance

- Toggle between dark and light themes.

#### About and Help

- Open in GitHub: opens the open source project repo.
- Icon Legend: explains common UI icons.
- User Manual: opens this guide in your browser.

### Top Bar

- Main menu: hamburger icon opens the left-side menu for loading/saving of workflows, appearance, and app info.
- Title and status: shows the workflow name on the workflow page, queue summary on the queue page, or "Outputs"/"Inputs" on the outputs page.
- Unsaved indicator: a blue asterisk appears when the loaded workflow has unsaved changes.
- Node count: on the workflow page, shows total nodes and how many are hidden.
- Queue summary: on the queue page, shows run count and pending count.
- Outputs title: on the outputs page, shows "Outputs" or "Inputs" depending on which source is selected.
- Double-tap title: quickly scrolls to the top of the current page

### Bottom Bar

- Run count: use the minus/plus buttons to set how many runs to queue.
- Run button: queues the current workflow on the server X times as indicated by the run count.
- Pinned widget shortcut: appears when a widget is pinned for quick editing — tap it to open a modal to edit your pinned widget from anywhere.
- On the outputs page, the pinned widget button is replaced with a filter/sort button (or a selection actions button when in selection mode).
- Queue/follow button: opens the image viewer in follow queue mode, or toggles follow mode when the viewer is already open.
- Queue badge: shows total pending + running items; a ring indicates overall (estimated) progress of the current run.

### Swipe Navigation

- Swipe left from the Workflow page to open the Queue page.
- Swipe right from the Queue page to return to the Workflow page.
- Swipe right from the Workflow page to open the Outputs page.
- Swipe left from the Outputs page to return to the Workflow page.
- When inside a subfolder on the Outputs page, swiping right navigates up one folder level instead of switching panels.
- Swipe navigation is disabled when menus, the viewer, input fields, or selection mode are active.

<a id="workflow-page"></a>
## Workflow Page

The workflow page is the main editor view where you inspect and adjust your workflow nodes. This is the default page when loading the app, though it'll be empty if you haven't loaded a workflow. Load a workflow from the main menu to get started using the app.

### Workflow Options Menu

Tap the `...` button in the top-right to access workflow-wide actions:

- Go to queue / Go to outputs: quick navigation to other panels.
- Add node: open node search and create a new node directly in the current workflow.
- Search: opens a search bar to filter nodes by name, type, or ID with fuzzy matching.
- Show/Hide connection buttons: toggles connection tracing buttons on node cards.
- Fold all / Unfold all nodes.
- Hide or show static nodes (nodes without editable inputs).
- Hide or show bypassed nodes.
- Show all hidden nodes.
- Clear bookmarks: removes all bookmarked items (nodes and containers).
- Workflow actions: save, save as, reload, discard changes, clear cache, and unload.
- Reload the current workflow if it was loaded from a file, template, or past run.
- Clear workflow cache.
- Unload workflow to return to an empty state.
- Clear all cache (local storage, session storage, caches, cookies) and reload.

### Containers (Groups and Subgraphs)

- Groups and subgraphs are both treated as editable containers in the mobile UI.
- Container cards support:
  - Fold/unfold.
  - Bookmark.
  - Hide/show.
  - Move (reposition mode).
  - Add node inside container.
  - Bypass all nodes in container.
  - Delete container (container-only or container + nested contents).
- Nested containers are supported, including groups inside groups and groups/subgraphs within nested structures.
- Empty containers show a placeholder action to quickly add a node.

### Node Cards

Each node is displayed as a card with controls and status:

- Fold/unfold: tap the header or caret to collapse or expand.
- Bypass state: bypassed nodes are visually dimmed purple.
- Execution status: running nodes show a pulse; collapsed nodes show a progress ring.
- Errors: a warning icon opens a detailed error popover.
- Node `...` menu (ellipsis): edit label, bookmark node, bypass/engage node, hide node, move node, delete node, and pin a widget.
- Connection trace button: cycles through highlighting inputs, outputs, both, or off.

### Node Connections

- Inputs and outputs display as directional buttons.
- Tap a connection to jump to the connected node (through hidden nodes, if any).
- If multiple connections exist, a menu lists destinations (including via bypassed nodes).
- Long-press an input/output connection button to open connection editing.
  - Input connections: choose a source node (or add a compatible new node) for that input.
  - Output connections: multi-select target inputs to connect/disconnect in one submit action.
  - If a selected target already has another source connected, the modal asks for overwrite confirmation before replacing that link.

### Parameters and Widgets

- Controls adapt to widget type (number, text, combo, toggle, etc.).
- Textarea/textbox widgets have buttons to easily copy to clipboard or clear the contents of the box.
- A widget can be pinned to the bottom bar for quick editing from any page.
  - Pin a widget via the node card's `...` menu.
  - Tap the pinned widget shortcut in the bottom bar to open an overlay editor.
- KSampler nodes expose seed and seed-control widgets for fixed or randomized runs.
  - Seed controls support fixed, increment, decrement, and randomize control modes.
  - Primitive numeric nodes expose a control mode selection too.

### Bookmarks

- Items can be bookmarked for quick access (up to five bookmarks per workflow).
  - Bookmark nodes, groups, or subgraphs via each item's `...` menu.
- Bookmarks appear fixed to the edge of the screen
  - click a bookmark button to scroll to that item
  - long press to reposition the bookmarks list, tap again to lock in place
- Bookmarks will be remembered when loading workflows
- Use the "Clear Bookmarks" button in the workflow page `...` menu to delete all bookmarks for a workflow

### Reposition Mode

- Open reposition mode from a node or container `...` menu using **Move**.
- Drag and drop nodes and containers to reorder or move across containers.
- Click another item's hamburger button to change your repositioning target
- Click "Done" to confirm your moves, or "Cancel" to discard position changes

<a id="workflow-search"></a>
### Search

- Open search from the workflow page `...` menu.
- Type to filter nodes by title, type, class name, or ID.
- Uses fuzzy matching — partial words and multiple search terms are supported.
- Match against individual nodes or groups.
- Close search with the X button to return to the full node list.

### Notes

- Note nodes or note-like text properties render as a note block.
- Double-tap the note to edit it.
- URLs are automatically turned into links.
- Textarea tools allow copy and clear actions.

### Output Preview

- Nodes with output images show a preview thumbnail.
- Tap the preview to open the full-screen Image Viewer.

### Errors

- Nodes with errors are highlighted with red borders.
- Tap the error icon to see per-input error details.
- Loading a workflow with errors displays a popover just above the bottom bar. Click this popover to scroll between errored nodes.

<a id="queue-page"></a>
## Queue Page

The queue page shows pending, running, and completed generations. Get to the queue page by swiping left from the workflow page.

### Queue List and Status

- Items are grouped by status: pending, running, then completed.
- Completed items are sorted by most recent run.
- Tap a card header to fold or unfold its outputs.
- Running items show progress and the currently executing node.

### Queue Options Menu

Tap the top-right `...` ellipsis when on the Queue page to access:

- Go to workflow: quick navigation back to the workflow panel.
- Cancel all pending items.
- Fold all or unfold all queue cards.
- Toggle metadata overlays (show/hide metadata).
- Toggle preview visibility (show/hide previews).
- Clear empty history items (items with no output images).
- Clear all history (with confirmation).

### Queue Card Details

- Pending items can be removed from the queue.
- Running items have a Stop button to interrupt execution.
- Completed items show timestamps, duration, and success status.

### Images, Previews, and Video

- Completed items show saved outputs and, optionally, preview images.
- Video outputs autoplay when the card is expanded and can be replayed.
- Downloaded items display a cloud icon badge.
- Metadata overlays (model, sampler, steps, cfg) can be toggled from the Queue options menu.

### Queue Item Menu

Use the per-item ellipsis menu on completed runs to:

- Load the workflow used for that run.
- Copy the workflow JSON to the clipboard.
- Download the first output or the entire batch.
- Hide or show images when video outputs are present.
- Delete the run from queue history.


<a id="outputs-page"></a>
## Outputs Page

The outputs page is a file browser for your generated outputs and input assets. Get to the outputs page by swiping right from the workflow page.

### Source Switching

- Switch between **Outputs** (generated images/videos) and **Inputs** (uploaded assets) using the outputs `...` menu.
- The top bar title updates to show which source is active.

### Folder Navigation

- Folders are displayed at the top of the file list.
- Tap a folder to navigate into it.
- A breadcrumb trail at the top shows your current path — tap any segment to jump back.
- Swipe right to navigate up one folder level (or use the breadcrumb).

### View Modes

- Toggle between grid and list views from the `...` menu.
- Grid view shows image/video thumbnails in a responsive grid.
- List view shows files with thumbnails, names, and details in a vertical list.

### Filtering and Sorting

- Tap the filter/sort button in the bottom bar to open the filter modal.
- Filter by file type: all, images only, or videos only.
- Filter by favorites only.
- Search by filename.
- Sort by: date modified, name, or file size (ascending or descending).
- Toggle show/hide hidden files (files starting with `.`) from the `...` menu.

### Favorites

- Mark files as favorites for quick access.
- Favorite files show a star indicator.
- Use the "favorites only" filter to view just your favorited files.
- Favorites persist across sessions.

<a id="select-mode"></a>
### Selection Mode

- Enter selection mode from the `...` menu or by using the context menu on a file.
- Tap files to select or deselect them.
- The bottom bar shows the number of selected items and a selection actions button.
- Selection actions include:
  - Favorite or unfavorite selected files.
  - Move selected files to a different folder.
  - Delete selected files.

### File Actions

- Tap the `...` on any file to open a context menu with actions:
  - Open the file in the viewer.
  - Favorite or unfavorite the file.
  - Rename the file or folder.
  - Load workflow metadata from the image (if available).
  - Use the image in your workflow (load into a LoadImage node).
  - Move the file to another folder.
  - Delete the file.
- Create new folders from the context menu or file actions.
- In move dialogs, hidden folder visibility follows your hidden-files toggle so hidden destinations can be selected when needed.

### Use in Workflow

- Select "Use in workflow" from a file's context menu or from the media viewer.
- A modal lists all LoadImage nodes in your current workflow.
- Tap a node to load the selected image into that node's input.
- The app switches to the workflow page and scrolls to the updated node.

### Outputs Viewer

- Tap any image or video to open a full-screen viewer.
- Swipe left/right to navigate between files.
- Action buttons in the viewer allow you to delete, load workflow metadata, or use the image in your workflow.
- Tap the info button to toggle metadata overlays.

<a id="image-viewer"></a>
## Image Viewer

The full-screen viewer supports images and videos while keeping access to the bottom bar of the app available.

### Open and Navigate

- Open by tapping any image or video.
- Swipe left/right to move between files.
- The counter in the top-left shows your position in the current list.

### Zoom and Pan

- Pinch to zoom images.
- Drag to pan when zoomed.
- Double-tap toggles between "fit" and "cover" zoom modes.

### Metadata Overlays

- Tap the info button to show or hide metadata overlays.
- Metadata includes model, sampler, steps, cfg, and elapsed generation time (when available).

### Follow Queue Mode

- Tap the queue/follow button in the bottom bar to open the viewer in follow mode.
- While follow mode is active, the viewer will jump to new outputs from the queue as they finish generating.
- Tap the button again to pause or resume follow mode.

### Video Playback

- Video outputs play inline with native controls.
- The viewer preserves follow mode but currently disables zoom gestures for videos.

### Workflow Controls

- Tap the workflow button to load an image's workflow. You will be prompted to confirm if you have unsaved changes.
- Tap the Use in Workflow button to load the image into any of the current workflow's LoadImage nodes.

### Pinned widgets

- If you have a pinned widget, click the pin button to edit your pinned widget without leaving the image viewer

