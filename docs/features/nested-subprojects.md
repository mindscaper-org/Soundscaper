# Nested audio subprojects

Soundscaper's **File > Subprojects** dialog inserts another saved project from
its local library as audio on a new track. **Open subproject** edits that project
independently. Saving the child updates following placements when their parent
is active; reopening a parent reconciles saves made while it was closed.
Subprojects can themselves contain linked subprojects. Framescaper's nested
sequences remain a separate feature.

## Publication and timing

The child publishes its main mix with track and master processing, automation,
routing, mute/solo, and the ordinary effect-tail plan. The initial publication
starts at child time zero and establishes a fixed output range, sample rate,
and channel count. Subsequent refreshes preserve that geometry and every parent
clip's placement, source trim, fades, and effects. Shorter child output is padded
with silence; material beyond the published range remains outside the placement.
Insert another placement to publish a different range or channel layout.
The child keeps its own tempo map. Sample-rate conversion uses the existing
windowed-sinc implementation and endpoint rounding policies.
Reference video remains in the child; proxy publication reads its audio mix.
Independent clip pitch and stretch prepare immutable StaffPad cache sources
in a separate render scope, including when the parent's playback cache is cold.

Each proxy is an ordinary managed PCM source. Refresh creates a new immutable
source and swaps the link and its timeline/Project Bin placements in one history
transaction. It never overwrites the old body. Named session snapshots, track
playlists, undo, saved revisions, and portable archives retain the source
identities they reference. An undone automatic refresh stays undone within that
controller session until a different child output is available or the user
explicitly refreshes. **Pin current audio** persists the choice across reopen;
**Make independent audio** removes update authority and leaves ordinary audio.

The current background renderer requires active native plug-in racks to be
rendered and committed to audio first. It never starts a child's native plug-in
session using the parent's runtime authority. Ordinary offline rendering stays
within the existing output-memory admission; larger outputs use the bounded
continuous-clock PCM sink. Read sessions, staging, preflight, and exact-generation
cleanup use the existing media repository.

## Dependency and write authority

`metadata.subprojects` is a closed, validated optional list, limited to 64 links.
The link owns its child project ID, local library ID, output source ID, follow
mode, accepted child revision, recursive content digest, title, and output
geometry. The library identity is created atomically in the settings repository.
It is not a path or an archive-owned authority.

Only committed child documents enter rendering. Dependency admission rejects
cycles, including through pinned links, and bounds nesting to eight levels and
256 visited nodes. Recursive freshness includes descendant output digests, so a
grandchild save invalidates a saved ancestor without requiring an edit to that
ancestor. Pinned and foreign-library descendants consume installed audio.

The controller serializes refresh work. The active editor checks following links
on a nominal 1.5-second interval; browser background throttling and rendering add
latency. Project switching, read-only/busy admission, and an abort signal prevent
publication into a different editor session. Before installing output, the
controller rechecks the exact parent and rereads the saved child dependency
identity. Obsolete output is discarded by exact stored-source identity.
Audio export and portable project saving settle following links before taking
their normal export snapshots. A missing or failed following child refuses that
refresh; the last installed audio remains available. The user can explicitly
pin it to continue with that revision.

## Compatibility and portability

The `org.soundscaper.capability.subprojects` requirement owns update behavior
and has bypass disposition. The proxy remains canonical audio; it is not a
whole-project fallback that could suppress unrelated parent tracks. The optional
metadata extension leaves both family-v1 schema identities and Scape format 1
unchanged. The owning validator, command capability policy, feature requirement,
source-retention collector, and Scape remapper all recognize the relationship.

A portable `.sscape` carries the installed proxy and link provenance, including
link state in named session snapshots. It does not bundle the independently
editable child project. Transfer that project separately and use **Relink to
selected project** to reconnect a recipient-owned copy. A foreign library ID
never grants permission to open or automatically follow a coincidentally equal
project ID. Copying a parent within the same library intentionally keeps its
links to the shared child.

## Verification

The focused `audio-editor-subproject*` Node tests cover immutable refresh,
exact-state publication, cycles, grandchild invalidation, pinning, relinking,
source cleanup, history, snapshot media, and collision-safe Scape import. The
browser workflow in `tests/browser/audio-editor-subprojects.spec.js` exercises
the File menu, real rendering, saved-child updates, audio export, pin/detach,
and reopen. Full test gates remain owner/CI work under the testing guide.
