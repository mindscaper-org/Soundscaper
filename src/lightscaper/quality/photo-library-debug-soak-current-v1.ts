/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoLibrarySessionPortCurrentV1 as Session } from '../../common/editor/photo-library-session-port-current-v1.ts';
import type { PhotoLibraryDevelopSnapshotCurrentV1 as Snapshot } from '../../common/editor/photo-library-develop-port-current-v1.ts';
import { normalizeImageDevelopStateThroughV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import { createVideoEffect } from '../../common/editor/video-effects.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { exportDebugPhotoCurrentV1 } from './photo-library-debug-export-current-v1.ts';
import { bindDebugMethodCurrentV1 as bind, captureDebugFilesCurrentV1 as captureFiles, debugCheckCurrentV1 as check, debugCleanupFailureCurrentV1 as cleanupFailure,
	debugMemoryCurrentV1, type DebugSoakOptionsCurrentV1, type DebugSoakReportCurrentV1,
	type DebugPhaseCurrentV1, type DebugPhaseReceiptCurrentV1, type DebugOutputCurrentV1, type DebugOwnersCurrentV1 } from './photo-library-debug-soak-contract-current-v1.ts';
import { hashDebugBlobCurrentV1 as hashBody } from './photo-library-debug-bytes-current-v1.ts';
export type { DebugSoakOptionsCurrentV1, DebugSoakReportCurrentV1 } from './photo-library-debug-soak-contract-current-v1.ts';
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
const NAME = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!, TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!;
const now = (): number => performance.now();
interface OwnedSession { readonly session: Session; readonly close: () => Promise<void> }
/** Finite opt-in diagnostic using complete actual Current Sessions. This is a
 * real-library mutation: diagnostic imports and reversible history remain. */
export async function runPhotoLibraryDebugSoakCurrentV1(value: DebugSoakOptionsCurrentV1): Promise<Readonly<DebugSoakReportCurrentV1>> {
	if (!value || typeof value !== 'object') throw new TypeError('Diagnostic options are required.');
	const earlyRounds = Object.getOwnPropertyDescriptor(value, 'iterations');
	if (earlyRounds && Object.hasOwn(earlyRounds, 'value') && (typeof earlyRounds.value !== 'number' || !Number.isSafeInteger(earlyRounds.value) || earlyRounds.value < 1 || earlyRounds.value > 100)) throw new RangeError('Diagnostic rounds must be between 1 and 100.');
	const input = record(value, 'Library debug soak', ['files', 'iterations', 'createSession', 'signal', 'storage', 'onPhase'], ['files', 'createSession']);
	const rounds: unknown = Object.hasOwn(input, 'iterations') ? field(input, 'iterations', 'Diagnostic rounds') : 3;
	if (typeof rounds !== 'number') throw new RangeError('Diagnostic rounds require a bounded integer.');
	const files = captureFiles(field(input, 'files', 'Diagnostic files') as readonly File[], rounds);
	const signalValue: unknown = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'Diagnostic cancellation') : undefined;
	if (signalValue !== undefined && !(signalValue instanceof AbortSignal)) throw new TypeError('Diagnostic requires native cancellation.');
	const signal = signalValue ?? new AbortController().signal; check(signal);
	const createValue: unknown = field(input, 'createSession', 'Complete Current Session factory'); if (typeof createValue !== 'function') throw new TypeError('Diagnostic requires the complete Current Session factory.');
	const create = bind(createValue as DebugSoakOptionsCurrentV1['createSession'], value);
	const observer: unknown = Object.hasOwn(input, 'onPhase') ? field(input, 'onPhase', 'Diagnostic observation') : undefined;
	if (observer !== undefined && typeof observer !== 'function') throw new TypeError('Diagnostic observer must be callable.');
	const storage = (Object.hasOwn(input, 'storage') ? field(input, 'storage', 'Private output storage') : globalThis.navigator?.storage) as DebugSoakOptionsCurrentV1['storage'];
	const owners: DebugOwnersCurrentV1 = { sessionsOpened: 0, sessionsClosed: 0, maximumLiveSessions: 0, activeSessions: 0, activeExports: 0, joined: false };
	const phases: Readonly<DebugPhaseReceiptCurrentV1>[] = [], originals: { photoId: string; sha256: string; byteLength: number }[] = [], outputs: Readonly<DebugOutputCurrentV1>[] = [];
	const sourceHashes: Awaited<ReturnType<typeof hashBody>>[] = []; for (const file of files) sourceHashes.push(await hashBody(file, signal));
	let owned: OwnedSession | undefined, importedPhotos = 0, failed = false, primary: unknown;
	const open = async (): Promise<Session> => {
		check(signal); const session = await create();
		owners.sessionsOpened++; owners.activeSessions++; owners.maximumLiveSessions = Math.max(owners.maximumLiveSessions, owners.activeSessions);
		let closing: Promise<void> | undefined; const close = bind(session.close, session);
		owned = { session, close: () => { closing ??= close(); return closing; } };
		check(signal); return session;
	};
	const close = async (): Promise<void> => {
		const current = owned; if (!current) return;
		try { await current.close(); } catch (error) { throw cleanupFailure([], error, current); }
		if (owned === current) owned = undefined; owners.sessionsClosed++; owners.activeSessions--;
	};
	const onAbort = (): void => { if (owned) void owned.close().catch(() => undefined); };
	Reflect.apply(ADD, signal, ['abort', onAbort, { once: true }]);
	const phase = async <Result>(iteration: number, name: DebugPhaseCurrentV1, count: number, work: () => Promise<Result>): Promise<Result> => {
		check(signal); const start = now();
		if (observer) { try { Reflect.apply(observer, value, [Object.freeze({ iteration, phase: name, elapsedMilliseconds: 0, count, memory: debugMemoryCurrentV1(), owners: Object.freeze({ activeSessions: owners.activeSessions, activeExports: owners.activeExports }) })]); } catch { /* Observers cannot veto acknowledged native operations. */ } }
		const result = await work(); phases.push(Object.freeze({ iteration, phase: name, elapsedMilliseconds: Math.max(0, now() - start), count, memory: debugMemoryCurrentV1(), owners: Object.freeze({ activeSessions: owners.activeSessions, activeExports: owners.activeExports }) })); return result;
	};
	try {
		for (let iteration = 1; iteration <= rounds; iteration++) {
			const session = await open(), tag = `diagnostic-${crypto.randomUUID().slice(0, 8)}-${iteration}`;
			const corpus = files.map((file, index) => new File([file], `${tag}-${index}-${String(Reflect.apply(NAME, file, [])).slice(-80)}`, { type: String(Reflect.apply(TYPE, file, [])) }));
			const items = await phase(iteration, 'import', files.length, () => session.importFiles(corpus, { signal }));
			if (items.length !== files.length || items.some((item, at) => item.status !== 'imported' || item.photoId === null || item.index !== at)) throw new Error('Diagnostic corpus was not completely imported.');
			const ids = items.map(item => { if (!item.photoId) throw new Error('Diagnostic import lacks Photo identity.'); return item.photoId; }); importedPhotos += ids.length;
			await phase(iteration, 'browse', ids.length, async () => { const page = await session.readPage({ signal }); if (page.totalCount < ids.length || !page.rows.length) throw new Error('Diagnostic browse did not observe the real library.'); });
			await phase(iteration, 'search', ids.length, async () => {
				const found = new Set<string>(); let cursor: string | null = null, steps = 0;
				do { check(signal); if (++steps > 256) throw new RangeError('Diagnostic search exceeds 256 bounded query pages.');
					const page = await session.readQueryStep({ query: { text: tag, filter: null, sort: { field: 'photo-id', direction: 'ascending' } }, cursor, signal });
					for (const row of page.rows) found.add(row.id); cursor = page.cursor;
				} while (cursor !== null);
				if (ids.some(id => !found.has(id))) throw new Error('Diagnostic query did not find every imported Photo.');
			});
			const baselines: Snapshot[] = [], edited: Snapshot[] = [];
			for (let at = 0; at < ids.length; at++) {
				const snapshot = await session.develop.read({ schemaVersion: 3, photoId: ids[at]! }, { signal }); baselines.push(snapshot);
				const actual = await original(session, snapshot, signal), expected = sourceHashes[at]!;
				if (actual.sha256 !== expected.sha256 || actual.byteLength !== expected.byteLength) throw new Error('Diagnostic imported Original differs from the selected File.');
				originals.push({ photoId: snapshot.photoId, ...actual });
			}
			await phase(iteration, 'save', ids.length, async () => { for (const baseline of baselines) {
				const develop = normalizeImageDevelopStateThroughV4({ ...baseline.develop, effects: [...baseline.develop.effects, createVideoEffect('tone-ladder-v1', { id: crypto.randomUUID(), params: { exposure: -.25 } })] });
				const ack = await session.develop.apply({ schemaVersion: 3, photoId: baseline.photoId, expectedRevision: baseline.revision,
					command: { type: 'record-develop', versionId: baseline.versionId, develop, label: 'Library diagnostic reversible exposure', createdAt: new Date().toISOString() } }, { signal });
				if (JSON.stringify(ack.snapshot.develop) !== JSON.stringify(develop) || ack.snapshot.revision <= baseline.revision) throw new Error('Diagnostic saved Develop acknowledgment differs.'); edited.push(ack.snapshot);
			} });
			await phase(iteration, 'export', ids.length, async () => { for (const snapshot of edited) outputs.push(await exportDebugPhotoCurrentV1(session, snapshot, iteration, signal, storage, owners)); });
			await phase(iteration, 'restore', ids.length, async () => { for (let at = 0; at < baselines.length; at++) {
				const baseline = baselines[at]!, saved = edited[at]!;
				const ack = await session.develop.apply({ schemaVersion: 3, photoId: baseline.photoId, expectedRevision: saved.revision,
					command: { type: 'select-develop-history', versionId: baseline.versionId, cursor: baseline.history.cursor } }, { signal });
				if (JSON.stringify(ack.snapshot.develop) !== JSON.stringify(baseline.develop)) throw new Error('Diagnostic Develop history did not restore the original recipe.');
			} });
			await phase(iteration, 'close', 1, close);
			await phase(iteration, 'reopen', ids.length, async () => {
				const reopened = await open();
				for (let at = 0; at < ids.length; at++) {
					const baseline = baselines[at]!, snapshot = await reopened.develop.read({ schemaVersion: 3, photoId: baseline.photoId, versionId: baseline.versionId }, { signal });
					if (JSON.stringify(snapshot.develop) !== JSON.stringify(baseline.develop)) throw new Error('Diagnostic saved recipe changed after actual close/reopen.');
					const actual = await original(reopened, snapshot, signal), expected = sourceHashes[at]!;
					if (actual.sha256 !== expected.sha256 || actual.byteLength !== expected.byteLength) throw new Error('Diagnostic Original changed after actual close/reopen.');
				}
				await close();
			});
		}
		check(signal);
	} catch (error) { failed = true; primary = error; }
	try { await close(); } catch (cleanup) { throw cleanupFailure(failed ? [primary] : [], cleanup, { owned, owners }); }
	Reflect.apply(REMOVE, signal, ['abort', onAbort]); if (failed) throw primary;
	owners.joined = true;
	return Object.freeze({ schemaVersion: 1, kind: 'photo-library-debug-soak', iterations: rounds, importedPhotos, phases: Object.freeze(phases),
		originals: Object.freeze(originals.map(item => Object.freeze(item))), outputs: Object.freeze(outputs), owners: Object.freeze({ ...owners }), memory: debugMemoryCurrentV1() });
}
async function original(session: Session, snapshot: Snapshot, signal: AbortSignal): Promise<Readonly<{ sha256: string; byteLength: number }>> {
	const capture = session.imageHandoffCurrent; if (!capture) throw new Error('Complete Current handoff is required for diagnostic Original verification.');
	return capture.withCapture({ catalogId: snapshot.catalogId, photoId: snapshot.photoId, versionId: snapshot.versionId, expectedRevision: snapshot.revision }, async view => {
		if (view.original.width * view.original.height > 1_048_576) throw new RangeError('Diagnostic Original exceeds one megapixel.');
		const body = await hashBody(view.originalBlob, view.signal);
		if (body.sha256 !== view.original.contentSha256 || body.byteLength !== view.original.byteLength) throw new Error('Diagnostic Original differs from its complete Current authority.'); return body;
	}, { signal });
}
