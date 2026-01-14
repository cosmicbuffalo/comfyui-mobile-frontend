# ComfyUI Mobile Frontend

An experimental dedicated mobile-first frontend for [ComfyUI](https://github.com/comfyanonymous/ComfyUI).

> [!WARNING]
> This project was almost entirely vibecoded with claude code, codex and gemini cli. It is still a work in progress, and currently doesn't support all custom nodes automatically. Don't be surprised if it breaks!

This project operates as a ComfyUI Custom Node that serves a modern, responsive React application. It is designed to make monitoring and managing your ComfyUI workflows and queue easy and accessible from your phone or tablet.

## Features

*   **Mobile-Optimized Interface:** A responsive UI designed specifically for touch devices.
*   **Workflow Editor:** Browse, fold, and edit node inputs; hide static/bypassed nodes; jump along connections.
*   **Queue + History:** View pending/running/completed generations, clear history, and manage previews.
*   **Image Viewer:** Full-screen viewer with pinch-to-zoom, swipe navigation, and follow-queue mode.
*   **Dark/Light Themes:** Theme toggle with persistent settings.
*   **Real-time Updates:** WebSocket integration for live status and progress monitoring.

## Installation

This project is installed as a standard ComfyUI Custom Node.

1.  Navigate to your ComfyUI `custom_nodes` directory:
    ```bash
    cd /path/to/ComfyUI/custom_nodes/
    ```
2.  Clone this repository:
    ```bash
    git clone https://github.com/cosmicbuffalo/comfyui-mobile-frontend.git
    ```
3.  Install dependencies and build the frontend:
    ```bash
    cd comfyui-mobile-frontend
    npm install
    npm run build
    ```
4.  Restart ComfyUI.

## Usage

Once installed and ComfyUI is running, you can access the mobile interface by navigating to:

```
http://<your-comfyui-ip>:8188/mobile
```

*Note: Replace `<your-comfyui-ip>` with the actual IP address of your computer if accessing from a mobile device on the same network. The build output is served from `dist/` at `/mobile` (or `/mobile/index.html`).*

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

### Building for Release

To build the production version of the frontend (which is what ComfyUI serves):

```bash
npm run build
```

This compiles the React application into the `dist/` directory, which the Python backend serves.

## License

MIT
