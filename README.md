# ComfyUI Mobile Frontend

An experimental dedicated mobile-first frontend for [ComfyUI](https://github.com/comfyanonymous/ComfyUI).

> [!WARNING]
> This project was almost entirely vibecoded with claude code, codex and gemini cli. It is still a work in progress, and currently doesn't support all custom nodes automatically. Don't be surprised if it breaks!

## Introduction

This project operates as a ComfyUI Custom Node that serves a modern mobile user interface. It is designed to make using ComfyUI easy and accessible from your phone or tablet.

Since the original goal of making generation accessible _at all_ on mobile was achieved, the project has turned in a more ambitious direction - Why stop at just making ComfyUI baseline functional on mobile? The mobile interface should be able to completely replace the desktop graph-interface for ComfyUI!

## Why?

Look, I like ComfyUI. It is a great tool and without it I probably wouldn't have gotten into AI in the first place. But man, is it a pain in the ass to use! (IMO)

I can see why some people like the graph interface. It's cool to see a solid workflow and the masterful craft that goes into making its graph look like a work of art. But I don't really give a shit about that most of the time. Most of the time, I just want to get from point A to point B and iterate repeatedly, and in cases like that the graph usually just gets in the way. try to scroll, oops now I'm zoomed way in or out. try to pan and oops, I just dragged this random node out of its position into a mess of other nodes. Maybe the graph interface is user friendly to some, but it sure ain't to me.

I just want to scroll through a workflow and easily and intuitively get to where I'm trying to go, change the thing I want to change, hit enqueue again, and then think about what to iterate on next. I want to be able to look at my outputs and see what settings I tweaked on them with a glance, and pull them right back into my workflow if needed. I want the feedback loop between iterations to be as fast and frictionless as possible.

So this mobile frontend is my attempt at improving upon the user experience of ComfyUI for myself and anyone else who agrees with me that the desktop interface is not their cup of tea. Let's make AI even more accessible now, shall we?

## Features

### ☑️ **Mobile-Optimized Interface:** A responsive UI designed specifically for touch devices
  - tap, scroll, and swipe to navigate your mobile ComfyUI workspace
    - v3.0.0 introduces some improvements for desktop support as well, but desktop support still has a ways to go
### ☑️ **Workflow Editor:** Browse, fold, and edit nodes groups, and subgraphs
  - load and save workflows from anywhere, whether on your server, pasted from your clipboard, or out of a generated image 
  - keep multiple workflow tabs open at once and switch between them without losing state
  - add or delete nodes, and edit connections directly from the mobile UI
  - navigate by traversing connections between nodes and jumping to bookmarks
  - easily hide parts of your workflow you don't need to see
  - reposition nodes, groups, and subgraphs in the mobile layout with drag-and-drop
  - drill into subgraphs from a placeholder node and edit inner nodes with a breadcrumb navigation bar
  - widget controls on subgraph placeholder nodes (promoted and proxy widgets rendered and editable inline)
  - organize your saved workflows into folders, and bookmark or hide them to cut the clutter
### ☑️ **Workflow Runner:** Trigger generations and monitor progress through your queue
  - WebSocket integration for live status and progress monitoring.
  - Follow the queue to take your hands off the wheel or focus on quickly iterating on a pinned widget
  - infinite-generation mode that auto-queues the next run (per-workflow, with a safety stop for fixed-seed loops)
  - automatic reconnect when the backend drops, plus recovery of jobs lost to a ComfyUI restart
  - scroll through generation history and load or copy workflows of anything you want to iterate on
### ☑️ **Media Viewer:** Full-screen viewer with convenient controls and familar gesture support
  - support for images and videos
  - inspect image metadata (just a few core attributes for now)
  - mark outputs as favorites so you can find them with filters later
  - download outputs directly to your device with one click
  - Load workflows from images, or pull images directly into workflows as inputs, hassle-free
### ☑️ **Outputs/Inputs Browser:** Inspect your server's outputs and inputs folders
  - search/filter/sort your outputs or inputs — including search by the prompt baked into an image
  - perform bulk operations like moves, deletes, and downloads (range-select a whole run at once)
  - download outputs to your device (iOS share sheet for saving to Photos/Files)
  - add files to favorites for quick access later
### ☑️ **LoraManager Support:** First-class support for LoraManager nodes and websocket integration
- a rich model/LoRA picker with thumbnails, version, and base-model badges (works with or without LoRA Manager)
### ☑️ **Custom Nodes Manager:** Browse, install, update, enable/disable, and uninstall custom nodes from the app
### ☑️ **Dark Theme:** A slate/cyan dark UI tuned for mobile

## Planned Features

- [ ] Better Custom Node Support
- [ ] Expanded Workflow Editing Capabilities
  - [x] delete nodes from a workflow
  - [x] create new nodes in a workflow (via fuzzy search)
  - [x] move nodes in/out of groups/subgraphs
  - [x] modify connections between nodes
  - [x] navigate into and edit subgraph inner nodes
  - [x] load multiple workflows at once (workflow tabs)
  - [ ] full subgraph creation and editing support
- [x] ComfyUI Manager support (custom nodes manager)
- [ ] Auto-positioning of nodes/Compatibility with desktop FE's graph interface
- [x] Integration of Civitai model metadata
- [ ] Integration of Huggingface model metadata
- [ ] Security/Multi-User Mode (manual opt-in)
  - [ ] Enable multiple users with separate workflows/models/inputs/outputs
  - [ ] Password authentication
  - [ ] Admin interface for user/model/resource management
  - [ ] Parental controls
  - [ ] Keyword/whitelist/blacklist based rule management

## Screenshots

### Workflow Panel
<table>
  <thead>
    <tr>
      <th>Workflow Panel</th>
      <th>Multiple Tabs</th>
      <th>Confirmation Dialog</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/1_workflow_panel.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/2_workflow_panel_multi_tabs.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/2.5_confirmation_dialog.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>
<table>
  <thead>
    <tr>
      <th>Bookmarks + Pins</th>
      <th>Pinned Widget Editor</th>
      <th>Model Picker + Connections</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/3_workflow_panel_bookmarks_pins.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/3.5_pinned_widget_modal.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/4_workflow_panel_model_picker_connection.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>
<table>
  <thead>
    <tr>
      <th>Node Menu</th>
      <th>Workflow Actions</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/5_workflow_panel_menu.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/6_workflow_actions.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>
<table>
  <thead>
    <tr>
      <th>Responsive Behavior for Desktop (WIP)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/7_workflow_panel_responsive.png?raw=true" width="700px"/></td>
    </tr>
  </tbody>
</table>

### Queue Panel & Media Viewer
<table>
  <thead>
    <tr>
      <th>Full-Screen Viewer</th>
      <th>Queue Item Menu</th>
      <th>Queue Panel Menu</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/8_1_image_viewer.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/8_2_queue_panel.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/8_3_queue_panel_menu.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>
<table>
  <thead>
    <tr>
      <th>Prompt Preview/Diff</th>
      <th>Re-enqueue</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/8_4_queue_panel_prompt_preview.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/8_5_queue_panel_re_enqueue.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>

### App Menu & Settings
<table>
  <thead>
    <tr>
      <th>Main Menu</th>
      <th>Preferences</th>
      <th>Feedback Form</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/9_1_main_menu.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/9_2_preferences.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/9_3_feedback.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>
<table>
  <thead>
    <tr>
      <th>Custom Nodes Manager</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/9_4_custom_node_manager.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>

### Inputs / Outputs Panel
<table>
  <thead>
    <tr>
      <th>Inputs / Outputs Panel</th>
      <th>Multiple Tabs</th>
      <th>Panel Menu</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/a_inputs_outputs_panel.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/b_inputs_outputs_panel_multi_tabs.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/c_inputs_outputs_panel_menu.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>
<table>
  <thead>
    <tr>
      <th>Filter + Sort</th>
      <th>Select Mode</th>
      <th>Selection Menu</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/d_inputs_outputs_panel_filter_sort.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/e_inputs_outputs_panel_select_mode.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/f_inputs_outputs_panel_selection_menu.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>
<table>
  <thead>
    <tr>
      <th>Move Menu</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/g_inputs_outputs_panel_move_menu.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>
<table>
  <thead>
    <tr>
      <th>Responsive Behavior for Desktop (WIP)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/3.0.0%20screens/h_inputs_outputs_panel_responsive.png?raw=true" width="700px"/></td>
    </tr>
  </tbody>
</table>

## Installation


This project is installed as a standard ComfyUI Custom Node. Search for it in the ComfyUI-Manager by name (ensure author is `cosmicbuffalo`) or follow the steps below for a manual installation:

1.  Navigate to your ComfyUI `custom_nodes` directory:
    ```bash
    cd /path/to/ComfyUI/custom_nodes/
    ```
2.  Clone this repository:
    ```bash
    git clone https://github.com/cosmicbuffalo/comfyui-mobile-frontend.git
    ```
3.  Restart ComfyUI.

## Usage

Once installed and ComfyUI is running, you can access the mobile interface by navigating to:

```
http://<your-comfyui-ip>:8188/mobile
```

*Note: Replace `<your-comfyui-ip>` with the actual IP address of your computer if accessing from a mobile device on the same network. The build output is served from `dist/` at `/mobile` (or `/mobile/index.html`).*

> [!IMPORTANT]
> Don't forget to add the `--listen` flag to your ComfyUI startup command to make your ComfyUI instance [accessible to other devices on your LAN](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/cli_args.py#L38)

### LoRA Manager UI Integration

This mobile frontend supports LoRA Manager nodes and websocket integration. The integration will work mostly out of the box, but the "Open LoRA Manager" action assumes by default that your LoRA Manager is running at `/loras` on the same host. If this is not the case, you can override the default assumption using one of the two methods:

1. `VITE_LORA_MANAGER_UI_URL` environment variable (build-time, run `npm run build` in the custom node directory to apply this change)
2. `localStorage["comfyui-mobile-lora-manager-ui-url"]` override

> [!WARNING]
> These override methods were not thoroughly tested in development, good luck and feel free to PR any improvements

## Development

If you want to contribute or modify the frontend, you'll need Node.js installed.

### Setup

1.  Navigate to the node directory:
    ```bash
    cd custom_nodes/comfyui-mobile-frontend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

### Running Locally

You can run the frontend in development mode with hot-reloading. This requires a running instance of ComfyUI for the API backend.

```bash
npm run dev
```

The dev server will proxy API requests to `localhost:8188` by default. If your ComfyUI instance is on a different port, update the `proxy` configuration in `vite.config.ts`.

If you are working on a remote machine, prefix the dev server command with `COMFY_HOST`:

```bash
COMFY_HOST=<your-comfyui-ip> npm run dev
```

### Building for Release

To build the production version of the frontend (which is what ComfyUI serves at <your-comfyui-ip>:8188/mobile/):

```bash
npm run build
```

This compiles the React application into the `dist/` directory, which the Python backend serves. The build also emits precompressed `.br` (brotli) and `.gz` siblings next to each asset; the backend negotiates these automatically and serves the content-hashed assets with long-lived `immutable` cache headers, so the app loads fast and repeat visits hit the browser cache.

> **Upgrading from an earlier version?** The asset-serving route and cache headers changed in 3.0.0. **Restart ComfyUI after upgrading** so the new serving logic and `immutable` caching take effect (a browser hard-refresh may also be needed to clear any previously-cached `index.html`).

## License

MIT
