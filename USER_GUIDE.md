# ComfyUI Mobile User Guide

This guide walks through every feature in the mobile frontend as of `v0.1.2`

## Table of Contents

- [Main Workspace (Workflow and Queue)](#main-workspace-workflow-and-queue)
- [Workflow Page](#workflow-page)
- [Queue Page](#queue-page)
- [Image Viewer](#image-viewer)
- [Hamburger Menu](#hamburger-menu)

<a id="main-workspace-workflow-and-queue"></a>
## Main Workspace (Workflow and Queue)

The main workspace is the default view and includes the Top Bar and Bottom Bar on both the Workflow and Queue pages.

### Top Bar

- Hamburger menu: opens the left-side menu for loading, saving, appearance, and app info.
- Title and status: shows the workflow name or "ComfyUI Mobile" when no workflow is loaded.
- Unsaved indicator: a blue asterisk appears when the loaded workflow has unsaved changes.
- Node count: on the workflow page, shows total nodes and how many are hidden.
- Queue summary: on the queue page, shows run count and pending count.
- Double-tap title: quickly scrolls the current list to the top with haptic feedback.

### Bottom Bar

- Run count: use the minus/plus buttons to set how many runs to queue.
- Run button: queues the current workflow on the server X times as indicated by the run count.
- Bookmark shortcut: appears when a widget is bookmarked for quick editing - click it to open a modal to edit your bookmarked widget from anywhere.
- Queue/follow button: opens the image viewer in follow queue mode, or toggles follow mode when the viewer is already open.
- Queue badge: shows total pending + running items; a ring indicates overall (estimated) progress of the current run.

### Swipe Navigation

- Swipe left to open the Queue page from the Workflow page.
- Swipe right to return to the Workflow page from the Queue page.
- Swipe navigation is disabled when menus, the viewer, or input fields are active.

<a id="workflow-page"></a>
## Workflow Page

The workflow page is the main editor view where you inspect and adjust your workflow nodes. This is the default page when loading the app, though it'll be empty if you haven't loaded a workflow. Load a workflow from the main menu to get started using the app.

### Workflow Options Menu

Tap the `...` button in the top-right to access workflow-wide actions:

- Fold all / Unfold all nodes.
- Hide or show static nodes (nodes without editable inputs).
- Hide or show bypassed nodes.
- Show all hidden nodes.
- Reload the current workflow if it was loaded from a file, template, or past run.
- Clear workflow cache.
- Unload workflow to return to an empty state.
- Clear all cache (local storage, session storage, caches, cookies) and reload.

### Node Cards

Each node is displayed as a card with controls and status:

- Fold/unfold: tap the header or caret to collapse or expand.
- Bypass state: bypassed nodes are visually highlighted.
- Execution status: running nodes show a pulse; collapsed nodes show a progress ring.
- Errors: a warning icon opens a detailed error popover.
- Node `...` menu (ellipsis): bypass node, hide node, and bookmark widgets.
- Connection trace button: cycles through highlighting inputs, outputs, both, or off.

### Node Connections

- Inputs and outputs display as directional buttons.
- Tap a connection to jump to the connected node.
- If multiple connections exist, a menu lists destinations (including via bypassed nodes).

### Parameters and Widgets

- Controls adapt to widget type (number, text, combo, toggle, etc.).
- Textarea/textbox widgets have buttons to easily copy to clipboard or clear the contents of the box.
- Widgets can be bookmarked and pinned to the bottom bar for quick access.
  - Currently only one bookmark at a time is suppported.
  - Bookmark a widget via the node card's `...` menu.
- KSampler nodes expose seed and seed-control widgets for fixed or randomized runs.
  - Seed controls support fixed, increment, decrement, and randomize conrol modes.
  - Primitive numeric nodes expose a control mode selection too.

### Notes

- Note nodes or note-like text properties render as a note block.
- Double-tap the note to edit it.
- URLs are automatically turned into links.
- Textarea tools allow copy and clear actions.

### Output Preview

- Nodes with output images show a preview thumbnail.
- Tap the preview to open the full-screen Image Viewer.
- While executing, progress overlays display node and overall completion.

### Errors

- Nodes with errors are highlighted with red borders.
- Tap the error icon to see per-input error details.

<a id="queue-page"></a>
## Queue Page

The queue page shows pending, running, and completed generations. Get to the queue page by swiping from the workflow page.

### Queue List and Status

- Items are grouped by status: pending, running, then completed.
- Completed items are sorted by most recent run.
- Tap a card header to fold or unfold its outputs.
- Running items show progress and the currently executing node.

### Queue Options Menu

Tap the top-right `...` ellipsis when on the Queue page to access:

- Cancel all pending items.
- Fold all or unfold all queue cards.
- Toggle preview visibility (show/hide previews).
- Toggle metadata overlays.
- Clear empty history items.
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


<a id="image-viewer"></a>
## Image Viewer

The full-screen viewer supports images and videos while keeping access to the bottom bar of the app available.

### Open and Navigate

- Open by tapping any output image or video.
- Swipe left/right to move between outputs when not zoomed.
- The counter in the top-left shows your position in the queue history's outputs list.

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

<a id="hamburger-menu"></a>
## Main Menu

Open the main menu from the top-left hamburger icon to access workflow load/save actions and general app settings and info

### Load Workflow

- My Workflows: load saved workflows from the ComfyUI server.
- Templates: load bundled templates grouped by module name from installed custom nodes.
- Paste JSON: paste workflow JSON to load it directly.
- From Device: upload a local JSON workflow file.

### Save Workflow

- Save: overwrites the current workflow file when it has a filename.
- Save As: saves to a new filename on the server.
- Download to Device: saves the current workflow JSON locally.

### Appearance

- Toggle between dark and light themes.

### About and Help

- Open in GitHub: opens the open source project repo.
- Icon Legend: explains common UI icons.
- User Manual: opens this guide in your browser.

