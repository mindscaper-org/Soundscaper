# Native managed Photo media

`LightscaperNativePhotoMediaCurrentV1` is a main-private component for managed
Original publication, asset metadata and catalog custody. The application still
selects its complete Web Core Session. This owner registers no renderer API or
menu entry and grants no linked-file or restored-library allocation authority.

Publication accepts the existing asset ID, genuine Blob and descriptive metadata.
Native Blob/File getters capture immutable body and filename facts before queue
waits; the lossless native settings codec detaches metadata, including nested
Blobs and cycles. Reserved physical paths, counts, digests and provenance tokens
cannot come from caller metadata. The native Original body profile retains its
196-MiB maximum; existing raster import limits remain with their owning importer.

An independent first pass hashes actual native Blob slices. A second bounded pass
feeds at most one MiB at a time to the real Original file owner, which verifies
the digest and length, flushes and closes its private stage and publishes its
immutable SHA body and physical binding. A one-use opaque proof ties that actual
publication to the live producer, exact database path and binding. Only an active
transaction in that database may consume it to install verified asset metadata.
No invented Photo dimensions or MIME descriptor are needed by the physical store.

`beginAssetWrite` now provides the complete five-member `MediaAssetWriter`
contract used by Photo restoration: `maximumChunkBytes`, `bytesWritten`, `write`,
`commit` and `abort`. Admission captures the expected size, lowercase digest and
detached metadata before asynchronous work. Each write owns one copied emission
of at most four MiB and supplies at most one MiB per native consumer pull. Its
acknowledgment follows actual consumption by the file writer. Concurrent writes
refuse while preserving the accepted write; commit joins that write before
ending the producer and awaiting real hash, file and binding publication.

Streaming uses the existing exclusive native stage directly, without an extra
body spool or a synthetic Blob. Its actual one-use physical proof and metadata
capture enter the same asset publication transaction used by Blob writes. Short
bodies, overruns and wrong digests publish no managed asset receipt. Successful
metadata commit returns a cached promise and receipt; later abort or Close
cannot revoke that acknowledgment. Optional owned-publication and video-claim
methods are separate contracts and are not advertised by this Photo writer.

`native-photo-originals.sqlite3` uses application identity LSCP and schema 2.
The exact historical schema-1 binding table remains unchanged; migration adds
empty asset and root tables with three bounded lookup indexes. Existing bindings
gain no inferred content tokens or catalog roots. Read-only admission precedes
writable SQLite recovery, permission changes, WAL adoption and body-directory
preparation. Primary and sidecar paths must be canonical single-link regular
files; orphan sidecars and linked product directories refuse.

Asset publication installs a fresh media generation token, detached metadata and
the existing 24-hour pending retention interval. Reads authenticate that metadata
against its physical binding. Metadata responses expose ordinary asset fields;
private content tokens, root counts and physical paths remain internal. Reusing
an already published asset ID refuses, including when its bytes match.

All seven custody methods operate on genuine verified media: retain, stage,
release, releaseStaged, promote, readPage and findDigestPage. Mutation batches
contain at most 16 references; pages contain at most 64 roots or digest matches.
UTF-16 big-endian root keys preserve JavaScript ordering, including unpaired
surrogates. Seek cursors can resume after the previous cursor row was deleted.
Staged and permanent roots retain the same generation token. Promotion inserts
the permanent root and retires the staged root in one transaction.

Roots, counts, asset metadata and physical binding rows share one database.
Logical deletion requires zero roots and atomically retires metadata and its
binding. It leaves immutable SHA files in place because another binding or reader
may still own those bytes. A later publication may reuse the retired asset ID
with a fresh generation. Point readbacks verify inserts, count changes and
deletions before COMMIT, including ignored or rewritten trigger effects. Failed
COMMIT and independent ROLLBACK failures remain visible together; an unsettled
transaction refuses subsequent public reads and writes until owner retirement.

The media lifetime registers accepted work before borrowed argument reflection.
Close fences new calls, cancels prepublication work and joins metadata captures,
native Blob reads, file writes, producer cleanup and queued SQL before retiring
both connections independently. A held native write is joined even after abort.
Actual metadata and custody COMMIT acknowledgments survive later cancellation
or reentrant close. Read publication still checks cancellation after native work.
Escaped stream writers retain their default caller signal after begin returns.
Their registry cancels idle producers before the ordinary media queue joins any
work waiting behind them. Retirement joins accepted writes and private commit
work before releasing signals or storage, including held native writes. It does
not wait on its own public cleanup-wrapped promise.

Focused Linux tests compose the unchanged Current importer and recovery owner
with real native catalog, media, selected settings and resource repositories.
They cover encoded raster, RAW and HDR body custody, exact reopen, whole Current
Photo documents and retained resources, dedup aliases, interrupted staging and
post-publication recovery. A genuine Node LockManager provides process-local
exclusive import ownership in these tests; cross-process selected-library lease
and packaged native Session qualification remain open. Body custody tests do not
claim container decoding or platform coverage beyond their actual Linux run.

The five-member streaming contract is qualified against actual native files and
SQLite, including four-MiB emissions split into native one-MiB writes, immutable
custody, reopen, cancellation and Close. The existing full restore candidate
still owns browser namespaces and catalog transactions; a working native stream
writer alone does not implement a complete native restore candidate.

Scoped Blob/File loading, authenticated library allocation, full restore,
renderer/IPC admission and menu-owned Session selection
remain required. No AI runtime source, archive closure or target inventory
changes; this component does not require a manual **Update AI assets** run.
