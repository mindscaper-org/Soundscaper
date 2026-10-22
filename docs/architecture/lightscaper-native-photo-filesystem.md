# Native Photo filesystem and folder grants

The Main-private granted filesystem service is a small read-only filesystem
broker. Its fixed SGR1 protocol opens granted roots, relative files and lazy
paged directory cursors. It contains no image decoder, plugin execution or
write operation. It is a trusted broker for changing chooser-authorized roots;
it does not claim the fixed filesystem sandbox used by untrusted decoders.
The authenticated shared Photo payload producer now supplies this broker and
the separately isolated RAW role from one target-bound artifact closure. Optional
selected components capture its trusted start capability; absence of the whole
bundle preserves Web Core, while a present invalid bundle refuses.

A genuine Main owner captures the actual media database namespace before
reflecting borrowed capabilities. Its hard-bound facet can open roots and check
lifetime, but cannot close the entire role. Native root/file/cursor identities
remain private capabilities. Native path components preserve POSIX bytes and
Windows UTF-16 units. Handle-relative opens refuse symbolic links and compare
actual volume/object identities; retaining a directory handle makes an issued
root independent of later replacement of its textual path.

Directory scans retain a real lazy native cursor and return at most 64 entries
and 64 KiB of names per page. Entries are hints, not file-body or stable snapshot
proof. File reads return at most one MiB, check the retained file stamp and
share the existing media namespace's four physical I/O bookings. The protocol
validates fixed framing, bounded lengths, request watermarks and the actual
compiled target profile. Root and cursor close do not need another data booking.

Close fences admission and joins accepted requests, actual native handles and
the child plus stdio. Per-operation filesystem cancellation conservatively
retires the shared peer. A higher folder-grant owner therefore fences its own
operation locally, joins an accepted native open, and privately closes any late
root. A local grant cancellation never receives whole-role stop authority.
Source-owned uncertainty during native close quarantines the namespace; a
protocol acknowledgment or kill timer alone supplies no retirement proof.

`LightscaperNativePhotoLinkedGrantsCurrentV1` owns a separate local SQLite file,
`native-photo-linked-grants.sqlite3`, with application identity LSLG and schema 1.
The only root-path source is its trusted Main chooser. Authorization proves a
real root identity and closes that root before publishing a durable grant.
Public summaries contain only grant ID, display name, revision and revoked state.
Revalidation must reopen the original physical directory; revocation remains a
permanent tombstone. A fresh chooser authorization mints a fresh ID.

A singleton binds the grants database to the exact canonical media database
path and its bigint device/inode identity. Read-only preflight refuses a copied
grants database in another media allocation before chooser/root I/O or durable
adoption. Paths and native identities stay local and supply no authority to a
portable archive; restored libraries require explicit chooser authorization.
No SQL transaction spans chooser, filesystem or consumer work. Accepted grant
operations are bounded to four, close joins their actual callbacks and roots,
and genuine SQLite COMMIT acknowledgments survive late cancellation or close.

Focused Linux qualification covers 23 actual SGR1 process/filesystem cases and
26 real filesystem/SQLite grant cases, including substituted directories,
non-UTF8 names, namespace copying, held native receipts, process crashes,
COMMIT denial and independent cancellation. The injected native close-EINTR case
proves no retry of a reused descriptor and retains the source quarantine. These
are component results. Separate linked Original owners now authenticate retained
files, prepublication inputs and linked Photo publication. Menu management,
watch/relink/revocation recovery and packaged linked-scenario qualification remain
separate work. The component cases do not establish another desktop target's
execution or whole application behavior.
