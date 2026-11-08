# Native retained Original repair

The main-private managed media owner implements the existing
`restoreCatalogOriginalBody(binding, selectedBlob, options)` port. The complete
[installed native Session](lightscaper-native-photo-session-protocol.md) now
exposes it through the existing retained-Original recovery workflow; Web Core
remains the default backend. No renderer filesystem capability is added.

Repair authenticates the exact selected permanent or import-scoped retained
root, its immutable asset token, SHA and byte length, and every same-asset root
in pages of 64. Conflicting present rows refuse. Descriptive metadata is never
decoded to grant authority. A genuine native Blob of the exact retained length
is hashed before any generation reservation, then independently hashed during
bounded file staging. Both passes use at most one MiB per emission. One accepted
repair per canonical library is booked before borrowed argument capture and
retained until actual capture, publication and retirement settle.

The installed repair path streams a selected genuine Blob/File into a Main-owned
upload file in at most one-MiB chunks. Full length, SHA, fsync and actual file
retirement produce a genuine one-use proof bound to the exact media namespace.
The source alternative borrows that completed file and reuses this same repair
kernel and independent OriginalStore hash; it neither aggregates the whole Blob
nor relies on `openAsBlob` garbage collection for close. Accepted upload reads
and consumers join before publication, while unproved cleanup retains the real
owner and selected guard. The existing Blob API and root/head/COMMIT contract
remain unchanged.

LSCP schema 3 preserves the exact schema-1 and schema-2 DDL. A missing digest head
explicitly selects the legacy `<sha>.body` file. An occupied head must resolve
its exact scalar locator; missing or corrupt locators never fall back to legacy.
Ordinary writes, verification, inspection, reads and restore audits resolve this
head. Ordinary physical publication proofs carry the captured head and recheck
it after file work and inside the consuming transaction.

A short transaction durably reserves a random generation locator before file
work. The file owner writes, hashes, flushes, closes and exclusively links the
fresh `<sha>.<locator>.body` file without replacing legacy or retired bodies.
A positively absent managed body directory may be recreated after authenticating
all parent and staging directories. Missing staging, symlinked directories,
permission errors and unsafe layouts refuse.

A genuine one-use proof binds the completed file to its live owner, actual
database, immutable binding, reserved candidate and previous head. The final
IMMEDIATE transaction rechecks the exact selected root, asset/binding presence
and identity, and head. It recounts current roots, allowing legitimate additional
owners. Existing metadata and timestamps stay in SQLite unchanged. Missing media
or binding rows can be reconstructed only from the authenticated retained roots;
the existing token survives. The head and reconstructed rows commit together.
The public receipt contains only asset ID, SHA and size.

A real COMMIT acknowledgment wins cancellation or close that arrives afterward.
A lost acknowledgment is reconciled against the exact candidate in a fresh
transaction. Uncertain or superseded files remain protected. An actual failed
ROLLBACK with an unsettled transaction retains the real database, Original owner,
proof, admission and deletion pin. Media close still attempts real owner close
and reports the latched retirement failure; the scope manager retains its writer
guard. An arbitrary caller error cannot manufacture this quarantine.

Single tickets and groups synchronously pin one resolved physical generation
for their whole lifetime. Each pull still reauthorizes logical custody. Repair
does not redirect these readers, and corrupt old bytes do not silently become
reads from the new file. New consumers select the new head. Physical close joins
actual file work before releasing logical pins. Inspection is a one-shot current
view and refuses a head changed during its file authentication. Restore inventory
hashes include active heads and all locator reservations, reject unarchived
digests, and retain the existing data-version fences.

Generation debt is deliberately bounded: at most nine generated locator rows
per SHA, including the active head and retired or unpublished candidates.
Failed reservations remain counted across reopen. Exhaustion refuses further
repair; this component provides no automatic reaper. No error path deletes an
old body based on elapsed time, process IDs or apparent inactivity. The native
scope manager supplies cross-process writer exclusion; standalone component
tests establish same-process ownership.

Qualification uses actual files, SQLite, native Blob receipts and joined
single/group readers on Linux. It establishes no Windows power-loss durability
or unexecuted desktop target coverage. No AI runtime closure or target inventory
changes; manual **Update AI assets** is not required.
