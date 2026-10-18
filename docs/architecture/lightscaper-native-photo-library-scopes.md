# Native Photo library scopes

The main-private `LightscaperNativePhotoLibraryScopesCurrentV1` allocates and
reopens physical native library generations. Each generation composes the actual
Current catalog, managed media, LUT/brush resources and selected settings owners.
The main-private restore now installs and reopens a selected native generation.
The [installed Session transport](lightscaper-native-photo-session-protocol.md)
uses the same manager for native Session and restore. The File menu offers this
complete pair while Web Core remains the default.

## Ownership and storage

One dedicated SQLite connection holds `BEGIN IMMEDIATE` for the entire manager
lifetime. The fixed `native-photo-library-writer.sqlite3` database has application
ID `LSLW`, version 1 and one exact empty STRICT table. It contains no heartbeat,
PID, expiry or takeover row. Another process refuses after SQLite's bounded busy
timeout; orderly close or process termination releases the OS lock. This guard
coordinates cooperating native scope owners, independently of their data
transactions. It does not replace selected-library epoch checks or folder grants.

The independent `native-photo-library-scopes.sqlite3` registry has application
ID `LSNS`, version 1 and a persistent random root owner. A reservation records the
complete normalized allocation and expected manifest digest before filesystem
creation. Namespace and owner tokens come from native cryptographic randomness.
Their fixed lowercase hexadecimal encoding supplies filesystem components;
browser database names and caller catalog names never become paths.

Each generation lives below the canonical global library directory:

```text
Lightscaper/project-library/v1/
  native-photo-libraries/<namespace-token>/
    owner.json
    app-data/Lightscaper/project-library/v1/
      native-photo-catalogs.sqlite3
      ...native media, resource and settings storage...
```

The exclusive immutable manifest binds the actual registry owner, native storage
profile and complete allocation. Its bounded bytes, single-link regular file,
canonical directories and expected digest must agree with the durable registry.
Creation joins file sync/close and directory sync before the `created` registry
commit. A reserved allocation can resume only from its matching fresh inventory
and empty app-data. A created allocation requires its existing exact manifest and
app-data; copied, missing or foreign evidence refuses without adoption or deletion.

The default scope retains the existing global component paths. The private fixed
anchor uses `scope: 'anchor'`; every vended settings owner explicitly uses
`scope: 'selected:library'`, including default storage. Each catalog's resource
verifier uses its actual same-generation resource owner.

## Capabilities and retirement

`openDefault`, `allocate` and `resume` return frozen opaque capabilities branded
only in the creating manager's WeakMap. `describe` returns allocation scalars or
null for default storage, without paths. Copying a descriptor, wrapping a scope in
a Proxy, using another manager or reopening after retirement grants no scope.
`openComponents` rechecks the actual reservation and manifest before opening any
generation child. Allocation paging reads at most 64 registry records, including
unfinished reservations, without interpreting creation progress as readiness.

Accepted requests register before borrowed options are reflected. Closing fences
admission, cancels pending work and joins actual component opening and cleanup.
Each child close method is captured before vending. The
[Original reader](lightscaper-native-photo-original-loading.md) uses a persistent
manager shutdown signal, independent of its completed opening request. Its
consumers and physical reads retire before catalog, media and selected settings;
those owners retire before resources, and all children retire before registry and
anchor. The global writer guard releases last. Unproved retirement quarantines
the manager and retains a strong reference to its guard until process exit;
another scope owner must not enter while a child might still own native work.
Combined native opening/retirement failures retain the guard even when no child
owner was returned.
Closing never deletes generation files or allocation records.
Successfully closed components leave the manager's tracking set. Fresh restore
roles release their generation tokens only after joined retirement.

Component close first quiesces escaped media writers without retiring physical
storage. This releases an idle stream producer that can precede a read in the
Original store queue, allowing reader retirement to join before ordinary owner
close. Every component close barrier is cached before synchronous cancellation.

The shared fixed-profile database opener admits existing SQLite ownership
read-only before writable recovery, permissions or WAL changes. Catalog profiles
accept only their exact historical schemas and preserve existing migrations.
Foreign hot-journal bytes remain untouched. Directory admission retries settle
parent-entry fsync even when an earlier mkdir succeeded before sync failed.

## Restore and selected installation

`restoreArchive` registers the entire archive job before lazy loading or input
IO. Its short queue registration permits ordinary manager calls during the job;
shutdown cancels and joins the actual job before retiring children and the guard.
The native input owner also joins real byte providers after the shared archive
reader stops waiting on cancellation. ZIP cleanup precedes publication.

`beginRestore` fences the previous selected epoch and joins its actual components
before allocating a fresh generation. Separate one-use catalog and media claims
cannot be copied, replayed or used as ordinary scope capabilities. The catalog
stage preserves exact archived documents and revisions, complete Query2 rows,
representable legacy Query1 rows, stack order and saved-state presence. Legal
legacy projection overflow leaves that index unready. The media stage hashes every Original
alias, installs the complete retained resource and preset closure, and audits
actual native custody and bodies. Audits guard encoded payload sizes in SQL and
refuse independent-connection changes.

Only genuine sealed child receipts and successful candidate close can issue the
manager-bound, one-use Ready capability. The fixed native anchor publishes the
selected pointer and permanent installation history in one transaction, reading
both exact values back before COMMIT. A true COMMIT acknowledgment survives late
cancellation and manager shutdown; matching permanent history reconciles a lost
acknowledgment. Native pointer/history records are independent of browser names.

Initial selection requires an actually pristine default catalog and joined close
before pointer creation. `openSelected` authenticates restored registry/manifest
identity and permanent history before vending an epoch-bound scope. Historical
Ready digests attest installation; legitimate later edits remain reopenable.
Malformed occupied authority rows refuse. Valid abandoned journals may be
replaced conditionally while their generation files and registry records remain
retained; neither journal nor manifest grants deletion authority.

## Qualification and remaining work

Linux tests use real independent SQLite connections and Node child processes.
They cover cross-process exclusion and crash release, same catalog/Photo/asset
keys with distinct genuine DNG bytes in default and two generations, independent
resource installation, settings isolation, complete Current resource verification,
durable reopen, bounded paging, foreign evidence and joined stream/resource
consumers. Large binary preservation checks compare bounded hash/size diagnostics.
Focused verification runs serially under a process-group memory limit.

Registry creation states, manifests and opaque allocation capabilities alone grant
no restore-ready, selected-pointer, permanent-history or deletion authority. Tests
also cover real archive restore, exact preset absence/empty rows and saved-state
tombstones, selected reopen
after edits, held input and ZIP cleanup, ignored history insertion, lost COMMIT
acknowledgment and manager shutdown during actual publication. Packaged native
Session qualification and the maintained desktop target matrix remain.
No AI runtime closure or target inventory changes; a manual
**Update AI assets** run is not required.
