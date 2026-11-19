# Native Photo settings

Lightscaper has a main-private SQLite settings owner implementing the complete
eight-method `PhotoMediaSettingsRepositoryV1` port. It supplies actual durable
values, physical presence reads, conditional mutation and the fixed anchor's
atomic pointer/history publication. The [complete installed native
Session](lightscaper-native-photo-session-protocol.md) now consumes it through
selected-generation facades and fixed settings domains. Web Core remains the
default. The SQLite owner stays Main-private; no renderer path or arbitrary
settings scope selects a database.

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
namespace allocation, selection or deletion ownership. The
[native library owner](lightscaper-native-photo-library-scopes.md) binds selected
settings to the actual authenticated generation; a catalog ID alone cannot
establish that identity after restore.

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

Restore publication and journals, import presets, Current Develop presets and
export journals now consume the native port in the complete Current composition.
Their reconciliation policies stay in those owning domains. Scopes recovers the
anchor restore journal before selected opening; the selected Session reconciles
import intent and custody before admitting work. A fixed SQL-bounded import-intent
reader refuses corrupt occupied rows before generic decoding. The selected
Session's four-method import-preset facet binds the fixed anchor and catalog,
while its ordinary settings facade retains the five selected domain keys and
raw comparison semantics. Renderer-supplied admission callbacks cannot cross IPC;
Main's actual anchor publication retains its private atomic admission barrier.

Allocation, complete restore, selected reopen and File-menu backend selection
are implemented by the scope, Session and installed transport owners. The
settings component's focused tests do not by themselves qualify that complete
application or another desktop target; the
[transport evidence](lightscaper-native-photo-session-protocol.md) records those
separate boundaries.
