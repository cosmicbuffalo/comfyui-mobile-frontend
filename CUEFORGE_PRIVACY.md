# What this custom node sends off your server

This document lists **every outbound request this custom node makes**, and what
each one carries, because that is the part that lives in this repository and
that you, the server operator, control. If something here does not match the
code, the code is wrong or this document is — please open an issue.

CueForge is the companion iOS app for this mobile frontend. The app's own
privacy policy — what the app stores on your device, what the push relay
retains, the app's analytics, and purchases — is published at
<https://cueforge.dev/privacy> and is the authoritative version for all of
that. It is deliberately **not** mirrored here: two copies of a policy drift,
and a stale copy is worse than no copy.

## At a glance

| Destination | When | What leaves your server |
| --- | --- | --- |
| CueForge push relay | only after you pair a device | completion notifications and Live Activity updates ([below](#the-cueforge-push-relay)) |
| Your browser's push service | only after you enable web push in a browser | an encrypted notification only that browser can read |
| CivitAI | **on by default — turn it off in Preferences**; automatically, for models without metadata | a model file's SHA-256 hash; preview images are downloaded back ([below](#civitai-model-metadata)) |
| CueForge feedback service | only when you submit the feedback form | what you typed, plus diagnostics if you tick the box |
| CueForge push relay, `/telemetry/batch` | **on by default — turn it off in Preferences** | anonymous operational events ([below](#operational-telemetry)) |

Everything else the frontend does — browsing outputs, editing workflows,
queueing — is between your browser and your own ComfyUI server.

## The CueForge push relay

The node talks to the relay only when a device has been paired with the iOS
app. With no paired device it makes no requests to the relay at all.

### Completion notifications

When a generation finishes, the node POSTs one event per paired device:

| Field | Value |
| --- | --- |
| `prompt_id` | ComfyUI's UUID for the run |
| `status` | `success` or `error` |
| `outputs` | how many output files the run produced |
| `pairing_code` | the random code identifying the paired device |
| `server_id` | optional; set by the app so a notification tap opens the right server |
| `server_label` | optional; **the name you gave this server in the app** (e.g. "Homelab"), shown in the notification |
| `relevance_score` | optional; a number the app assigns from your server order, so iOS ranks two busy servers consistently |
| `url` | a relative deep link (`/mobile/?prompt_id=…`) |
| `image` | optional; a **relative URL on your own server**, only when "include thumbnail" is on |

No prompt text, no workflow, no filenames, no image bytes. The `image` field is
a path (`/mobile/api/thumbnail?prompt_id=…`) that resolves against your server,
keyed by the same opaque UUID already in the payload; the phone fetches the
picture from your server directly, never through the relay. The notification's
title and body are composed by the relay from `status`, not sent from here.

### Live Activities

If the app has Live Activities on for this server, the node also sends
generation progress so the Lock Screen and Dynamic Island can show it — about
every two seconds while something is running, or every ten when iOS has not
granted frequent updates. Each update carries:

| Field | Value |
| --- | --- |
| `prompt_id`, `pairing_code`, `server_id`, `server_label`, `relevance_score` | as above |
| `phase` | `queued`, `generating`, `done` or `error` |
| `progress`, `node_progress` | fractions from 0 to 1 |
| `queue_position` | how many prompts are waiting |
| `node_index`, `node_count` | position in the graph, e.g. 3 of 7 |
| `node_name` | **the running node's title as it appears in your graph**, falling back to its type (e.g. "KSampler", "Upscale (2x)") |
| `workflow_label` | **the workflow's display name**, as the frontend recorded it when queueing (up to 200 characters) |
| `delivery`, `activity_event` | relay controls: whether this update may be dropped, and whether it starts, updates or ends the activity |

`node_name` and `workflow_label` are text you wrote. They are what makes the
Live Activity say *"Portrait upscale · KSampler 3/7"* rather than "Generating",
and they appear on your Lock Screen. If they should not leave your server,
switch Live Activities off for this server in the app (the server's ⋯ menu);
completion notifications do not include them.

### Pairing and test messages

Pairing sends one fixed confirmation event to check that the code belongs to a
real relay pairing (a Live-Activity-only pairing uses a side-effect-free verify
call carrying only the code). "Send test notification" sends a fixed title and
body. Neither contains a prompt, workflow, filename, or image.

### Where it can be sent

Only to an allowlisted HTTPS origin. By default that is the production
CueForge relay and nothing else. Operators running their own relay add
origins with `COMFYUI_MOBILE_APP_PUSH_RELAYS` (comma-separated). A stored
target that falls outside the allowlist is discarded without being contacted,
so an origin removed from the list stops receiving events immediately.

### Turning it off

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

## Web push

The self-hosted web-push path (`mobile_web_push.py`) does not involve the
relay or CueForge at all: your server signs and sends notifications directly
to the browser's own push service using a VAPID keypair generated on your
machine. The content is encrypted to that browser's subscription key, so the
push service carries it without being able to read it.

The server only sends to the push services browsers actually use: Apple
(`push.apple.com`), Google (`fcm.googleapis.com`), Mozilla
(`push.services.mozilla.com`) and Microsoft (`notify.windows.com`), over HTTPS
on the default port. A subscription pointing anywhere else is refused, so a
client cannot make the server POST to a loopback or LAN address. If your
browser uses a different push service, add its hostname with
`COMFYUI_MOBILE_WEB_PUSH_HOSTS`; see
[Allowing another push service](./README.md#allowing-another-push-service)
for the syntax and how to find the host. A stored subscription that falls
outside the list is discarded without being contacted.

## CivitAI model metadata

The model picker shows previews, trigger words and base models. Without
[LoRA Manager](https://github.com/willmiao/ComfyUI-Lora-Manager) the node looks
them up on CivitAI itself (`model_metadata.py`); with it, the frontend asks
LoRA Manager to, and LoRA Manager sends CivitAI the same hash.

- **When:** automatically, for models with no metadata yet:
  - once per session for the whole library, when the model list first loads
    (without LoRA Manager only);
  - when a workflow uses a model the picker has no metadata for (a model
    added since the list loaded, say). Only that model is looked up, once per
    session;
  - when you use *Refresh model metadata* in the App menu.

  A model CivitAI does not know is recorded and not asked about again.
- **Sent:** a `GET` to `civitai.com/api/v1/model-versions/by-hash/<sha256>` — the
  **SHA-256 hash of the model file**, computed on your server, with the user
  agent `comfyui-mobile-frontend`. Not the filename, not your server's address.
- **Received:** CivitAI's public record for that model, and its preview image,
  downloaded from CivitAI and saved beside the model as a sidecar.
- **Turning it off:** this is **on by default**. Switch off
  **Preferences → Fetch model details from CivitAI**, or set
  `COMFYUI_MOBILE_CIVITAI_METADATA=0` on the server (`1` forces it on, and
  either value locks the switch). With comfyui-multiuser, only an admin can
  change the switch. Off, the node contacts CivitAI for nothing,
  the frontend asks LoRA Manager for no lookups, and *Refresh model metadata*
  only picks up new files. LoRA Manager's own features (its downloader, its
  own refresh) are LoRA Manager's and not affected.

A hash identifies a *published* file, so a model you trained or merged yourself
matches nothing and reveals nothing beyond "a file CivitAI has not seen". A
model you downloaded from CivitAI tells CivitAI, via your server's IP address,
that this server has it.

## The feedback form

The frontend's feedback form (App menu → About → Send Feedback) is sent **from
your browser, not from the server**, to CueForge's feedback service
(`feedback.comfyui-mobile-frontend.com`), which files it as a **public GitHub
issue** on this repository. It sends only when you press Submit:

- the title and description you typed;
- a contact, only if you enter one. A handle that GitHub confirms is a real
  account is mentioned in the issue; **anything else — an email address, a phone
  number — is removed from the public issue** and forwarded privately to the
  maintainer's inbox so they can reply;
- **diagnostics, only if you tick "Include diagnostics"**, shown to you in full
  before sending: this frontend's version, ComfyUI version, OS, Python version,
  your browser's user agent, and how many nodes the open workflow has (the count,
  not the workflow).

The service uses your IP address only to rate-limit submissions and does not
store it. Builds made without the feedback endpoint configured link to GitHub's
own new-issue page instead and send nothing themselves.

## Operational telemetry

The node reports how it runs — that it started, and, once an hour, how many
generations finished or failed and roughly how long they took, whether
notifications were delivered, and how often its own routes errored — so we can
see how it behaves on real servers. **It is on by
default, and you can turn it off at any time.** Nothing it sends is about what
you make or who uses the server.

**Turning it off:** Preferences → *Share operational telemetry*, which applies to
the whole server. Or set `COMFYUI_MOBILE_TELEMETRY=0` where ComfyUI runs; the
environment wins over the switch, which then shows its state locked
(`COMFYUI_MOBILE_TELEMETRY=1` forces it on the same way). With comfyui-multiuser,
only an admin can change the switch. Turning it off drops
anything queued and deletes the install id at once; turning it on again starts
a new one. ComfyUI's log says on every start whether it is on.

**Where it goes:** to the CueForge push relay's `/telemetry/batch`, not to an
analytics company. The relay checks every field against the table below, drops
anything else, and forwards the rest to PostHog without storing or logging it.
PostHog therefore never sees your server's IP address, and no analytics key is
in this repository. The relay's handling of a batch, and the list of everything
it accepts, are published at
[cosmicbuffalo/cueforge-telemetry](https://github.com/cosmicbuffalo/cueforge-telemetry);
this node ships the same list as `telemetry_contract.json`, and
[TELEMETRY.md](https://github.com/cosmicbuffalo/cueforge-telemetry/blob/main/TELEMETRY.md)
there explains what each number means and does not.

**What is sent.** Every batch carries `install_id` — a random identifier, not
derived from your machine — and `deployment`: `prod`, unless
`COMFYUI_MOBILE_TELEMETRY_DEPLOYMENT` says `dev` or `review`. Every event
also carries `node_version` and `measurement_version`. The events, and every
field each can carry, are:

<!-- telemetry-contract: tests/test_privacy_doc_contract.py checks this table
     against telemetry_contract.json. Change what is sent, and this table
     must change with it, or the test fails. Write each field as
     `field`: followed by its allowed values, or a description in words. -->

| Event | Fields |
| --- | --- |
| `node started` | `platform`: `linux`, `windows`, `darwin` or `other`. `python_version`: the Python version. `comfyui_version`: the ComfyUI version, or `unknown`. `install_source`: `registry`, `manager`, `git` or `other`. `multiuser`: whether comfyui-multiuser is installed. |
| `hourly summary` | `opens_ios_app_bucket`, `opens_share_extension_bucket`, `opens_web_bucket`: page loads of the frontend that hour, by kind of client, as ranges. `queued_ios_app_bucket`, `queued_share_extension_bucket`, `queued_web_bucket`: generations queued, by kind of client, as ranges. `succeeded_bucket`, `failed_bucket`, `interrupted_bucket`: generations that finished each way, as ranges. `median_duration_bucket`: the hour's median run time, as a range such as 10–30s. `top_model_family`: the architecture used by the most runs that hour, as ComfyUI detects it — `sd15`, `sd2`, `sdxl`, `sd3`, `stable_cascade`, `stable_video`, `flux`, `flux2`, `chroma`, `hidream`, `qwen_image`, `z_image`, `lumina`, `auraflow`, `pixart`, `hunyuan_image`, `hunyuan_video`, `wan`, `ltx`, `mochi`, `cosmos`, `cogvideo`, `kandinsky`, `audio`, `3d` or `other`. **Never a model's name, file, hash or CivitAI identifier.** `top_error_class`: the exception type that failed the most runs, **type name only**, such as OutOfMemoryError — never its message. `pushes_delivered_bucket`, `pushes_failed_bucket`: notifications delivered or not, as ranges. `request_failures_bucket`: server errors from the node's own routes, as a range. |
| `daily summary` | `paired_app`: whether an iOS app is paired. `days_since_install_bucket`: days since install, as a range. |

Activity is never sent as it happens. The node counts it in memory and sends one
`hourly summary` for each hour in which something happened — an idle hour sends
nothing — so even a busy server contacts the relay about once an hour. Counts and
durations are always ranges, never exact, so a small install cannot be
fingerprinted by its numbers. A summary that fails to send is dropped, never
retried or stored.

## Never sent, by any of the above

Prompt text, workflow contents, output images or their filenames, model
filenames, your server's URL or LAN/Tailscale address, credentials, or anything
about the people using your server. The two user-authored strings that do leave
— `node_name` and `workflow_label`, in Live Activity updates — are described
above with how to stop them.
