# Native Photo Session transport

The Lightscaper desktop installs a complete Current Photo Session and a matched
native restore runtime behind its sandboxed preload. Web Core remains the
default. **File → Photo storage** offers the native backend only when both
complete installed ports are available. The libraries are separate; selecting a
backend does not migrate photos. Custom application factories retain their own
composition and suppress this choice.

The menu reuses the existing workspace lifecycle owner. It refuses switching
during pending work or an open dialog, fences the current workspace, and joins
archive, preview, Develop and library retirement before changing both factories
and mounting the replacement workspace. Failed cleanup retains the failed owner
and prevents another selection. No always-visible control is added.

## Main authority and requests

The existing trusted IPC boundary verifies the actual application window, main
frame and document URL. The Photo host additionally binds the exact renderer
process, frame and document generation before reflecting request payloads.
Main lazily opens one actual native Scopes manager at the configured migrated
application-data location. No renderer path, database name or storage token can
choose that location.

Fixed channels cover catalog, both query versions, stacks, saved collections,
selected settings, custody, all six Original operations, resources, caches,
uploads, archive iteration and explicit exclusivity. The renderer retains real
Current and strict legacy children and the complete Web decoder. Optional native
RAW and linked-input families now compose separately through the same selected
Session and document authority; storage RPC alone is not decode authority.

Main issues connection and handle IDs. A monotonic request watermark is consumed
synchronously at authenticated send admission, before domain capture. Sixteen
active data requests and sixteen non-Original handles have independent cleanup
lanes. Transfers use at most one pending one-MiB chunk per handle. Retained
non-Original bodies share a 128-MiB allowance. Original single/group ownership
keeps its separate existing 196-MiB body and 384-MiB aggregate group limits.

Portable metadata preserves ordinary structured-clone graphs, including cycles,
aliases, insertion order, undefined, UTF-16, typed views and genuine Blob/File
bodies. Shared backing memory refuses. Graph and host bodies share bounded
byte, object and field counts. Metadata preparation has one renderer lane;
measured wire debt remains charged through actual upload retirement. Main
preflights native normalization and the eventual receipt's byte and field
capacity before opening a writer. Stored metadata and settings use bounded SQL
projections before generic decoding.

Only the five selected settings domains and the fixed-anchor import-preset
facet cross this boundary. Physical absence, occupied undefined and the owning
order-sensitive CAS comparator remain distinct. Genuine mutation acknowledgments
survive later cancellation; reads and false CAS results retain their stop fence.
Opaque caller cancellation reasons remain local. Errors cross as bounded facts.

## Native RAW and optional filesystem services

The installed native RAW gateway captures actual component-owned stored-Original
and prepublication-input facets. Stored requests require the full actual Photo
Original and revision; raw-input IDs resolve only completed Main upload owners
or issued linked-input capabilities. They never authorize a renderer path or a
digest-only source. The RAW output ticket keeps the actual Main plane and source
borrow through the real renderer consumer, with bounded one-MiB transfer and
complete output SHA verification. Its 256-MiB typed-output profile is separate
from the generic 128-MiB resource/download capacity. Native preview recipes have
a distinct cache identity, and permanent portable interchange retains WASM.

The host installs the shared target-authenticated Photo payloads only when their
protected manifest and exact runtime inventory are present. It supplies one
trusted read-only filesystem broker and an independently OS-isolated zero-path
RAW decoder, with genuine child and stdio retirement. Missing optional payloads
preserve the complete Web fallback; invalid present payloads refuse. Main folder
choosers and private grant/input owners remain the only external-file authority.
The broader linked management/watch/relink workflow and its packaged scenario
are separate L8 completion work.

## Retirement and restore

The isolated preload captures the actual local Session retirement handler before
opening. Main stop starts local fencing; its private retirement nonce is answered
only after the captured close promise settles. A shell consent response cannot
complete this barrier. Main joins actual local consumers and accepted work before
physical ticket, storage and writer-guard retirement. Cleanup failure retains the
real owner. Navigation and a timeout do not prove retirement: the installed
Electron process-gone path is the alternative process-loss authority.

The four restore channels stream a real archive into a Main-owned disk stage.
Main independently verifies complete length and SHA-256, then calls the same
Scopes manager's full fresh-generation restore and selected publication flow.
The archive uses its owning archive limit, independently of Original limits.
One synchronously booked restore attempt owns admission before lazy opening;
post-await checks refuse a revoked document. Live Sessions must retire first.
Stale IDs cannot close a newer attempt. Actual stage cleanup and accepted work
join before capacity is released. An acknowledged publication retains its receipt
with a cleanup notice if later cleanup fails. Unproved external stage retirement
also retains the Scopes writer guard.

Focused tests use genuine filesystem bodies, SQLite, complete Current Sessions,
held File/resource consumers, actual COMMIT boundaries and full archive restore.
Linux x64 packaged qualification separately passes raster/RAW import, Develop,
PNG and full archive backup, persistent reopen, confirmed restore and restored
reopen in three fresh processes for each backend. Every process exits cleanly
and retires its readers before its private profile is removed. These WSL
earlier packaged runs explicitly allow `--no-sandbox`; they do not qualify OS sandboxing.

An independent actual Electron process-loss check holds a genuine staged OPFS
File in a noncooperative collection consumer. Physical deletion and another
writer remain refused while Main close is held. A signal to the authenticated
actual renderer produces Electron's real process-gone event; native retirement
then joins and a fresh Scopes manager reopens the selected library. An unresolved
Electron evaluation result supplies no retirement authority. The check records
actual window isolation preferences, without claiming an OS sandbox audit.

Read-only grant, linked storage/input, native RAW service and linked menu
management/watch/relink paths are implemented. A subsequent Linux x64 public
`desktop:dir` run passes native-linked and native-absent Web packages through
three fresh processes each without `--no-sandbox`. Its linked scenario covers
native RAW import/Develop, durable cached-preview Develop after a physical move,
full Original refusal, exact relink, export and reopen, with actual reader and
native child retirement. The internal all-five workflow still requires the other
four targets' actual successful execution; final full-suite gates are pending.
Linux results do not qualify macOS or Windows, and public release remains
deferred. These changes do not require a
manual **Update AI assets** run; separate native Photo artifact production still
tracks its own source and inventory changes.
