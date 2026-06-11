# ComfyUI Mobile User Guide

This guide walks through every feature in the mobile frontend as of `v3.0.0`

## Table of Contents

- [How-To](#how-to)
  - [How do I load a workflow?](#how-do-i-load-a-workflow)
  - [How do I save my workflow?](#how-do-i-save-my-workflow)
  - [How do I work on more than one workflow at once?](#how-do-i-work-on-more-than-one-workflow-at-once)
  - [How do I organize my saved workflows into folders?](#how-do-i-organize-my-saved-workflows-into-folders)
  - [How do I bookmark a workflow or template I use often?](#how-do-i-bookmark-a-workflow-or-template-i-use-often)
  - [How do I hide workflows I don't want to see?](#how-do-i-hide-workflows-i-dont-want-to-see)
  - [How do I install or manage custom nodes?](#how-do-i-install-or-manage-custom-nodes)
  - [How do I see previews and details for models and LoRAs?](#how-do-i-see-previews-and-details-for-models-and-loras)
  - [How do I use an output image in my current workflow?](#how-do-i-use-an-output-image-in-my-current-workflow)
  - [How do I load the workflow of one of my output images?](#how-do-i-load-the-workflow-of-one-of-my-output-images)
  - [How do I run my workflow multiple times?](#how-do-i-run-my-workflow-multiple-times)
  - [How do I enable infinite generation mode?](#how-do-i-enable-infinite-generation-mode)
  - [How do I watch outputs as they are generated?](#how-do-i-watch-outputs-as-they-are-generated)
  - [How do I favorite an output?](#how-do-i-favorite-an-output)
  - [How do I see my favorites?](#how-do-i-see-my-favorites)
  - [How do I find a specific node in my workflow?](#how-do-i-find-a-specific-node-in-my-workflow)
  - [How do I quickly edit a widget I change often?](#how-do-i-quickly-edit-a-widget-i-change-often)
  - [How do I use LoRA Manager with this frontend?](#how-do-i-use-lora-manager-with-this-frontend)
  - [How do I skip (bypass) a node in my workflow?](#how-do-i-skip-bypass-a-node-in-my-workflow)
  - [How do I re-run a previous generation?](#how-do-i-re-run-a-previous-generation)
  - [How do I trace which nodes are connected to each other?](#how-do-i-trace-which-nodes-are-connected-to-each-other)
  - [How do I delete old outputs in bulk?](#how-do-i-delete-old-outputs-in-bulk)
  - [How do I select a range of outputs at once?](#how-do-i-select-a-range-of-outputs-at-once)
  - [How do I search my outputs by prompt?](#how-do-i-search-my-outputs-by-prompt)
  - [How do I download an output to my device?](#how-do-i-download-an-output-to-my-device)
  - [How do I organize my output files into folders?](#how-do-i-organize-my-output-files-into-folders)
  - [How do I switch between my outputs and input images?](#how-do-i-switch-between-my-outputs-and-input-images)
  - [How do I navigate between pages?](#how-do-i-navigate-between-pages)
  - [How do I edit nodes inside a subgraph?](#how-do-i-edit-nodes-inside-a-subgraph)
  - [How do I turn on latent previews?](#how-do-i-turn-on-latent-previews)
- [Main Workspace](#main-workspace)
  - [Main Menu](#main-menu)
    - [Load Workflow](#load-workflow)
    - [My Workflows (Folders, Bookmarks, Hidden)](#my-workflows-folders-bookmarks-hidden)
    - [Save Workflow](#save-workflow)
    - [Server](#server)
      - [Custom Nodes Manager](#custom-nodes-manager)
      - [Preferences](#preferences)
      - [Restart the ComfyUI backend server](#restart-the-comfyui-backend-server)
      - [What happens when the connection to ComfyUI drops?](#what-happens-when-the-connection-to-comfyui-drops)
    - [About and Help](#about-and-help)
  - [Top Bar](#top-bar)
  - [Workflow Tabs](#workflow-tabs)
  - [Bottom Bar](#bottom-bar)
  - [Swipe Navigation](#swipe-navigation)
  - [Connection & Recovery](#connection-and-recovery)
- [Workflow Page](#workflow-page)
  - [Workflow Options Menu](#workflow-options-menu)
  - [Containers (Groups and Subgraphs)](#containers-groups-and-subgraphs)
    - [Subgraph Navigation](#subgraph-navigation)
  - [Node Cards](#node-cards)
  - [Node Connections](#node-connections)
  - [Parameters and Widgets](#parameters-and-widgets)
  - [Rich Model Picker](#rich-model-picker)
  - [Image Comparer Nodes](#image-comparer-nodes)
  - [LoRA Manager Nodes](#lora-manager-nodes)
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
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Zoom and Pan](#zoom-and-pan)
  - [Metadata Overlays](#metadata-overlays)
  - [Follow Queue Mode](#follow-queue-mode)
  - [Video Playback](#video-playback)

<a id="how-to"></a>
## How-To

<a id="how-do-i-load-a-workflow"></a>
### How do I load a workflow?

Open the [Main Menu](#main-menu) from the hamburger icon in the top-left corner. Under **Load Workflow**, you can browse your saved workflows on the server, pick from bundled templates, paste workflow JSON directly, or upload a JSON file from your device. See [Load Workflow](#load-workflow) for details on each option.

<a id="how-do-i-save-my-workflow"></a>
### How do I save my workflow?

Open the [Main Menu](#main-menu) and look under **Save Workflow**. Use **Save** to overwrite the current file, **Save As** to save under a new name on the server, or **Download to Device** to save a local copy as JSON. An unsaved-changes indicator (blue asterisk) appears in the [Top Bar](#top-bar) on the workflow page when you have edits that haven't been saved yet.

<a id="how-do-i-work-on-more-than-one-workflow-at-once"></a>
### How do I work on more than one workflow at once?

You can keep up to 10 workflows open at the same time, each in its own tab. Whenever you load a workflow while one is already open (from the server, a template, pasted JSON, a file, or an image's embedded workflow), it opens in a new tab instead of replacing the current one. A **tab strip** appears just under the [Top Bar](#top-bar) once you have more than one open — tap a tab to switch to it. See [Workflow Tabs](#workflow-tabs) for what each tab shows and how to close them.

Only the active tab runs live; the others are held in the background with all their state intact, and your open tabs (plus which one is active) survive a page refresh. If you try to open an 11th workflow, the app asks you to close one first.

<a id="how-do-i-organize-my-saved-workflows-into-folders"></a>
### How do I organize my saved workflows into folders?

Open the [Main Menu](#main-menu) → **Load Workflow** → **My Workflows**. Use the `...` menu at the top of the panel and choose **New folder** to create one. To move a workflow (or a folder) into a folder, open that item's `...` menu and choose **Move**, then pick a destination. Tap a folder to open it and use the breadcrumb (or swipe) to navigate back out. Folders sort by their most recently modified workflow, so the ones you're actively using float to the top. See [My Workflows](#my-workflows-folders-bookmarks-hidden) for the full set of folder actions (rename, delete).

<a id="how-do-i-bookmark-a-workflow-or-template-i-use-often"></a>
### How do I bookmark a workflow or template I use often?

In both the **My Workflows** and **Templates** panels ([Main Menu](#main-menu) → Load Workflow), each item has a bookmark toggle — tap it to bookmark or un-bookmark (a workflow's bookmark action also lives in its `...` menu as **Bookmark** / **Remove bookmark**). To see only your bookmarks, tap the **Show bookmarks only** filter at the top of the panel. Bookmarks are stored per-device, follow a workflow through renames and moves, and are removed automatically if you delete the item. This is separate from the in-workflow [Bookmarks](#bookmarks) that jump you to nodes.

<a id="how-do-i-hide-workflows-i-dont-want-to-see"></a>
### How do I hide workflows I don't want to see?

In **My Workflows**, open a workflow's or folder's `...` menu and choose **Hide**. Hidden items disappear from the list until you turn on **Show hidden** from the panel's top `...` menu; while that's on, hidden items show faded with an **Unhide** action in their menu. This is a declutter convenience only — it is **not** access control, and it doesn't restrict the server in any way. The hidden list is saved to your ComfyUI user data, so it persists across sessions and devices.

<a id="how-do-i-install-or-manage-custom-nodes"></a>
### How do I install or manage custom nodes?

Open the [Main Menu](#main-menu), expand the **Server** section, and tap **Custom nodes**. This opens the [Custom Nodes Manager](#custom-nodes-manager), where you can search, filter (e.g. by ones with updates available or ones missing from your current workflow), and install, update, enable/disable, switch versions, or uninstall custom nodes. After a change, restart ComfyUI to apply it (the manager shows a restart prompt when one is needed).

<a id="how-do-i-see-previews-and-details-for-models-and-loras"></a>
### How do I see previews and details for models and LoRAs?

Model and LoRA dropdowns show a **rich picker** with a thumbnail preview, the model name, its version, and a small badge for the model type and base model (e.g. _LoRA · XL_) — so you can recognize the right file at a glance instead of reading filenames. This works whether or not Lora Manager is installed; without it, the app uses its own metadata fetched from Civitai. To pull down previews and details for your models, open the [Main Menu](#main-menu) → **Server** → **Refresh model metadata**. See [Rich Model Picker](#rich-model-picker) for details (including how to reveal blurred previews).

<a id="how-do-i-use-an-output-image-in-my-current-workflow"></a>
### How do I use an output image in my current workflow?

There are two ways. From the [Outputs Page](#outputs-page), tap the `...` on any image and select "Use in workflow" — or open any image in the [Image Viewer](#image-viewer) and tap the [Use in Workflow](#use-in-workflow) action button (the arrow pointing right). Either way, a modal will list all LoadImage nodes in your current workflow. Tap the node you want to load the image into, and the app will switch to the [Workflow Page](#workflow-page) and scroll to that node with the image already set.

If you have more than one workflow open in [tabs](#workflow-tabs), the picker first asks which open workflow to load the image into, then shows that workflow's LoadImage nodes.

<a id="how-do-i-load-the-workflow-of-one-of-my-output-images"></a>
### How do I load the workflow of one of my output images?

Click on the image you would like to load the workflow for in your outputs list, then click the small button with the workflow icon overlaid on top of the image viewer. This will load the workflow embedded in the image into the workflow panel, you will be prompted to confirm if your current loaded workflow has changes, since any unsaved changes will be lost.

> [!NOTE]
> It is currently possible to load workflows for videos too, but only if one of the following applies:
> - An image with the same basename as the video exists in the same folder as the video (workflow will be loaded from this image)
> - The video was recently generated and still present in the queue panel's history

<a id="how-do-i-run-my-workflow-multiple-times"></a>
### How do I run my workflow multiple times?

Use the run count buttons (minus/plus) in the [Bottom Bar](#bottom-bar) to set how many runs to enqueue, then tap the **Run** button. Each run is queued separately on the server. You can monitor all pending and running items on the [Queue Page](#queue-page).

<a id="how-do-i-enable-infinite-generation-mode"></a>
### How do I enable infinite generation mode?

First turn the feature on under [Main Menu](#main-menu) → **Server** → **Preferences** → toggle **Enable infinite mode**. With the preference on, an ∞ button appears beside the Run button in the [Bottom Bar](#bottom-bar). Tap it to enable infinite generation. Now when you tap **Run**, each finished run automatically queues the next one. While running, the Run button is replaced by a red **Stop** button (which cancels the current run and disables infinite mode) and an amber **Skip** button (which cancels the current run but keeps looping into the next iteration).

If you use multiple [workflow tabs](#workflow-tabs), only one workflow loops at a time. Switching to another tab leaves the loop running on its own workflow in the background; enabling infinite mode on a different tab moves the loop there. As a safety check, the loop stops itself (with an explanation) if the next run would re-submit an identical prompt forever — for example a fixed seed with no other changes. Set a seed widget to randomize, or change an input, to keep generating new outputs.

<a id="how-do-i-watch-outputs-as-they-are-generated"></a>
### How do I watch outputs as they are generated?

Tap the queue/follow button in the [Bottom Bar](#bottom-bar) to open the [Image Viewer](#image-viewer) in [Follow Queue Mode](#follow-queue-mode). The viewer will automatically jump to newly generated media (saved outputs and preview/temp images) as each run completes. Tap the button again to pause or resume following.

<a id="how-do-i-favorite-an-output"></a>
### How do I favorite an output?

Open any saved output image in the [Image Viewer](#image-viewer) — from the [Outputs Page](#outputs-page), the [Queue Page](#queue-page), or [Follow Queue Mode](#follow-queue-mode) — and tap the heart button next to the load-workflow and use-in-workflow buttons. The heart fills in solid red to indicate the image is favorited. Tap again to unfavorite. You can also favorite a file from the [Outputs Page](#outputs-page) by opening its `...` menu and tapping **Favorite**. Favorited files show a small red heart indicator on their card.

<a id="how-do-i-see-my-favorites"></a>
### How do I see my favorites?

Go to the [Outputs Page](#outputs-page), open the [filter and sort](#filtering-and-sorting) modal from the `...` menu, and toggle **Favorites only**. The grid will then show only your favorited files. Toggle it off to return to all files. See [Favorites](#favorites) for more.

<a id="how-do-i-find-a-specific-node-in-my-workflow"></a>
### How do I find a specific node in my workflow?

Open the [Workflow Options Menu](#workflow-options-menu) (the `...` in the top-right on the workflow page) and tap **Search**. A search bar appears at the top of the node list where you can type to filter by node title, type, class name, or ID. The search uses fuzzy matching, so partial words work. See [Workflow Search](#workflow-search) for more details.

<a id="how-do-i-quickly-edit-a-widget-i-change-often"></a>
### How do I quickly edit a widget I change often?

You can pin a widget to the [Bottom Bar](#bottom-bar) so it's accessible from any page. Open the node's `...` menu, select **Pin widget**, and choose which widget to pin (when there are multiple widgets to choose from). A shortcut button appears in the bottom bar — tap it to open an overlay editor for that widget without navigating back to the node. See [Parameters and Widgets](#parameters-and-widgets) for more.

<a id="how-do-i-use-lora-manager-with-this-frontend"></a>
### How do I use LoRA Manager with this frontend?

Use a workflow that contains supported `(LoraManager)` nodes (for example: Lora Loader, Lora Stacker, Lora Randomizer, Lora Cycler, TriggerWord Toggle). In each node card, edit the LoRA rows directly: choose LoRA name, enable/disable entries, adjust strength/clip strength, and add/remove entries.

Once a workflow with LoraManager nodes is loaded, the frontend will automatically accept incoming updates (`lora_code_update`, `trigger_word_update`, and `lm_widget_update`) and apply them to the matching node automatically. Trigger-word nodes connected to LoRA nodes can be refreshed automatically based on active LoRAs.

You can open the LoRA Manager web UI directly from a LoRA node card's `...` menu using **Open LoRA Manager**.

<a id="how-do-i-skip-bypass-a-node-in-my-workflow"></a>
### How do I skip (bypass) a node in my workflow?

Open the node's `...` menu and tap **Bypass node**. The node will be visually dimmed and skipped during execution. To re-enable it, open the same menu and tap **Engage node**. You can also hide bypassed nodes entirely from the [Workflow Options Menu](#workflow-options-menu) using "Hide bypassed nodes." See [Node Cards](#node-cards) for details.

<a id="how-do-i-re-run-a-previous-generation"></a>
### How do I re-run a previous generation?

Go to the [Queue Page](#queue-page) and find the completed run you want to repeat. Tap its `...` menu and select **Load workflow** to load the exact workflow and settings used for that run. You can then tap **Run** to execute it again. See [Queue Item Menu](#queue-item-menu) for all available actions on completed runs.

<a id="how-do-i-trace-which-nodes-are-connected-to-each-other"></a>
### How do I trace which nodes are connected to each other?

Each node card has a connection trace button that cycles through highlighting its inputs, outputs, both, or none. Tap it to see which nodes are upstream or downstream from the selected node. You can also tap individual [connection buttons](#node-connections) to jump directly to the connected node. If a node has multiple connections, a menu lists all destinations. Jumping through connections will jump through hidden nodes.

<a id="how-do-i-delete-old-outputs-in-bulk"></a>
### How do I delete old outputs in bulk?

Go to the [Outputs Page](#outputs-page) and enter [Select Mode](#select-mode) from the `...` menu or a file's context menu. Tap files to select them, then tap the selection actions button in the [Bottom Bar](#bottom-bar) and choose **Delete**. To clear queue history instead, use the [Queue Options Menu](#queue-options-menu) — "Clear empty items" removes runs with no saved outputs, and "Clear history" removes everything.

<a id="how-do-i-select-a-range-of-outputs-at-once"></a>
### How do I select a range of outputs at once?

In the [Outputs Page](#outputs-page), enter [Selection Mode](#select-mode) and select one file to set an anchor. Then long-press another file's selection badge (or shift-click on desktop) to select everything between the two at once — handy for grabbing a whole run before a bulk download, move, or delete. See [Selection Mode](#select-mode).

<a id="how-do-i-search-my-outputs-by-prompt"></a>
### How do I search my outputs by prompt?

On the [Outputs Page](#outputs-page), open the `...` menu and tap **Search**. A search bar appears at the top — type a query and tap **Apply**. As well as matching filenames, the search looks inside each image's embedded generation prompt, so you can find outputs by something you remember typing (a subject, a LoRA, a phrase). A banner shows how many total matches were found and how many are in the current folder. Clear the search to return to normal browsing. See [Filtering and Sorting](#filtering-and-sorting).

<a id="how-do-i-download-an-output-to-my-device"></a>
### How do I download an output to my device?

For a single file, open the file's `...` context menu on the [Outputs Page](#outputs-page) (or open the file in the [Image Viewer](#image-viewer) and tap the download button next to the favorite/load-workflow buttons). For multiple files at once, enter [Selection Mode](#select-mode), tap the files you want, then tap the selection actions button in the [Bottom Bar](#bottom-bar) and choose **Download**.

On iOS, this triggers the share sheet so you can save to Photos / Camera Roll, save to Files in any location, or send to another app. On Android and desktop, files are saved directly through the browser's download flow. If the share sheet isn't available the app falls back to the same download flow.

<a id="how-do-i-organize-my-output-files-into-folders"></a>
### How do I organize my output files into folders?

On the [Outputs Page](#outputs-page), you can create new folders from the bulk selection's **Move** action. In the move, navigate to where you'd like to create a new folder, then enter the new folder and click Submit to complete the move. See [File Actions](#file-actions) and [Folder Navigation](#folder-navigation) for more details.

<a id="how-do-i-switch-between-my-outputs-and-input-images"></a>
### How do I switch between my outputs and input images?

On the [Outputs Page](#outputs-page), tap the `...` menu in the top-right and select the option to switch between **Outputs** and **Inputs**. Outputs shows your generated images and videos, while Inputs shows uploaded assets (including duplicates of any images the "Use in Workflow" action was triggered on). The [Top Bar](#top-bar) title updates to reflect which source is active. See [Source Switching](#source-switching).

<a id="how-do-i-navigate-between-pages"></a>
### How do I navigate between pages?

Use [Swipe Navigation](#swipe-navigation): swipe left from the Workflow page to reach the Queue page, or swipe right to reach the Outputs page. Swipe in the opposite direction to go back. You can also use the quick-navigation links in each page's `...` menu (e.g., "Go to queue" or "Go to outputs" in the [Workflow Options Menu](#workflow-options-menu)).

<a id="how-do-i-edit-nodes-inside-a-subgraph"></a>
### How do I edit nodes inside a subgraph?

On the workflow page, find the subgraph placeholder node card. Open its `...` menu and tap **Enter subgraph** to drill into it. A breadcrumb bar appears at the top showing your current scope (e.g., _Root / My Subgraph_). You can then view and edit the inner nodes of that subgraph just like root-level nodes. Tap **Root** in the breadcrumb, use the device back button, or swipe back to return to the root workflow. If the subgraph exposes widget controls on the placeholder card itself (promoted or proxy widgets), you can edit those directly without entering the subgraph.

<a id="how-do-i-turn-on-latent-previews"></a>
### How do I turn on latent previews?

Open the [Main Menu](#main-menu) and expand the **Server** section. Tap **Preferences**, then toggle **Show latent previews** on. You can choose between two preview methods:

- **Fast (latent2rgb)** — a quick approximate preview that updates during sampling with minimal performance impact.
- **Accurate (TAESD)** — a higher-quality preview using a tiny autoencoder, slightly slower but much closer to the final image.

When enabled, any node that produces latent samples (e.g., KSampler) will show a live preview image on its card during generation. The preview updates in real time and is replaced by the final output when the node finishes. Latent previews are off by default to avoid unnecessary overhead for users who don't need them.

> [!NOTE]
> If your sampler node is inside a subgraph, navigate into that subgraph to see its latent preview — the preview appears on the inner node's card, not on the placeholder.

<a id="main-workspace"></a>
## Main Workspace

The main workspace consists of three pages framed by a top and bottom control bar:  Workflow, Queue, and Outputs.

<a id="main-menu"></a>
### Main Menu

Open the main menu from the top-left hamburger icon to access workflow load/save actions and general app settings and info

<a id="load-workflow"></a>
#### Load Workflow

- My Workflows: load saved workflows from the ComfyUI server (see [My Workflows](#my-workflows-folders-bookmarks-hidden) below for folders, bookmarks, and hiding).
- Templates: load bundled templates grouped by module name from installed custom nodes. Templates can be bookmarked and filtered the same way as saved workflows.
- Paste JSON: paste workflow JSON to load it directly.
- From Device: upload a local JSON workflow file.

Loading a workflow while one is already open adds it as a new [tab](#workflow-tabs) rather than replacing the current one.

<a id="my-workflows-folders-bookmarks-hidden"></a>
#### My Workflows (Folders, Bookmarks, Hidden)

The **My Workflows** panel is a browser for the workflows saved on your server, with three organizing tools:

- **Folders**
  - Create a folder from the panel's top `...` menu → **New folder**.
  - Move a workflow or folder into a folder from its `...` menu → **Move**, then choose a destination.
  - Rename or delete a folder from its `...` menu (**Rename** / **Delete**). Deleting a folder removes the workflows inside it.
  - Tap a folder to open it; use the breadcrumb or swipe to go back up.
  - Folders sort by their most recently modified workflow, so active folders rise to the top.
- **Bookmarks**
  - Toggle a bookmark on any workflow or folder (also in the `...` menu as **Bookmark** / **Remove bookmark**).
  - **Show bookmarks only** at the top of the panel filters the list to your bookmarks.
  - Bookmarks are stored per-device, follow items through rename/move, and clear automatically on delete.
  - Templates can be bookmarked and filtered the same way in the Templates panel.
- **Hidden**
  - Hide a workflow or folder from its `...` menu → **Hide**; reveal hidden items with **Show hidden** in the panel's top `...` menu, then **Unhide** to restore one.
  - Hiding is a declutter convenience, **not** access control. The hidden list is saved to your ComfyUI user data and persists across sessions and devices.

> [!NOTE]
> These workflow/template bookmarks are different from the in-workflow [Bookmarks](#bookmarks) that scroll you to nodes within an open workflow.

<a id="save-workflow"></a>
#### Save Workflow

- Save: overwrites the current workflow file when it has a filename.
- Save As: saves to a new filename on the server.
- Download to Device: saves the current workflow JSON locally.

<a id="server"></a>
#### Server

Expand the **Server** section in the main menu for backend tools and app preferences:

- **Custom nodes** — opens the [Custom Nodes Manager](#custom-nodes-manager).
- **Refresh model metadata** — fetches preview images, names, versions, and badges for your models so the [Rich Model Picker](#rich-model-picker) can show them. Works with or without Lora Manager installed (the two share the same metadata sidecars). The button shows progress while it runs.
- **Preferences** — opens the app [Preferences](#preferences) page.
- **Restart ComfyUI** — restarts the backend (after a confirmation). See [Restart the ComfyUI backend server](#restart-the-comfyui-backend-server).
- The section also surfaces server stats (VRAM, system RAM, PyTorch/Python versions) when available.

<a id="restart-the-comfyui-backend-server"></a>
##### Restart the ComfyUI backend server

The **Restart ComfyUI** button restarts the ComfyUI backend without leaving the app — handy after installing or updating [custom nodes](#custom-nodes-manager), which only take effect once the server restarts. You're asked to confirm first, since a restart interrupts any running jobs and briefly disconnects the mobile UI.

While the server comes back up, the app shows a restart overlay, waits for ComfyUI to return, and then reloads itself automatically — you don't need to reload it by hand. If you had jobs queued when the restart happened, see [What happens when the connection to ComfyUI drops?](#what-happens-when-the-connection-to-comfyui-drops) for how they're recovered.

<a id="what-happens-when-the-connection-to-comfyui-drops"></a>
##### What happens when the connection to ComfyUI drops?

If the app loses contact with the ComfyUI backend (server stopped, network blip, or a [restart](#restart-the-comfyui-backend-server)), a full-screen **"Reconnecting…"** overlay appears and the app recovers on its own once the server is back. If a ComfyUI restart drops jobs you had queued, the [Queue Page](#queue-page) shows a **"Lost queued jobs found"** banner with a **Restore lost jobs** button so you can re-enqueue them. You can also have this happen automatically by turning on **Restore lost queue after restart** in [Preferences](#preferences). See [Connection & Recovery](#connection-and-recovery).

<a id="custom-nodes-manager"></a>
##### Custom Nodes Manager

A full-screen manager for the custom nodes installed on your ComfyUI server, opened from **Server → Custom nodes**:

- **Search** custom nodes by name.
- **Filter** the list — e.g. show only nodes with an **Update** available, ones **Missing** from your current workflow, or your **Favorites**.
- Each entry shows its status (enabled, disabled, update available, not installed), version, node count, and a short description, with a link to its repository.
- From an entry's menu you can **Install**, **Update**, **Switch version**, **Enable**/**Disable**, or **Uninstall**.
- Changes take effect after a ComfyUI restart — the manager shows a restart prompt when one is pending.

> [!NOTE]
> The Custom Nodes Manager acts on the ComfyUI server itself. Treat it like any other tool that installs code on your machine.

<a id="preferences"></a>
##### Preferences

App-wide toggles, reached from **Server → Preferences**:

- **Fast image previews** — load lightweight WebP previews instead of full-size originals (faster browsing; turn off if an image looks wrong). Downloads always use the original.
- **Show latent previews** — show a live preview on sampler nodes during generation, with a choice of **Fast (latent2rgb)** or **Accurate (TAESD)**. See [How do I turn on latent previews?](#how-do-i-turn-on-latent-previews).
- **Restore lost queue after restart** — automatically re-enqueue pending jobs this device saw if ComfyUI restarts and loses them. See [Connection & Recovery](#connection-and-recovery).
- **Alias filepaths in embedded metadata** — hide input paths and output filename prefixes in shared workflow metadata.
- **Enable infinite mode** — show the ∞ button next to Run. See [How do I enable infinite generation mode?](#how-do-i-enable-infinite-generation-mode).
- **Hide bottom bar when viewer is idle** — fade the bottom bar along with the image-viewer controls after a few seconds without interaction.
- **Follow into subgraphs** — when following execution, navigate into subgraph scopes so you can watch nodes running inside them.

<a id="about-and-help"></a>
#### About and Help

- Open in GitHub: opens the open source project repo.
- Icon Legend: explains common UI icons.
- User Manual: opens this guide in your browser.

<a id="top-bar"></a>
### Top Bar

- Main menu: hamburger icon opens the left-side menu for loading/saving of workflows, server tools, and app info.
- Title and status: shows the workflow name on the workflow page, queue summary on the queue page, or "Outputs"/"Inputs" on the outputs page.
- Unsaved indicator: a blue asterisk appears when the loaded workflow has unsaved changes.
- Node count: on the workflow page, shows total nodes and how many are hidden.
- Queue summary: on the queue page, shows run count and pending count.
- Outputs title: on the outputs page, shows "Outputs" or "Inputs" depending on which source is selected.
- Double-tap title: quickly scrolls to the top of the current page

<a id="workflow-tabs"></a>
### Workflow Tabs

You can keep several workflows open at once (up to 10), each in its own tab. A scrollable tab strip appears just under the top bar whenever more than one workflow is open.

- **Opening tabs:** loading any workflow while one is already open adds a new tab instead of replacing the current one. If you're already at 10, the app asks you to close one to make room.
- **Switching:** tap a tab to make it active. Only the active workflow runs and updates live; the others are parked in the background with their full state preserved.
- **Each tab shows:**
  - the workflow's name (italic when it has unsaved changes);
  - an asterisk `*` for unsaved changes (or a spinning ring while saving);
  - a live activity indicator — the run count with a progress ring while it's generating, or a spinning ∞ when that workflow is in infinite mode;
  - a close (✕) button.
- **Closing:** tap the ✕ on a tab. If that workflow has unsaved changes you'll be asked to confirm before discarding them. Closing the active tab activates a neighbor; closing the last tab returns the app to the empty state.
- **Background runs:** a parked tab can still have queued or running jobs. Their outputs and previews route back to the correct tab, so switching to it later shows everything it produced.
- **Persistence:** your open tabs, the active tab, and which workflow is looping all survive a page refresh.

<a id="bottom-bar"></a>
### Bottom Bar

- Run count: use the minus/plus buttons to set how many runs to queue.
- Run button: queues the current workflow on the server X times as indicated by the run count.
- Pinned widget shortcut: appears when a widget is pinned for quick editing — tap it to open a modal to edit your pinned widget from anywhere.
- On the outputs page, the pinned widget button is replaced with a filter/sort button (or a selection actions button when in selection mode).
- Queue/follow button: opens the image viewer in follow queue mode, or toggles follow mode when the viewer is already open.
- Queue badge: shows total pending + running items; a ring indicates overall (estimated) progress of the current run.

<a id="swipe-navigation"></a>
### Swipe Navigation

- Swipe left from the Workflow page to open the Queue page.
- Swipe right from the Queue page to return to the Workflow page.
- Swipe right from the Workflow page to open the Outputs page.
- Swipe left from the Outputs page to return to the Workflow page.
- When inside a subfolder on the Outputs page, swiping right navigates up one folder level instead of switching panels.
- Swipe navigation is disabled when menus, the viewer, input fields, or selection mode are active.

<a id="connection-and-recovery"></a>
### Connection & Recovery

The app stays in sync with ComfyUI over a websocket and handles interruptions gracefully:

- **Connection lost:** if contact with the backend drops (server stopped, network blip), a full-screen **"Reconnecting…"** overlay appears after a few seconds and blocks interaction until the connection is restored. The app reconnects and recovers automatically once the server is back — you don't need to reload.
- **Lost jobs after a restart:** if ComfyUI restarts and forgets jobs you had queued, the [Queue Page](#queue-page) shows a **"Lost queued jobs found"** banner with a **Restore lost jobs** button to re-enqueue them.
- **Automatic restore:** turn on **Restore lost queue after restart** in [Preferences](#preferences) to have this device re-enqueue its lost jobs automatically instead of prompting.

<a id="workflow-page"></a>
## Workflow Page

The workflow page is the main editor view where you inspect and adjust your workflow nodes. This is the default page when loading the app, though it'll be empty if you haven't loaded a workflow. Load a workflow from the main menu to get started using the app.

<a id="workflow-options-menu"></a>
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

<a id="containers-groups-and-subgraphs"></a>
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
  - Change container color (via the `...` menu on the container header).
- Nested containers are supported, including groups inside groups and groups/subgraphs within nested structures.
- Empty containers show a placeholder action to quickly add a node.

#### Subgraph Navigation

- Subgraph placeholder nodes show an **Enter** action in their `...` menu (or via a dedicated button on the placeholder card) to navigate into the subgraph.
- When inside a subgraph, a **breadcrumb bar** appears at the top of the workflow page showing the current scope path (e.g., _Root / My Subgraph_).
  - Tap **Root** in the breadcrumb to jump back to the root workflow.
  - Tap any intermediate crumb in a deeply nested stack to jump to that level.
- The device's **back button or back gesture** exits the current subgraph scope (same as tapping Root).
- While inside a subgraph, all node cards, connection traversal, and editing actions operate on the inner nodes of that subgraph.
- Subgraph placeholder nodes also display promoted widget controls directly on their card (no need to enter the subgraph to adjust common parameters):
  - **Slot-promoted widgets** (set by the subgraph author via the `input.widget` mechanism) appear as standard widget controls.
  - **Proxy widgets** (set via `properties.proxyWidgets`) reference inner node widgets and route updates to those inner nodes transparently.
  - Seed-mode controls (randomize, increment, decrement) work on promoted seed slots.

<a id="node-cards"></a>
### Node Cards

Each node is displayed as a card with controls and status:

- Fold/unfold: tap the header or caret to collapse or expand.
- Bypass state: bypassed nodes are visually dimmed purple.
- Execution status: running nodes show a pulse; collapsed nodes show a progress ring.
- Errors: a warning icon opens a detailed error popover.
- Node `...` menu (ellipsis): edit label, bookmark node, bypass/engage node, hide node, move node, delete node, and pin a widget.
- On supported LoRA Manager nodes, the same menu also includes **Open LoraManager** (opens LoRA Manager web UI in a new tab).
- Connection trace button: cycles through highlighting inputs, outputs, both, or off.

<a id="node-connections"></a>
### Node Connections

- Inputs and outputs display as directional buttons.
- Tap a connection to jump to the connected node (through hidden nodes, if any).
- If multiple connections exist, a menu lists destinations (including via bypassed nodes).
- Long-press an input/output connection button to open connection editing.
  - Input connections: choose a source node (or add a compatible new node) for that input.
  - Output connections: multi-select target inputs to connect/disconnect in one submit action.
  - If a selected target already has another source connected, the modal asks for overwrite confirmation before replacing that link.

<a id="parameters-and-widgets"></a>
### Parameters and Widgets

- Controls adapt to widget type (number, text, combo, toggle, etc.).
- Textarea/textbox widgets have buttons to easily copy to clipboard or clear the contents of the box.
- Combo widgets that take a file (e.g. **LoadImage**, VHS **LoadVideo**) add two ways to set their value without leaving your phone:
  - **Browse files** opens a picker with **Outputs** and **Inputs** tabs, so you can pick any image (or video) already on the server. Choosing an output copies it into ComfyUI's input folder server-side — there's no download/re-upload round trip, so it's instant.
  - **Load from camera roll** (or **Upload video from device** on video nodes) uploads a file straight from your device into the input folder.
- A widget can be pinned to the bottom bar for quick editing from any page.
  - Pin a widget via the node card's `...` menu.
  - Tap the pinned widget shortcut in the bottom bar to open an overlay editor.
  - The editor leaves the bottom bar reachable, so you can queue runs while it's open — handy for quickly iterating on a prompt or seed.
- KSampler nodes expose seed and seed-control widgets for fixed or randomized runs.
  - Seed controls support fixed, increment, decrement, and randomize control modes.
  - Primitive numeric nodes expose a control mode selection too.

<a id="rich-model-picker"></a>
### Rich Model Picker

Dropdowns that pick a model — checkpoints, LoRAs, VAEs, and similar — show a rich picker instead of a plain list of filenames:

- Each option has a **thumbnail preview**, the model **name**, its **version**, and a compact **badge** showing the model type and base model (for example _LoRA · XL_ or _CKPT · SD1_).
- The currently-selected model shows the same preview and details in the closed control, so you can tell at a glance what's set.
- This works **with or without Lora Manager**. When Lora Manager is installed the app reads its metadata; otherwise it uses its own metadata fetched from Civitai (the two share the same sidecar files).
- To populate or update previews and details, run **Refresh model metadata** from the [Server](#server) menu section.
- Previews flagged as sensitive are blurred with a **Reveal** button — tap it to show the image.

> [!NOTE]
> If a model has no metadata yet, it still appears by filename and works normally — you just won't see a preview until metadata is fetched.

<a id="image-comparer-nodes"></a>
### Image Comparer Nodes

Nodes that output two images for side-by-side comparison (rgthree's **Image Comparer**) render an interactive before/after slider on their card:

- The two images are stacked, with the **A** image revealed from the left up to a draggable divider over the **B** image (corner labels mark which is which).
- **Drag the handle left and right** to wipe between the two images and inspect the differences.
- If only one side has an image, the card shows that single image; if neither does, nothing is shown until the node runs.

<a id="lora-manager-nodes"></a>
### LoRA Manager Nodes

The mobile UI has dedicated controls for supported `(LoraManager)` node families:

- **LoRA list controls**
  - Toggle all or toggle individual entries on/off.
  - Add/remove LoRA entries from list-based nodes.
  - Edit model strength and optional clip strength per entry.
  - LoRA display names may hide `.safetensors` suffixes for readability.
- **Text/list synchronization**
  - Editing LoRA text syntax can update LoRA list entries.
  - Editing LoRA list entries can update LoRA text syntax.
- **TriggerWord Toggle controls**
  - Toggle individual trigger words.
  - Optional strength controls when enabled by the node.
  - Trigger-word lists can be updated from incoming backend trigger-word messages.
- **Graph/subgraph-aware updates**
  - LoRA Manager updates target the correct node reference in root graph or subgraphs.
  - Trigger-word sync respects chain providers/loaders and downstream routing where applicable.

<a id="bookmarks"></a>
### Bookmarks

- Items can be bookmarked for quick access (up to five bookmarks per workflow).
  - Bookmark nodes, groups, or subgraphs via each item's `...` menu.
- Bookmarks appear fixed to the edge of the screen
  - click a bookmark button to scroll to that item
  - long press to reposition the bookmarks list, tap again to lock in place
- Bookmarks will be remembered when loading workflows
- Use the "Clear Bookmarks" button in the workflow page `...` menu to delete all bookmarks for a workflow

<a id="reposition-mode"></a>
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

<a id="notes"></a>
### Notes

- Note nodes or note-like text properties render as a note block.
- Double-tap the note to edit it.
- URLs are automatically turned into links.
- Textarea tools allow copy and clear actions.

<a id="output-preview"></a>
### Output Preview

- Nodes with output images show a preview thumbnail.
- Tap the preview to open the full-screen Image Viewer.
- Nodes with string/text outputs can also show a text preview block on the card.

<a id="errors"></a>
### Errors

- Nodes with errors are highlighted with red borders.
- Tap the error icon to see per-input error details.
- Loading a workflow with errors displays a popover just above the bottom bar. Click this popover to scroll between errored nodes.

<a id="queue-page"></a>
## Queue Page

The queue page shows pending, running, and completed generations. Get to the queue page by swiping left from the workflow page.

<a id="queue-list-and-status"></a>
### Queue List and Status

- Items are grouped by status: pending, running, then completed.
- Completed items are sorted by most recent run.
- Tap a card header to fold or unfold its outputs.
- Running items show progress and the currently executing node.

<a id="queue-options-menu"></a>
### Queue Options Menu

Tap the top-right `...` ellipsis when on the Queue page to access:

- Go to workflow: quick navigation back to the workflow panel.
- Cancel all pending items.
- Fold all or unfold all queue cards.
- Toggle metadata overlays (show/hide metadata).
- Toggle preview visibility (show/hide previews).
- Clear empty history items (items with no output images).
- Clear all history (with confirmation).

<a id="queue-card-details"></a>
### Queue Card Details

- Pending items can be removed from the queue.
- Running items have a Stop button to interrupt execution.
- Completed items show timestamps, duration, and success status.

<a id="images-previews-and-video"></a>
### Images, Previews, and Video

- Completed items show saved outputs and, optionally, preview/temp images.
- Video outputs autoplay when the card is expanded and can be replayed.
- Downloaded items display a cloud icon badge.
- Metadata overlays (model, sampler, steps, cfg) can be toggled from the Queue options menu.
- When previews are visible, queue ordering is preserved so tapping an item opens the matching media in the Image Viewer.

<a id="queue-item-menu"></a>
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

<a id="source-switching"></a>
### Source Switching

- Switch between **Outputs** (generated images/videos) and **Inputs** (uploaded assets) using the outputs `...` menu.
- The top bar title updates to show which source is active.

<a id="folder-navigation"></a>
### Folder Navigation

- Folders are displayed at the top of the file list.
- Tap a folder to navigate into it.
- A breadcrumb trail at the top shows your current path — tap any segment to jump back.
- Swipe right to navigate up one folder level (or use the breadcrumb).

<a id="view-modes"></a>
### View Modes

- Toggle between grid and list views from the `...` menu.
- Grid view shows image/video thumbnails in a responsive grid.
- List view shows files with thumbnails, names, and details in a vertical list.

<a id="filtering-and-sorting"></a>
### Filtering and Sorting

- Tap the filter/sort button in the bottom bar to open the filter modal.
- Filter by file type: all, images only, or videos only.
- Filter by favorites only.
- Sort by: date modified, name, or file size (ascending or descending).
- Toggle show/hide hidden files (files starting with `.`) from the `...` menu.

**Search** is a separate tool opened from the outputs `...` menu. It opens a search bar at the top of the page where you type a query and tap **Apply**. The search matches filenames **and** the generation prompt embedded in each image, so you can find outputs by something you remember typing. A banner reports the total number of matches and how many are in the current folder; clear the search to return to browsing.

<a id="favorites"></a>
### Favorites

- Mark files as favorites for quick access.
- Favorite files show a solid red heart indicator.
- Favorite or unfavorite from the file's `...` context menu, from the heart button in the [Image Viewer](#image-viewer), or from the selection actions when in [Selection Mode](#select-mode).
- Use the "favorites only" filter to view just your favorited files.
- Favorites persist across sessions.

<a id="select-mode"></a>
### Selection Mode

- Enter selection mode from the `...` menu or by using the context menu on a file.
- Tap files to select or deselect them.
- **Range select:** with one file already selected, long-press another file's selection badge (or shift-click on desktop) to select everything in between — useful for grabbing a whole run at once.
- The bottom bar shows the number of selected items and a selection actions button.
- Selection actions include:
  - Favorite or unfavorite selected files.
  - Move selected files to a different folder.
  - Delete selected files.

<a id="file-actions"></a>
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

<a id="use-in-workflow"></a>
### Use in Workflow

- Select "Use in workflow" from a file's context menu or from the media viewer.
- A modal lists all LoadImage nodes in your current workflow.
- Tap a node to load the selected image into that node's input.
- The app switches to the workflow page and scrolls to the updated node.

<a id="outputs-viewer"></a>
### Outputs Viewer

- Tap any image or video to open a full-screen viewer.
- Swipe left/right to navigate between files.
- Action buttons in the viewer allow you to delete, load workflow metadata, or use the image in your workflow.
- Tap the info button to toggle metadata overlays.

<a id="image-viewer"></a>
## Image Viewer

The full-screen viewer supports images and videos while keeping access to the bottom bar of the app available.

<a id="open-and-navigate"></a>
### Open and Navigate

- Open by tapping any image or video.
- Swipe left/right to move between files.
- The counter in the top-left shows your position in the current list.

<a id="keyboard-shortcuts"></a>
### Keyboard Shortcuts

The image viewer accepts these keys when no text input is focused:

| Key | Action |
| --- | --- |
| `←` | Previous (newer) image |
| `→` | Next (older) image |
| `Escape` | Close the topmost open modal if any; otherwise close the viewer |
| `Delete` / `Backspace` | Open the delete confirmation dialog (same as the trash button) |
| `f` | Toggle favorite (same as the heart button) |
| `w` | Load this image's embedded workflow (same as the workflow button) |
| `u` | Use this image in a workflow LoadImage node (images only) |
| `i` | Toggle the metadata overlay |
| `d` | Download the current image to device (iOS opens the share sheet) |
| `q` | In the viewer: toggle Follow Queue mode. From the Workflow or Queue page (with the viewer closed): open the viewer in Follow Queue mode |
| `p` | Toggle the pinned widget editor (same as the pin button). If the pinned widget is a text widget, focus drops into the textarea with the caret at the end so you can start typing immediately |

Inside any confirmation dialog the destructive/primary action is pre-focused, so `Enter` confirms it immediately. `Tab` / `Shift+Tab` cycle between buttons in the dialog. The visible focus ring only appears when the dialog was triggered via the keyboard — opening a dialog with a mouse or tap leaves the pre-focused button without a ring until you start tabbing.

Closing the viewer while a modal is open closes the modal too.

<a id="zoom-and-pan"></a>
### Zoom and Pan

- Pinch to zoom images.
- Drag to pan when zoomed.
- Double-tap toggles between "fit" and "cover" zoom modes.

<a id="metadata-overlays"></a>
### Metadata Overlays

- Tap the info button to show or hide metadata overlays.
- Metadata includes model, sampler, steps, cfg, and elapsed generation time (when available).

<a id="follow-queue-mode"></a>
### Follow Queue Mode

- Tap the queue/follow button in the bottom bar to open the viewer in follow mode.
- While follow mode is active, the viewer will jump to new queue media as runs finish (including preview/temp images when available).
- Tap the button again to pause or resume follow mode.

<a id="video-playback"></a>
### Video Playback

- Video outputs play inline with native controls.
- The viewer preserves follow mode but currently disables zoom gestures for videos.

### Workflow Controls

- Tap the workflow button to load an image's embedded workflow metadata. You will be prompted to confirm if you have unsaved changes.
- This works for saved outputs and temp preview images, as long as the image has embedded workflow metadata.
- Tap the Use in Workflow button to load the image into any of the current workflow's LoadImage nodes.

### Pinned widgets

- If you have a pinned widget, click the pin button to edit your pinned widget without leaving the image viewer
