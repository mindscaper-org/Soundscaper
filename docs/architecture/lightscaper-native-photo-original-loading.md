# Native Photo Original loading

Native Original loading composes an authenticated main-process range reader,
a main-owned ticket transport and a renderer staging source that returns a genuine File. These
components do not activate a native Session. The application keeps its complete
Web Core storage until native restore, selection publication, IPC and consumer
integration are complete.

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

The manager supplies a persistent private shutdown signal, independent of the
completed component-open request. Parent close fences reads immediately and waits
for consumers and accepted I/O before closing catalog, media and selected
settings. It first quiesces escaped stream writers: an idle producer can occupy
the Original store queue ahead of an accepted read. Quiescence fences media
admission and cancels those producers while retaining physical owners and pins.
Resources retire afterward; the global writer guard releases last.

The main ticket server captures that reader and exposes the fixed `open`, `read`
and ID-only `close` transport. Random native IDs retain actual reader callbacks;
they grant no filesystem path authority. Four admission/read slots, 4094 live
tickets and 384 MiB of encoded-byte reservations are shared by the persistent
scope signal. Idle callbacks retain their pins and reservations without occupying
an admission slot. The server caches close before cancellation, joins physical
reads and callback retirement before releasing capacity, and keeps no retired-ID
tombstones. Unknown cleanup retains the entry and immediately quarantines the
owning scope. Parent close starts writer quiescence, ticket cancellation and reader
retirement in that order, then joins all three before closing dependent owners.

## Renderer ownership

The renderer source captures a closed transport with `open`, `read` and `close`.
Tickets contain a random 64-character lowercase hexadecimal ID and the complete
normalized Original. A closing request carries only the ID so a malformed issued
descriptor can still be retired. Local AbortSignals are never serialized.

Materialization pulls at most one MiB at a time into a private generated OPFS
stage. It joins each write, closes the writable, obtains a genuine native File
and hashes the persisted File in bounded slices before publication. It never
assembles the whole Original in renderer memory. Descriptive filenames do not
select staging paths.

The source admits at most four simultaneous acquisitions, 4094 live stages and
384 MiB of reserved encoded bytes. Capacity refusal starts no native open or
filesystem work. A published File and its native ticket remain leased until the
actual decoder, exporter or archive consumer retires. Owner close cancels
unpublished work and waits for published leases to close. Unknown cleanup retains
the stage owner and its reservation and fences further admission. A file whose
removal already succeeded need not remain when a separate ticket close fails.

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
durable Blob loader. Preview, export, archive and whole-collection migrations
still require their own retirement and cancellation qualification.

## Qualification

Focused Node tests use actual native files, SQLite and independent media owners
for main-process authority and lifetime checks. Renderer port tests use genuine
Files with instrumented storage and transport ports. Additional Chromium tests
connect actual native files, SQLite and the ticket server through a bounded
Playwright binding to real OPFS Files and production raster/LibRaw decoders. A
two-range PNG and an owned DNG retain the File, stage and native deletion pin
through a held frame consumer; retirement wipes pixels and removes the stage.
These component tests run in an isolated minimal document on the real Lightscaper
preview origin. They do not qualify packaged preload IPC, application activation,
a complete native Session, archive cancellation or the desktop target matrix.

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
