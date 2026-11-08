# Native Photo RAW process service

The Main-only RAW owner supervises one fixed SRR1 process using the separate
`lightscaper-libraw-native/v1` engine. It accepts a trusted fixed-role start
capability and a bounded Main-owned source reader. The authenticated Photo
payload producer must supply the genuine OS-isolated zero-path decoder for
shipping. The process owner itself grants no arbitrary executable/path API or
sandbox claim; [the filesystem broker](lightscaper-native-photo-filesystem.md)
is a separate trusted role.

One global job is booked before reflecting a borrowed request. Main captures
the source receiver, exact length and SHA, streams at most one MiB per actual
backpressured input exchange, and independently checks the digest. The native
peer checks the length and SHA again before decoding. The fixed 16-byte framing
bounds control messages, consumes monotonic request IDs and authenticates a
nonce, engine version and compiled maintained target during initialization.

Native ingress is at most 64 MiB; the engine admits a phase up to 512 MiB and
an output up to 256 MiB. Native ingress and decoder scratch retire before the
result announcement permits Main to allocate its one output plane. Main checks
profile, format, geometry, finite Float32 samples, exact opaque alpha and output
SHA. These phase bounds are not an RSS guarantee. Both actual output pipes enter
flowing mode only after all bounded listeners have been installed.

Main joins the actual child, all three stdio streams and write callbacks before
vending decoded pixels to a consumer. It retains the private plane and global
job slot through the consumer, then wipes the plane. Cancellation fences new
work, terminates the peer and joins accepted source reads and entered consumers.
A kill request, deadline or protocol acknowledgment alone never retires a
resource. Cleanup uncertainty strongly retains the owner and global capacity.
Ordinary input failures with proven retirement allow a later job.

The engine returns oriented neutral linear RGBA16, the two fixed signed
Float32 profiles, declared nearest display previews, or genuine embedded
JPEG/bitmap bytes. Embedded extraction supplies no pixel interpretation. Native
previews have their own recipe identity and must not enter the permanent Web
preview cache key. Exact portable interchange retains the existing WASM engines
and digests.

## Complete Current forwarding

The stored-Original owner now composes the actual same-generation Catalog and
scoped Original reader. Before launch and around delivery it checks the full
stored Original, logical custody and the requested revision. The native callback
retains the genuine reader and deletion pin through the actual consumer. A
separate prepublication-input owner accepts only a genuine completed Main upload
or authenticated linked-input borrow, with full SHA and length. It does not
manufacture a stored Photo descriptor from a renderer File or scalar digest.

The installed Session gateway captures these genuine facets and issues bounded
RAW output tickets. Main authenticates the exact selected document before domain
capture; output transfers use one-MiB ranges, independent complete SHA checking
and a separate 256-MiB typed-output bound. A ticket retains the Main RAW plane,
source callback and global job until the renderer's actual consumer retires.
A known source/revision failure can return an explicit proved-retirement receipt;
unknown cleanup quarantines and retains dependent ownership instead.

Current import preparation, canonical Original Develop and both fixed derived
profiles use these ports. Derived frames acquire their owning computational
profile authority only after real native format, opacity, source and geometry
checks, while keeping distinct native decoder provenance. The preview scheduler
uses `lightscaper.native-original-preview.rgba8-nearest` with its own decoder and
cache identity; it shares the selected cache quota without reusing the permanent
Web preview key. Full Original and derived-frame requests never silently receive
a thumbnail. Embedded JPEG/bitmap extraction is not decoding: interpretation
uses the complete existing Web path where a native pixel route is unavailable.

Only explicit `native-unavailable` or `unsupported-representation` results before
consumer entry select the whole Web fallback. Actual corruption, cancellation,
stale Photo authority, entered-consumer failure or unproved cleanup does not
become fallback. Fallback uses the initially captured request and signal, after
actual native work has retired. Generic RAW import similarly retains a fully
staged upload until native input/output retirement; linked import uses its
separate genuine linked-input purpose. Exact portable interchange continues to
use the pinned WASM profiles deliberately.

The shared authenticated Photo payload producer supplies the shipping isolated
RAW start/retire capability and trusted read-only filesystem broker from one
all-target closure. Native helpers, enforcement profiles, source and licenses are
verified against the target result and protected application inventory. A missing
optional bundle leaves the complete Web product; a present invalid bundle
refuses. Source/build definitions do not establish all-target execution.

The 15 focused Linux cases use real native processes and actual FileHandles.
They cover independent pinned WASM numerical comparisons, previews, absent
embedded results, independent native SHA refusal, cross-owner capacity,
captured prototype readers, opaque failures, held reads/consumers and real
child crashes. The successful run under `TZ=Pacific/Auckland` completed in
1.944 seconds alongside four fixture-selection checks, peaked at 167,280,640
bytes and recorded no cgroup OOM event. Separate actual NativeScopes, Reader,
Main/client and complete Current tests exercise stored canonical/derived frames,
native preview caches, prepublication input and installed import through real
native children, including held consumers, stale authority and fallback capture.
These are focused Linux results, not an all-target or broad-camera certificate.

The internal desktop workflow defines independent native-linked and Web-only
packages for Linux x64/ARM64, macOS ARM64 and Windows x64/ARM64. Each platform
requires its actual packaged scenario to pass before it is qualified. Public
release remains deferred. No assistance runtime closure changed; a manual
**Update AI assets** run is not required. Native Photo artifacts must still be
rebuilt whenever their own source, recipe or delivered inventory changes.
