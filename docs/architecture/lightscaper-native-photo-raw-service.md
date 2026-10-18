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
and digests. Complete native import, Develop and preview forwarding and
whole-operation Web fallback after proven native cleanup remain implementation
work outside this process component.

The 15 focused Linux cases use real native processes and actual FileHandles.
They cover independent pinned WASM numerical comparisons, previews, absent
embedded results, independent native SHA refusal, cross-owner capacity,
captured prototype readers, opaque failures, held reads/consumers and real
child crashes. The successful run under `TZ=Pacific/Auckland` completed in
1.944 seconds alongside four fixture-selection checks, peaked at 167,280,640
bytes and recorded no cgroup OOM event. Other maintained targets require their
own target-native qualification. No assistance runtime closure changed; this
component requires no manual **Update AI assets** run.
