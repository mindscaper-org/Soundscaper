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
version 1, STRICT tables and indexes. One row atomically binds a validated
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
schema does not implement live queries, stacks or saved smart collections.

The composing main-private owner captures request metadata before waiting,
serializes publication, joins verification and file work before close, and
independently retires both databases. Body reads first load the selected stored
Photo; a supplied descriptor or digest cannot grant body access. Actual Linux
filesystem/SQLite tests cover reopen, independent-owner conflicts, rollback,
scalar-only paging, cancellation, and reentrant close. They do not qualify a
packaged renderer adapter or another platform.

The remaining adapter must add native query/stack/saved-collection companions,
resource ownership, settings, journals and restore, then preserve all complete
session/publication/recovery ports through selected-catalog renderer admission.
Its media publication port must receive the whole validated Original; the
existing `(assetId, Blob)` port cannot infer one. Menu-owned library selection
must join authoring, previews and storage before switching. Native qualification must also supply a private
appData root explicitly: the existing Lightscaper smoke's `--user-data-dir`
isolates Chromium storage but does not select a private native library root.
Linked Originals remain refused until durable folder grants, watching, relink,
revocation and disconnected-volume behavior are implemented together.
