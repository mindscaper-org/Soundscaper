/* SPDX-License-Identifier: AGPL-3.0-only */

import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { nativeGpuRepairSceneCurrentV1 } from './lightscaper-native-gpu-repair-current-reference.ts';

const words = (pixels: Float32Array<ArrayBuffer>) => [...new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length)];
const retired = (bytes: ArrayBuffer) => bytes.byteLength === 0 || new Uint8Array(bytes).every(value => value === 0);
const rank = (word: number) => word >= 0x80000000 ? 0x100000000 - word : 0x80000000 + word;
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

/** Real high broker and a separately completed real CPU render; neither path
 * replaces GL, capabilities, storage, source pixels or a production consumer. */
export async function runGpuHighBrokerFallbackCurrentV1(scene: 'mask' | 'clone' | 'heal', held: boolean) {
	const repair = scene === 'mask' ? null : nativeGpuRepairSceneCurrentV1(scene === 'clone' ? 'clone-alpha' : 'heal-forward');
	const width = repair?.width ?? 4, height = repair?.height ?? 1;
	const pixels = repair?.pixels ?? Float32Array.from([.125, .25, .5, 1, .25, .5, 1, .5, .5, 1, 2, 0, 1, 2, 4, .375]);
	const source = pixels.buffer, before = words(pixels);
	const frame = { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'float32' as const,
		primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
	const develop = { ...defaultImageDevelopStateV2(), ...(repair ? { processVersion: 3, repairs: { schemaVersion: 1, spots: repair.spots } } : {
		effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 1 } }],
		masks: [{ schemaVersion: 1, id: 'half', kind: 'mask', inputs: [], nodes: [{ id: 'a', kind: 'vector-shape', shape: 'rectangle',
			x: 0, y: 0, width: .5, height: 1 }], outputNodeId: 'a' }], maskBindings: [{ effectId: 'tone', maskId: 'half' }],
	}) };
	const request = { frame, develop };
	let oracle: ArrayBuffer | undefined, output: ArrayBuffer | undefined;
	let actual: number[] = [], callbacks = 0;
	let backend: 'cpu' | 'webgl2' | undefined, reason: string | null = null;
	let outputDedicated = false, outputLiveDuringDelivery = false, heldPending = false, exactPrimary = false;
	const entered = deferred(), release = deferred(), opaque = Object.freeze(Object.create(null) as object);
	try {
		const expected = await withImageDevelopLinearCurrentV1(request, value => { oracle = value.pixels.buffer; return words(value.pixels); }, PROFILE);
		let settled = false;
		const work = withImageDevelopGpuCurrentV1(request, async (value, execution) => {
			callbacks++; backend = execution.backend; reason = execution.reason ?? null; output = value.pixels.buffer;
			actual = words(value.pixels); outputDedicated = output !== source; outputLiveDuringDelivery = !retired(output);
			if (held) { entered.resolve(); await release.promise; throw opaque; }
		}, PROFILE);
		const outcome = work.then(() => { settled = true; return { failed: false as const }; }, (error: unknown) => {
			settled = true; return { failed: true as const, error };
		});
		if (held) {
			await Promise.race([entered.promise, outcome.then(value => { if (value.failed) throw value.error; throw new Error('Held broker omitted delivery.'); })]);
			heldPending = !settled && output !== undefined && !retired(output); release.resolve();
		}
		const result = await outcome;
		if (held) exactPrimary = result.failed && Object.is(result.error, opaque);
		else if (result.failed) throw result.error;
		if (!backend || output === undefined || oracle === undefined) throw new Error('Actual broker omitted its joined output.');
		const nativeMismatches: number[] = [];
		const expectedFloats = new Float32Array(Uint32Array.from(expected).buffer), actualFloats = new Float32Array(Uint32Array.from(actual).buffer);
		try {
			for (let at = 0; at < expected.length; at++) {
				if (actual[at] === expected[at]) continue;
				const sample = expectedFloats[at]!;
				if (expected[at] === before[at] || at % 4 === 3 || sample === 0 || Math.abs(sample) < 2 ** -60 || !Number.isFinite(actualFloats[at])
					|| Math.abs(rank(expected[at]!) - rank(actual[at]!)) > 8) nativeMismatches.push(at);
			}
		} finally { expectedFloats.fill(0); actualFloats.fill(0); }
		const sourceUnchanged = words(pixels).every((word, at) => word === before[at]);
		pixels.fill(0);
		return { backend, reason, before, expected, actual, callbacks, nativeMismatches, sourceUnchanged,
			outputDedicated, outputLiveDuringDelivery, heldPending, exactPrimary,
			oracleRetired: retired(oracle), outputRetired: retired(output), sourceRetired: retired(source) };
	} finally { release.resolve(); pixels.fill(0); }
}
