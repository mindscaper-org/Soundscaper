/* SPDX-License-Identifier: AGPL-3.0-only */
import { join } from 'node:path';
import { readPhotoNativeApplicationManifestCurrentV1 as readApplication } from './lightscaper-native-photo-application-current-v1.ts';
import { photoNativeDirectoryCurrentV1 as directory,
 photoNativeInventoryCurrentV1 as inventory } from './lightscaper-native-photo-artifact-files-current-v1.ts';
import { preparePhotoNativeChildCurrentV1 as prepare, photoNativePreparedRetirementIsUnprovedCurrentV1 as unproved,
 type LightscaperNativePhotoPreparedChildCurrentV1 as Prepared } from './lightscaper-native-photo-prepared-child-current-v1.ts';
import { ownRecord } from './lightscaper-native-photo-granted-filesystem-codec-current-v1.ts';
import { captureNativeFilesystemOptions as captureOptions, captureNativeFilesystemSignal as captureSignal,
 checkNativeFilesystemSignal as check, linkNativeFilesystemSignal as link } from './lightscaper-native-photo-granted-filesystem-signal-current-v1.ts';
import { readLightscaperPhotoNativeBuildResultCurrentV1 as readResult, type PhotoNativeBuildCurrentV1, type PhotoNativeRoleCurrentV1, type PhotoNativeTargetCurrentV1 } from '../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';
export type { LightscaperNativePhotoPreparedChildCurrentV1 } from './lightscaper-native-photo-prepared-child-current-v1.ts';
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const BOOKED = { 'raw-engine': 0, 'granted-filesystem': 0 }, QUARANTINE = new Set<object>();
function actualTarget(): PhotoNativeTargetCurrentV1 {
 if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
 if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64';
 if (process.platform === 'darwin' && process.arch === 'arm64') return 'mac-arm64';
 if (process.platform === 'win32' && process.arch === 'x64') return 'win-x64';
 if (process.platform === 'win32' && process.arch === 'arm64') return 'win-arm64';
 throw new TypeError('Photo native payloads have no maintained runtime for this actual target.');
}
/** The sole protected Photo native payload/start owner. No renderer path,
 * environment override, role-shaped DTO or caller executable grants a start. */
export class LightscaperNativePhotoPayloadsCurrentV1 {
 #shutdown = new AbortController(); #accepting = true; #closing?: Promise<void>; #detach: () => void = () => {};
 #result!: PhotoNativeBuildCurrentV1; #root = ''; #jobs = new Set<Promise<unknown>>(); #prepared = new Set<Prepared>(); #faults: unknown[] = [];
 private constructor() {}
 static async open(value: Readonly<{ applicationRoot: string; resourcesPath: string; packaged: boolean; signal?: AbortSignal }>): Promise<LightscaperNativePhotoPayloadsCurrentV1> {
  const owner = new LightscaperNativePhotoPayloadsCurrentV1(); let signal: AbortSignal | undefined;
  try {
   const row = ownRecord(value, ['applicationRoot', 'resourcesPath', 'packaged', 'signal'], ['applicationRoot', 'resourcesPath', 'packaged']);
   signal = captureSignal(row.signal); check(signal); if (typeof row.packaged !== 'boolean') throw new TypeError('Photo native packaging identity is required.');
   owner.#detach = link(signal, () => { owner.stop(); void owner.close().catch(() => undefined); });
   const resources = await directory(row.resourcesPath); if (typeof row.applicationRoot !== 'string') throw new TypeError('Photo application root is required.'); const bytes = await readApplication(row.applicationRoot);
   try { owner.#result = readResult(JSON.parse(bytes.toString('utf8')) as unknown); } finally { bytes.fill(0); }
   if (owner.#result.target !== actualTarget() || row.packaged && owner.#result.sourceRevision === null) throw new Error('Photo native package target/source revision is not genuine.');
   owner.#root = await directory(join(resources, 'runtime/photo-native/current-v1', owner.#result.target));
   await owner.#authenticate(); owner.#current(); check(signal); return owner;
  } catch (error) { let primary = error; try { check(signal); } catch (reason) { primary = reason; }
   try { await owner.close(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Photo native open and retirement failed.', { cause: cleanup }); } throw primary;
  }
 }
 #current(): void { if (!this.#accepting || this.#closing || this.#faults.length) throw new Error('Photo native payload owner is stopped or quarantined.'); check(this.#shutdown.signal); }
 async #authenticate(): Promise<void> {
  const actual = await inventory(this.#root); if (JSON.stringify(actual) !== JSON.stringify(this.#result.files)) throw new Error('Photo native actual payload inventory differs from the protected package.');
 }
 prepare(role: PhotoNativeRoleCurrentV1, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Prepared> {
  let accept!: (value: Prepared) => void, reject!: (reason: unknown) => void;
  const task = new Promise<Prepared>((yes, no) => { accept = yes; reject = no; });
  let booked = false, current: Prepared | undefined, signal: AbortSignal | undefined; const detaches: Array<() => void> = [];
  const release = (): void => { for (const detach of detaches.splice(0)) detach(); if (booked) { BOOKED[role]--; booked = false; } if (current) this.#prepared.delete(current); };
  try {
   this.#current(); if (role !== 'granted-filesystem' && role !== 'raw-engine') throw new TypeError('Unknown fixed Photo native role.');
   const maximum = role === 'raw-engine' ? 1 : 4; if (BOOKED[role] >= maximum) throw new RangeError('Photo native prepared peer capacity is busy.');
   BOOKED[role]++; booked = true; this.#jobs.add(task);
   const caller = captureOptions(options), controller = new AbortController(); signal = controller.signal;
   const abort = (reason: unknown): void => { if (!controller.signal.aborted) controller.abort(reason); };
   detaches.push(link(caller, () => { abort(caller ? Reflect.apply(REASON, caller, []) : undefined); })); detaches.push(link(this.#shutdown.signal, () => { abort(Reflect.apply(REASON, this.#shutdown.signal, [])); })); check(signal); this.#current();
   void (async () => {
    await this.#authenticate(); check(signal); this.#current();
    current = await prepare(this.#root, this.#result.target, this.#result.files, role, signal, release); this.#current(); check(signal); this.#prepared.add(current); return current;
   })().then(value => { this.#jobs.delete(task); accept(value); }, async (error: unknown) => {
    let primary = error; try { check(signal); } catch (reason) { primary = reason; }
    try { if (current) await current.close(); else if (!unproved(error)) release(); } catch (cleanup) { primary = new AggregateError([primary, cleanup], 'Photo native preparation and retirement failed.'); this.#faults.push(primary); QUARANTINE.add(this); }
    if (unproved(error)) { this.#faults.push(error); QUARANTINE.add(this); }
    this.#jobs.delete(task); reject(primary);
   });
  } catch (error) { let primary = error; try { check(signal); } catch (reason) { primary = reason; }
   try { release(); } catch (cleanup) { primary = new AggregateError([primary, cleanup], 'Photo native admission and link retirement failed.'); this.#faults.push(primary); QUARANTINE.add(this); }
   this.#jobs.delete(task); reject(primary);
  } return task;
 }
 stop(): void { if (!this.#accepting) return; this.#accepting = false; this.#shutdown.abort(new DOMException('Photo native payload owner retired.', 'AbortError')); }
 close(): Promise<void> {
  if (this.#closing) return this.#closing; let accept!: () => void, reject!: (error: unknown) => void;
  this.#closing = new Promise<void>((yes, no) => { accept = yes; reject = no; }); this.stop();
  void (async () => {
   const errors: unknown[] = [];
   await Promise.allSettled([...this.#jobs]);
   for (const owner of this.#prepared) try { await owner.close(); } catch (error) { errors.push(error); }
   try { this.#detach(); } catch (error) { errors.push(error); }
   for (const error of this.#faults) if (!errors.some(value => Object.is(value, error))) errors.push(error);
   if (errors.length) { QUARANTINE.add(this); throw new AggregateError(errors, 'Photo native child/artifact ownership could not retire.'); }
  })().then(accept, reject); return this.#closing;
 }
}
