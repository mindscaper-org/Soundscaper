# Native Photo storage

Lightscaper's L8 native catalog adapter is in progress. Internal components
store managed Original bytes in main-owned files, their immutable physical
bindings in SQLite, and Current Photo catalog documents in a separate SQLite
database. The application still uses its complete Web Core catalog and media
stores. These components register no renderer API, menu action, selected native
catalog backend or add-in-place capability by themselves.

The host supplies one canonical appData directory. The fixed product scope is
`Lightscaper/project-library/v1/`; filenames supplied by a photo or renderer
never select a physical path. `native-photo-originals.sqlite3` admits only its
exact `LSCP` application identity, version 1 and single STRICT binding table.
An unowned nonempty database, adjacent version or altered schema is refused.

A physical binding contains only a storage key, SHA-256 and byte length.
Existing managed import can deduplicate identical bytes while preserving each
photo's source ID and exact filename. Those per-photo fields belong to the
catalog rather than the body index. Reusing a key for different bytes refuses;
metadata aliases over the same bytes remain valid. The shared twelve-field
Original validator still owns descriptor normalization. Native storage admits
managed retention and at most 196 MiB per body, covering the current stored HDR
profile. Container decoding, geometry and HDR provenance remain the import and
render owners' responsibility.

Uploads consume bounded, copied chunks with backpressure. The writer hashes and
checks the declared length, flushes and closes its exclusive private stage, then
publishes a complete SHA-sharded body using an exclusive hard link. It verifies
an existing winner instead of replacing it. Unsupported hard links refuse;
rename or copying into a visible partial destination is not a fallback. Only
then may the SQLite transaction publish the physical binding. A failed SQL
commit leaves a complete unreferenced body available for retry; removing it
could destroy bytes another binding already owns. Automatic orphan reclamation
is not implemented by this component.

Reads require a committed matching binding and authenticate actual regular
files. A bounded cache retains only file-identity snapshots, with nanosecond
timestamps and no retained read handles. Every range rechecks the opened and
path identities, and responses are capped at one MiB. Missing, changed or
symlinked bodies refuse without rewriting the Original or repairing authority
from an untrusted file.

Closing fences new admission and joins already admitted producers and file
operations. A rejected `next()` still joins the producer's `return()` and requires
a terminal result; a generator suspended inside its `finally` is unretired. Primary
and cleanup errors remain observable together. Unproved producer or file-handle
retirement fences the owner, retains its staging scope and makes close reject.
Controlled tests explicitly retire their injected callbacks and native handles
before removing their private diagnostics.

POSIX publication also syncs admitted directory entries, including retries,
and the containing body and index directories. Windows retains byte flushes
and SQLite FULL commits; this component does not flush directories there. Power-loss durability has not
been qualified. Current component qualification uses actual Linux files and
SQLite; it does not establish native Windows, ARM64 or macOS qualification.

`native-photo-catalogs.sqlite3` admits its own exact `LSCC` application identity,
version 3, STRICT tables, indexes and forward-membership triggers. One row atomically binds a validated
catalog root to its root revision, photo count and independently advancing
index revision. Whole Photo1/2/3 documents retain their declared versions;
bounded summaries and memberships belong to the same publication transaction.
Imports authenticate actual managed Original custody and the complete retained
LUT/brush closure before opening a SQL transaction. Edits authenticate resources
but do not reopen potentially unavailable Originals; the SQL transaction keeps
Original descriptors and extracted metadata immutable. Source-guarded derived
publication checks source revisions and exact Originals in its insertion
transaction. Catalog and Photo revision conflicts publish nothing.

Scalar pages read at most 64 summaries, never aggregate Photo documents. A
single SQLite read snapshot binds the root/index fence to its ordered page,
including when another WAL connection commits during the read. Continuations
bind catalog, filter scope and index revision. Smart definitions cannot be
created or changed until their native companion storage is implemented. This
schema does not implement collapsed stack queries or saved smart collections.

Ordinary Query2 search, metadata predicates and all four sort fields use the
existing shared query contracts and matcher. Each SQLite read snapshot binds
the root, index epoch, build readiness and at most 64 candidates; sparse matches
may produce empty pages with a continuation. Paging streams one complete
metadata projection at a time and returns bounded summaries, without loading
Photo/Develop aggregates. Filename index keys encode JavaScript UTF-16 code
units as big-endian BLOBs, preserving browser ordering for astral characters,
unpaired surrogates and lowercase expansion. Capture-time queries visit dated
Photos before the unknown bucket in both sort directions.

An exact historical version 1 schema migrates transactionally without reading
or rewriting Photo aggregates. Its catalogs start with an unready derived
index. Explicit rebuild steps process at most 16 Photos and 8 MiB of combined
canonical source and derived bytes, retaining a durable catalog-scoped cursor.
Actual source exhaustion authenticates the physical derived-row count before
readiness. Ordinary pages trust the count maintained by atomic writers; they
do not scan the full index on every request. Imports, edits and derived Photo
publication update query rows and counts in their existing transaction,
including while a rebuild is partial. New catalogs start ready and empty.
Rebuilds need no Original bodies, decoders or resource verification services.

Native stack storage preserves ordered membership, cover selection and one
stack per Photo. SQLite projects an independent forward relation from each
stack document; the mutation owner publishes reverse membership in the same
transaction. Loading a stack authenticates both relations and actual source
Photo identities, bounded by 1,024 members. Membership point lookups detect a
missing reverse row through the forward relation. Stack pages stream at most
64 documents into scalar summaries; selected member pages authenticate the
whole selected stack before reading at most 64 Photo summaries. Neither path
loads Photo aggregates or Original bodies.

Stack writes check the caller's catalog and stack-state revisions, then compare
and advance the captured catalog, index and stack-state epochs atomically.
Dissolving the last stack retains its state row and increasing revision.
Continuations bind all three epochs. Exact historical versions 1 and 2 migrate
to version 3 without rewriting their catalog, Photo or existing query rows;
only the new grouping state starts empty. These bounded checks authenticate
the selected closure rather than auditing every row of a catalog on each read.

The composing main-private owner captures request metadata before waiting,
serializes publication, joins verification and file work before close, and
independently retires both databases. Body reads first load the selected stored
Photo; a supplied descriptor or digest cannot grant body access. Actual Linux
filesystem/SQLite tests cover reopen, independent-owner conflicts, rollback,
scalar-only paging, cancellation, and reentrant close. They do not qualify a
packaged renderer adapter or another platform.

The remaining adapter must add collapsed stack queries, culling and saved-collection companions,
resource ownership, settings, journals and restore, then preserve all complete
session/publication/recovery ports through selected-catalog renderer admission.
Its media publication port must receive the whole validated Original; the
existing `(assetId, Blob)` port cannot infer one. Menu-owned library selection
must join authoring, previews and storage before switching. Native qualification must also supply a private
appData root explicitly: the existing Lightscaper smoke's `--user-data-dir`
isolates Chromium storage but does not select a private native library root.
Linked Originals remain refused until durable folder grants, watching, relink,
revocation and disconnected-volume behavior are implemented together.
