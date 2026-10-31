# Native Photo Original loading

Native Original loading composes an authenticated main-process range reader,
a main-owned ticket transport and a renderer staging source that returns a
genuine File. The [installed native Session](lightscaper-native-photo-session-protocol.md)
now composes this source with the complete Current consumers and its matched
restore runtime. Web Core remains the default with a separate library. Native
restore and selected publication use the same
[scope owner](lightscaper-native-photo-library-scopes.md).

## Main-process ownership

Each physical library composes an Original reader from its actual catalog,
managed media and selected settings owners. It captures their methods before
vending the components. A request names the catalog, Photo and complete immutable
Original; caller-provided paths and digest-only authority are insufficient.

The reader checks the stored Photo, the committed asset's scalar generation and
binding, and genuine Original custody. Permanent custody is valid directly.
Staged custody additionally requires the matching actual selected-settings
import intent. Promotion to permanent custody and attribute edits preserve an
otherwise unchanged Original. Generic asset metadata is not decoded to authorize
range reads. The fixed selected-settings intent reader bounds the encoded
payload to 4096 bytes in SQL before decoding it, then applies the owning intent
grammar. Oversized or corrupt occupied values refuse; they do not become absence.

Deletion pins are shared across same-process media owners of the canonical
database. Deleting a pinned asset refuses immediately. The consumer holds its pin
through the callback and every accepted physical read, including cancellation
and failure. Range publication rechecks authority. Escaped views close when their
callback retires; no catalog or media queue is held across the whole callback.
Each consumer also synchronously pins its resolved physical body generation.
An exact repair can publish a new head without redirecting an admitted ticket
or group between pulls. Physical close joins accepted I/O before the logical
deletion pin retires. One-shot inspection instead rejects a head changed during
its actual file authentication.

The manager supplies a persistent private shutdown signal, independent of the
completed component-open request. Parent close fences reads immediately and waits
for consumers and accepted I/O before closing catalog, media and selected
settings. It first quiesces escaped stream writers and joins their real work.
Physical lease pulls use an independent bounded lane. Quiescence fences media
admission and cancels those producers while retaining physical owners and pins.
Resources retire afterward; the global writer guard releases last.

The main ticket server captures that reader and exposes the fixed `open`, `read`,
ID-only `close`, `openGroup`, indexed `readGroup` and ID-only `closeGroup`
transport. Random native IDs retain actual reader callbacks;
they grant no filesystem path authority. Four admission/read slots, 4094 live
tickets and 384 MiB of encoded-byte reservations are shared by the persistent
scope signal. Idle callbacks retain their pins and reservations without occupying
an admission slot. The server caches close before cancellation, joins physical
reads and callback retirement before releasing capacity, and keeps no retired-ID
tombstones. Unknown cleanup retains the entry and immediately quarantines the
owning scope. Parent close starts writer quiescence, ticket cancellation and reader
retirement in that order, then joins all three before closing dependent owners.

A group admits the complete ordered vector of catalog, Photo and immutable
Original bindings. It reserves every authority before the first per-Photo lookup;
compatible digest aliases share encoded-byte accounting while retaining separate
authentication and generation pins. Logical limits are shared with single-file
tickets, and physical capacity is shared across canonical-database media owners.
All reserved slots remain occupied until every alias callback and accepted pull
retires. Never-activated bookings retire on owner close; failed cleanup rejects
close and quarantines the full booking. Empty wire groups retain no entry.

## Renderer ownership

The renderer source captures a closed transport with `open`, `read` and `close`,
plus the optional complete group triple.
Tickets contain a random 64-character lowercase hexadecimal ID and the complete
normalized Original. A closing request carries only the ID so a malformed issued
descriptor can still be retired. Local AbortSignals are never serialized.

Materialization pulls at most one MiB at a time into a private generated OPFS
stage. It joins each write, closes the writable, obtains a genuine native File
and hashes the persisted File in bounded slices before publication. It never
assembles the whole Original in renderer memory. Descriptive filenames do not
select staging paths.

The source admits at most four simultaneous acquisitions, 4094 live authorities and
384 MiB of reserved encoded bytes. Capacity refusal starts no native open or
filesystem work. A published File and its native ticket remain leased until the
actual decoder, exporter or archive consumer retires. Owner close cancels
unpublished work and waits for published leases to close. Unknown cleanup retains
the stage owner and its reservation and fences further admission. A file whose
removal already succeeded need not remain when a separate ticket close fails.

Group staging creates one OPFS File per compatible digest and independently
streams and hashes every Photo alias, including aliases with different native
locators. It publishes the aligned File vector only after all members pass.
Groups share acquisition, authority and unique-byte limits with single-file
leases; no sequence of partial admissions substitutes for a group.

The product-owned Original source helper validates a genuine Blob/File and its
exact size, detaches request identity, and joins the consumer before cached
cleanup. Existing Web Core loaders retain their durable Blob fallback. Consumer
migrations must preserve archive yields, encoder lookahead and whole collection
groups; the helper alone does not establish those barriers.

The named Develop owners now accept a scoped source independently of the backup
capability. Canonical Photo1, Photo1/2 and Current readers, plus both Current RAW
derived profiles, hold the lease through decoder retirement, the actual consumer
and the final revision check. Session construction captures the source receiver
before initialization can yield. Existing Web Core callers retain their genuine
durable Blob loader.

Preview cache misses retain the selected source through actual decoding, frame
retirement, cache publication, pressure retry and the final Original binding
check. Cache hits do not acquire an Original. Camera culling and HDR keep their
separate recipes. Journal verification and single-image handoff retain the lease
through byte authentication, resource child retirement and the final whole Photo
check; settings-only journal access does not require an Original source. The HDR
Session child forwards the same captured source to canonical sampling.

Backup sources capture the source receiver before metadata awaits and acquire
each lease lazily when its Photo is demanded. The lease spans the generator's
yield. Both archive writer families separately own accepted encoder pulls: ZIP
cancellation or destination failure first joins the actual pending read, then
retires the encoder and only afterward returns the Photo sequence. Returning the
sequence immediately after a ZIP rejection could otherwise delete a leased File
while its accepted read was still running. All three Session profiles forward a
scoped source without requiring a legacy backup loader.

Whole-collection handoff captures group capability before metadata awaits and
refuses a scoped per-file-only source before collection reads. It retains the
complete group through escaped Original, LUT and brush consumers, final root,
query, membership and Photo checks, and joined resource retirement. Distinct
aligned bodies are each hashed before digest reuse. Durable Web Core loaders
provide an explicit group fallback. The installed complete Current factory
forwards this group source through authenticated preload IPC; its local retirement
barrier keeps published groups pinned before physical native shutdown.

## Qualification

Focused Node tests use actual native files, SQLite and independent media owners
for main-process authority and lifetime checks. Renderer port tests use genuine
Files with instrumented storage and transport ports. Additional Chromium tests
connect actual native files, SQLite and the ticket server through a bounded
Playwright binding to real OPFS Files and production raster/LibRaw decoders. A
two-range PNG and an owned DNG retain the File, stage and native deletion pin
through a held frame consumer; retirement wipes pixels and removes the stage.
These component tests run in an isolated minimal document on the real Lightscaper
preview origin. These component cases do not by themselves qualify packaged
preload IPC or the desktop target matrix. Complete Session, installed transport,
actual process-loss and Linux packaged results are separately recorded in the
[Session transport document](lightscaper-native-photo-session-protocol.md).

The Chromium group check authenticates two actual native locators, shares one
real OPFS File, holds both deletion pins through two raster consumers and verifies
joined retirement. Native collection tests cover six Photo authorities, ordered
manual, smart and saved collections, missing later aliases, escaped resource
consumers, cancellation and a real LibRaw editable collection export. Renderer
port tests separately cover malformed receipts and shared capacity. Shutdown
regressions distinguish unused bookings from accepted first-Photo lookups and
verify that failed cleanup rejects instead of leaving close pending forever.

Focused consumer tests additionally exercise real native files, SQLite, ticket
pins and genuine Files through backup roundtrips, RAW decoding and PNG16 handoff.
Held reads, acquisition, decoder and resource retirement, cache publication and
final Photo checks verify that the source stays leased. Archive cancellation
tests cover both writer families, destination failure and distinct opaque primary
and cleanup failures. The held-stream opaque case uses a Symbol: Node's Web
Streams abort implementation inspects a Proxy reason before this writer receives
it, so this case does not qualify hostile Proxy cancellation inside that engine
boundary. Pre-output opaque-reason tests retain their existing coverage.

Verification runs only Lightscaper runtime tests, serially, in a Linux process
group with a one-GiB kernel memory limit and no swap. The limit includes children;
the Node heap limit alone would not constrain large external byte allocations.
Type-aware static gates run separately with their own bounded memory allowance.
Failure diagnostics compare binary hashes and lengths instead of formatting
large buffer differences. Cleanup follows actual process and reader retirement.
New fixture deadline handlers cancel their actual lifetime and release owned
consumer, decoder and native-read gates, allowing cleanup to join. A reported
test deadline alone is not evidence of retirement. Browser checks use one worker
and bounded CPU affinity; their process allowance includes Chromium threads.

No AI runtime bytes or target inventories change. A manual **Update AI assets**
run is not required.
