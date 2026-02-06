# ComfyUI Mobile Frontend

An experimental dedicated mobile-first frontend for [ComfyUI](https://github.com/comfyanonymous/ComfyUI).

> [!WARNING]
> This project was almost entirely vibecoded with claude code, codex and gemini cli. It is still a work in progress, and currently doesn't support all custom nodes automatically. Don't be surprised if it breaks!

> [!NOTE]
> Refactoring of vibecoded nonsense code has begun with v2.0.0 but there are still plenty of pieces that need fixing

## Introduction

This project operates as a ComfyUI Custom Node that serves a modern mobile user interface. It is designed to make monitoring and managing your ComfyUI workflows and queue easy and accessible from your phone.

Since the original goal of making generation accessible _at all_ on mobile was achieved, the project has turned in a more ambitious direction - Why stop at just making ComfyUI baseline functional on mobile? The mobile interface should be able to completely replace the desktop graph-interface for ComfyUI!

## Why?

Look, I like ComfyUI. It is a great tool and without it I probably wouldn't have gotten into AI in the first place. But man, is it a pain in the ass to use! (IMO)

I can see why some people like the graph interface. It's cool to see a solid workflow and the masterful craft that goes into making its graph look like a work of art. But I don't really give a shit about that most of the time. Most of the time, I just want to get from point A to point B and iterate repeatedly, and in cases like that the graph usually just gets in the way. try to scroll, oops now I'm zoomed way in or out. try to pan and oops, I just dragged this random node out of its position into a mess of other nodes. Maybe the graph interface is user friendly to some, but it sure ain't to me.

I just want to scroll through a workflow and easily and intuitively get to where I'm trying to go, change the thing I want to change, hit enqueue again, and then think about what to iterate on next. I want to be able to look at my outputs and see what settings I tweaked on them with a glance, and pull them right back into my workflow if needed. I want the feedback loop between iterations to be as fast and frictionless as possible.

So this mobile frontend is my attempt at improving upon the user experience of ComfyUI for myself and anyone else who agrees with me that the desktop interface is not their cup of tea. Let's make AI even more accessible now, shall we?

## Features

### ☑️ **Mobile-Optimized Interface:** A responsive UI designed specifically for touch devices
  - tap, scroll, and swipe to navigate your mobile ComfyUI workspace
    - one user suggested making the mobile frontend usable on the desktop form factor as well. I like this idea, but it will have to wait to be explored until other higher priority plans are completed first
### ☑️ **Workflow Editor:** Browse, fold, and edit nodes in workflows
  - easily hide nodes you don't need to see
  - navigate by traversing connections between nodes and jumping to bookmarks
  - load and save workflows from anywhere, whether on your server, pasted from your clipboard, or out of a generated image
### ☑️ **Workflow Runner:** Trigger generations and monitor progress through your queue
  - WebSocket integration for live status and progress monitoring.
  - Follow the queue to take your hands off the wheel or focus on quickly iterating on a pinned widget
  - scroll through generation history and load or copy workflows of anything you want to iterate on
### ☑️ **Media Viewer:** Full-screen viewer with convenient controls and familar gesture support
  - support for images and videos
  - inspect image metadata (just a few core attributes for now)
  - Load workflows from images, or pull images directly into workflows as inputs, hassle-free
### ☑️ **Outputs/Inputs Browser:** Inspect your server's outputs and inputs folders
  - search/filter/sort your outputs or inputs
  - perform bulk operations like moves or deletes
  - add files to favorites for quick access later
### ☑️ **Dark/Light Themes:** Theme toggle with persistent settings.

## Planned Features

- [ ] Better Custom Node Support
- [ ] Expanded Workflow Editing Capabilities
  - [ ] delete nodes from a workflow
  - [ ] create new nodes in a workflow (via fuzzy search)
  - [ ] move nodes in/out of groups/subgraphs
  - [ ] modify connections between nodes
  - [ ] load multiple workflows at once (workflow tabs)
- [ ] ComfyUI Manager support
- [ ] Auto-positioning of nodes/Compatibility with desktop FE's graph interface
- [ ] Integration of Civitai model metadata
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
      <th>Output Previews</th>
      <th>Bookmarks + Pins</th>
      <th>Workflow Menu (Light Mode)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/workflow_panel.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/workflow_panel_2.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/workflow_panel_3_light.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>

### Queue Panel
<table>
  <thead>
    <tr>
      <th>Queue Item Menu</th>
      <th>Queue Menu</th>
      <th>Pinned Widget Editor</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/queue_panel.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/queue_panel_2.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/pinned_widget.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>

### Outputs Panel
<table>
  <thead>
    <tr>
      <th>List View</th>
      <th>Outputs Menu (Grid View)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/outputs_panel.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/outputs_panel_2.png?raw=true" width="300px"/></td>
    </tr>
  </tbody>
</table>

### Image Viewer
<table>
  <thead>
    <tr>
      <th>Full Screen View</th>
      <th>Overlay buttons</th>
      <th>Button Modals (w/Metadata)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/image_viewer.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/images/image_viewer_2.png?raw=true" width="300px"/></td>
      <td><img src="https://github.com/user-attachments/assets/f3373269-b168-459d-8586-70b812e6b59c" width="300px"/></td>
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

## Development

If you want to contribute or modify the frontend, you'll need Node.js installed.

### Setup

1.  Navigate to the node directory:
    ```bash
    cd custom_nodes/comfyui-mobile
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

This compiles the React application into the `dist/` directory, which the Python backend serves.

## License

MIT
