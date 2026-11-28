/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	TracktionClipPage, TracktionEditResult, TracktionProjectPage,
} from '../../src/soundscaper/tracktion-project-contract.ts';

interface WorkerReply<Value = unknown> {
	readonly id: number;
	readonly error?: string;
	readonly detail?: string;
	readonly output?: ArrayBuffer;
	readonly value?: Value;
}

/** Drive the reusable command worker from the same isolated origin as the editor. */
export async function verifyWorkerCommands(): Promise<void> {
	let id = 0;
	const pending = new Map<number, (reply: WorkerReply) => void>();
	let fail: ((error: Error) => void) | undefined;
	let timer: number | undefined;
	const deadline = new Promise<never>((_, reject) => {
		fail = reject;
		timer = window.setTimeout(() => reject(new Error(`Tracktion WASM command ${String(id)} timed out.`)), 50_000);
	});
	function startWorker() {
		const worker = new Worker('/tracktion-project-worker.js');
		worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
			const resolve = pending.get(data.id);
			if (!resolve) return;
			pending.delete(data.id);
			resolve(data);
		};
		worker.onerror = (event) => fail?.(new Error(event.message));
		return worker;
	}
	let engine = startWorker();
	function send(request: Readonly<Record<string, unknown>>, input?: ArrayBuffer, worker = engine): Promise<WorkerReply> {
		const next = ++id;
		return new Promise((resolve) => {
			pending.set(next, resolve);
			worker.postMessage({ id: next, request, input }, input ? [input] : []);
		});
	}
	async function command<Value = unknown>(
		request: Readonly<Record<string, unknown>>, input?: ArrayBuffer, worker = engine,
	): Promise<WorkerReply<Value> & Readonly<{ value: Value }>> {
		const response = await send(request, input, worker);
		if (response.error) throw new Error(JSON.stringify(response));
		return response as WorkerReply<Value> & Readonly<{ value: Value }>;
	}
	function assert(condition: unknown, detail: string): asserts condition {
		if (!condition) throw new Error(detail);
	}
	const project = crypto.randomUUID().replaceAll('-', '');
	const asset = crypto.randomUUID().replaceAll('-', '');
	try {
		await Promise.race([deadline, (async () => {
			const { value: opened } = await command<TracktionProjectPage>({ kind: 'create', project, sampleRate: 48_000 });
			const oversized = await send({ kind: 'project', offset: 2 ** 32 });
			assert(oversized.error === 'request', 'A project offset wrapped around on wasm32.');
			const { value: track } = await command<TracktionEditResult>({ kind: 'addTrack', revision: opened.revision, name: 'Worker WAV' });
			const rejected = await send({ kind: 'undo', revision: opened.revision });
			assert(rejected.error === 'request', 'The WASM worker accepted an obsolete edit revision.');
			const wave = new ArrayBuffer(44 + 2 * 4096);
			const bytes = new DataView(wave);
			const label = (offset: number, value: string) => {
				[...value].forEach((character, index) => { bytes.setUint8(offset + index, character.charCodeAt(0)); });
			};
			label(0, 'RIFF');
			bytes.setUint32(4, wave.byteLength - 8, true);
			label(8, 'WAVEfmt ');
			bytes.setUint32(16, 16, true);
			bytes.setUint16(20, 1, true);
			bytes.setUint16(22, 1, true);
			bytes.setUint32(24, 48_000, true);
			bytes.setUint32(28, 96_000, true);
			bytes.setUint16(32, 2, true);
			bytes.setUint16(34, 16, true);
			label(36, 'data');
			bytes.setUint32(40, wave.byteLength - 44, true);
			for (let i = 44; i < wave.byteLength; i += 2) bytes.setInt16(i, 8192, true);
			const { value: clip } = await command<TracktionEditResult>({
				kind: 'importFile', name: 'Tone', revision: track.revision, trackId: track.itemId, asset, start: 0,
			}, wave);
			const { value: trimmed } = await command<TracktionEditResult>({ kind: 'trim', revision: clip.revision, clipId: clip.itemId, start: 64, end: 1024 });
			const { value: undone } = await command<TracktionEditResult>({ kind: 'undo', revision: trimmed.revision });
			const { value: redone } = await command<TracktionEditResult>({ kind: 'redo', revision: undone.revision });
			await command({ kind: 'save', revision: redone.revision });
			const concurrent = startWorker();
			try {
				const { value: stale } = await command<TracktionProjectPage>({ kind: 'open', project }, undefined, concurrent);
				const { value: added } = await command<TracktionEditResult>({ kind: 'addTrack', revision: redone.revision, name: 'Second track' });
				await command({ kind: 'save', revision: added.revision });
				const collision = await send({ kind: 'save', revision: stale.revision }, undefined, concurrent);
				assert(collision.detail?.includes('Another browser tab'), 'A stale worker overwrote a published project.');
				await command({ kind: 'close' }, undefined, concurrent);
			} finally {
				concurrent.terminate();
			}
			await command({ kind: 'close' });
			engine.terminate();
			engine = startWorker();
			const { value: reopened } = await command<TracktionProjectPage>({ kind: 'open', project });
			assert(reopened.tracks.some((track) => track.name === 'Second track'), 'The latest publication was lost on restart.');
			const { value: listing } = await command<TracktionClipPage>({ kind: 'clips', revision: reopened.revision, trackId: track.itemId, offset: 0 });
			assert(listing.clips[0].start === 64 && listing.clips[0].end === 1024, 'The edited WAV geometry did not survive reopening.');
			const { output } = await command({ kind: 'render', revision: reopened.revision, start: 64, end: 1024, asset });
			assert(output instanceof ArrayBuffer && output.byteLength > 960 * 2, 'Tracktion did not return the rendered stereo WAV.');
			assert(new DataView(output).getUint32(0) === 0x52494646, 'The returned audio is missing the RIFF container.');
			await command({ kind: 'close' });
		})()]);
	} finally {
		window.clearTimeout(timer);
		engine.terminate();
	}
}
