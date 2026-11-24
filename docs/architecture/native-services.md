# Native services

Soundscaper and Framescaper keep native code behind supervised desktop service
boundaries. Native services add device, plug-in, media, and display capabilities;
they do not replace the editor domain, reinterpret projects, or weaken the Web
Core fallback.

This page describes the durable contract. Historical S/F/V generation labels
are provenance, not current runtime authority. Current
projects are admitted by the family-v1 rules in
[`project-compatibility.md`](../policies/project-compatibility.md).

## Authorities

The implementation is split deliberately so no prose document can grant native
execution by itself:

- `desktop/helper-contract.ts` owns the versioned helper wire.
- `desktop/helper-registration.mjs` and `desktop/helper-supervisor.ts` own
  process creation, supervision, cancellation, and quarantine.
- `config/production-security-matrix.json` and the
  [threat model](../policies/security.md) own security claims and residual
  risks.
- `config/production-licensing-matrix.json` and the
  [licensing policy](../policies/licensing.md) own distribution gates.
- `config/native-payload-producers.json` is the inventory of target-native CI
  producers.
- The native-addon, Soundscaper professional-host, Framescaper media-host, and
  Framescaper OpenFX payload manifests own exact target payload status, length,
  architecture, and digest.
- Canonical editor plans, project validators, and storage services remain the
  semantic authorities. A helper receives a validated operation; it never owns
  a project revision.

A source recipe, provisioned source tree, passing test, licensing row, payload
manifest, and packaged binary are distinct facts. Runtime admission requires the
applicable facts to agree; none stands in for another.

## Shared process boundary

Electron main is the sole process authority. It selects executables, resolves
private paths, mints and revokes grants, and starts helpers with
`utilityProcess`. Preload and renderer code receive opaque identifiers and
bounded status, not raw paths or generic process, filesystem, native-module, or
network primitives.

Native adapters load only inside supervised helper processes. They do not load
into Electron main, preload, a renderer, or an `AudioWorklet`. A helper may use
threads internally, but a worker thread never substitutes for the crash and
authority boundary of a process.

All renderer-to-main entry points retain the desktop trust checks: expected
sender, main frame, allowed document URL, closed request shape, and bounded
opaque identifiers. File and directory access begins with a main-owned picker or
another explicit grant and is revalidated before use.

A helper process contains crashes; it is not proof that arbitrary native code
has lost all authority of the current operating-system account. Each target's
launcher records the restrictions it actually enforces. Missing containment is
a residual risk and must never be described as a sandbox.

## Helper protocol and lifecycle

The shared helper contract has these invariants:

- Messages are versioned, discriminated, direction-checked, and rejected before
  semantic work when malformed or oversized.
- Control envelopes are capped at 64 KiB. PCM, frames, media bodies, and opaque
  state use separately authenticated, bounded, backpressured data planes.
- Every job receives a kind-correlated capability grant. A renderer can never
  turn a grant into arbitrary spawn, path, child-process, or network authority.
- Main validates grants before spawning. The helper negotiates a supported
  subset and cannot enlarge the grant.
- Heartbeats, job generations, monotonic progress, cancellation acknowledgement,
  and engine quiescence are part of the protocol rather than UI conventions.
- CPU, process-tree memory, duration, file, scratch, child-process, and network
  limits are explicit admission inputs. Reservations may lower concurrency.
- Crashes, hangs, contract faults, resource violations, and cancellation
  timeouts close the current generation and may quarantine the exact payload or
  plug-in fingerprint. User cancellation and orderly shutdown are not faults.
- Late results from a cancelled, stale, or superseded generation cannot publish
  output or mutate project state.

Failure preserves the last committed project revision. Offline work may retry
from the same canonical plan when its recovery class permits it. Real-time work
never replays stale packets silently.

Effect plug-in discovery pages its descriptors within the 64 KiB control envelope.
Main follows candidate and bundle-descriptor cursors before publishing the complete
inventory, without a per-root plug-in count limit. Every page retains consent,
cancellation, identity admission, and the root's shared duration budget.

Every native feature is reached from an existing menu and begins disabled or
unavailable until its exact capability checks pass. Removing or revoking every
helper leaves a usable Web Core editor and a truthful capability report.

## Packaging and provenance

The desktop application uses a fuse-protected asar without incidental
`asarUnpack` or runtime dependency rebuilding. JavaScript helper entry points may
remain in the asar. Target-selected native binaries, addons, launchers, and
profiles are staged as digest-pinned resources outside it.

The supported producer matrix is:

- Windows x64;
- Windows ARM64;
- macOS ARM64;
- Linux x64; and
- Linux ARM64.

macOS x64 is not an empty or pending row; it is outside the matrix. A result for
one target grants nothing to a neighbouring target.

Target workflows provision pinned sources, build the payload and containment
launcher, run required self-tests, inspect dependencies and architecture, close
the file inventory, and record byte lengths and SHA-256 digests. Packaging may
stage only the matching result for the current source revision, target, and
build plan. A `ci-generated` manifest row with no payload remains unavailable
and must report that fact.

The optional native source cache is uncommitted build input. Provisioning verifies
each archive and extracted tree against the [acquisitions register](../../config/milestone-5-native-source-acquisitions.json).
The original `orbit-amp`, `orbit-core`, `orbit-guitar`, `orbit-appkit`, and
`orbit-eigen` archives are retained under
[`vendor/milestone-5-source-archives/`](../../vendor/milestone-5-source-archives/)
with their upstream licenses and notices so builds can use the pinned revisions
while the upstream archives are unavailable.

Licensing, corresponding-source, patent, trademark, and notice requirements are
distribution controls. They neither fabricate a payload nor replace runtime
checks. Conversely, a working payload does not clear a held distribution row.
Platform signing and notarization are package concerns described in
[`signing.md`](../operations/signing.md); they are not helper
protocol or project authority.

## Soundscaper audio and plug-ins

Native audio reuses the editor's recording routing, transport, effect graph,
automation, freeze, and per-path delay-compensation models. It does not create a
second device preference or render model.

The service reports explicit backend and mode identities:

- CoreAudio on macOS;
- WASAPI shared or exclusive, and separately admitted ASIO, on Windows; and
- PipeWire as the primary Linux backend, with ALSA as a backup and for direct
  hardware access.

A device candidate belongs to the backend that enumerated it. Fallback walks an
ordered caller-supplied candidate list and reports each refusal and the granted
candidate. An absent backend may advance the list; refusal of a requested format
or mode does not silently turn into a different request.
For ASIO, a rate outside the driver's advertised list is refused before
opening a stream can retune the configured clock.
Audio Setup saves a native sample rate after the selected routes open and
bind at that rate. If opening fails, it restores the previous Web Audio rate
and reopens the previously connected routes. A separately opened route can
recover even if another device has disconnected.
When starting with saved input and output devices, Audio Setup attempts their
separate routes independently. A working route stays bound through Refresh
while the failed route reports its own error and is retried. The selected
native playback route owns the output during startup, including when the first
attempt to open that route is refused.
If the native inventory temporarily omits a saved device, Audio Setup keeps its
selection and reports it unavailable. The other device can stay bound. Refresh
reconnects the saved device when it returns, and choosing System default allows
use of the current default device.
While an already selected native output is being replaced, playback keeps
its timeline position and uses silence until a native output is bound again.
A replacement refusal leaves the browser output muted until the user
selects Electron or a native route binds successfully.
An ordinary WASAPI take with one assigned input can temporarily bind that
track's exact microphone before capture. The take keeps the saved global
input choice and independent speakers. When the take finishes or admission
fails, the workspace restores the global input.

Real-time audio uses a directly transferred `MessagePort` between the helper and
the `AudioWorklet`. Electron's utility port copies PCM typed arrays through
structured clone. The fixed credit count bounds the packets in flight, and each
returned packet releases one credit. Generation, sequence, and absolute frame
identity fence every packet. Main participates in setup and revocation.

In WASAPI shared mode the driver sets the callback period. The native bridge
regroups frames between that period and the negotiated transport packet size
at the requested sample rate. Playback primes the ring before consuming the
first packet so the two block sizes can run on their own schedules.
Above 48 kHz the workspace scales WASAPI transport frames to keep at least
the same buffered time within its fixed eight-credit window.
The Windows build applies a source-pinned patch to its JUCE build copy so
shared callbacks use the endpoint period at the opened stream rate. Input-only
callbacks consume complete blocks already in JUCE's capture reservoir before
waiting for another device event.

ASIO and shared WASAPI output can recover from one missed callback. The device
renders silence for that period and discards the corresponding late samples
before rendering the next complete device period. The skipped interval follows
the device callback size even when the transport packets use another size. If
the next period also misses its deadline, the session reports device loss.

Input loss during recording commits only the already captured prefix through
the normal recording publication path. The capture worklet drains the complete
packets it already accepted and signals the valid frame count in its final
render quantum. The recorder flushes those frames before renderer-side teardown.
Removing a PipeWire input ends its capture session. Opening a new session can
select the new default source.
Output loss pauses playback and stops monitoring. Pressing Play again
keeps the browser output silent until a native route binds successfully or
the user selects Electron.

Plug-in discovery and execution are separate helper kinds and security controls.
Scanning grants no project audio and hosts no project instance. Scan roots are
main-owned grants. New installations automatically discover supported standard
folders when the editor opens; saved discovery settings and folder choices are
preserved. Consent remains per format.

Each professional candidate is inspected in its own supervised peer. A refused
or crashed candidate is reported as incompatible without discarding the folder's
other results or blocking later scans. Plugin Manager retains incompatible
observations without inventing channel layouts; they cannot receive hosting
grants. Completed scans link to Plugin Manager for review and explicit recovery.
Plug-in file identities retain the full unsigned 64-bit device and inode values:
safe values keep their numeric representation, while larger NTFS identifiers use
canonical decimal strings through authentication, registry storage and host grants.

Registry identity is the format plus its native stable identifier. An installed
binary additionally binds platform, architecture, version, and digest. An external new or
changed digest requires an explicit allow decision; path ordering never resolves
a stable-ID collision silently.

### Bundled JUCE effects

The professional host build also produces `soundscaper_juce_effects.clap`,
containing the processors in the shared
[`catalog.json`](../../src/common/editor/juce-effects/catalog.json): gain,
convolution and algorithmic reverbs, chorus, phaser, dynamics, delay, waveshaping,
panning, bias, and the JUCE filter families. The first-party library
is included in the authenticated runtime closure at `runtime/effects/`, with
the same architecture, dependency, digest, macOS execution-seal, and package
checks as the other native binaries. It uses the existing JUCE and CLAP source
pins and AGPL distribution path.
Linux continues to resolve shared system libraries from its authenticated
root-owned ELF closure. The bundled effect is admitted separately at its exact
peer-relative path and does not enter the loader's library search path or raise
the runtime-file ceiling.

**Effect → JUCE** lists all bundled effects and selects the requested effect in
Plugin Manager. Each menu insertion has fresh controls while existing authored
rack instances remain active. **Effect → Plugin Manager** also exposes them through CLAP discovery's
**Soundscaper JUCE effects** folder. Authenticated app-provided effects are discovered
and enabled by default through a private startup scan. Saved disables and quarantine
take precedence. External discovery still requires folder consent and installation
allowance. Process isolation, rack binding, state storage, playback, and native
rendering apply. Existing installations receive no new external folder grants.

The common processor prepares all buffers and convolution kernels outside the
audio callback. IR changes crossfade over 2048 samples, with retired engines
destroyed outside processing. Gain, wet mix, and pre-delay are smoothed; CLAP
parameter events retain their sample offsets. Impulse responses are mono or
stereo WAV/AIFF, limited to 8 MiB of decoded float PCM at 8–192 kHz, and are
embedded in versioned state. Restore prepares the complete IR before the first
rendered sample. IR amplitudes are preserved without automatic normalization.
The FIR low-pass uses 65 symmetric Hamming-windowed taps and reports 32 samples
of latency through the existing native rack compensation path. Other filters
update prepared coefficient storage without creating processors on the audio
thread. Four-channel true-stereo IRs and automatic native tail discovery beyond
the requested project/render interval are not supported by this adapter.

### Bundled guitar amp

Soundscaper desktop packages include OrbitAmp as a single VST3 effect alongside
the existing JUCE suite. The native build uses the exact, offline source
closure in the milestone 5 acquisitions register. Its working-copy patch
locates the factory data inside the VST3 bundle. Only the data named by the
OrbitAmp factory manifest is staged as plug-in resources. The existing bundle
fingerprint binds those resources to the target binary, and isolated launches
carry them with the plug-in snapshot. The build also primes OrbitAmp’s capture
slots on the control thread during prepare and state restore so a bounce can
start immediately. Soundscaper discovers OrbitAmp through
the authenticated startup scan and exposes it through **Effect → Audio Plugins**
and **Effect → Plugin Manager**.

### Installed plug-in identities

JUCE identifiers must not hash a binary's location: scans and hosts receive
separate immutable snapshot paths. VST2 uses the native 32-bit unique ID
(including shell member IDs); VST3 uses JUCE's normalized class-ID hash and
plug-in name; LADSPA reads the descriptor's native UniqueID rather than JUCE's
descriptor index. AU retains its native component tuple and LV2 its full URI.
CLAP already retains its native descriptor ID. Scan collision checks and instance
selection use the same identifier. Unnamed JUCE parameters expose their stable
parameter ID as their display name.

Opening activates the main input/output buses using their native channel
arrangements, even when a VST3 bus is not active by default. The open reply
reports the instance's actual channel counts rather than scan metadata, which
VST3 moduleinfo files can omit. Vendor editor probing, state save/restore and
parameter writes run on JUCE's message thread; PCM processing stays on the
processing thread.
The plug-in peer duplicates its reply stream before redirecting vendor standard
output to diagnostics, so plug-in logging cannot corrupt framed RPC replies.

VST2, VST3 and CLAP are cross-platform effect targets, Audio Units is macOS-only,
LADSPA and LV2 effects are Linux-only, and Vamp is an analyzer rather than an
effect. VST2/VST3 instruments and Linux LV2 instruments can be assigned to a
selected MIDI beta track from the piano roll's **Instrument** selector. Its
**Instrument settings** entry opens the instrument manager for parameter and preset
editing. Instruments are excluded from **Effect → Plugin Manager** and audio-track
targets. Instruments retain the same
consent, installation allowance, binary identity, containment and quarantine
checks as effects. Immutable MIDI source recipes are synthesized on demand through
separate bounded native sessions, preserving stereo/multichannel PCM and
compensating reported latency. Playback reuses a bounded PCM cache; a cold live
seek chases controller and sounding-key state, prepared on a worker, then starts
the isolated host at the requested origin. Export materializes a continuous
origin-zero render through the PCM reader; live seek caches stay separate.
Older projects' stored audio remains playable
without the instrument; uncached recipe windows require the exact installation.
Vendor controls and interfaces use the existing manager; **Apply instrument
settings** captures state and regenerates the track atomically. Identity and
base64 vendor state (at most 12 MiB before encoding) travel in the existing
opaque MIDI track carrier, including history and native project saves.

VST2 uses JUCE's legacy host with the authenticated FST 0.177.0
GPL-3.0-or-later compatibility headers, without the proprietary Steinberg SDK.
The build copy restores the fixed inline-array storage floors and reserved pin
properties tail that JUCE's legacy record allocation expects, and selects a
pointer-sized integer for the native Windows peers and the x86 bridge. The
pinned FST source remains unchanged.
VST2 uses the same automatic standard-folder discovery and plug-in preferences
as the other formats, including saved discovery settings and folder choices.
Candidates are `.vst` bundles on macOS, `.dll` files on Windows, and `.so`
files on Linux. Windows x64 additionally supports 32-bit x86 VST2 plug-ins
through the bundled x86 peer. Bridging defaults on, including after restoring
factory settings, so admitted VST2 folders scan both x86 and x64 plug-ins.
The existing **Edit > Preferences > Effects > Enable 32-bit VST2 plugins**
setting can disable bridging; saved opt-outs survive restarts and upgrades.
Windows ARM64, macOS and Linux retain their
matching-architecture requirements. CLAP remains native-architecture on every
target; VST3 additionally has the opt-in Linux x64 Wine route below. VST2 instances use
the same isolation, digest allowance, parameters, vendor windows, latency,
opaque state, real-time and offline routes as the other native effects. ARA
remains VST3-only. Native CTest fixtures exercise VST2 and VST3 discovery,
relocation between snapshots, processing, parameters, latency and state
restoration into a new instance, alongside native LADSPA ID checks.
The state fixture requires the host's processor-construction thread; the Linux
VST2 wrapper's private JUCE GUI thread is independent of that host dispatcher.

The Windows x64 package builds `runtime/soundscaper_vst2_x86_peer.exe` from the
same authenticated sources with a separate Win32 build and VST2 fixture. It is
a required, digest-pinned runtime artifact of the Windows x64 package, not an
additional desktop target. Build-result architecture admission permits PE32
only for this exact role; the other binaries retain their native architecture
requirements. The installed cross-architecture canary covers consent refusal,
scan/open, PCM, parameters, latency, state restoration into a fresh instance and
vendor-window open/close. The native launcher serializes CRT startup handles at
the child's pointer width and applies the existing Job supervision and limits.

Main grants bridge execution while the Windows x64 bridge setting is enabled. The peer router
checks the candidate's exact file identity, length, digest and PE architecture
before selecting the x86 peer. Scan metadata retains the candidate architecture,
including separate x86/x64 installations sharing one VST2 ID. Existing allowance
and explicit installation selection still apply; no state is transferred between
architectures automatically. Disabling the bridge cancels scans, revokes its
live hosts and blocks retained installations without discarding saved state.
Unresolved incompatible scan observations cannot claim a native stable ID;
a successful rescan replaces their digest-keyed placeholder.

Runtime hosting isolates one renderer owner and one plug-in digest per process.
Linux x64 can additionally host x64 Windows VST3 effects and instruments through
the bundled yabridge runtime. **Edit > Preferences > Effects > Windows plugins**
offers the separate opt-in and Wine detection, Browse, Rescan, and automatic
selection controls. Wine is external and is never installed or downloaded by
this feature. Automatic detection checks executable candidates from absolute
PATH entries and standard Wine locations, deduplicates canonical paths and
selects the newest supported numeric release. A manual selection remains pinned
until cleared. Probes use only `--version`, with bounded time and output; they
do not initialize a Wine prefix. Resetting preferences disables the bridge.
Users add their installed Windows VST3 directory through the existing folder
picker and review the scan in Plugin Manager.

Wine uses a separate prefix and registry. A plugin path on a mounted Windows
drive does not import that installation's shared kernels, runtime dependencies,
ProgramData or licence registration into Wine. Install the complete vendor
package into the intended Wine prefix. `WINEPREFIX` selects an explicit prefix;
otherwise yabridge detects an enclosing prefix or uses `~/.wine`.

Wine scan and host requests require an explicit main-owned VST3 grant. Native
Linux bundles keep the native route. Windows file and bundle digests, installation
selection, state and quarantine retain the original installation identity;
the generated merged bundle is temporary and never becomes the plug-in identity.
The helper rereads the current main-owned Wine configuration before each Windows
request and reauthenticates the runtime and Wine executable before spawning.
Changing Wine configuration revokes Windows hosts while native Linux hosts remain.

The separate Wine launcher supervises the plugin process tree with a subreaper,
samples aggregate RSS against the existing one-GiB ceiling, caps process count
and elapsed time, and kills detached plugin descendants on termination. The
prefix keeps its normal shared Wine server and builtin services. Exact executable
and mapped service-image identities exempt those shared services and their
children from per-plugin cleanup and accounting; process names grant no exemption.
The Wine runtime and vendor code retain the user's filesystem and network access;
this is process supervision, not a filesystem or network sandbox. The ordinary
Linux, macOS and Windows launchers retain their existing policies. Wine
compatibility, graphical editors, authorization and device timing require
observations for the actual vendor and Wine combination.

On Windows, effect discovery and hosting use trusted plug-in processes with
normal user filesystem, registry, environment and network access. This lets
installed plug-ins resolve sibling libraries, shared vendor runtimes, presets,
licences and services without vendor-specific support rules. The primary
candidate is reauthenticated and loaded from its installed location; its
dependencies retain the installation's normal trust model and are not covered
by that candidate's digest. File authentication is point-in-time and does not
freeze the installed files for the process lifetime.

The authenticated Windows launcher assigns the peer to a kill-on-close Job
before resuming it, with the existing memory, CPU, duration and single-process
limits. Its distinct supervision handshake and enforcement report explicitly
say that filesystem and network access are those of the user. This is process
supervision, not an AppContainer sandbox. Existing format consent, installation
allowance, quarantine, revocation and per-owner/digest process boundaries still
apply. Vamp analyzers, containment fixtures and the other target launchers retain
their separate sandbox policies. Neither vendor-specific allowlists nor a
global shared plug-in process are used.

Scanning receives the same one-GiB memory ceiling as hosting: library discovery
can initialize the full vendor engine before describing it. The helper hard
ceiling remains unchanged. Native x64 VST2 peers on Windows additionally keep bottom-up
allocation ASLR enabled but disable high-entropy allocation in that child.
This supports older statically linked runtimes that truncate heap pointers;
image ASLR and the full 64-bit address space remain available. VST3, CLAP,
Windows ARM64, the launcher and the main application keep their normal
allocation policy. The trusted process enforcement report names the selected
allocation policy explicitly; installed plug-ins and host executables are not
patched.

Opaque state is retained exactly and capped at 16 MiB per instance. State and
parameters survive missing, changed, crashed, revoked, or quarantined binaries;
the live graph uses truthful bypass or an already authored, verified freeze.
The host never manufactures a freeze after failure.

Reported latency is generation-scoped and feeds the canonical path-delay plan.
A change produces a new graph revision and swaps only at a safe block boundary.
Unbounded or unstable latency faults the instance rather than shifting the
project silently.

Vendor UI is a helper-owned top-level native window tied to one instance and
owner generation. It has no renderer bridge or general filesystem, network, or
child-process API. Closing the window does not remove the effect; losing the
owner or helper closes the window.

## Framescaper media and OpenFX

Native media consumes a closed canonical plan envelope with an authenticated
fingerprint. Unknown plan versions are refused; every accepted version needs an
explicit adapter, validator, canonical form, and parity evidence. Native
execution may accelerate the plan but may not add native-only timeline or render
semantics.

OpenFX Interact still has a helper-admission gap: the main service supplies
`dataPlaneTransfers: []`, while control-only admission accepts only `undefined`.
The isolated manager forwards the list unchanged, so the supervisor refuses
the request before native execution. Correct the dispatcher and exercise the
real supervisor path before treating the mocked-worker
[Interact integration test](../../tests/desktop-openfx-main-service-integration.test.ts)
as proof of native Interact operation.

Inputs owned by browser storage cross bounded streams. Main-revalidated linked
files may use helper-scoped handles. Raw frames, audio intermediates, and output
trees remain bounded and backpressured. Final files are written to a temporary
sibling in the authorized destination, verified, then renamed without replacing
an existing output. Failure, cancellation, stale authority, or supersession
publishes nothing.

Hardware capability is the intersection of the staged build, live probe,
self-test, codec and licensing rows, operation, project authority, capacity, and
user opt-in. A typed hardware failure may retry once on native CPU with the
identical plan and fingerprint. If native attempts fail, main reports that the
renderer-owned Web Core route is required; it does not forge a native receipt or
execute renderer work itself.

Professional source characteristics are exact-or-unreported. Required bit
depth, pixel format, color primaries, transfer, matrix, range, HDR metadata, or
alpha that cannot be preserved causes a typed refusal before work. A limited
RGBA8 image-sequence carrier must not be described as high-precision, HDR, or
alpha-preserving beyond what it actually carries. Proxies remain derivatives;
original media is authoritative for final export.

Persistent native jobs live in a main-owned database separate from project
storage. Rows contain bounded plan descriptions, fingerprints, opaque grants,
relative destinations, reservations, recovery class, state, and audit metadata;
they contain no raw paths or media bytes. A single-writer lease prevents a
second process from dispatching work.

The queue supports reorder, pause, resume, cancel, retry, and structured
progress. Recovery revalidates project revision, sources, plan, roots, payload,
scratch, and authorization before dispatch. Encoded outputs use atomic restart;
only image sequences with verified existing frames may use frame checkpoints.

Durable roots keep their paths private to main and require identity,
containment, and revocation checks at startup and use. Watch services treat
filesystem notifications as hints and bounded reconciliation as authoritative;
they do not follow directory symlinks or mutate a closed project. Scratch is
per-job, reservation-bound, and deleted only when its manager-owned manifest,
job, and root identities agree.

External display presents the same evaluated frame stream and transport clock
as the editor. It is a session-only, menu-opened sink, not a second renderer or
audio route. Display loss closes it; unsupported placement or HDR capability is
reported rather than guessed.

The sandboxed editor preload offers one control port and one pixel port per
evaluated frame. Main authorizes the owner and binds the transfer to the active
display window. The pixel port carries the private RGBA snapshot directly to
that window. The sink verifies the dimensions and SHA-256 before paint, and
main returns the acknowledgement only for the current session.

OpenFX discovery and hosting follow the same grant, consent, fingerprint, and
quarantine model as audio plug-ins, using a dedicated host rather than the media
helper. Generator, filter, transition, paint, retimer, and general contexts map
to existing project sources and resolved timeline outputs. General context does
not introduce an unrestricted node compositor.

CPU rendering is mandatory. Applicable GPU paths may fall back through the
same canonical CPU plan without mutating authored state. Interact V1, custom
parameter interacts, and DrawSuite V1 render through bounded frames and
normalized events in a menu-opened React surface; OpenFX plug-ins cannot create
renderer-native or arbitrary vendor windows.
