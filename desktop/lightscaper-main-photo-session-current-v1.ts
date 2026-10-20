/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LightscaperNativePhotoLibraryServicesCurrentV1 as Services } from './lightscaper-native-photo-library-services-current-v1.ts';
import { RendererSaveOwnership } from './renderer-save-owner.js';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from './lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoSessionServiceCurrentV1 as Service } from './lightscaper-native-photo-session-service-current-v1.ts';
import { LightscaperNativePhotoLibraryRestoreServiceCurrentV1 as Restore } from './lightscaper-native-photo-library-restore-service-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_RESTORE_CHANNELS_CURRENT_V1 as RESTORE, readDesktopPhotoLibraryRestoreBeginCurrentV1 as restoreBegin,
	readDesktopPhotoLibraryRestoreWriteCurrentV1 as restoreWrite, readDesktopPhotoLibraryRestoreCommitCurrentV1 as restoreCommit,
	readDesktopPhotoLibraryRestoreAbortCurrentV1 as restoreAbort } from '../src/lightscaper/desktop-photo-library-restore-contract-current-v1.ts';
import type { PhotoLibraryRestoreReceiptV1 } from '../src/common/editor/photo-library-restore-port-v1.ts';
import { LightscaperNativePhotoSessionRetirementCurrentV1 as Retirement } from './lightscaper-native-photo-session-retirement-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as CHANNELS } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { DESKTOP_PHOTO_SESSION_CONTROL_CHANNELS_CURRENT_V1 as CONTROL, captureDesktopPhotoSessionFailureCurrentV1 as failure } from '../src/lightscaper/desktop-photo-session-response-current-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { name } from '../src/lightscaper/catalog/value-validation.ts';

interface Contents {
	send(channel: string, value: unknown): void;
	isDestroyed(): boolean;
	getOSProcessId(): number;
	forcefullyCrashRenderer(): void;
}
interface Options {
	readonly appDataPath: string;
	readonly services?: () => Promise<Readonly<Services>>;
	readonly handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void;
	readonly reportError: (error: unknown) => void;
}
interface Document {
	readonly owner: object;
	readonly contents: Contents;
	readonly processId: number;
	readonly osProcessId: number;
	readonly local: Retirement;
	readonly controller: AbortController;
	readonly failures: unknown[];
	active: boolean;
	openId?: string;
	opening?: AbortController;
	sessionClosing?: Promise<void>;
	closing?: Promise<void>;
	lossTimer?: ReturnType<typeof setTimeout>;
	restore?: RestoreJob;
}
type Library = Readonly<{ scopes: Scopes; service: Service; restore: Restore }>;
interface RestoreJob {
 readonly document: Document; readonly owner: object; readonly active: Set<Promise<unknown>>;
 id?: string; stopped: boolean; retired: boolean; failed: boolean; failure?: unknown;
 retiring?: Promise<void>; closing?: Promise<void>;
}
const QUARANTINE = new Set<object>();

/** Application-installed Main composition. TrustedDesktopIpc checks the real
 * window/main-frame/URL before these handlers; the exact process/frame/document
 * ownership check below then precedes every borrowed request field. */
export function installLightscaperMainPhotoSessionCurrentV1(options: Options) {
	const prepareServices = options.services;
	const ownership = new RendererSaveOwnership(), documents = new Map<object, Document>(), processFor = new WeakMap<Contents, number>();
	let library: Promise<Library> | undefined, loaded: Library | undefined, closing: Promise<void> | undefined, restoring: RestoreJob | undefined;
	const getLibrary = (): Promise<Library> => {
		if (closing) return Promise.reject(new Error('Native Photo library is closing.'));
		library ??= Promise.resolve().then(async () => Scopes.open({ appDataPath: options.appDataPath, ...(prepareServices ? { services: await prepareServices() } : {}) })).then(async scopes => {
   try { const actual = Object.freeze({ scopes, service: new Service(scopes), restore: new Restore(scopes, options.appDataPath) }); loaded = actual; return actual; }
   catch (primary) { try { await scopes.close(); } catch (cleanup) { QUARANTINE.add(scopes); throw new AggregateError([primary, cleanup], 'Native service construction and guard retirement failed.', { cause: cleanup }); } throw primary; }
  });
		void library.catch(() => undefined); return library;
	};
	const ownerFor = (event: unknown): Document => {
		const actual = event as { sender: Contents; processId: number; frameId: number };
		const owner = ownership.ownerFor({ sender: actual.sender, processId: actual.processId, frameId: actual.frameId }) as object;
		const document = documents.get(owner); if (!document?.active) throw new Error('Native Photo request belongs to a retired document.'); return document;
	};

 const currentDocument = (event: unknown, document: Document): void => {
  if (closing || ownerFor(event) !== document || document.controller.signal.aborted) throw new Error('Native Photo document is closing or no longer current.');
 };
 const releaseRestore = (job: RestoreJob): void => {
  if (!job.retired || job.failed || job.active.size) return;
  if (restoring === job) restoring = undefined;
  if (job.document.restore === job) job.document.restore = undefined;
 };
 const retireRestore = (job: RestoreJob): Promise<void> => {
  if (job.retiring) return job.retiring;
  let resolve!: () => void, reject!: (error: unknown) => void;
  job.retiring = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); job.stopped = true;
  let work: Promise<void>;
  try { work = loaded ? loaded.restore.close(job.owner) : library ? library.then(actual => actual.restore.close(job.owner)) : Promise.resolve(); }
  catch (error) { work = Promise.reject(error); }
  void work.then(() => { job.retired = true; releaseRestore(job); resolve(); }, (error: unknown) => {
   job.failed = true; job.failure = error; QUARANTINE.add({ job, library }); reject(error);
  }); return job.retiring;
 };
 const closeRestore = (job: RestoreJob): Promise<void> => {
  if (job.closing) return job.closing;
  let resolve!: () => void, reject!: (error: unknown) => void;
  job.closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); job.stopped = true;
  const physical = retireRestore(job); void physical.catch(() => undefined);
  void Promise.allSettled([...job.active]).then(async () => { await physical; releaseRestore(job); }).then(resolve, reject); return job.closing;
 };
 const restoreData = <Value>(job: RestoreJob, run: () => Promise<Value>, admitted: () => boolean,
  finish?: (value: Value) => Promise<Value>): Promise<Value> => {
  let resolve!: (value: Value) => void, reject!: (error: unknown) => void;
  const work = new Promise<Value>((yes, no) => { resolve = yes; reject = no; }); job.active.add(work);
  let actual: Promise<Value>; try { actual = run(); } catch (error) { actual = Promise.reject(error); }
  void actual.then(value => finish ? finish(value) : value, async (primary: unknown) => {
   if (admitted()) try { await retireRestore(job); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native restore request and actual retirement failed.', { cause: cleanup }); }
   throw primary;
  }).then(value => { job.active.delete(work); releaseRestore(job); resolve(value); }, error => { job.active.delete(work); releaseRestore(job); reject(error); }); return work;
 };
	const closeSession = (document: Document): Promise<void> => {
		if (document.sessionClosing) return document.sessionClosing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		document.sessionClosing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		const failures: unknown[] = [];
		try { document.opening?.abort(); } catch (error) { failures.push(error); }
		try {
			const work = loaded ? loaded.service.close(document.owner) : library ? library.then(value => value.service.close(document.owner)) : Promise.resolve();
			void work.then(() => {
				document.openId = undefined;
				if (failures.length) reject(new AggregateError(failures, 'Native opening cancellation failed.')); else resolve();
			}, (error: unknown) => { if (failures.length) reject(new AggregateError([...failures, error], 'Native opening cancellation and close failed.')); else reject(error); });
		} catch (error) { reject(error); }
		return document.sessionClosing;
	};
	const closeDocument = (document: Document): Promise<void> => {
		if (document.closing) return document.closing;
  let resolve!: () => void, reject!: (error: unknown) => void;
  document.closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const work = [closeSession(document), ...(document.restore ? [closeRestore(document.restore)] : [])];
  void Promise.allSettled(work).then(results => {
   const errors = [...document.failures, ...results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])];
   if (errors.length) throw new AggregateError(errors, 'Native document retirement failed.');
  }).then(resolve, reject);
		void document.closing.then(() => {
			if (document.lossTimer) clearTimeout(document.lossTimer);
			if (!document.active) documents.delete(document.owner);
		}, options.reportError);
		return document.closing;
	};
	const revoke = (contents: Contents, exited = false): void => {
		const owner = ownership.revoke(contents) as object | null; if (!owner) return;
		const document = documents.get(owner); if (!document) return;
		document.active = false;
		for (const stop of [() => document.opening?.abort(), () => loaded?.service.stop(owner),
			() => { if (exited) document.local.confirmProcessExit(); else document.local.stop(); }, () => document.controller.abort()]) {
			try { stop(); } catch (error) { document.failures.push(error); }
		}
		void closeDocument(document).catch(() => undefined);
		// Navigation is not proof of consumer retirement. If the old realm no
		// longer answers, terminate its actual bound renderer and await the real
		// process-gone listener. This timer itself never resolves the barrier.
		if (exited) return;
		document.lossTimer = setTimeout(() => {
			if (!documents.has(owner) || contents.isDestroyed()) return;
			if (contents.getOSProcessId() !== document.osProcessId) { options.reportError(new Error('An unretired native document lost its bound renderer process.')); return; }
			contents.forcefullyCrashRenderer();
		}, 1000);
	};
	const reply = async (run: () => unknown | Promise<unknown>): Promise<unknown> => {
		try { return { schemaVersion: 1, ok: true, value: await run() }; }
		catch (error) { return { schemaVersion: 1, ok: false, error: failure(error) }; }
	};
	for (const channel of Object.values(CHANNELS)) options.handle(channel, (event, ...args) => {
		const document = ownerFor(event);
		return reply(async () => {
			if (args.length !== 1) throw new TypeError('Native Photo request requires exactly one packet.');
			if (channel === CHANNELS.open) {
				if (closing || restoring) throw new Error('Native Session opening is fenced by library close or restore.');
				const input = record(args[0], 'native Photo opening', ['name', 'openId']);
				const catalogName = name(field(input, 'name', 'native Photo opening'), 'native catalog name'), openId = field(input, 'openId', 'native Photo opening');
				if (typeof openId !== 'string' || !/^[a-f0-9]{64}$/u.test(openId)) throw new TypeError('Native Photo opening requires a local correlation ID.');
				const local = document.local.register(openId), opening = new AbortController(); document.opening = opening;
				const signal = AbortSignal.any([document.controller.signal, opening.signal]); document.openId = openId; document.sessionClosing = undefined;
				try { const actual = await getLibrary(); currentDocument(event, document); return await actual.service.open(document.owner, { name: catalogName, openId }, local, signal); }
				catch (error) {
					try { await local.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Native Photo admission and local retirement failed.', { cause: cleanup }); }
					if (document.openId === openId) document.openId = undefined; throw error;
				} finally { if (document.opening === opening) document.opening = undefined; }
			}
			if (channel === CHANNELS.close || channel === CHANNELS.stop) {
				const input = record(args[0], 'native Photo lifecycle', ['openId']), openId = field(input, 'openId', 'native Photo lifecycle');
				if (typeof openId !== 'string' || openId !== document.openId) throw new Error('Native Photo lifecycle belongs to another opening.');
				if (channel === CHANNELS.close) return await closeSession(document);
				document.opening?.abort(); loaded?.service.stop(document.owner, openId); document.local.stop(); return undefined;
			}
			if (!loaded) throw new Error('Native Photo Session has not opened.');
			// No await before actual service admission: the authenticated send
			// watermark and accepted data slot are consumed in this IPC turn.
			return await loaded.service.dispatch(channel, document.owner, args[0]);
		});
	});

 for (const channel of Object.values(RESTORE)) options.handle(channel, (event, ...args) => {
  const document = ownerFor(event);
  return reply(() => {
   if (args.length !== 1) throw new TypeError('Native restore requires exactly one packet.');
   if (channel === RESTORE.begin) {
    currentDocument(event, document); if (restoring) throw new Error('A native restore already owns the host.');
    if ([...documents.values()].some(value => value.openId !== undefined)) throw new Error('Retire the native Photo Session before restoring its library.');
    const job: RestoreJob = { document, owner: Object.freeze({}), active: new Set(), stopped: false, retired: false, failed: false };
    restoring = job; document.restore = job;
    return restoreData(job, async () => {
     const packet = restoreBegin(args[0]), actual = await getLibrary(); currentDocument(event, document);
     if (job.stopped) throw new Error('Native restore opening was retired.');
     const receipt = await actual.restore.begin(job.owner, packet); job.id = receipt.id; return receipt;
    }, () => true);
   }
   const job = document.restore;
   if (!job || restoring !== job) {
    if (channel === RESTORE.abort) { restoreAbort(args[0]); return undefined; }
    throw new Error('Native restore has no current document upload.');
   }
   if (channel === RESTORE.abort) {
    const packet = restoreAbort(args[0]); if (packet.id !== job.id) throw new Error('Native restore cleanup belongs to another upload.'); return closeRestore(job);
   }
   currentDocument(event, document);
   if (job.stopped || job.active.size) throw new Error('Native restore data capacity is busy or retired.');
   let admitted = false;
   if (channel === RESTORE.write) return restoreData(job, async () => {
    const packet = restoreWrite(args[0]);
    try {
     if (packet.id !== job.id) throw new Error('Native restore write belongs to another upload.'); admitted = true;
     const actual = await getLibrary(); currentDocument(event, document); if (job.stopped) throw new Error('Native restore was stopped.');
     return await actual.restore.write(job.owner, packet);
    } finally { packet.bytes.fill(0); }
   }, () => admitted);
   return restoreData(job, async () => {
    const packet = restoreCommit(args[0]); if (packet.id !== job.id) throw new Error('Native restore commit belongs to another upload.'); admitted = true;
    const actual = await getLibrary(); currentDocument(event, document); if (job.stopped) throw new Error('Native restore was stopped.');
    return await actual.restore.commit(job.owner, packet);
   }, () => admitted, async receipt => {
    try { await retireRestore(job); return receipt; }
    catch { return cleanupNotice(receipt); } // Native publication already acknowledged.
   });
  });
 });
	options.handle(CONTROL.completed, (event, ...args) => {
		const document = ownerFor(event); if (args.length !== 1) throw new TypeError('Native local completion requires one private packet.');
		return document.local.respond(args[0]);
	});
	return Object.freeze({
		activate(contents: Contents, processId: number, frameId: number): void {
			if (closing) throw new Error('Native Photo host is closing.');
			revoke(contents); const actual = ownership.activate({ webContents: contents, processId, frameId }), owner = actual.owner as object;
			const osProcessId = contents.getOSProcessId(); if (!Number.isSafeInteger(osProcessId) || osProcessId <= 0) throw new Error('Native document requires its actual renderer process.');
			processFor.set(contents, osProcessId);
			documents.set(owner, { owner, contents, processId, osProcessId, local: new Retirement(value => { contents.send(CONTROL.requested, value); }),
				controller: new AbortController(), failures: [], active: true });
		}, revoke: (contents: Contents): void => { revoke(contents); },
		/** Called directly by the actual Electron render-process-gone event. */
		processGone(contents: Contents): Promise<void> {
			const exited = processFor.get(contents); revoke(contents, true);
			const held = [...documents.values()].filter(document => document.contents === contents && document.osProcessId === exited);
			for (const document of held) { document.local.confirmProcessExit(); if (document.lossTimer) clearTimeout(document.lossTimer); }
			return Promise.all(held.map(closeDocument)).then(() => undefined);
		},
		close(): Promise<void> {
			if (closing) return closing;
			let resolve!: () => void, reject!: (error: unknown) => void;
			closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
			const pendingRestore = restoring ? closeRestore(restoring) : undefined; void pendingRestore?.catch(() => undefined);
			const errors: unknown[] = [];
			for (const document of documents.values()) for (const stop of [() => document.opening?.abort(), () => loaded?.service.stop(document.owner),
				() => document.local.stop(), () => document.controller.abort()]) { try { stop(); } catch (error) { errors.push(error); } }
			void Promise.resolve().then(async () => {
				if (library) {
					const actual = await library;
     const retired = await Promise.allSettled([actual.service.closeAll(), actual.restore.closeAll(), ...(pendingRestore ? [pendingRestore] : [])]);
     const failures = retired.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []); errors.push(...failures);
     if (failures.length) QUARANTINE.add(actual);
     else try { await actual.scopes.close(); } catch (error) { QUARANTINE.add(actual); errors.push(error); }
				}
				if (errors.length) throw new AggregateError(errors, 'Native Photo application retirement failed.');
				for (const document of documents.values()) if (document.lossTimer) clearTimeout(document.lossTimer);
				// Keep the authenticated document's cleanup lane until its actual
				// teardown: public outer Close may join this manager-driven close.
			}).then(resolve, reject); return closing;
		},
	});
}

function cleanupNotice(receipt: Readonly<PhotoLibraryRestoreReceiptV1>): Readonly<PhotoLibraryRestoreReceiptV1> {
	return receipt.notices.includes('cleanup-failed') ? receipt : Object.freeze({ ...receipt, notices: Object.freeze([...receipt.notices, 'cleanup-failed' as const]) });
}
