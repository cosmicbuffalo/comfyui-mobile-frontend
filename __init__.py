print("[Mobile Frontend] Loading custom node...")
import os
import server
from aiohttp import web

# Define the path to the built frontend files
EXTENSION_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(EXTENSION_DIR, "dist")

def setup_mobile_route():
    if not os.path.exists(DIST_DIR):
        print(f"[\033[33mMobile Frontend\033[0m] 'dist' directory not found. Please run 'npm run build' in {EXTENSION_DIR}")
        return

    # Create a sub-application for the mobile frontend
    mobile_app = web.Application()

    # Handler to serve index.html for SPA routing
    async def serve_index(request):
        response = web.FileResponse(os.path.join(DIST_DIR, "index.html"))
        response.headers['Cache-Control'] = 'no-cache'
        return response

    # Serve index.html for root and all non-asset routes (SPA)
    mobile_app.router.add_get('/', serve_index)
    mobile_app.router.add_get('/{path:.*}', serve_index)

    # Serve static assets
    mobile_app.add_routes([web.static('/assets', os.path.join(DIST_DIR, 'assets'))])

    # Mount the sub-application at /mobile
    server.PromptServer.instance.app.add_subapp('/mobile', mobile_app)

    print(f"[\033[34mMobile Frontend\033[0m] Mobile UI enabled at: \033[34m/mobile\033[0m")

# Execute the setup
setup_mobile_route()

# Required for ComfyUI to recognize this as a custom node, even if it has no logic nodes
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
