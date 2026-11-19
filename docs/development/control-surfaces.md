# Soundscaper control-surface implementation plan

This plan defines the implementation boundaries and acceptance gates for
Soundscaper hardware control surfaces. The [post-1.0 roadmap](../../roadmap.md#9-post-10-extensions)
owns product status and sequencing. No protocol support is claimed by this
document. Implement MCU first, HUI compatibility next, and investigate EUCON
as a separately gated extension.

## Scope and entry point

The initial desktop workflow connects a supported surface to the existing
transport, mixer, and automation. It covers play/stop, record through the
normal recording preflight, track selection, volume, pan, mute, solo, and
switching the tracks assigned to the hardware channel strips. Send current
values, transport state, supported track labels, and supported meter feedback
back to the device. Touch-sensitive faders must support concurrent gestures.

Add **Control surfaces** inside the existing **Edit > Preferences > Audio settings**
surface. This is the proposed setup location, not an existing setting. Setup
owns enable/disable, protocol/profile selection, input/output port pairing,
connection status, and disconnect/reconnect actions. Start disabled and open
ports only after explicit opt-in. Remember local configuration, but treat a
missing, ambiguous, or replaced device as unavailable until resolved. Put
diagnostics inside this opt-in surface; add no always-visible toolbar control,
panel, rail, badge, or inline control.

The baseline does not include instrument note input, MIDI clock/MTC, MPE,
samplers, arbitrary MIDI learn, user-executable device scripts, plug-in parameter
pages, surround panning, or Framescaper integration. Those capabilities need
their own bounded work packets. Browser Web MIDI is a possible later adapter;
desktop qualification and Web Core editing must remain independent of it.

## Protocol strategy

| Adapter | Intended role | Admission condition |
| --- | --- | --- |
| Mackie Control Universal (MCU) | First complete mixer/transport workflow, with device-specific profiles where necessary. | Reviewed protocol evidence, implementation/license provenance, and tested hardware profiles. |
| Human User Interface (HUI) | Compatibility for hardware operating in HUI mode. | Separate parser, encoder, session lifecycle, and real-device qualification after the MCU foundation. |
| Extended User Control (EUCON) | Potential integration with Avid surfaces and Avid Control. | SDK/distribution feasibility and target-platform evidence before a product commitment. |

MCU and HUI are separate wire adapters even when a device supports both modes.
Neither is assumed to behave like generic MIDI continuous-controller mapping.
Declare the tested subset per device/profile; a protocol name alone does not
certify every emulating controller or every function printed on its buttons.

## Ownership and invariants

Follow [architecture and maintainability](../architecture/overview.md),
[production rendering](../architecture/production-rendering.md), and
[native services](../architecture/native-services.md).

- Keep protocol codecs and normalized surface actions in focused strict
  TypeScript domain modules under `src/common/editor/`. They must not import
  React, Electron, or a broad editor facade.
- Put stateful coordination behind narrow typed ports in the existing
  controller domains: composition wires dependencies; preferences owns device
  configuration; track-audio owns mixer targeting; transport and recording own
  their commands; document owns history and publication. Register any new
  public files or dependency directions with their owning architecture policy.
- Keep presentation in `src/common/editor/ui/` and Soundscaper product wiring
  in `src/soundscaper/`. Shared codecs do not enable another product implicitly.
- Native MIDI adapters execute in supervised helper processes. Main owns
  device grants, exact payload admission, and lifecycle. Renderer/preload ports
  expose bounded operations and opaque device/session IDs. EUCON, if admitted,
  must use an equally explicit SDK/network boundary.
- Surface events resolve to existing editor actions and stable parameter
  addresses. The device never owns project state, routing, or an alternate audio
  engine. Preserve command guards, recording preflight, locks, read-only state,
  parameter taper/range, and canonical automation timing.
- Device/profile configuration, port identities, banks, touch state, and
  reconnect generations are local preferences or transient session state.
  Existing mixer and automation intent persists through its current owners;
  do not allocate a project schema for hardware setup. Any later event-model
  or project-format change must satisfy the roadmap's Audacity compatibility
  and migration review first.
- Keep one authoritative active-project binding per device session. Project
  switches, lost write authority, disconnect, disable, helper failure, and
  disposal terminate gestures and invalidate queued input/output. A late event
  must never target a newly active project or a reassigned strip.
- Bound messages, queues, device counts, and feedback rates. Coalesce replaceable
  meter/value feedback while preserving button edges and gesture termination.
  Detect overload and end the affected session instead of applying stale input.
- Preserve existing startup, chunk, architecture, coverage, and file-size
  budgets. Load optional adapters on demand; extract focused modules from
  ratcheted owners rather than growing them or raising limits.

## Work packets

Start each packet with focused failing tests for its behavior. Import the
owning module directly, keep new modules/tests in strict TypeScript, and await,
catch, return, or explicitly `void` every promise. Commit each completed packet
atomically. A packet stops at its stated gate; simulator results alone cannot
promote a hardware or packaged-platform claim.

| Packet | Prerequisites | Outcome |
| --- | --- | --- |
| CS01 | Existing editor command/parameter contracts | Reviewed surface contract and independently sourced protocol fixtures. |
| CS02 | CS01; coordinate the native MIDI service with roadmap packet 8B | Opt-in, supervised device sessions and setup. |
| CS03 | CS01, CS02 | Complete MCU baseline with concurrent automation and feedback. |
| CS04 | CS03 | HUI adapter on the same editor integration. |
| CS05 | CS03, CS04 | Qualified MCU/HUI device profiles and desktop packages. |
| CS06 | Research alongside CS01; adapter after CS03 and feasibility approval | Durable EUCON decision, followed by an adapter only for approved targets. |

### CS01. Surface contract and protocol evidence

Define closed normalized actions, feedback snapshots, device/profile
capabilities, port pairing, bank order, and session generations. Define track,
bus, and master eligibility explicitly from the existing mixer projection;
never identify a target by its display name or array position alone.

Collect protocol documentation and independently captured input/output traces
with their origin, device model, firmware, operating mode, and redistribution
rights. Select multi-fader MCU-capable and HUI-capable reference surfaces;
one physical device may qualify both modes separately. Record expected
unsupported buttons and profile differences. Review any reused implementation's
license before importing it, and pin third-party inputs through the existing
provenance workflow.

**Gate:** tests reject malformed actions and stale generations and prove stable
target resolution across track reorder/deletion and bank changes. Trace fixtures
have independently specified expected actions/bytes. Stop a protocol adapter
whose evidence or implementation provenance is unresolved.

### CS02. Native MIDI service and opt-in setup

Extend the planned native MIDI service with enumeration, explicit input/output
pairing, open/close, ordered event delivery, bounded sends, hotplug, revocation,
and idempotent cleanup. Keep musical note input and surface ownership distinct
so a reserved control port cannot accidentally play an instrument or receive a
second surface session.

Reuse the helper supervisor and versioned contracts; add capability/security
and licensing entries through their owning registers. Admit only the selected
ports and operations. Add authenticated payload production, staging, containment,
and packaged smoke evidence for Linux x64/ARM64, macOS ARM64, and Windows
x64/ARM64. Missing payloads or unavailable devices report typed unavailability
while ordinary editing and playback remain usable.

Build the preferences workflow with keyboard navigation, focus restoration,
localized copy, and actionable unavailable states. Follow the
[localization workflow](localization.md), including generated catalog handling.
Persist enablement and chosen configuration locally without silently claiming a
new port when device identity cannot be established.

**Gate:** focused helper tests cover invalid IPC, permission loss, open failures,
hotplug, duplicate ownership, crash/hang, and teardown. UI tests show no device
enumeration/opening before opt-in and prove enable, disable, and unavailable
flows. Each advertised native target has its own packaged evidence.

### CS03. MCU mixer, transport, and automation

Implement the MCU parser/encoder and a profile-driven session with its required
handshake. Wire normalized actions to the editor ports and derive feedback from
authoritative project/transport state. Apply device-specific label limits and
encoder conventions. On connection or bank change, publish a bounded complete
snapshot, clear unused strips, and invalidate feedback for old assignments.
Prevent echoed feedback from becoming a new edit.

Use the existing parameter descriptors and automation gesture path for fader
touch/move/release. The current
[`parameter-automation-control-router-v21.ts`](../../src/common/editor/parameter-automation-control-router-v21.ts)
tracks a single active gesture per router. Introduce per-parameter gesture
ownership or equivalent coordination so multiple physical faders can be touched
at once without cancelling each other. Capture active strip assignments for the
gesture lifetime; define bank/selection changes during touch to terminate the
affected gestures before reassignment.

Exercise read, trim, touch, latch, and write modes through their existing
semantics. Group a manual fader gesture into one undoable operation rather than
one history entry per MIDI packet. On disconnect or stale authority, use the
existing cancellation behavior and preserve committed edits. Define a bounded
gesture-ending policy for supported controls without touch detection.

**Gate:** golden protocol tests plus editor integration tests prove bidirectional
volume/pan/mute/solo/selection, transport/record preflight, bank boundaries,
simultaneous gestures, undo/redo, automation timing, and save/reopen. Test project
switches, deletion, read-only transitions, feedback loops, reconnect snapshots,
and a disconnect during automation capture. Validate the complete workflow on
the MCU reference surface before claiming its profile supported.

### CS04. HUI compatibility

Implement a separate HUI codec/session on the shared action and feedback ports.
Cover its handshake/keepalive, fader and relative-encoder encoding, button
edges, labels, meters, and any required bounded SysEx messages. Qualify the
selected HUI profile against the same baseline workflow; document differences
in supported feedback and controls instead of silently substituting MCU rules.

**Gate:** independent HUI traces and timeout/malformed-message tests pass; the
MCU regression selection still passes; real HUI hardware completes the baseline
workflow, including simultaneous gestures and disconnect recovery. Unsupported
profiles or functions retain explicit unavailable/unsupported status.

### CS05. Qualification and delivery

Publish the tested model/firmware/mode matrix and the setup/troubleshooting
workflow in the handbook. Separate codec fixtures, simulated editor workflows,
real-device observations, and exact packaged-target evidence. Establish and
record event/feedback rate, response latency, and memory bounds using the
reference devices; a long-session run must show no stuck touches, feedback
oscillation, unbounded queues, or retained sessions after repeated reconnects.

Run focused Node and browser workflows for the changed owners, strict type
checks, changed-file lint, applicable architecture/audits, and product builds
under the [testing guide](testing.md). Tests must cover setup accessibility and
localization, live edits reflected in hardware feedback, and project persistence
with device identities absent from saved projects. Keep native dependencies
behind the existing package/provenance checks and preserve notices and GPU
build requirements on all maintained targets.

**Gate:** MCU and HUI claims list only tested profiles and packaged targets;
Web Core behavior is unchanged with surfaces disabled or unavailable. No
coverage, isolation, chunk, startup, or maintainability budget is weakened.
Agents run focused selections only and hand off absolute-worktree commands for
the full `npm run check` and, for interactive changes, `npm run test:browser`.

### CS06. EUCON feasibility and conditional adapter

Research may begin alongside CS01; product implementation waits for the shared
surface contract and a maintained MCU workflow. Obtain the actual EUCON SDK
terms and establish whether source publication, SDK integration, and binary
redistribution can comply with the application's AGPL-3.0-only license. Avid's
evaluation download or general commercial-license requirement does not itself
answer that question. Record SDK/runtime availability for each maintained
desktop OS/architecture, required EuControl installation, version constraints,
service discovery, network grants, containment, and test-device access. A helper
process is an isolation boundary, not a licensing exception.

**Feasibility gate:** retain a durable decision in `docs/decisions/` with exact
terms/version evidence, supported targets, distribution boundaries, required
third-party software, and unresolved limitations. If terms, platform support,
or test access remain unresolved, stop the EUCON implementation and retain MCU
and HUI as independently deliverable capabilities. Do not advertise generic
EUCON or five-target compatibility from an SDK sample or one working machine.

If feasibility passes, define a bounded adapter packet for the approved target
matrix. Reuse editor actions, snapshots, automation, local configuration, and
the opt-in setup surface; expose only the negotiated feature subset. Start with
the baseline workflow on an identified Avid surface or Avid Control setup.
Plug-in pages, custom layouts, and surround controls need separate acceptance
criteria before being enabled. Require integration, reconnect/version-mismatch,
network-loss, and packaged-target checks before adding any supported claim.

## Protocol references

Revalidate these sources and record exact revisions/terms when CS01 or CS06
starts. Product overviews establish context; they are not complete wire specs
or permission to redistribute SDK material.

- [Mackie MCU Pro/XT Pro owner's manual](https://mackie.com/img/file_resources/MCU_Pro-XT_Pro_OM.pdf): operating modes and hardware setup.
- [PreSonus controller modes](https://support.presonus.com/hc/en-us/articles/217070166-Faderport-Family-Native-Mode-HUI-Mode-MCU-Modes-and-MIDI-Mode): MCU, HUI, and generic MIDI distinctions.
- [Apple HUI setup](https://support.apple.com/en-mt/guide/logicpro-css/ctls73678434/mac): bidirectional MIDI pairing and emulation caveats.
- [Avid EUCON overview](https://www.avid.com/pro-tools/control-surfaces/what-is-eucon): Ethernet control, feedback, and surface capabilities.
- [EUCON application SDK](https://developer.avid.com/eucon/) and [Avid developer program](https://developer.avid.com/): SDK access and development licensing entry points.
- [EUCON compatibility](https://kb.avid.com/pkb/articles/en_US/Knowledge/EUCON-Compatibility): runtime and application compatibility evidence to recheck.
