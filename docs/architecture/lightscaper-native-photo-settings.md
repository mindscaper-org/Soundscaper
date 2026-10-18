# Native Photo settings

Lightscaper has a main-private SQLite settings owner implementing the complete
eight-method `PhotoMediaSettingsRepositoryV1` port. It supplies actual durable
values, physical presence reads, conditional mutation and the fixed anchor's
atomic pointer/history publication. The application still selects the complete
Web Core Photo Session. This component does not activate a native library or
expose renderer paths, settings keys or new IPC.

The host supplies canonical appData. The independent database is fixed at
`Lightscaper/project-library/v1/native-photo-settings.sqlite3`, with `LSST`
application identity, schema 1 and the exact STRICT
`native_photo_settings(scope,key,payload)` table. Its secure opener applies the
same ownership preflight, canonical private directories, single-link regular
files, orphan-sidecar refusal, WAL/FULL commits and independently observable
retirement failures as the native resource owner. It does not initialize
Original, resource or catalog storage. POSIX directory syncing does not qualify
Windows power-loss durability or any packaged runtime.

Each connection binds one immutable scope: `anchor` or a bounded
`selected:<generation>` label supplied by the host. Identical logical keys in
different scopes occupy different physical rows. Scope labels do not prove
namespace allocation, selection or deletion ownership. The later native library
owner must bind selected settings to the actual authenticated generation; a
catalog ID alone cannot establish that identity after restore.

Keys retain every JavaScript UTF-16 code unit as big-endian BLOB bytes, including
empty keys, embedded NUL and lone surrogates. Values use an independently
versioned native clone codec rather than JSON. Capture invokes native
`structuredClone` before its first await. Binary backing relationships, cycles,
bigints, property order and present `undefined` survive within the supported
codec profile; Blob materialization finishes outside SQLite transactions.
Unsupported shared backing or host objects refuse explicitly. Domain owners
retain their own preset and journal limits; the database does not copy a small
resource-body ceiling onto settings.

`readEntry` returns a frozen physical-presence receipt with a detached value.
`get` returns `undefined` for both absent and present-undefined values. Every
read and put receipt is detached from stored and borrowed inputs.
`putIfAbsent` and the pair's intent guard inspect physical presence, preserving
even an occupied row whose codec bytes are unreadable. Unconditional `put` and
`delete` remain available without canonical-comparison admission.

Conditional mutations use the existing shared `canonicalKeyValueComparison`
on decoded values. They do not compare encoded bytes, sort object keys or store
a digest during unconditional writes. The existing insertion-order, omission,
binary-type, number and lone-surrogate rules remain authoritative. A cyclic or
bigint value can be stored even though a later CAS comparison may reject it.

Every mutation owns one synchronous IMMEDIATE transaction. The fixed-anchor
pair compares the current pointer and physical absence of its distinct history
key, then writes both rows before one COMMIT. Its trusted synchronous admission
callback receives `true` with the existing undefined receiver once before the
transaction and again only on the matched two-write path. Its return value is
not awaited. Selected scopes refuse this anchor capability. Primary SQL and
rollback failures remain independently observable; a transaction left active
after failed rollback refuses subsequent reads and mutations.

Admission registers its promise and queue position before getters, clone or
comparison reflection can reenter. Asynchronous encodings cannot reorder
accepted writes. A pair joins both captures even when one fails, retaining the
original opaque error. Close caches its fence, refuses new requests, drains
all accepted captures and SQL, then retires the connection. It does not abort
settings work. A genuine COMMIT acknowledgment survives close reentry without
a later cancellation check; operation failures remain owned by their promises.

Existing restore publication, restore journals, import presets, Current Develop
presets and export journals can consume the native port. Their reconciliation
policies stay in those owning domains. Complete startup binding must recover
the anchor restore journal before selecting media, then reconcile selected
import intent/custody before admitting Session work. Full native allocation,
managed Original custody, complete restore stages, native Session construction
and menu/IPC selection remain pending. This owner does not certify that work.
