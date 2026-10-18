# Native Photo storage

Lightscaper's L8 native catalog adapter is in progress. Its first internal
component stores managed Original bytes in main-owned files and their immutable
physical bindings in SQLite. The application still uses its complete Web Core
catalog and media stores. This component registers no renderer API, menu action,
native catalog backend or add-in-place capability by itself.

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

The remaining adapter must persist Current catalog documents, indexes and
resources natively, preserve publication/recovery and custody transactions, and
authorize body access from the selected catalog. Its media publication port must
receive the whole validated Original; the existing `(assetId, Blob)` port cannot
infer one. Menu-owned library selection must join authoring, previews and
storage before switching. Native qualification must also supply a private
appData root explicitly: the existing Lightscaper smoke's `--user-data-dir`
isolates Chromium storage but does not select a private native library root.
Linked Originals remain refused until durable folder grants, watching, relink,
revocation and disconnected-volume behavior are implemented together.
