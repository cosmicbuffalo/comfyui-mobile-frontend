print("[Mobile Frontend] Loading custom node...")
import os
import shutil
import server
from aiohttp import web
import folder_paths
import json
import time
from PIL import Image, ImageOps
import io

# Define the path to the built frontend files
EXTENSION_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(EXTENSION_DIR, "dist")

def setup_mobile_route():
    if not os.path.exists(DIST_DIR):
        print(f"[\033[33mMobile Frontend\033[0m] 'dist' directory not found. Please run 'npm run build' in {EXTENSION_DIR}")
        return

    # Create a sub-application for the mobile frontend
    mobile_app = web.Application()

    async def api_list_files(request):
        try:
            query = request.rel_url.query
            source = query.get('source', 'output')
            base_dir = folder_paths.get_input_directory() if source == 'input' else folder_paths.get_output_directory()
            subpath = query.get('path', '')
            recursive = query.get('recursive', 'false').lower() == 'true'
            search = query.get('search', '').lower()
            prompt_search = query.get('prompt', '').lower()
            start_date = query.get('startDate') # ms timestamp
            end_date = query.get('endDate')     # ms timestamp
            limit = int(query.get('limit', 0))
            offset = int(query.get('offset', 0))
            
            # Security check for path traversal
            target_path = os.path.abspath(os.path.join(base_dir, subpath))
            if not target_path.startswith(os.path.abspath(base_dir)):
                return web.json_response({"error": "Access denied"}, status=403)
            
            if not os.path.exists(target_path):
                return web.json_response({"error": "Path not found"}, status=404)

            results = []
            
            # Helper to check prompt in file
            def match_prompt(full_path):
                if not prompt_search: return True
                try:
                    ext = os.path.splitext(full_path)[1].lower()
                    if ext == '.png':
                        img = Image.open(full_path)
                        metadata = img.info
                        prompt_str = metadata.get('prompt', '')
                        # prompt_str might be JSON
                        return prompt_search in prompt_str.lower()
                    return False
                except:
                    return False

            # Helper to process a file
            def process_file(root, filename):
                full_path = os.path.join(root, filename)
                stat = os.stat(full_path)
                mtime_ms = int(stat.st_mtime * 1000)

                # Date filter
                if start_date and mtime_ms < int(start_date): return None
                if end_date and mtime_ms > int(end_date): return None

                # Name search filter
                if search and search not in filename.lower():
                    return None
                
                # Prompt search filter
                if prompt_search and not match_prompt(full_path):
                    return None
                    
                rel_path = os.path.relpath(full_path, base_dir)
                
                # Determine type
                ext = os.path.splitext(filename)[1].lower()
                kind = 'image' if ext in ['.png', '.jpg', '.jpeg', '.webp', '.gif'] else \
                       'video' if ext in ['.mp4', '.mov', '.webm', '.mkv'] else 'unknown'
                
                if kind == 'unknown': return None

                return {
                    "name": filename,
                    "path": rel_path,
                    "type": kind,
                    "size": stat.st_size,
                    "date": mtime_ms,
                    "folder": os.path.relpath(root, base_dir) if root != base_dir else ""
                }

            is_flattened = recursive or search or prompt_search or start_date or end_date

            if is_flattened:
                for root, dirs, files in os.walk(target_path):
                    for name in files:
                        if name.startswith('.'): continue
                        item = process_file(root, name)
                        if item: results.append(item)
            else:
                # Non-recursive: list dirs and files in current path
                for name in os.listdir(target_path):
                    if name.startswith('.'): continue
                    full_path = os.path.join(target_path, name)
                    if os.path.isdir(full_path):
                        count = 0
                        for _, _, files in os.walk(full_path):
                            count += len([f for f in files if not f.startswith('.')])
                            
                        results.append({
                            "name": name,
                            "type": "dir",
                            "path": os.path.relpath(full_path, base_dir),
                            "count": count,
                            "date": int(os.stat(full_path).st_mtime * 1000)
                        })
                    else:
                        item = process_file(target_path, name)
                        if item: results.append(item)

            # Sort results: Dirs first, then name alphabetical
            def sort_key(item):
                is_dir = 0 if item['type'] == 'dir' else 1
                return (is_dir, item['name'].lower())
            
            results.sort(key=sort_key)
            
            total = len(results)
            if limit > 0:
                results = results[offset:offset+limit]

            return web.json_response({
                "files": results,
                "total": total,
                "offset": offset,
                "limit": limit
            })
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_delete_file(request):
        try:
            data = await request.json()
            filepath = data.get('path')
            source = data.get('source', 'output')
            if not filepath:
                return web.json_response({"error": "No path provided"}, status=400)
            
            base_dir = folder_paths.get_input_directory() if source == 'input' else folder_paths.get_output_directory()
            target_path = os.path.abspath(os.path.join(base_dir, filepath))
            
            if not target_path.startswith(os.path.abspath(base_dir)):
                return web.json_response({"error": "Access denied"}, status=403)
            
            if os.path.exists(target_path):
                if os.path.isdir(target_path):
                    shutil.rmtree(target_path)
                else:
                    os.remove(target_path)
                return web.json_response({"success": True})
            else:
                return web.json_response({"error": "File not found"}, status=404)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_file_metadata(request):
        try:
            filepath = request.query.get('path', '')
            if not filepath:
                return web.json_response({"error": "No path provided"}, status=400)

            source = request.query.get('source', 'output')
            base_dir = folder_paths.get_input_directory() if source == 'input' else folder_paths.get_output_directory()
            target_path = os.path.abspath(os.path.join(base_dir, filepath))

            if not target_path.startswith(os.path.abspath(base_dir)):
                return web.json_response({"error": "Access denied"}, status=403)

            if not os.path.exists(target_path):
                return web.json_response({"error": "File not found"}, status=404)

            if os.path.isdir(target_path):
                return web.json_response({"error": "Folder metadata not supported"}, status=400)

            ext = os.path.splitext(target_path)[1].lower()
            image_extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
            video_extensions = ['.mp4', '.mov', '.webm', '.mkv']

            metadata_path = target_path
            if ext in video_extensions:
                base_name = os.path.splitext(os.path.basename(target_path))[0]
                folder_path = os.path.dirname(target_path)
                matching_image = None
                for img_ext in image_extensions:
                    candidate = os.path.join(folder_path, base_name + img_ext)
                    if os.path.exists(candidate):
                        matching_image = candidate
                        break
                if not matching_image:
                    return web.json_response({"error": "No image metadata found for video"}, status=404)
                metadata_path = matching_image
            elif ext not in image_extensions:
                return web.json_response({"error": "Unsupported file type"}, status=400)

            img = Image.open(metadata_path)
            metadata = dict(img.info)
            if hasattr(img, 'text') and isinstance(img.text, dict):
                metadata.update(img.text)
            workflow = None

            workflow_str = metadata.get('workflow') or metadata.get('Workflow')
            if isinstance(workflow_str, bytes):
                workflow_str = workflow_str.decode('utf-8', errors='ignore')
            if workflow_str:
                try:
                    workflow = json.loads(workflow_str) if isinstance(workflow_str, str) else workflow_str
                except Exception:
                    workflow = None

            if not workflow:
                prompt_str = metadata.get('prompt') or metadata.get('Prompt')
                if isinstance(prompt_str, bytes):
                    prompt_str = prompt_str.decode('utf-8', errors='ignore')
                if not prompt_str:
                    return web.json_response({"error": "No prompt metadata found"}, status=404)

                try:
                    prompt_data = json.loads(prompt_str)
                except Exception:
                    return web.json_response({"error": "Invalid prompt metadata"}, status=400)

                extra_pnginfo = prompt_data.get('extra_pnginfo', {})
                if isinstance(extra_pnginfo, str):
                    try:
                        extra_pnginfo = json.loads(extra_pnginfo)
                    except Exception:
                        extra_pnginfo = {}
                workflow = (
                    extra_pnginfo.get('workflow')
                    or prompt_data.get('workflow')
                    or prompt_data.get('workflow_v2')
                )

            if not workflow:
                return web.json_response({"error": "No workflow metadata found"}, status=404)

            return web.json_response({"workflow": workflow})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_image_metadata(request):
        try:
            filepath = request.query.get('path', '')
            if not filepath:
                return web.json_response({"error": "No path provided"}, status=400)

            source = request.query.get('source', 'output')
            base_dir = folder_paths.get_input_directory() if source == 'input' else folder_paths.get_output_directory()
            target_path = os.path.abspath(os.path.join(base_dir, filepath))

            if not target_path.startswith(os.path.abspath(base_dir)):
                return web.json_response({"error": "Access denied"}, status=403)

            if not os.path.exists(target_path):
                return web.json_response({"error": "File not found"}, status=404)

            if os.path.isdir(target_path):
                return web.json_response({"error": "Folder metadata not supported"}, status=400)

            ext = os.path.splitext(target_path)[1].lower()
            image_extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
            video_extensions = ['.mp4', '.mov', '.webm', '.mkv']

            metadata_path = target_path
            if ext in video_extensions:
                base_name = os.path.splitext(os.path.basename(target_path))[0]
                folder_path = os.path.dirname(target_path)
                matching_image = None
                for img_ext in image_extensions:
                    candidate = os.path.join(folder_path, base_name + img_ext)
                    if os.path.exists(candidate):
                        matching_image = candidate
                        break
                if not matching_image:
                    return web.json_response({"error": "No image metadata found for video"}, status=404)
                metadata_path = matching_image
            elif ext not in image_extensions:
                return web.json_response({"error": "Unsupported file type"}, status=400)

            img = Image.open(metadata_path)
            metadata = dict(img.info)
            if hasattr(img, 'text') and isinstance(img.text, dict):
                metadata.update(img.text)

            prompt_data = None
            prompt_str = metadata.get('prompt') or metadata.get('Prompt')
            if isinstance(prompt_str, bytes):
                prompt_str = prompt_str.decode('utf-8', errors='ignore')
            if prompt_str:
                try:
                    prompt_data = json.loads(prompt_str) if isinstance(prompt_str, str) else prompt_str
                except Exception:
                    prompt_data = None

            workflow = None
            workflow_str = metadata.get('workflow') or metadata.get('Workflow')
            if isinstance(workflow_str, bytes):
                workflow_str = workflow_str.decode('utf-8', errors='ignore')
            if workflow_str:
                try:
                    workflow = json.loads(workflow_str) if isinstance(workflow_str, str) else workflow_str
                except Exception:
                    workflow = None

            if not workflow and isinstance(prompt_data, dict):
                extra_pnginfo = prompt_data.get('extra_pnginfo', {})
                if isinstance(extra_pnginfo, str):
                    try:
                        extra_pnginfo = json.loads(extra_pnginfo)
                    except Exception:
                        extra_pnginfo = {}
                workflow = (
                    extra_pnginfo.get('workflow')
                    or prompt_data.get('workflow')
                    or prompt_data.get('workflow_v2')
                )

            return web.json_response({
                "prompt": prompt_data,
                "workflow": workflow
            })
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_get_thumbnail(request):
        try:
            filename = request.query.get('filename')
            subfolder = request.query.get('subfolder', '')
            source = request.query.get('source', 'output')

            if not filename:
                return web.Response(status=400)

            base_dir = folder_paths.get_input_directory() if source == 'input' else folder_paths.get_output_directory()
            file_path = os.path.abspath(os.path.join(base_dir, subfolder, filename))

            if not file_path.startswith(os.path.abspath(base_dir)):
                return web.Response(status=403)

            if not os.path.exists(file_path):
                return web.Response(status=404)

            # For videos, look for an image with the same name
            ext = os.path.splitext(filename)[1].lower()
            if ext in ['.mp4', '.mov', '.webm', '.mkv']:
                base_name = os.path.splitext(filename)[0]
                folder_path = os.path.join(base_dir, subfolder) if subfolder else base_dir
                image_extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

                # Look for matching image file
                matching_image = None
                for img_ext in image_extensions:
                    candidate = os.path.join(folder_path, base_name + img_ext)
                    if os.path.exists(candidate):
                        matching_image = candidate
                        break

                if not matching_image:
                    return web.Response(status=400, text="No thumbnail image found for video")

                file_path = matching_image

            img = Image.open(file_path)
            img = ImageOps.exif_transpose(img)
            img.thumbnail((300, 300))
            
            buffer = io.BytesIO()
            if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                 img.save(buffer, format='PNG')
                 content_type = 'image/png'
            else:
                 img.save(buffer, format='JPEG', quality=80)
                 content_type = 'image/jpeg'
                 
            buffer.seek(0)
            return web.Response(body=buffer.read(), content_type=content_type)
        except Exception as e:
            return web.Response(status=500)

    async def api_move_files(request):
        try:
            data = await request.json()
            sources = data.get('sources')
            destination = data.get('destination', '')
            source = data.get('source', 'output')
            if not sources or not isinstance(sources, list):
                return web.json_response({"error": "No sources provided"}, status=400)

            base_dir = folder_paths.get_input_directory() if source == 'input' else folder_paths.get_output_directory()
            dest_path = os.path.abspath(os.path.join(base_dir, destination))
            if not dest_path.startswith(os.path.abspath(base_dir)):
                return web.json_response({"error": "Access denied"}, status=403)
            if not os.path.exists(dest_path):
                return web.json_response({"error": "Destination not found"}, status=404)
            if not os.path.isdir(dest_path):
                return web.json_response({"error": "Destination must be a folder"}, status=400)

            for source in sources:
                src_path = os.path.abspath(os.path.join(base_dir, source))
                if not src_path.startswith(os.path.abspath(base_dir)):
                    return web.json_response({"error": "Access denied"}, status=403)
                if not os.path.exists(src_path):
                    continue
                target = os.path.join(dest_path, os.path.basename(src_path))
                shutil.move(src_path, target)

            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def api_mkdir(request):
        try:
            data = await request.json()
            path = data.get('path')
            source = data.get('source', 'output')
            if not path:
                return web.json_response({"error": "No path provided"}, status=400)

            base_dir = folder_paths.get_input_directory() if source == 'input' else folder_paths.get_output_directory()
            target_path = os.path.abspath(os.path.join(base_dir, path))
            if not target_path.startswith(os.path.abspath(base_dir)):
                return web.json_response({"error": "Access denied"}, status=403)

            os.makedirs(target_path, exist_ok=True)
            return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    # Register API routes
    mobile_app.router.add_get('/api/files', api_list_files)
    mobile_app.router.add_delete('/api/files', api_delete_file)
    mobile_app.router.add_get('/api/thumbnail', api_get_thumbnail)
    mobile_app.router.add_get('/api/file-metadata', api_file_metadata)
    mobile_app.router.add_get('/api/image-metadata', api_image_metadata)
    mobile_app.router.add_post('/api/files/move', api_move_files)
    mobile_app.router.add_post('/api/files/mkdir', api_mkdir)

    # Handler to serve index.html for SPA routing (non-API routes only)
    async def serve_index(request):
        # Don't serve index.html for API routes
        path = request.path
        if path.startswith('/api/'):
            return web.Response(status=404, text='Not found')
        response = web.FileResponse(os.path.join(DIST_DIR, "index.html"))
        response.headers['Cache-Control'] = 'no-cache'
        return response

    # Serve static assets (must be before catch-all)
    mobile_app.add_routes([web.static('/assets', os.path.join(DIST_DIR, 'assets'))])

    # Serve index.html for root and all non-API routes (SPA)
    mobile_app.router.add_get('/', serve_index)
    mobile_app.router.add_get('/{path:.*}', serve_index)

    # Redirect /mobile to /mobile/
    async def redirect_to_mobile(request):
        raise web.HTTPFound('/mobile/')

    server.PromptServer.instance.app.router.add_get('/mobile', redirect_to_mobile)

    # Mount the sub-application at /mobile
    server.PromptServer.instance.app.add_subapp('/mobile', mobile_app)

    print(f"[\033[34mMobile Frontend\033[0m] Mobile UI enabled at: \033[34m/mobile\033[0m")

# Execute the setup
setup_mobile_route()

# Required for ComfyUI to recognize this as a custom node, even if it has no logic nodes
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
