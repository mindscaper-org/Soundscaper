# Soundscaper CV/gate implementation guide

This guide defines proposed contracts for sequencing CV-equipped hardware,
automating its controls, synchronizing it, and recording its audio in
Soundscaper. The [post-1.0 roadmap](../../roadmap.md#9-soundscaper-cvgate-hardware)
owns scope, status, and release sequencing. These are planned capabilities;
this guide enables no device access and allocates no project schema version.

## Scope and delivery order

Deliver MIDI output to a hardware MIDI-to-CV converter first. This establishes
the broader external-instrument workflow: select a device, send notes and
supported controllers, align the returning audio, and record a usable take.
It depends on the [post-1.0 MIDI service](../../roadmap.md#8b-midi), including
its event-model and compatibility review. Share that service with
[control surfaces](control-surfaces.md); MCU/HUI implementation is not a
prerequisite for instrument output.

Direct CV/gate output is a separate desktop extension after the MIDI workflow
works. Begin with one monophonic pitch/gate pair, then add bounded parameter
voltage automation and clock/reset outputs on the same routing contract.
Soundscaper is the clock leader in this baseline. Each direct output claims
only identified interface channels, voltage ranges, and tested backends.

| Path | Hardware responsibility | Soundscaper responsibility |
| --- | --- | --- |
| MIDI-to-CV | Converter maps received MIDI to voltages, gates, and supported clock signals. | Scheduled MIDI output, device/channel selection, controller mapping, transport cleanup, return recording, and measured alignment. |
| Direct CV/gate | A qualified interface converts output samples to physical voltages. | Dedicated output channels, calibrated voltage conversion, sample scheduling, gates/clocks, fault handling, and return recording. |

Sustained pitch and modulation CV generally require DC-coupled outputs;
ordinary audio outputs cannot be assumed suitable. Some trigger/clock signals
can work through AC-coupled outputs, but that needs its own hardware profile
and is outside the initial direct-output claim. DC-coupled outputs also do not
imply DC-coupled inputs. These distinctions follow
[Ableton's hardware integration guidance](https://help.ableton.com/hc/en-us/articles/360005621939-How-to-use-CV-enabled-hardware-with-Live).

Defer CV input/recording, external clock following, polyphonic voice allocation,
Hz/V pitch, S-trigger interfaces, vendor-specific ADAT/S/PDIF encoders, and
automatic oscillator tuning. A future plug-in adapter must satisfy the same
output isolation and lifecycle contracts; installed plug-ins alone do not
establish direct CV support. Browser MIDI-to-CV may follow the permission-aware
Web MIDI adapter; direct browser CV and Framescaper enablement are separate
feasibility work.

## Opt-in workflow

Proposed setup lives in **Edit > Preferences > Audio settings > External
hardware**, with MIDI device pairing and a separately enabled CV/gate section.
Proposed **Tracks > External hardware** commands configure the selected track's
logical route and record its return to an ordinary audio track. These are new
entries inside existing menus, not current commands. Reuse existing recording
preflight, monitoring, take publication, and device selection.

Start disabled and open no ports merely because a project references a route.
Setup owns physical output selection, local calibration, voltage limits, gate
levels, clock division/pulse width, return input, latency measurement, test
signals, connection diagnostics, and disable/reconnect actions. Require explicit
arming before test signals or calibration voltages are emitted. Calibration
uses a separate bounded test lease with declared voltage limits; musical output
can be armed only after calibration is valid. Opening a project or setup dialog
must not emit a pulse or enable an output.

Keep controls and unavailable-device explanations in invoked dialogs and
existing workflow surfaces. Add no always-visible toolbar button, panel, rail,
badge, or inline control. Make setup, cancellation, route assignment, and return
recording keyboard accessible, restore focus, and follow the
[localization workflow](localization.md).

## Architecture and ownership

Follow [architecture and maintainability](../architecture/overview.md),
[time and media](../architecture/time-and-media.md),
[production rendering](../architecture/production-rendering.md),
[native services](../architecture/native-services.md), and
[delivery and interchange](../architecture/delivery-and-interchange.md).

| Existing owner | Required integration |
| --- | --- |
| [`midi-project-event-projection.ts`](../../src/common/editor/midi-project-event-projection.ts) and [`midi-project-timing.ts`](../../src/common/editor/midi-project-timing.ts) | Resolve editable notes and channel messages through the owning MIDI contract, without a second sequencer. |
| [`parameter-address.ts`](../../src/common/editor/parameter-address.ts) and [`automation-lane-scheduler-v21.ts`](../../src/common/editor/engine/automation-lane-scheduler-v21.ts) | Stable hardware-control targets and existing authored automation timebases. |
| [`mixer-graph-v21.ts`](../../src/common/editor/mixer-graph-v21.ts) and [`project-path-pdc-plan-v21.ts`](../../src/common/editor/engine/project-path-pdc-plan-v21.ts) | Explicit signal roles, exclusive physical channel assignments, audio return paths, and graph-derived compensation. |
| [`soundscaper-native-audio-renderer.ts`](../../src/common/editor/soundscaper-native-audio-renderer.ts) and [`native-realtime-transport.ts`](../../src/common/editor/native-realtime-transport.ts) | Bounded, generation-fenced output with absolute frame identity and a dedicated CV route. |
| [`native-audio-session-service.ts`](../../desktop/native-audio-session-service.ts) and [`juce_audio_adapter.cpp`](../../native/soundscaper-professional-host/src/juce_audio_adapter.cpp) | Main-owned grants, supervised device sessions, physical channel admission, and callback-level idle/fault behavior. |
| Controller `preferences`, `track-audio`, `transport`, `recording`, `document`, and `export` domains | Local setup; track intent; schedule lifetime; captured takes; history/persistence; and export admission respectively. Composition wires narrow ports between them. |
| [`scape-project-document.ts`](../../src/common/editor/scape-project-document.ts) and the [compatibility contract](../policies/project-compatibility.md) | Reviewed portable intent, migration, unavailable-route behavior, recorded media, and opaque custody. |

The existing native audio request names device candidates, sample rate, period,
and channel count. Width alone proves neither exclusive physical CV routing nor
DC capability. Audit the worklet, helper, and backend mappings before extending
their contracts. Do not reinterpret existing audio-only packets as authorized
CV output or inherit ordinary audio fallback behavior.

Put new deterministic voltage, pitch, gate, clock, and route-validation modules
and their tests in focused strict TypeScript under `src/common/editor/`.
Proposed names such as `cv-output-profile.ts` and `cv-gate-schedule.ts` describe
future modules. Import owning modules directly; keep React/Electron out of the
domain and stateful coordination in existing controller domains. Register
ownership and dependencies in the existing module/controller policy when source
is added. Extend native C++ only at the device boundary. Preserve file-size,
startup, chunk, coverage, provenance, notices, and desktop GPU-build requirements.

## Signal and device contracts

Represent ordinary audio, pitch CV, parameter CV, gate, clock, and reset as
distinct signal roles. Neither a track name nor channel count establishes CV
intent. Compile these roles through the existing graph and a single physical
output assembly stage. Reserve each CV channel exclusively; reject collisions
with speaker channels, sends, auditions, or another hardware route. The first
supported configuration uses one native device clock for CV and return audio;
independent-device drift correction is deferred.

CV must bypass audio faders, pan, master gain, effects, DC removal, limiters,
normalization, dither, speaker downmixing, and implicit channel summation.
Track mute/solo and route disable resolve to explicit output policies, including
lowering the gate, rather than multiplying control voltages by audio gain.
Ordinary audio must never enter a reserved CV channel. Raw CV must never reach
speakers, headphones, generic meters/auditions, mix exports, or video audio.

A bounded, versioned local output profile must identify:

- Exact opaque device/backend identity, physical channel map, qualified format,
  sample rate/period, and relevant driver/firmware evidence. Missing or ambiguous
  identity requires rebinding; display-name similarity is insufficient.
- Supported signal roles, DC capability evidence, physical voltage interval,
  polarity, and sample-to-voltage calibration per output. Treat unknown
  capability as unavailable; enumeration is not voltage measurement.
- Pitch convention and reference note/voltage, gate-low/high levels, minimum
  pulse and retrigger-low widths, optional pitch-settle time, clock pulses per
  quarter note, reset timing, and per-role idle values.
- Measured latency and its configuration tuple, calibration provenance and
  validity conditions, and numerical acceptance limits for that profile.

Keep logical target values in semitones or volts, not device sample amplitudes.
For the baseline 1 V/octave mapping, compute
`V = referenceVoltage + (note - referenceNote + bendSemitones) / 12` before
applying the calibrated inverse voltage transfer. An ideal affine output with
`V = gain * sample + offset` needs `sample = (V - offset) / gain`; never assume
that sample `1` means one volt or that sample `0` means physical zero volts.

Reject nonfinite values, invalid gains, nonmonotone calibration, duplicate
channels, unsupported polarity, and authored ranges outside the qualified
interval before arming. Bound runtime output and fault the route on invalid
values instead of sending NaN or silently flattening an out-of-range melody.
Do not assume every interface reaches common gate thresholds or an entire
requested pitch range.

Separate DAC voltage calibration from oscillator tuning. Begin with an explicit
voltage-reference measurement procedure and user-specified pitch reference;
automatic pitch analysis is deferred. A plain cable loopback with unknown input
gain cannot establish absolute volts. Expert Sleepers' documented
[calibrator uses an external voltage reference](https://www.expert-sleepers.co.uk/vcvrack_encoders.html).
Bind calibration to the physical path and invalidate it on incompatible device,
channel, gain, or format changes. Only advertise a profile after measurements
meet its declared voltage and pitch tolerances.

## Timing, transport, and lifecycle

Resolve musical notes, automation, and clocks from existing rational beat and
sample authorities. Project onto the granted device sample clock once, using
named rounding rules and absolute origins. Recompute clock edges from absolute
beat positions across tempo changes; repeated rounded pulse intervals drift.
MIDI scheduling uses the shared MIDI service's timestamp contract; direct CV
uses bounded sample blocks. Neither uses UI timers for event timing.
Bound MIDI lookahead and cancel queued timestamped sends before transport
cleanup. Qualify cancellation or a bounded queue-drain policy per backend so
future queued note-ons cannot restart a stopped instrument.

Define these semantics before implementing the scheduler:

- Monophonic overlap priority, sustain and pitch-bend handling, legato versus
  retrigger, same-sample note-off/on ordering, and pitch-before-gate settling.
  Refuse unrepresentable overlapping notes unless the user selects an explicit
  reduction policy. MIDI-to-CV voice policy remains converter-specific.
- Start, pause, stop, seek, loop wrap, tempo edit, mute/solo, and track deletion.
  Begin a new generation for discontinuous schedules, lower active gates, and
  invalidate queued old events before establishing the new position. Define
  note chasing explicitly so seeking cannot create an accidental note onset.
- Clock pulse width and phase, reset ordering, and cancellation at transport
  boundaries. Validate that high and low durations fit the selected rate;
  minimum widths must never silently move the next musical edge.
- Output/return latency, MIDI converter response, and graph compensation.
  Record measurements by exact configuration and apply each correction once.
  Keep return-take alignment separate from live-monitoring delay; report when
  causal live input cannot be advanced to match pre-scheduled playback.

Use an explicit lifecycle such as disabled, configured, armed, running, and
faulted. Arming binds one owning writable project, route revision, configuration,
and session generation. Project switches, lock/read-only changes, disable,
disconnect, helper failure, or disposal revoke that authority. Reconnect starts
unarmed and discards pending notes, pulses, and stale calibration claims.

On controlled stop or revocation, send MIDI note/controller cleanup while the
port is available and drive direct gates/clocks/reset to their inactive levels.
Pitch and parameter outputs use the profile's bounded idle policy. For direct
CV, the native callback needs a preallocated per-channel idle frame and a bounded
output lease/watchdog, independent of renderer responsiveness. On queue starvation,
expired authority, or protocol failure, discard stale blocks and output idle at
the next available callback; never repeat a gate-high block. Resuming requires
re-arming. The current audio-zero underrun policy alone is insufficient.

Discard queued direct-output blocks and acknowledge inactive output before a
controlled disarm completes; prevent late packets from restarting it. Device
removal or process/driver failure can prevent any final output write: report
the lost connection, require explicit recovery, and do not promise physical gate
reset on unavailable hardware. Never fall back CV to another backend, default
device, browser destination, or first channel pair. Qualify driver/device
behavior on close and failure separately.

## Recording, persistence, and delivery

Keep logical track routing, note/control intent, voltage/pitch conventions, and
authored automation in the reviewed portable model. Keep physical port handles,
channel bindings, measured calibration, latency tuples, and armed state local.
A logical route name may travel; opening it elsewhere must require local
binding and explicit arming. Undo/redo or project reopen must never restore
armed authority or emit test signals.

Any new persisted route or signal role retains the MIDI compatibility review
and the frozen owning-family-v1 migration contract. Decide schema, validation,
history, cloning, Scape preservation, and missing-feature behavior together
before allocating a version. Foreign/future project custody cannot enable
hardware. Shared code does not grant Framescaper device access; cross-product
conversion must materialize recorded audio or report/refuse unsupported intent.

Return audio uses the normal recording path, with granted input channels,
recording preflight, monitored-feedback checks, compensated placement, undo,
recovery, and take publication. On input loss retain only captured material;
never invent silence. Define return-channel ownership so a take is not mixed
twice through both a live return and its recorded replacement. Associate a take
with the source/route revision it captures without persisting device authority.

Baseline capture is an explicit recording action. Offline export, previews,
background queues, and reopen must not drive hardware. Export uses an explicitly
selected recorded return; an audible external route without one fails preflight
unless the user chooses a supported, reported omission. Preserve source notes
alongside the take. Do not substitute the beta's built-in synth or label an
unrecorded route as rendered audio.

Automatic hardware freeze/bounce is a later extension: it must capture in real
time, honor existing graph/PDC and freeze capture boundaries, bind freshness to
the complete source/control intent, avoid double effects, and publish atomically.
A stale take remains an ordinary recording but cannot silently satisfy a fresh
hardware render request. MIDI export can preserve representable notes/controllers;
it cannot claim physical voltages or calibration. Audacity/audio-only and other
interchange reports must name conversions and omissions under their existing
contracts.

## Implementation packets and acceptance

Begin each behavior packet with focused failing tests. Keep deterministic DSP
and lifecycle cases in Node, invoked workflow checks in focused browser specs,
and physical voltage/timing claims in real-device qualification.

| Packet | Dependencies | Deliverable and acceptance gate |
| --- | --- | --- |
| CV01. Contracts and evidence | Post-1.0 MIDI compatibility review | Define logical routes, event/voice semantics, typed device/output profiles, authority states, and persistence dispositions. Select reference converter/interface and pin vendor evidence. Independent fixtures reject invalid maps, ranges, calibration, and stale authority before any device can open. |
| CV02. MIDI external instrument | CV01 and native MIDI output service | Opt-in MIDI-to-CV route, scheduled notes/controllers, transport cleanup, audio return monitoring and recording. A real converter completes edit/play/loop/stop/record/save/reopen; disconnected ports never receive replayed events. This slice ships independently of direct CV. |
| CV03. Dedicated native CV route | CV02 and qualified direct-output hardware | Extend explicit physical channel grants, graph signal roles, worklet/helper packets, exclusive channel assembly, idle callback, and watchdog. DC reference vectors survive end to end; speaker/master/audition/export routes contain no CV, and queue loss never repeats a high gate. Permit only bounded test leases until calibration allows musical arming. |
| CV04. Calibrated pitch/gate | CV03 | One monophonic 1 V/octave pitch/gate pair with bounded test signals, calibration, range admission, and explicit overlap/retrigger policy. Independent note/bend/voltage vectors and measured output/pitch tolerances pass across block, seek, loop, and restart boundaries. |
| CV05. Parameter and clock outputs | CV04 | Existing automation targets drive bounded voltage controls; sample-scheduled clock/reset honors rational tempo, pulse width, phase, and stop policy. Long and changing-tempo fixtures show no cumulative edge drift; a real device verifies voltage limits and transport behavior. |
| CV06. Capture and portability | CV02 for MIDI; CV04/CV05 for each direct role | Verify compensated return recording, captured-prefix recovery, undo/redo, Scape round trip, migration, missing bindings, take selection, and export refusal/reporting. Reopen and offline rendering emit no hardware events. Keep this gate in each shipping slice rather than postponing persistence until direct CV exists. |
| CV07. Packaged qualification | Each shipping slice and CV06 | Complete accessible/localized menu workflows, measured stress/failure cases, exact native payload tests, and handbook setup/limitations for each claimed device/backend/target tuple. Automated simulation and physical observations remain distinguishable. |

Required focused regression coverage includes:

- Independent voltage and event vectors, same-frame edge ordering, all supported
  rounding/rate combinations, long tempo ramps, loop boundaries, late packets,
  calibration invalidation, and finite/range enforcement.
- Stop while gate-high, renderer stall, helper timeout, underrun, invalid packet,
  disconnect, project switch, read-only/lock loss, route deletion, and reconnect.
  Assert output idles, queued generations expire, and re-arming is explicit.
- Physical-channel conflicts with ordinary audio and other CV routes, master
  gain/effect/mute changes, input/output feedback, and no implicit fallback.
- Recording interruption, take freshness, save/reopen with device IDs absent,
  cross-product disposition, missing hardware, and export with/without a take.
- Menu reachability, disabled-by-default setup, permission denial, keyboard/focus,
  translated copy, and complete file-based editing with hardware unavailable.

Before advertising support, record numerical voltage error, pitch error, pulse
width, jitter, round-trip alignment, queue/watchdog, and long-session memory
limits for the exact profile. Internal sample-exact scheduling is not a claim
of zero physical latency or jitter. Test the maintained desktop matrix of macOS
arm64/x64, Windows x64, and Linux x64/arm64 against available qualified hardware;
an unavailable tuple remains unclaimed rather than inferred from one machine.
Publish reusable measurements and supported setup in the handbook; keep one-off
development/test ledgers in ignored `private/`.

Follow the [testing guide](testing.md): run changed-file lint, strict types,
focused Node/browser checks, applicable architecture/native audits, and product
builds within 12 GB RAM. Agents never execute full suites and hand off exact
absolute-worktree commands for `npm run check` and, when interactions change,
`npm run test:browser`. No packet may weaken existing budgets or substitute
fixture-only payload evidence for a supported hardware configuration.

## Reference boundaries

Revalidate vendor specifications and pin relevant manual/firmware revisions
when selecting hardware in CV01. Product documentation is design evidence, not
permission to redistribute a vendor SDK or claim an untested interface.

- [Ableton CV hardware integration](https://help.ableton.com/hc/en-us/articles/360005621939-How-to-use-CV-enabled-hardware-with-Live) distinguishes DC input/output capability, MIDI converters, routing, and trigger exceptions. Soundscaper's dedicated-output policy is a proposed implementation contract.
- [Expert Sleepers calibration](https://www.expert-sleepers.co.uk/vcvrack_encoders.html) documents voltage-reference calibration. Copying its implementation is not required.
- [Expert Sleepers Silent Way Voice Controller](https://www.expert-sleepers.co.uk/silentway.html) demonstrates audio-return-based oscillator tuning, a separate future capability from baseline DAC calibration.
