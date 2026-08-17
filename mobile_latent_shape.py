"""Tell the mobile client what a latent preview stream actually contains.

The problem
-----------
Preview frames arrive at the client as a flat sequence of N images, and N alone
is ambiguous in a way that changes how it should be drawn:

    a batch of 4 images   -> four separate results; showing them one at a time
                             in a single slot reads as a flicker
    a 4-frame video       -> one result; showing them side by side throws away
                             the animation

VideoHelperSuite, which produces those frames, computes exactly the number we
need — it branches on `x0.ndim` to decide whether it is looking at a batch or a
video — and then sends only the flattened count. ComfyUI's own preview envelope
carries no shape either. By the time either payload reaches the browser the
distinction is gone, and every way of recovering it downstream is a guess:
frame counts overlap, and VHS's frame rate only identifies the video formats it
already knows about, so any new one would be misread.

Neither payload is ours to change, so this adds a third one. We read the tensor
at the point the sampler hands it over — before anything flattens it — and send
the shape on the same websocket, ahead of the frames it describes.

The seam
--------
`latent_preview.prepare_callback` is where a sampler asks for its per-step
callback, and the callback receives the denoised latent directly:

    [B, C, H, W]      B images
    [B, C, T, H, W]   B videos of T frames each

Wrapping it rather than `get_previewer` is deliberate. VHS hooks
`get_previewer`, and custom nodes import alphabetically — `comfyui-mobile-
frontend` sorts before `comfyui-videohelpersuite`, so a `get_previewer` wrapper
of ours would be installed first and end up nested *inside* VHS's, which never
calls through to the previewer it wrapped. Hooking a different function sidesteps
the ordering question entirely, and it sees the real tensor no matter how many
other packs have wrapped the previewer itself.

Coverage is every sampler that uses `prepare_callback`, which is all the core
ones and nearly every custom pack. A pack that hand-rolls its own callback sends
nothing, and the client keeps its previous behaviour — an absent message means
"unknown", never a wrong answer.
"""
import functools
import logging

logger = logging.getLogger(__name__)

# (prompt_id, node_id) pairs already reported. A sampler calls its callback once
# per step and the shape cannot change mid-sampling, so only the first is worth
# sending. Bounded by pruning everything for a prompt once a different one runs.
_reported = set()
_reported_prompt = None

_installed = False


def _executing_ids():
    """The prompt and node currently sampling, by ComfyUI's own reckoning."""
    prompt_id = node_id = None
    try:
        from comfy_execution.utils import get_executing_context
        context = get_executing_context()
        if context is not None:
            prompt_id = context.prompt_id
            node_id = context.node_id
    except Exception:
        pass
    if prompt_id is None or node_id is None:
        try:
            import server
            instance = getattr(server.PromptServer, "instance", None)
            if instance is not None:
                prompt_id = prompt_id or getattr(instance, "last_prompt_id", None)
                # The same id VHS stamps into its frames, so the client can line
                # this message up with the sequence it describes.
                node_id = node_id or getattr(instance, "last_node_id", None)
        except Exception:
            pass
    return prompt_id, node_id


def _shape_of(x0):
    """(batch, frames) for a latent, or None if it is not a shape we understand."""
    shape = getattr(x0, "shape", None)
    if shape is None:
        return None
    dims = len(shape)
    if dims == 4:
        return int(shape[0]), 1
    if dims == 5:
        # [B, C, T, H, W]. VHS flattens this batch-major (movedim(2,1) then
        # reshape), so frame index b*T + t belongs to batch item b.
        return int(shape[0]), int(shape[2])
    return None


def _report(x0):
    global _reported_prompt

    prompt_id, node_id = _executing_ids()
    if node_id is None:
        return
    if prompt_id != _reported_prompt:
        _reported_prompt = prompt_id
        _reported.clear()
    key = (prompt_id, str(node_id))
    if key in _reported:
        return

    shape = _shape_of(x0)
    if shape is None:
        return
    batch, frames = shape
    _reported.add(key)

    import server
    instance = getattr(server.PromptServer, "instance", None)
    if instance is None:
        return
    instance.send_sync(
        "mobile_latent_shape",
        {
            "prompt_id": prompt_id,
            "node_id": str(node_id),
            "batch": batch,
            "frames": frames,
        },
        instance.client_id,
    )


def install():
    """Wrap latent_preview.prepare_callback. Safe to call more than once."""
    global _installed
    if _installed:
        return False
    try:
        import latent_preview
    except Exception:
        logger.warning("[mobile] latent_preview unavailable; shape hints disabled")
        return False

    original = latent_preview.prepare_callback

    @functools.wraps(original)
    def prepare_callback(model, steps, x0_output_dict=None, *args, **kwargs):
        inner = original(model, steps, x0_output_dict, *args, **kwargs)

        @functools.wraps(inner)
        def callback(step, x0, x, total_steps, *cb_args, **cb_kwargs):
            # Never let a preview hint break a generation: report, then get out
            # of the way regardless of what happened.
            try:
                _report(x0)
            except Exception:
                logger.debug("[mobile] latent shape report failed", exc_info=True)
            return inner(step, x0, x, total_steps, *cb_args, **cb_kwargs)

        return callback

    prepare_callback.__wrapped__ = original
    latent_preview.prepare_callback = prepare_callback
    _installed = True
    return True


def reset_for_tests():
    """Clear the dedup state between unit tests."""
    global _reported_prompt
    _reported.clear()
    _reported_prompt = None
