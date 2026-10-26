# Native Motionscaper Save publication

Motionscaper's file writer and the Framescaper successor's saved-file watcher
run in separate main processes. A complete `.mscape` replacement alone does
not prove that its Save succeeded. A destination-local transaction journal
keeps a candidate out of linked publication until native preparation and local
project retention have both succeeded.

## Preparation and the publication point

The native writer streams and syncs a complete candidate. When replacing an
existing file, it copies the pinned, no-follow original descriptor into an
independent, synced backup inode and verifies its digest. The copy uses bounded
buffers; it does not change the original inode's link count or weaken the
watcher's in-place mutation checks.

Before replacement, main installs and syncs a pending journal. Its closed,
checksummed record binds a transaction ID, project ID, candidate identity and
digest, and the prior file and backup identities. Main derives the journal,
temporary and backup names from the selected destination. The selected parent
directory's device/inode identity fences later writes, rollback and cleanup.

The watcher defers the exact candidate identified by a pending journal. Native
replacement, directory synchronization and destination verification finish
behind that fence. The Motion store then durably reserves the expected saved
head and write lease in `nativeSaves`, retaining the candidate snapshot and
verified asset closure. Preparation changes neither the published saved pointer
nor saved-revision notifications. Recovery autosaves remain separate.

One atomic journal transition from `pending` to `published` releases the
candidate. Watcher discovery includes journal phase, so publication becomes
discoverable without another archive-byte change. Local finalization advances
the reserved saved pointer and emits the saved-revision notification. The
journal remains until explicit acknowledgement of that reconciliation.

| Journal state | Meaning |
| --- | --- |
| `pending` | The candidate is fenced; native or local preparation may still fail. |
| `published` | Publication occurred. Reconciliation or cleanup may still need retry. |
| `rolled-back` | The candidate was withdrawn; the retained transaction still needs local cancellation and acknowledgement. |

Before publication, failed preparation or cancellation restores verified prior
bytes only while the destination still belongs to this candidate. A first Save
with no prior file rolls back to an absent destination. Failed or uncertain
rollback retains its journal for retry. After publication, errors carry an
authoritative committed outcome: they do not restore the old file or masquerade
as an ordinary failed Save. Cleanup and local finalization remain retryable.

## Restart and acknowledgement

**File → Open** can recover an interrupted transaction through its selected
native capability. A pending candidate is rolled back, never promoted merely
because its archive is complete. Published recovery metadata remains available
even when backup cleanup is blocked.

The store finds the preparation by transaction ID. Its owning project can differ
from the incoming archive: an interrupted Save As of project B over project A
may restore A, and an independent external replacement may now occupy the path.
Reconciliation checks the transaction's retained candidate receipt and owning
saved-head reservation, then the selected archive follows normal format
admission and import or collision review. A foreign or future archive keeps its
read-only admission rules. An already reconciled Save or a saved copy can have
no local preparation. Its cleanup does not create or advance a local saved head.

If rollback removed the only file, **File → Save** can select that same
destination through the Save dialog. Before creating another temporary archive
or admitting current destination bytes, main checks the selected parent and
journal's project ownership and returns a recovery-only capability. It permits
status and acknowledgement; streaming, preparation and publication refuse.
That action reconciles the interrupted transaction. A later Save action starts
an ordinary Save.

Acknowledgement follows durable local finalization or cancellation. It removes
only the matching settled transaction's owned debris and journal. It cannot
publish a pending candidate, roll back an archive, or bind a document to a new
destination. Open review can therefore Keep or Cancel after reconciliation
without changing the Save binding. Native Copy passes recovery results through
the same session owner; a copy without a local preparation preserves dirty
state, saved head and Undo history. Failed acknowledgement retains a retryable
capability and correlation. Lost replies and repeated status/acknowledgement
requests do not publish twice.

## Independent files, bounds and qualification

The fence applies to one candidate's file identity and digest. An independent
atomic replacement has another inode and remains eligible, even with identical
bytes. Rollback refuses to overwrite that independent replacement. Paths,
parent identities, journals and native capabilities remain platform-local;
portable projects and linked archives retain their existing formats and
composition identities. Renderer requests contain opaque tokens and closed
operation fields, never journal or destination paths.

Native Save admits four active project reservations and four recovery grants,
with bounded completed-receipt retention. Archive admission is 64 GiB, streaming
chunks are at most 4 MiB, and journal records are at most 8 KiB. The receiver's
separate snapshot and transfer bounds still apply.

Maintained filesystem, storage and controller tests exercise preparation
failures, rollback, independent replacements, lost replies and restart
reconciliation. They do not establish complete packaged-desktop, native chooser,
filesystem or power-loss qualification. Directory synchronization follows the
platform implementation; the Windows path does not perform a POSIX directory
fsync. Journals and backups are recovery artifacts beside their selected file,
not portable project content. Remaining platform and full-release gates retain
the qualification boundaries in the implementation order.
