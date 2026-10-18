# Native Photo LUT and brush resources

Lightscaper has a main-private resource owner for immutable `.cube` LUT and
`SCMASK01` brush bodies. It provides the existing Photo LUT and mask-raster
capabilities to native storage callers. The application still selects its
complete Web Core Photo Session; this component adds no renderer API, menu
entry, selected native library or add-in-place access.

The main host supplies a canonical appData directory. Storage uses the fixed
`Lightscaper/project-library/v1/native-photo-resources.sqlite3` path, separate
from Original physical bindings and the native catalog. Resource keys and
renderer filenames cannot choose physical paths. The database admits only its
exact `LSRC` application identity, version 1 and STRICT
`native_photo_resources(storage_key,family,reference,body)` table. Existing
files receive a read-only ownership preflight followed by a writable recheck;
foreign identities, altered schemas and orphan sidecars refuse. Database and
sidecar files must be canonical, single-link regular files in real private
directories. No Original body directory or index is initialized as a side effect.

LUT references bind the SHA-256, exact UTF-8 byte length, lattice size and domain.
Bodies are bounded by 16 MiB, retain their exact UTF-8 representation and refuse
a byte-order mark. The existing shared `.cube` parser authenticates the complete
body. Brush references bind SHA-256, dimensions and byte length to a canonical
logical key. The shared brush owner authenticates the `SCMASK01` header,
little-endian dimensions, complete digest and alpha plane. Dimensions are at
most 1,024 by 1,024; the encoded body is at most one MiB plus 16 bytes. These
body/parser limits are component bounds, not a total process-heap claim.

Installation captures a private fixed backing before any asynchronous work.
The actual shared parser must finish before SQL starts; a genuine authenticated
packet and synchronous digest recheck fence publication. A short IMMEDIATE
transaction either appends the immutable row or compares an existing canonical
reference, actual body length and every byte to the authenticated incoming body.
A corrupt or longer prefix-matching body refuses rather than being reused or
replaced. The returned `{ reference, created }` receipt belongs to the actual
COMMIT. Caller cancellation or close after that acknowledgment cannot erase an
installed or reused result. No SQL transaction spans parser or consumer awaits.

Reads select one bounded row, normalize its complete reference and authenticate
its actual body before lending private bytes through `source.withBytes`.
Every delivery is authenticated, including repeated reads; there is no body
cache. The consumer joins the scope and must not retain or transfer its view.
Its mutation cannot change persisted bytes. Private raw-byte allocations are wiped after their owning work settles;
parser-owned text and lattice state follow the existing parser lifetime. Missing or corrupt
bodies refuse without reconstructing authority from metadata.

Each family has one render slot, one verification slot and one installation
slot: six independent slots total, with no deferred body queue. A held render
consumer can coexist with that family's verification or installation. A second
operation in the same slot refuses before borrowed-input capture. Admission
registers its active placeholder before reflecting options, references or bytes,
so synchronous close reentry still joins the operation. Captured native caller
and shutdown signals preserve their first reason without inspecting opaque
values; listeners detach on settlement.

`verifyPhoto` uses the complete Current collector for Photo aggregate schemas
1, 2 and 3 with Develop processes 1 through 4. It includes inactive versions,
disabled effects, redo/history entries, snapshots and unused or unbound mask
inputs. `verifyPreset` normalizes selected preset schemas 1 through 4 with the
fixed owning Current selected-preset kernel, then collects
`preset.settings.develop`. The public external-preset grammar remains strict.
Both family capabilities expose their own `verifyReferencesV1` and authenticate
its admitted scalar references serially through the independent verify slot.
This supplies genuine body verification to native Current catalog publication;
a descriptor or no-op callback cannot substitute for it.

Close caches its fence before shutdown callbacks can reenter, aborts read and
verification publication, joins all admitted parser, Blob-read and consumer
work, and then retires SQLite. Read and verification scopes reject late
publication after cancellation. Installation retains a completed native ACK.
An admitted operation's failure remains observable through its own promise;
close is a joined retirement barrier, not a replacement for observing it.

The opener uses private file permissions, SQLite WAL and FULL commits. POSIX
also syncs admitted directory entries. Windows directory flushing and power-loss
durability are not established by this component, and a host-Node component
run does not qualify its packaged Electron runtime or other desktop targets.

The [native Photo storage adapter](lightscaper-native-photo-storage.md) still
needs managed-media custody and scoped Original/preview loading, settings,
journals, full restore publication and complete Session composition. Renderer
and IPC admission plus menu-owned library selection follow that composition.
The complete Web Core remains the active fallback throughout that work.
