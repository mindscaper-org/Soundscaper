# Native Photo storage

Lightscaper's L8 native catalog adapter is in progress. Internal components
store managed Original bytes in main-owned files, their immutable physical
bindings in SQLite, and Current Photo catalog documents in a separate SQLite
database. The application still uses its complete Web Core catalog and media
stores. These components register no renderer API, menu action, selected native
catalog backend or add-in-place capability by themselves.

A [separate native LUT and brush owner](lightscaper-native-photo-resources.md)
now persists authentic immutable `.cube` and `SCMASK01` bodies in its own
SQLite database. It provides both existing family capabilities, independent
render/verification/installation slots and complete Current resource closure
verification. It does not select a native Session or replace Web Core storage.

The host supplies one canonical appData directory. The fixed product scope is
`Lightscaper/project-library/v1/`; filenames supplied by a photo or renderer
never select a physical path. `native-photo-originals.sqlite3` admits only its
exact `LSCP` application identity and version 3 schema, with immutable physical
bindings, managed asset metadata, catalog Original roots and scalar body heads.
Exact historical versions 1 and 2 migrate without rewriting their rows, reading
bodies or inventing verified metadata.
An unowned nonempty database, unsupported version or altered schema is refused
through read-only preflight before writable recovery, chmod or WAL adoption.

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

[Exact retained-body repair](lightscaper-native-original-repair.md) publishes a
fresh immutable generation and switches its digest head after genuine file
authentication. An absent head explicitly selects the historical SHA path;
an occupied malformed or missing locator refuses. Whole-consumer leases retain
their selected physical generation across every pull, while new consumers use
the current head. Ordinary publication proofs also bind their actual head.

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
version 5, STRICT tables, indexes and forward-membership triggers. One row atomically binds a validated
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
bind catalog, filter scope and index revision. Legacy smart predicates remain
part of the root. Saved Query2 recipes have independent definition, scalar
summary and physical state tables. Native destination navigation uses these
same independent query and saved-definition owners.

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

The legacy Query1 ports retain their own rows, build state, matcher and public
page/cursor contracts. They do not translate requests to Query2. Exact versions
1, 2, 3 and 4 migrate to version 5 without reading or rewriting stored aggregates;
existing catalogs receive an unready Query1 build even if Query2 is ready.
Current rebuild steps report the combined source and Row1 bytes in the legacy
three-field receipt. All imports, edits and derived publications maintain both
profiles in the same transaction. A valid Photo exceeding Row1's 512-KiB limit
still publishes its complete Photo and Query2 row: only Query1 readiness and its
rebuild cursor retire, preserving any prior Row1 and physical row count. A
fitting edit followed by a genuine rebuild restores Query1 readiness. Other
projection or SQL failures roll back the whole publication. Ordinary outgoing
Query1 cursors must fit their existing 2-KiB contract before a page can escape.
Ordinary Query2 continuations use the same validated position grammar directly
under their own 4-KiB limit; a temporary Query1 envelope does not narrow that
contract. Saved and collapsed cursors keep their independent owning limits.

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
Continuations bind all three epochs. Exact historical versions 1 and 2 acquire
grouping storage without rewriting their catalog, Photo or existing query rows;
only the new grouping state starts empty. These bounded checks authenticate
the selected closure rather than auditing every row of a catalog on each read.

Collapsed Query1 and Query2 pages preserve the shared cover and fallback rules: an eligible
cover represents its stack; otherwise the first eligible member in global sort
order does. Each page shares one 64-unit budget across initial stack-key count
auditing, global candidates and metadata point probes. A representative's full
metadata membership closure can span signed pending pages, including a maximum
1,024-member stack. Empty pages with a continuation retain that bounded work.
All four sort fields, both directions, UTF-16 filename ordering and unknown-date
placement follow the ordinary query contracts without reading Photo aggregates.

Collapsed continuations bind query, catalog/index/stack epochs, audit position
and pending member progress to the actual issuing SQLite connection with HMAC.
Each query version has an independent signing domain. The owner captures
requests before queue waits and retires both signing authorities after
accepted work joins, before closing the connection. Keys never persist; a new
connection cannot resume a previous connection's cursor. Each page reads one
SQLite snapshot, and stale revisions refuse before missing-index readiness.

Saved collections retain the complete normalized Query2 recipe and authenticate
references even inside negative or inactive predicate branches. Canonical JSON
tuple keys keep catalog and collection identities separate. Summary names use
canonical JSON strings in SQLite TEXT, preserving legal unpaired UTF-16
surrogates. Scalar pages return at most 64 summaries under a 256-KiB budget;
they never read full recipes. Snapshot reads bind root, index, physical state
and the selected definition to one SQLite snapshot. Reading a virtual empty
state never creates a row; deleting the last definition retains its increasing
state revision.

Every saved write and queued root save first audits definitions, summaries and
both scoped indexes in bounded snapshots. A page admits at most ten full
definitions or 64 scalar keys under an eight-MiB retained-data budget, releases
its transaction, then yields. The final IMMEDIATE transaction consumes a
single-use connection, context and candidate bound proof. Root/index/state
and definition revision checks publish the paired rows atomically. Saved CRUD
does not depend on query readiness and leaves Photo, query and stack bytes
unchanged. Root edits also retain the existing Photo membership removal guard.

Saved ordinary and collapsed queries use the selected stored recipe. They bind
its definition and state revisions before checking index readiness, and use an
independent connection-bound HMAC domain for their bounded continuations. The
ordinary and collapsed native kernels preserve their shared query semantics
and work budgets without creating intermediate public signed tokens.

The native culling destination reader covers plain, Query1, Query2 and saved
queries, with ordinary and collapsed variants for each queried mode. Each
readonly phase authenticates the whole selected Current Photo and its summary,
plus the complete derived row for queried modes, in the same SQLite snapshot.
It then derives its private
inclusive sort position. Plain navigation needs no query or grouping readiness.
Collapsed navigation retains only scalar proof and bounded pending positions
between phases, sharing the existing 64-unit traversal budget through stack
audits and up to 1,024 members. Only the selected Photo aggregate is loaded;
Original bodies are unnecessary. Final cursors resume their corresponding
native reader, and only escaping collapsed or saved continuations are signed.
Closing aborts and joins every phase and its actual event-loop yield before
retiring the connection; it cannot erase a prior durable attribute edit.

An archive capture escapes the request queue while remaining owned until
verification, explicit iterator return or owner shutdown. Initial and final
bounded audits compare complete context and length-framed canonical recipe
digests. Demand reads release their SQLite snapshot before delivering each
definition. The source is one-shot and refuses overlapping operations. Shutdown
aborts and joins initialization, reads and final audits before closing SQLite;
successful terminal operations detach their signal listeners immediately.

A separate main-private saved restore component owns an exclusive fresh
candidate file and an opaque single-use permit. Existing active connections
cannot grant that authority. It appends at most 64 records and eight MiB per
transaction, preserves absent, empty and tombstone state exactly, then audits
the delivered count, references and digest before returning its receipt.
Closing joins stage work before removing only its owned directory. This is a
saved-data staging component; complete Photo/media restoration and active
library publication still require their own composition.

The composing main-private owner captures request metadata before waiting,
serializes publication, joins verification and file work before close, and
independently retires both databases. Body reads first load the selected stored
Photo; a supplied descriptor or digest cannot grant body access. Actual Linux
filesystem/SQLite tests cover reopen, independent-owner conflicts, rollback,
scalar-only paging, cancellation, and reentrant close. They do not qualify a
packaged renderer adapter or another platform.

The independent [native settings owner](lightscaper-native-photo-settings.md)
now provides all eight settings methods, detached native clone values, physical
presence and exact existing CAS semantics. The fixed anchor publishes pointer
and permanent history in one SQLite transaction; selected generation labels
remain distinct bindings without granting allocation authority. Accepted
captures and queued SQL drain before close, including failing paired captures,
and durable COMMIT acknowledgments survive reentry. Existing preset, journal
and restore publication owners can consume this genuine native port.

The [managed media owner](lightscaper-native-photo-media.md) now publishes real
Blob bodies and detached metadata, provides all seven catalog Original custody
methods and composes with Current import and startup recovery. Physical binding,
asset metadata and roots share one database for atomic logical retirement.
The existing `(assetId, Blob)` publication port supplies actual bytes and name/MIME
metadata; the physical body owner requires only a key, digest and byte length.
It never invents Photo dimensions or a full Original descriptor.

The managed owner also provides the complete five-member streamed Photo writer,
joining copied four-MiB emissions through actual bounded one-MiB native writes
and the same verified asset publication transaction. Escaped writers retire
before storage, including idle producers with ordinary requests queued behind
them. Existing full restore namespace/catalog composition remains separate.

The [native library scope owner](lightscaper-native-photo-library-scopes.md)
now provides durable allocation reservations, exact generation manifests and
opaque capabilities composing all four genuine component owners. An independent
SQLite writer transaction excludes other processes until children, registry and
anchor retire; unproved retirement retains the guard. Default storage remains
available, while each allocated generation has separate physical storage and
explicit selected settings. Creation progress grants no restore readiness or
selected-pointer publication authority.

The [Original loading components](lightscaper-native-photo-original-loading.md)
now bind native reads to the actual stored Photo, asset generation and custody,
and provide a separate bounded renderer File staging owner. Their integration
with real transport, decoding and existing consumers remains required.

The scope owner also completes main-private native restore, selected publication
and authenticated reopen. The remaining adapter must preserve all complete
Session/publication/recovery and Original/preview loading ports through selected-catalog
renderer and IPC admission. Menu-owned library selection
must join authoring, previews and storage before switching. Native qualification must also supply a private
appData root explicitly: the existing Lightscaper smoke's `--user-data-dir`
isolates Chromium storage but does not select a private native library root.
Linked Originals remain refused until durable folder grants, watching, relink,
revocation and disconnected-volume behavior are implemented together.
