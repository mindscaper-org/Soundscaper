/* SPDX-License-Identifier: AGPL-3.0-only */
import { installDesktopSpeedWarmupManifest } from './desktop-speed-warmup-fixture.js';
import { toneA, toneB } from '../audio-editor-test-fixtures.js';
import { SOUNDSCAPER_DATABASE_NAME } from './editor-databases.js';
const locatorIds = { initial: '1'.repeat(64), exact: '2'.repeat(64), declined: '3'.repeat(64), accepted: '4'.repeat(64) };

export async function clearSourceProvenance(page, projectId) {
	// Current imports carry attribution; this fixture models an older unattributed project.
	await page.evaluate(async ({ databaseName, id }) => {
		const open = indexedDB.open(databaseName);
		const database = await new Promise((resolve, reject) => {
			open.onsuccess = () => resolve(open.result);
			open.onerror = () => reject(open.error);
		});
		try {
			const transaction = database.transaction('projects', 'readwrite');
			const store = transaction.objectStore('projects');
			const read = store.get(id);
			const project = await new Promise((resolve, reject) => {
				read.onsuccess = () => resolve(read.result);
				read.onerror = () => reject(read.error);
			});
			if (!project?.sources?.some((source) => Object.hasOwn(source, 'provenance'))) {
				throw new Error('The linked import fixture did not carry source attribution.');
			}
			const sources = project.sources.map((source) => {
				const copy = { ...source };
				delete copy.provenance;
				return copy;
			});
			store.put({ ...project, sources });
			await new Promise((resolve, reject) => {
				transaction.oncomplete = resolve;
				transaction.onabort = () => reject(transaction.error);
				transaction.onerror = () => reject(transaction.error);
			});
		} finally {
			database.close();
		}
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, id: projectId });
}

export async function installLinkedAudioBridge(page, media = { original: toneA, changed: toneB }, { unavailable = false } = {}) {
	await page.route(/\/__e2e-project-bin-linked\/(original|changed)\.wav$/u, (route) => {
		const kind = /\/(original|changed)\.wav$/u.exec(route.request().url())?.[1];
		return route.fulfill({
			body: media[kind].buffer,
			contentType: media[kind].mimeType,
			headers: { 'Content-Length': String(media[kind].buffer.byteLength) },
		});
	});
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(({ fixtures, ids, unavailable }) => {
		const state = { next: 'initial', choices: [], released: [], rangeRequests: [], exports: [] };
		const writes = new Map();
		let nextWriteId = 0;
		const details = {
			initial: { kind: 'original', locatorId: ids.initial, locatorRevision: 'a'.repeat(64) },
			exact: { kind: 'original', locatorId: ids.exact, locatorRevision: 'b'.repeat(64) },
			declined: { kind: 'changed', locatorId: ids.declined, locatorRevision: 'c'.repeat(64) },
			accepted: { kind: 'changed', locatorId: ids.accepted, locatorRevision: 'd'.repeat(64) },
		};
		const byId = Object.values(details).reduce((entries, detail) => {
			entries[detail.locatorId] = detail;
			return entries;
		}, {});
		const bytes = Object.fromEntries(Object.entries(fixtures).map(([kind, fixture]) => [
			kind, Uint8Array.from(atob(fixture.base64), (character) => character.charCodeAt(0)),
		]));
		const nativeFetch = globalThis.fetch.bind(globalThis);
		globalThis.fetch = async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			const match = /\/linked-audio-range-v1\/([a-f\d]{64})\//u.exec(url);
			if (!match) return nativeFetch(input, init);
			const kind = match[1].endsWith('1') ? 'original' : 'changed';
			const header = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('Range');
			const interval = /^bytes=(\d+)-(\d+)$/u.exec(header ?? '');
			if (!interval) return new Response(null, { status: 416 });
			const start = Number(interval[1]);
			const end = Number(interval[2]);
			state.rangeRequests.push({ kind, start, end });
			const body = bytes[kind].slice(start, end + 1);
			return new Response(body, { status: 206, headers: {
				'Accept-Ranges': 'bytes',
				'Content-Length': String(body.byteLength),
				'Content-Range': `bytes ${start}-${end}/${bytes[kind].byteLength}`,
				'Content-Type': fixtures[kind].mimeType,
			} });
		};
		const bridge = Object.freeze({
			chooseLinkedAudioOriginal: async () => {
				const selected = state.next;
				state.choices.push(selected);
				if (selected === 'cancel') return null;
				const detail = details[selected];
				const fixture = fixtures[detail.kind];
				return {
					locatorId: detail.locatorId, locatorRevision: detail.locatorRevision,
					name: fixture.name, size: bytes[detail.kind].byteLength,
					mimeType: fixture.mimeType, lastModified: 123,
				};
			},
			loadLinkedAudioOriginal: async ({ locatorId, range }) => {
				if (unavailable) return null;
				const detail = byId[locatorId];
				if (!detail) return null;
				const fixture = fixtures[detail.kind];
				const descriptorId = `${range ? 'e' : 'f'}`.repeat(63) + (detail.kind === 'original' ? '1' : '2');
				return { locatorRevision: detail.locatorRevision, descriptor: {
					id: descriptorId,
					readProfile: range ? 'linked-audio-range-v1' : 'materialized-v1',
					url: range
						? `soundscaper-app://bundle/_desktop/read/linked-audio-range-v1/${descriptorId}/${encodeURIComponent(fixture.name)}`
						: `${location.origin}/__e2e-project-bin-linked/${detail.kind}.wav`,
					name: fixture.name, size: bytes[detail.kind].byteLength,
					mimeType: fixture.mimeType, lastModified: 123,
				} };
			},
			reconcileLinkedOriginals: async () => 0,
			releaseLinkedOriginal: async (reference) => { state.released.push(structuredClone(reference)); return true; },
			chooseLinkedVideoOriginal: async () => null,
			loadLinkedVideoOriginal: async () => null,
			reconcileLinkedVideoOriginals: async () => 0,
			releaseLinkedVideoOriginal: async () => true,
			releaseRead: async () => true,
			chooseSaveTarget: async ({ suggestedName }) => ({ id: 'linked-audio-export', name: suggestedName }),
			beginWrite: async () => {
				const writeId = `linked-audio-write-${++nextWriteId}`;
				writes.set(writeId, { chunks: [], length: 0, prefix: null });
				return { writeId, chunkSize: 1024 * 1024 };
			},
			writeChunk: async ({ writeId, offset, bytes }) => {
				const write = writes.get(writeId);
				if (!write || offset !== write.length) throw new Error('Linked audio export chunks were out of order.');
				write.chunks.push(Uint8Array.from(bytes));
				write.length += bytes.byteLength;
				return { nextOffset: write.length };
			},
			patchFinalPrefix: async ({ writeId, bytes }) => {
				const write = writes.get(writeId);
				if (!write) throw new Error('The linked audio export write is missing.');
				write.prefix = Uint8Array.from(bytes);
				return { byteLength: write.length };
			},
			finishWrite: async (writeId) => {
				const write = writes.get(writeId);
				if (!write) throw new Error('The linked audio export write is missing.');
				const result = new Uint8Array(write.length);
				let offset = 0;
				for (const chunk of write.chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
				if (write.prefix) result.set(write.prefix, 0);
				state.exports.push(result);
				writes.delete(writeId);
				return { byteLength: result.byteLength };
			},
			abortWrite: async (writeId) => { writes.delete(writeId); },
		});
		Object.defineProperty(globalThis, '__projectBinLinkedAudioFixture', { configurable: true, value: state });
		Object.defineProperty(globalThis, 'soundscaperDesktop', {
			configurable: true, enumerable: true, value: Object.freeze({ v1: bridge }),
		});
	}, {
		fixtures: Object.fromEntries(Object.entries(media).map(([kind, fixture]) => [kind, {
			name: fixture.name, mimeType: fixture.mimeType, base64: fixture.buffer.toString('base64'),
		}])),
		ids: locatorIds,
		unavailable,
	});
}
