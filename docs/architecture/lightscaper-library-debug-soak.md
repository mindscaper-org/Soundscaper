# Lightscaper library debug soak

**File → Library debug soak** opens an optional diagnostic dialog in the selected
Web or native library. It adds no default toolbar, panel or startup workflow.
The application uses its complete Current Session factory, including the real
import, Original/resource, Develop and export owners. The existing backend
management barrier fences and joins the entire current workspace before a
diagnostic Session opens. After proved retirement, the same backend remounts.

This diagnostic changes the actual library. Imported diagnostic Photos and their
recorded history remain. A successful round restores the prior Develop history
cursor; cancellation or failure can leave acknowledged imports and edits in
place. Develop history retains the reversible edit. Original bytes are never
rewritten, and private PNG outputs are removed after their actual readback.

## Finite corpus and operations

The menu runs three rounds. The owned runner admits 1–32 genuine Files, at most
64 MiB of encoded source data in total, and at most one megapixel per rendered
image. Its reusable diagnostic API accepts 1–100 rounds. Each export has an
8 MiB encoded/output-workspace allowance. These explicit tiny-corpus bounds are
not a new camera support claim or a large-library performance qualification.

Each round performs these real operations in order:

1. Import uniquely named diagnostic copies through the selected Current Session.
   Every acknowledged Photo must correspond to its input File.
2. Browse the library and search for the diagnostic IDs through actual Query1
   pages. Search refuses after 256 bounded pages rather than running an
   unbounded index walk.
3. Capture and hash each authenticated full Current Original in one-MiB ranges.
   Its digest and byte length must equal the selected input File.
4. Save a named, reversible exposure edit through actual Develop revision checks.
5. Use `PhotoRasterExportCurrentV1`, the real Current renderer and PNG encoder to
   commit a lossless RGBA8 sRGB PNG to a private OPFS stage. Read the committed
   File back, verify its PNG chunk CRCs and fixed scanlines, and compare its
   pixel digest to the actual encoder input. Only scalar output facts survive.
6. Restore the captured Develop history cursor, join actual Session retirement,
   open a fresh Session, and verify the stored recipe and Original digest again.
   Join that Session before the next round starts.

The main runner is
[`photo-library-debug-soak-current-v1.ts`](../../src/lightscaper/quality/photo-library-debug-soak-current-v1.ts).
The private export owner and PNG readback parser are separate focused modules.
The frozen application and Session kernels are unchanged. English/German copy is
registered in the lazy editor-copy audit inventory.

## Diagnostic evidence and lifetime

The report records each completed phase's elapsed milliseconds, actual item
count, current returned Session/export owner counts, and actual browser
`performance.memory.usedJSHeapSize` when the platform provides it. An unavailable
API is recorded explicitly as `browser-heap-api-unavailable`; no zero or inferred
RSS substitutes for a measurement. The report also records total opened/closed
Sessions, maximum simultaneously returned Sessions, final joined-owner counts,
Original hashes, and PNG container/pixel hashes. These counts describe this
runner's owners, not every browser or operating-system resource.

There is no throughput threshold, release performance gate, forced collection,
estimated process RSS, camera breadth certificate or physical-device claim.
A tiny three-round corpus is a bounded regression/diagnostic exercise. Broader
scale, hardware, color-management and assistive-technology observations retain
their separate roadmap scope and optional status.

Stop fences work and starts the actual selected Session's retirement. The runner
still joins entered Original consumers, decoder/resource callbacks and private
OPFS writes before settling. A writer stays owned until its real close or abort
fulfills; stage removal follows that receipt. Source-owned cleanup failures retain
the actual owners strongly and prevent backend remount. Timers and cancellation
signals are requests, never cleanup receipts. Ordinary failure after proved
cleanup can remount the same backend and report the failure truthfully. Desktop
close sees an active diagnostic as busy and cannot certify the already-retired
old workspace while the diagnostic owns a new Session.

## Focused qualification

The Node regression uses actual native FS/SQLite selected components, the
complete desktop Current Session factory and genuine pinned LibRaw workers. Its
OPFS directory boundary is explicitly instrumented and returns real File
snapshots; it does not establish Chromium OPFS behavior. It runs three real RAW
rounds and separately holds an actual write to prove stop/Session retirement
stays pending until that write joins.

The English/German browser specs use a tiny owned PNG and DNG, the real complete
Web Session, pinned RAW worker and browser OPFS for three rounds through the File
menu. They require actual PNG readback and joined cleanup, then close the dialog
and reload the resulting library. These are the intended focused qualification
surfaces; successful execution and its exact considered revision must be recorded
by the owned gates. They do not establish every native target, browser, camera,
GPU or real-device configuration.
