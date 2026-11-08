/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { copyNativeTestFixture } from '../../scripts/lib/node-native-test-fixtures.ts';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoOriginalsCurrentV1 as Originals } from '../../desktop/lightscaper-native-photo-originals-current-v1.ts';
import { LightscaperNativePhotoRawOriginalsCurrentV1 as Native } from '../../desktop/lightscaper-native-photo-raw-originals-current-v1.ts';
import { createDesktopPhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts';
import type { PhotoLibrarySessionCurrentV1 as Session } from '../../src/lightscaper/controller/photo-library-session-current-v1.ts';
import type { PhotoLibraryRawImportSourceCurrentV1 } from '../../src/lightscaper/controller/photo-library-raw-import-current-v1.ts';
import type { DesktopPhotoLibrarySessionServiceCurrentV1 as Service } from '../../src/lightscaper/desktop-photo-library-session-storage-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { rawRecoveryDngFixtureV1 } from './lightscaper-raw-recovery-dng-current-fixture.ts';
import { scopePhotoCurrentV1, scopeOriginalReferenceCurrentV1 as reference } from './lightscaper-native-library-scope-integration-fixture-current.ts';
import { originalGroupFixtureCurrentV1 } from './lightscaper-desktop-original-group-fixture-current.ts';

export const nativeRawOriginalsHashCurrentV1 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
type NativeOwner = ReturnType<typeof Native.create>;
type Profile = 'canonical' | 'linear-headroom-v1' | 'highlight-recovery-v1';
type Child = { actual: ChildProcessWithoutNullStreams; done: Promise<void>; closed: boolean; closing?: Promise<void>; used: boolean };
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** Native FS/SQLite + actual compiled SRR1, with a genuine Current renderer
 * Session. Only the OPFS directory operations are the maintained real-File
 * test port. The prepared-child fixture is trusted local launch ownership,
 * not a claim of the shipping authenticated producer or OS isolation. */
export async function nativeRawOriginalsFixtureCurrentV1<Result>(context: TestContext,
 run: (fixture: Awaited<ReturnType<typeof create>>) => Promise<Result>): Promise<Result> {
 const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native RAW originals ')));
 let fixture: Awaited<ReturnType<typeof create>> | undefined, manager: Scopes | undefined;
 let failed = false, primary: unknown;
 const cancel = (): void => { fixture?.cancel(); };
 context.signal.addEventListener('abort', cancel, { once: true });
 let result!: Result;
 try {
  check(context.signal); manager = await Scopes.open({ appDataPath: directory }); fixture = await create(context, directory, manager);
  if (context.signal.aborted) cancel(); result = await run(fixture);
 } catch (error) { failed = true; primary = error; }
 const errors: unknown[] = [];
 try { await fixture?.close(); } catch (error) { errors.push(error); }
 try { await manager?.close(); } catch (error) { errors.push(error); }
 context.signal.removeEventListener('abort', cancel);
 if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Native RAW Current fixture actual ownership did not retire; files retained.');
 await rm(directory, { recursive: true, force: false }); if (failed) throw primary; return result;
}
async function create(context: TestContext, directory: string, scopes: Scopes) {
 const selected = await scopes.openSelected({ name: 'Native RAW Current' });
 const components = await scopes.openComponents(selected.scope), stop = new AbortController();
 const generated = rawRecoveryDngFixtureV1({ variant: 'color-canary' }), bytes = generated.bytes; generated.sensor.fill(0);
 const template = scopePhotoCurrentV1(); let native: NativeOwner | undefined;
 const children = new Set<Child>(), work = new Set<Promise<unknown>>(), releases = new Set<() => void>(), sessions = new Set<Session>();
 const storage = originalGroupFixtureCurrentV1(context), owners = new Set<NativeOwner>(), readers = new Set<ReturnType<typeof Originals.create>>();
 const state = { starts: 0, prepares: 0, alerts: 0 }, executable = join(directory, process.platform === 'win32' ? 'role.exe' : 'role');
 let closing: Promise<void> | undefined;
 const release = (): void => { for (const done of [...releases]) done(); };
 const cancel = (): void => {
  release(); if (!stop.signal.aborted) stop.abort(context.signal.aborted ? context.signal.reason : new Error('Native RAW fixture retired.'));
  for (const owner of owners) owner.stop();
  for (const child of children) if (!child.closed) child.actual.kill('SIGKILL');
  for (const session of sessions) void session.close().catch(() => undefined);
 };
 const track = <Value>(task: Promise<Value>): Promise<Value> => { work.add(task); void task.then(() => { work.delete(task); }, () => { work.delete(task); }); return task; };
 const closeChild = (child: Child): Promise<void> => {
  if (child.closing) return child.closing;
  let resolve!: () => void; child.closing = new Promise<void>(accept => { resolve = accept; });
  if (!child.closed) child.actual.kill('SIGKILL'); void child.done.then(resolve); return child.closing;
 };
 const prepare = (options: Readonly<{ signal?: AbortSignal }> = {}) => {
  check(stop.signal); if (options.signal) check(options.signal); state.prepares++;
  const actual = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const child: Child = { actual, done: Promise.resolve(), closed: false, used: false };
  const streams = [actual.stdin, actual.stdout, actual.stderr].map(stream => new Promise<void>(resolve => { stream.once('close', resolve); }));
  child.done = new Promise<void>(resolve => { actual.once('close', () => { child.closed = true; resolve(); }); }).then(async () => { await Promise.all(streams); });
  actual.on('error', () => undefined); children.add(child);
  return Promise.resolve(Object.freeze({ start() {
   check(stop.signal); if (child.used || child.closed || child.closing) throw new Error('Actual prepared child is not claimable.');
   child.used = true; state.starts++; return actual;
  }, close: () => closeChild(child) }));
 };
 context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel(); const timer = setTimeout(cancel, 12_000);
 try {
  assert.ok(copyNativeTestFixture({ repositoryRoot: fileURLToPath(new URL('../../', import.meta.url)), kind: 'lightscaper-raw-role', outputPath: executable }));
  const photo = normalizePhotoDocumentCurrentV1({ ...template.photo, catalogId: selected.catalogId, id: 'native-raw-photo',
   original: { ...template.photo.original, id: 'native-raw-original', storageKey: 'native-raw-body', name: 'Native color.dng', mimeType: 'image/x-adobe-dng',
    contentSha256: nativeRawOriginalsHashCurrentV1(bytes), byteLength: bytes.byteLength, width: generated.width, height: generated.height, hasAlpha: false },
   metadata: { ...template.photo.metadata, fileName: 'Native color.dng' } });
  const root = await components.catalog.loadCatalog(selected.catalogId); assert.ok(root);
  await components.media.writeAsset(photo.original.storageKey, new Blob([bytes], { type: photo.original.mimeType! }), { name: photo.original.name, mimeType: photo.original.mimeType });
  await components.media.catalogOriginals.retain(selected.catalogId, [reference(photo.original, photo.id)]);
  await components.catalog.publishPhotos(selected.catalogId, root.revision, [photo]);
  const createOwner = (options: Partial<Parameters<typeof Native.create>[0]> = {}): NativeOwner => {
   const owner = Native.create({ catalog: components.catalog, originals: components.originals, prepare,
    scope: { signal: stop.signal, assertCurrent() { check(stop.signal); scopes.describe(selected.scope); } },
    unretired: () => { state.alerts++; }, ...options }); owners.add(owner); return owner;
  };
  native = createOwner(); let currentNative = native, genericClosed = false, rawImport: Readonly<PhotoLibraryRawImportSourceCurrentV1> | undefined;
  const service: Service = { async open(options, localOwner) {
   check(stop.signal); const localClose = localOwner.close;
   if (!genericClosed) { await currentNative.close(); await components.close(); genericClosed = true; }
   let openedNative: NativeOwner | undefined;
   const realCreate = Originals.create, descriptor = Object.getOwnPropertyDescriptor(Originals, 'create'); assert.ok(descriptor);
   const observe: typeof Originals.create = actual => {
    const reader = Reflect.apply(realCreate, Originals, [actual]) as ReturnType<typeof Originals.create>; readers.add(reader);
    openedNative = Native.create({ catalog: actual.catalog, originals: reader, prepare, scope: actual.scope,
     unretired: () => { state.alerts++; } }); owners.add(openedNative); currentNative = openedNative; return reader;
   };
   const local = { async close() {
    await Reflect.apply(localClose, localOwner, []); await openedNative?.close();
   } };
   Object.defineProperty(Originals, 'create', { ...descriptor, value: observe });
   try {
    const lease = await scopes.openSessionLease(selected.scope, local, options.signal ? { signal: options.signal } : {});
    assert.ok(openedNative, 'Real selected lease must construct its actual Original reader.');
    const { linked: mainLinked, ...managedComponents } = lease.components; assert.equal(mainLinked, undefined);
    return Object.freeze({ ...lease, components: Object.freeze({ ...managedComponents, raw: openedNative.raw, ...(rawImport ? { rawImport } : {}) }) });
   } finally { Object.defineProperty(Originals, 'create', descriptor); }
  } };
  return {
   directory, scopes, selected, components, get native() { return currentNative; }, get raw() { return currentNative.raw; }, photo, bytes, prepare, createOwner, state, storage, cancel, track,
   signal: stop.signal,
   request: (profile: Profile = 'canonical', expectedRevision: number | null = photo.revision) => Object.freeze({ catalogId: photo.catalogId, photoId: photo.id,
    original: photo.original, expectedRevision, profile }),
   preview: (tier: 'thumbnail' | 'fit-screen' = 'thumbnail') => Object.freeze({ catalogId: photo.catalogId, photoId: photo.id,
    original: photo.original, expectedRevision: null, tier }),
   activeChildren: () => [...children].filter(value => !value.closed).length,
   gate() {
    let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; });
    const done = (): void => { releases.delete(done); resolve(); }; releases.add(done); if (stop.signal.aborted) done();
    return Object.freeze({ promise, release: done });
   },
   async reached(barrier: Promise<void>, task: Promise<unknown>): Promise<void> {
    check(stop.signal); await Promise.race([barrier, task.then(() => { throw new Error('Actual native operation ended before the held receipt.'); })]); check(stop.signal);
   },
   async openSession(importSource?: Readonly<PhotoLibraryRawImportSourceCurrentV1>): Promise<Session> {
    rawImport = importSource;
    const session = await track(createDesktopPhotoLibrarySessionCurrentV1({ name: 'Native RAW Current', service, signal: stop.signal,
     originalSourceOptions: { storage: storage.storage } })); sessions.add(session); return session;
   },
   close(): Promise<void> {
    if (closing) return closing;
    let resolve!: () => void, reject!: (error: unknown) => void; closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
    if (timer) clearTimeout(timer); context.signal.removeEventListener('abort', cancel); cancel();
    void (async () => {
     await Promise.allSettled([...work]); const errors: unknown[] = [];
     for (const owner of [...sessions, ...owners, ...readers, storage]) { try { await owner.close(); } catch (error) { errors.push(error); } }
     for (const child of children) { try { await closeChild(child); } catch (error) { errors.push(error); } }
     await Promise.all([...children].map(child => child.done));
     try { await components.close(); } catch (error) { errors.push(error); }
     bytes.fill(0); if (errors.length) throw new AggregateError(errors, 'Native RAW fixture consumers/peers/native components did not retire.');
    })().then(resolve, reject); return closing;
   },
  };
 } catch (primary) {
  if (timer) clearTimeout(timer); context.signal.removeEventListener('abort', cancel); cancel(); const errors: unknown[] = [];
  for (const owner of [...owners, ...readers, storage]) { try { await owner.close(); } catch (error) { errors.push(error); } }
  for (const child of children) { try { await closeChild(child); } catch (error) { errors.push(error); } }
  try { await components.close(); } catch (error) { errors.push(error); }
  bytes.fill(0); if (errors.length) throw new AggregateError([primary, ...errors], 'Native RAW fixture opening and actual retirement failed.', { cause: primary }); throw primary;
 } finally { template.bytes.fill(0); }
}
