"""Test-only ComfyUI node that emits latent previews without loading a model.

Installed by scripts/latent-preview-smoke.mjs --install (a symlink into
custom_nodes), never shipped as part of the frontend extension.

Why it exists
-------------
Latent previews only reach the client when a *sampler* runs, because only a
sampler calls `latent_preview.get_previewer()` — which is where VHS installs
its global hook. That made the whole pipeline untestable without a checkpoint,
so the existing real-server smoke uses a model-free workflow and consequently
never produced a single preview frame. A 4-byte error in the binary envelope
shipped in 3.1.2 and survived six days of use behind that gap.

This node reproduces exactly the part of a sampler that matters: it asks for a
previewer through the real `get_previewer()` (so VHS's hook applies, and the
per-prompt `preview_method` override applies), then drives a real
`comfy.utils.ProgressBar` with real preview images. Everything downstream —
VHS's WrappedPreviewer, the throttle, the binary envelope, the websocket — is
the production path. Nothing is stubbed and nothing touches the GPU.
"""

import time

import torch

import comfy.utils
import latent_preview

# Four latent channels mapped to RGB. The values only need to produce a
# non-degenerate image; SD1.5's factors are used so previews look plausible if
# a human ever watches this run.
LATENT_RGB_FACTORS = [
    [0.3512, 0.2297, 0.3227],
    [0.3250, 0.4974, 0.2350],
    [-0.2829, 0.1762, 0.2721],
    [-0.2120, -0.2616, -0.7177],
]


class _ProbeLatentFormat:
    """The surface `latent_preview.get_previewer()` actually reads.

    Deliberately not a comfy.latent_formats subclass: a real one would put us
    in VHS's `rates_table` and change the frame rate under the test.
    """

    latent_channels = 4
    taesd_decoder_name = None  # forces the latent2rgb path even under --taesd
    latent_rgb_factors = LATENT_RGB_FACTORS
    latent_rgb_factors_bias = None
    latent_rgb_factors_reshape = None


class MobileLatentPreviewProbe:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "steps": ("INT", {"default": 8, "min": 1, "max": 128}),
                # Batch 1 is the regression case: a still-image workflow, where
                # VHS reports a one-frame "animation". >1 exercises the frame
                # buffer and the out-of-order reassembly instead.
                "batch": ("INT", {"default": 1, "min": 1, "max": 16}),
                # Pixel dimensions; the preview comes out at latent resolution
                # (size // 8), exactly as a real sampler's does.
                "latent_size": ("INT", {"default": 512, "min": 64, "max": 2048, "step": 64}),
                # VHS throttles to `rate` frames/sec (8 by default) and drops
                # anything faster, so steps must be spaced or most emit nothing.
                "step_delay_ms": ("INT", {"default": 200, "min": 0, "max": 2000}),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "emit"
    OUTPUT_NODE = True
    CATEGORY = "_for_testing/mobile"
    DESCRIPTION = "Emits latent preview frames with no model, for the mobile preview smoke test."

    def emit(self, steps, batch, latent_size, step_delay_ms):
        previewer = latent_preview.get_previewer(
            torch.device("cpu"), _ProbeLatentFormat()
        )
        if previewer is None:
            # Either the server was started with --preview-method none and the
            # client sent no per-prompt override, or it sent "none". Failing
            # here beats a smoke test that silently asserts nothing.
            raise RuntimeError(
                "no previewer: this prompt carries no usable extra_data.preview_method "
                "and the server default is NoPreviews, so no latent previews can be sent."
            )

        latent = latent_size // 8
        pbar = comfy.utils.ProgressBar(steps)
        emitted = 0
        for step in range(steps):
            x0 = torch.rand((batch, 4, latent, latent)) * 2 - 1
            preview = previewer.decode_latent_to_preview_image("JPEG", x0)
            # VHS's wrapper dispatches its own frames and returns None; the
            # stock previewer returns a ("JPEG", image, max_size) tuple that
            # ProgressBar forwards. Both are the real production shapes.
            if preview is not None:
                emitted += 1
            pbar.update_absolute(step + 1, steps, preview)
            if step_delay_ms:
                time.sleep(step_delay_ms / 1000)

        # The previewer class name is the smoke's proof that it measured the
        # envelope it meant to: "WrappedPreviewer" means VHS's hook applied.
        summary = (
            f"previewer={type(previewer).__name__} steps={steps} batch={batch} "
            f"stock_frames={emitted}"
        )
        return {"ui": {"text": [summary]}}


NODE_CLASS_MAPPINGS = {"MobileLatentPreviewProbe": MobileLatentPreviewProbe}
NODE_DISPLAY_NAME_MAPPINGS = {"MobileLatentPreviewProbe": "Latent Preview Probe (mobile smoke)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
