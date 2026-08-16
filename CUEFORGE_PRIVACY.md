# What this custom node sends to CueForge

CueForge is the companion iOS app for this mobile frontend. This document
covers **what the custom node itself transmits**, because that is the part
that lives in this repository and that you, the server operator, control.

The app's own privacy policy — covering what the app stores on your device,
what the push relay retains, analytics, and purchases — is published at
<https://cueforge.dev/privacy> and is the authoritative version. It is
deliberately **not** mirrored here: two copies of a policy drift, and a stale
copy is worse than no copy.

## The node sends nothing to CueForge unless you pair a device

With no paired device, this node makes no outbound requests to the CueForge
relay. Everything else the frontend does — browsing outputs, editing
workflows, queueing — is between your browser and your own ComfyUI server.
(The self-hosted web-push path is the one other outbound channel; it never
touches CueForge and is described in its own section below.)

## What a completion notification contains

When a device is paired and a generation finishes, the node POSTs a single
event to the push relay. The payload is, in full:

| Field | Value |
| --- | --- |
| `prompt_id` | ComfyUI's UUID for the run |
| `status` | `success` or `error` |
| `outputs` | how many output files the run produced |
| `pairing_code` | the random code identifying the paired device |
| `server_id` | optional; set by the app so a notification tap opens the right server |
| `url` | a relative deep link (`/mobile/?prompt_id=…`) |
| `image` | optional; a **relative URL on your own server**, only when "include thumbnail" is on |

Note what is absent: no prompt text, no workflow, no filenames, no image
bytes. The `image` field is a path (`/mobile/api/thumbnail?prompt_id=…`) that
resolves against your server, not a picture and not a filename — it is keyed
by the same opaque UUID that is already in the payload. The notification's
visible title and body are composed by the relay from `status`, not sent from
here.

Pairing sends one fixed confirmation event to verify that the code belongs to
a real relay pairing. The "Send test notification" button likewise sends a
fixed title and body. Neither contains a prompt, workflow, filename, or image.

## Where it can be sent

Only to an allowlisted HTTPS origin. By default that is the production
CueForge relay and nothing else. Operators running their own relay add
origins with `COMFYUI_MOBILE_APP_PUSH_RELAYS` (comma-separated). A stored
target that falls outside the allowlist is discarded without being contacted,
so an origin removed from the list stops receiving events immediately.

## Turning it off

Pairing is enabled by default; the allowlist is what makes that safe, since a
paired client can only ever direct events at an origin you already trust. To
disable the pairing endpoints entirely, set `COMFYUI_MOBILE_APP_PUSH=0` in
the environment ComfyUI runs under and restart. Unpairing from within the app
stops delivery for that device without disabling anything server-wide.

**Threat model.** ComfyUI itself has no user accounts: any client that can
reach the server can already queue prompts, browse and download every output,
and delete files. Pairing is treated the same way — a client that can reach
the pairing endpoint may register a device to receive completion events. Such
a client gains nothing it could not already read directly, and the events
carry only the fields listed above, but a registration does persist until it
is removed from the app or from the pairing list. If your ComfyUI is reachable
by clients you do not fully trust, put it behind authentication (a reverse
proxy, VPN, or Cloudflare Access) or set `COMFYUI_MOBILE_APP_PUSH=0`.

## Web push is separate

The self-hosted web-push path (`mobile_web_push.py`) does not involve the
relay or CueForge at all: your server signs and sends notifications directly
to the browser's own push service using a VAPID keypair generated on your
machine.
