#!/usr/bin/env python
"""Regenerate the golden VHS animated-latent frame fixture.

    python scripts/capture-vhs-latent-frame.py
    python scripts/capture-vhs-latent-frame.py --comfy-root /path/to/ComfyUI

Why this exists
---------------
`parseBinaryPreviewMessage` decodes a binary envelope that neither this repo
nor ComfyUI defines: VideoHelperSuite writes it by hand. The first version of
that parser was written from a prose description of the layout, its unit
fixtures were hand-encoded from the same description, and both were wrong by
one 4-byte word for six days without a single test failing — because the
fixture and the code were the same belief written twice.

So the fixture is not hand-written any more. This script derives it from the
two upstream functions that actually produce the bytes, and refuses to emit
anything if either has drifted from the copy the parser was written against:

  * VHS `process_previews()`  — writes index + Pascal node id + JPEG
  * ComfyUI `encode_bytes()`  — prepends the binary event type

That last one is the word that got missed. VHS writes *two* leading uint32s of
its own and `encode_bytes` prepends a third, so the frame index lands 12 bytes
in, not 8. Deriving the fixture from both functions makes that impossible to
get wrong by re-reading the description more carefully.

Run this after upgrading VHS or ComfyUI. If it fails, the envelope moved and
`parseBinaryPreviewMessage` needs to move with it — see the
`comfyui-videohelpersuite` entry in scripts/node-parity/manifests.mjs.
"""

import argparse
import base64
import io
import json
import re
import struct
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
# The frontend is installed as a ComfyUI custom node, so the sibling pack and
# the ComfyUI root are both reachable relatively. Overridable for CI checkouts.
DEFAULT_COMFY_ROOT = REPO_ROOT.parent.parent
FIXTURE = REPO_ROOT / "src/hooks/__tests__/fixtures/vhs-latent-frame.json"

# Upstream statements this fixture is derived from. Whitespace is normalised
# before matching, so reindentation is tolerated but a changed layout is not.
VHS_PACKING = [
    "message.write((1).to_bytes(length=4, byteorder='big')*2)",
    "message.write(ind.to_bytes(length=4, byteorder='big'))",
    "message.write(struct.pack('16p', serv.last_node_id.encode('ascii')))",
]
COMFY_PACKING = [
    'packed = struct.pack(">I", event)',
    "message = bytearray(packed)",
    "message.extend(data)",
]


def normalised(text):
    return re.sub(r"\s+", " ", text)


def require(haystack, statements, label, path):
    missing = [s for s in statements if normalised(s) not in normalised(haystack)]
    if missing:
        print(f"error: {label} has drifted from the copy the parser was built on.")
        print(f"  source: {path}")
        for statement in missing:
            print(f"  missing: {statement}")
        print("\nThe wire format may have changed. Re-read the upstream function,")
        print("update parseBinaryPreviewMessage in src/hooks/useWebSocket.ts, then")
        print("update the expected statements at the top of this script.")
        sys.exit(1)


def read(path):
    if not path.is_file():
        print(f"error: expected to find {path}")
        print("Pass --comfy-root if your ComfyUI lives elsewhere.")
        sys.exit(1)
    return path.read_text(encoding="utf-8")


def version_of(text, pattern, default="unknown"):
    match = re.search(pattern, text, re.M)
    return match.group(1) if match else default


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--comfy-root", type=Path, default=DEFAULT_COMFY_ROOT)
    parser.add_argument("--node-id", default="50:7")
    parser.add_argument("--index", type=int, default=3)
    args = parser.parse_args()

    comfy_root = args.comfy_root.resolve()
    vhs_root = comfy_root / "custom_nodes/comfyui-videohelpersuite"

    vhs_source_path = vhs_root / "videohelpersuite/latent_preview.py"
    comfy_source_path = comfy_root / "server.py"
    vhs_source = read(vhs_source_path)
    comfy_source = read(comfy_source_path)

    require(vhs_source, VHS_PACKING, "VHS process_previews()", vhs_source_path)
    require(comfy_source, COMFY_PACKING, "ComfyUI encode_bytes()", comfy_source_path)

    try:
        from PIL import Image
    except ImportError:
        print("error: Pillow is required. Run this with ComfyUI's interpreter.")
        sys.exit(1)

    # A real encoder's output, not a stubbed `ff d8 ... ff d9`, so the fixture
    # exercises the same "payload contains bytes that could pass for headers"
    # hazard the parser has to survive.
    image = Image.new("RGB", (8, 8), (32, 96, 160))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=95)
    jpeg = buffer.getvalue()

    # --- VHS process_previews(), transcribed from the statements above -----
    message = io.BytesIO()
    message.write((1).to_bytes(length=4, byteorder="big") * 2)
    message.write(args.index.to_bytes(length=4, byteorder="big"))
    message.write(struct.pack("16p", args.node_id.encode("ascii")))
    message.write(jpeg)
    payload = message.getvalue()

    # --- ComfyUI encode_bytes(event=BinaryEventTypes.PREVIEW_IMAGE) -------
    frame = bytearray(struct.pack(">I", 1))
    frame.extend(payload)

    vhs_version = version_of(
        read(vhs_root / "pyproject.toml"), r'^version\s*=\s*"([^"]+)"'
    )
    comfy_version = version_of(
        read(comfy_root / "comfyui_version.py"), r'^__version__\s*=\s*"([^"]+)"'
    )

    fixture = {
        "_comment": (
            "Generated by scripts/capture-vhs-latent-frame.py — do not hand-edit. "
            "Derived from VHS process_previews() and ComfyUI encode_bytes(); the "
            "script fails if either upstream function drifts."
        ),
        "derivedFrom": {
            "vhsVersion": vhs_version,
            "comfyuiVersion": comfy_version,
            "vhsSource": "videohelpersuite/latent_preview.py :: process_previews",
            "comfyuiSource": "server.py :: PromptServer.encode_bytes",
            "statements": VHS_PACKING + COMFY_PACKING,
        },
        "layout": {
            "eventType": 0,
            "vhsWordOne": 4,
            "vhsWordTwo": 8,
            "frameIndex": 12,
            "nodeIdLength": 16,
            "nodeId": 17,
            "jpeg": 32,
        },
        "expected": {
            "nodeId": args.node_id,
            "index": args.index,
            "jpegBase64": base64.b64encode(jpeg).decode("ascii"),
        },
        "frameBase64": base64.b64encode(bytes(frame)).decode("ascii"),
    }

    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {FIXTURE.relative_to(REPO_ROOT)}")
    print(f"  VHS {vhs_version} / ComfyUI {comfy_version}")
    print(f"  {len(frame)} bytes, JPEG starts at offset {len(frame) - len(jpeg)}")


if __name__ == "__main__":
    main()
