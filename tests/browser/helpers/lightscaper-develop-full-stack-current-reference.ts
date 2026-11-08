/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { withDecodedRawOriginalV1 } from '../../../src/common/editor/raw/libraw-runtime-v1.ts';
import { withDecodedRawRecoveryFrameV2 } from '../../../src/common/editor/raw/libraw-runtime-v2.ts';
import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { normalizeImageDevelopStateV4 } from '../../../src/common/editor/imaging/image-develop-state-v4.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PixelFrameV1 } from '../../../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { LinearWorkingPixelFrameV1 } from '../../../src/common/editor/imaging/image-develop-linear-frame-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { rawDngFixtureV1 } from '../../helpers/lightscaper-raw-dng-current-fixture.ts';
import { rawRecoveryDngFixtureV1 } from '../../helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { fullStackSceneCurrentV1, fullStackAlternativesCurrentV1, fullStackGateCurrentV1, fullStackRetiredCurrentV1 as retired,
	type FullStackModeCurrentV1, type FullStackFaultCurrentV1 } from './lightscaper-develop-full-stack-scene-current.ts';
import { observeFullStackGpuCurrentV1, compareFullStackCurrentV1 } from './lightscaper-develop-full-stack-observer-current.ts';

const hash = (view: ArrayBufferView<ArrayBuffer>) => bytesToHex(sha256(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)));
const outcome = <T>(promise: Promise<T>) => promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
type Comparison = ReturnType<typeof compareFullStackCurrentV1>;
type Delivery = { backend: string; reason: string | null; comparison: Comparison; exactComparison: Comparison; attemptedComparison: Comparison | null;
	overlayMatches: boolean; overlayNonconstant: boolean; actualReadback: boolean; handlesAtDelivery: number; resourcesAtDelivery: number;
	width: number; height: number; outputSha256: string };
const differs = (left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>) => {
	const a = new Uint32Array(left.buffer), b = new Uint32Array(right.buffer); let count = 0;
	for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) count++;
	return count;
};

/** Actual pinned LibRaw worker -> full saved Current4 -> independent CPU
 * reference -> real GPU broker. The CPU reference never feeds GPU input. */
export async function runFullStackCurrentV1(mode: FullStackModeCurrentV1, fault: FullStackFaultCurrentV1 = 'none', colorControl = false) {
	const stop = new AbortController(), entered = fullStackGateCurrentV1(), release = fullStackGateCurrentV1();
	const reason = Symbol('full-stack cancellation'), timeout = new Error('Full-stack active 15s deadline exceeded.');
	const input = mode === 'canonical' ? rawDngFixtureV1(6) : rawRecoveryDngFixtureV1({ orientation: 6, variant: 'color-canary' });
	const encodedBefore = hash(input.bytes), scene = await fullStackSceneCurrentV1(mode, colorControl);
	// Deadline releases both actual owned gates, cancels native work, and joins it.
	const timer = setTimeout(() => { stop.abort(timeout); release.resolve(); scene.release.resolve(); }, 15_000);
	let sourceBacking: ArrayBuffer | undefined, outputBacking: ArrayBuffer | undefined, overlayBacking: ArrayBuffer | undefined;
	let cpuBacking: ArrayBuffer | undefined, sourceUnchanged = false, recipeUnchanged = false, callbacks = 0;
	let pendingAtCancel = false, heldOutputLive = false, rawFlip = -1, exposureScale: number | null = null;
	let delivery: Delivery | null = null;
	const alternatives: Record<string, number> = {};
	let observation: ReturnType<ReturnType<typeof observeFullStackGpuCurrentV1>['read']> | null = null;
	// Explicit readers preserve the declared unions across actual callback writes.
	const readDelivery = (): Delivery | null => delivery;
	const readObservation = (): ReturnType<ReturnType<typeof observeFullStackGpuCurrentV1>['read']> | null => observation;
	const render = async (frame: Readonly<PixelFrameV1>) => {
		if (!(frame.pixels.buffer instanceof ArrayBuffer)) throw new TypeError('RAW source requires private native pixels.');
		sourceBacking = frame.pixels.buffer;
		const sourceHash = hash(frame.pixels), recipeText = JSON.stringify(scene.recipe), request = { frame, develop: scene.recipe, maskOverlay: scene.selection, signal: stop.signal };
		let expected: Float32Array<ArrayBuffer> | undefined, expectedOverlay: Uint8Array<ArrayBuffer> | undefined;
		try {
			await withImageDevelopLinearCurrentV1(request, (output, overlay) => {
				cpuBacking = output.pixels.buffer; expected = output.pixels.slice(); expectedOverlay = overlay?.coverage.slice();
			}, PROFILE, scene.options);
			if (!expected) throw new Error('Independent whole CPU oracle did not deliver.');
			if (mode === 'canonical' && fault === 'none') for (const [name, develop] of Object.entries(fullStackAlternativesCurrentV1(scene.recipe))) {
				const normative = expected;
				alternatives[name] = await withImageDevelopLinearCurrentV1({ frame, develop, signal: stop.signal }, output => differs(normative, output.pixels), PROFILE, scene.options);
			}
			scene.setFault(fault);
			const native = observeFullStackGpuCurrentV1(expected.length);
			try {
				let settled = false;
				const work = outcome(withImageDevelopGpuCurrentV1(request, async (output, execution, overlay) => {
					callbacks++; outputBacking = output.pixels.buffer; overlayBacking = overlay?.coverage.buffer;
					const normative = expected!;
					const coverage = overlay?.coverage;
					delivery = { backend: execution.backend, reason: execution.reason ?? null, comparison: compareFullStackCurrentV1(normative, output.pixels),
						exactComparison: compareFullStackCurrentV1(normative, output.pixels, true),
						overlayMatches: coverage !== undefined && expectedOverlay !== undefined && coverage.length === expectedOverlay.length && coverage.every((byte, at) => byte === expectedOverlay![at]),
						overlayNonconstant: coverage !== undefined && coverage.some(byte => byte > 0) && coverage.some(byte => byte < 255),
						attemptedComparison: native.compareFinal(normative), actualReadback: native.isReadback(output.pixels.buffer), handlesAtDelivery: native.read().alive, resourcesAtDelivery: scene.read().active,
						width: output.descriptor.width, height: output.descriptor.height, outputSha256: hash(output.pixels) };
					if (fault === 'held-consumer-abort') { entered.resolve(); await release.promise; }
				}, PROFILE, scene.options));
				void work.then(() => { settled = true; });
				try {
					if (fault === 'held-consumer-abort' || fault === 'held-resource-abort') {
						const reached = fault === 'held-consumer-abort' ? entered.promise : scene.entered.promise;
						await Promise.race([reached, work.then(result => { if (!result.ok) throw result.error; throw new Error('Combined work settled before its held native borrow.'); })]);
						stop.abort(reason); await Promise.resolve(); await Promise.resolve();
						pendingAtCancel = !settled;
						heldOutputLive = outputBacking !== undefined && !retired(outputBacking);
						release.resolve(); scene.release.resolve();
					}
					const result = await work;
					if (!result.ok) throw result.error;
				} finally { release.resolve(); scene.release.resolve(); await work; }
			} finally { observation = native.read(); native.close(); }
		} finally {
			sourceUnchanged = hash(frame.pixels) === sourceHash; recipeUnchanged = JSON.stringify(scene.recipe) === recipeText;
			expected?.fill(0); expectedOverlay?.fill(0);
		}
	};
	let result: Awaited<ReturnType<typeof outcome<void>>>;
	try {
		result = await outcome(mode === 'canonical'
			? withDecodedRawOriginalV1({ bytes: input.bytes, signal: stop.signal }, async view => { rawFlip = view.rawFlip; await render(view.frame); })
			: withDecodedRawRecoveryFrameV2({ bytes: input.bytes, profile: mode === 'headroom' ? 'linear-headroom-v1' : 'highlight-recovery-v1', signal: stop.signal },
				async view => { rawFlip = view.rawFlip; exposureScale = view.exposureScale; await render(view.frame); }));
		if (!result.ok && Object.is(result.error, timeout)) throw timeout;
		if (!result.ok && fault === 'none') throw result.error;
		return { mode, fault, rawFlip, exposureScale, callbacks, delivery: readDelivery(), alternatives, observation: readObservation(),
			rejected: !result.ok, exactReason: !result.ok && Object.is(result.error, reason),
			sourceUnchanged, recipeUnchanged, encodedUnchanged: hash(input.bytes) === encodedBefore,
			pendingAtCancel, heldOutputLive, resources: scene.read(), sourceRetired: sourceBacking !== undefined && retired(sourceBacking),
			cpuRetired: cpuBacking !== undefined && retired(cpuBacking), outputRetired: outputBacking === undefined || retired(outputBacking),
			overlayRetired: overlayBacking === undefined || retired(overlayBacking) };
	} finally {
		clearTimeout(timer); release.resolve(); scene.release.resolve();
		scene.close(); input.bytes.fill(0); input.sensor.fill(0);
	}
}

/** Current4 canonical scene at the maintained repair underflow boundary.
 * Tone, partial mask and final flip must all run in the ONE whole CPU fallback. */
export async function runFullStackFallbackCurrentV1() {
	const width = 7, height = 3, pixels = new Float32Array(width * height * 4), alpha = 2 ** -126;
	for (let at = 3; at < pixels.length; at += 4) pixels[at] = alpha;
	pixels.set([2 ** 126, 2 ** 125, -(2 ** 126), alpha], (width + 1) * 4);
	const frame = { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'float32' as const, transfer: 'linear' as const, primaries: 'srgb' as const }, pixels };
	const develop = normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV2(), processVersion: 4, rawDevelopment: { schemaVersion: 1, mode: 'canonical' },
		repairs: { schemaVersion: 1, spots: [{ id: 'heal', mode: 'heal', enabled: true, target: { x: 5.5 / 7, y: .5 }, source: { x: 1.5 / 7, y: .5 }, radius: .1, feather: 0, opacity: 1 }] },
		effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } }, { id: 'flip', type: 'develop-geometry-v1', enabled: true, params: { flipHorizontal: 1 } }],
		masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [{ id: 'ramp', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'ramp' }],
		maskBindings: [{ maskId: 'mask', effectId: 'tone' }] });
	const stop = new AbortController(), timer = setTimeout(() => { stop.abort(new Error('Fallback active 15s deadline exceeded.')); }, 15_000);
	let expected: Float32Array<ArrayBuffer> | undefined, expectedOverlay: Uint8Array<ArrayBuffer> | undefined, outputBacking: ArrayBuffer | undefined;
	let calls = 0;
	try {
		const request = { frame, develop, maskOverlay: { maskId: 'mask', effectId: 'tone' }, signal: stop.signal };
		await withImageDevelopLinearCurrentV1(request, (view, overlay) => { expected = view.pixels.slice(); expectedOverlay = overlay?.coverage.slice(); }, PROFILE);
		const native = observeFullStackGpuCurrentV1();
		try {
			const delivery = await withImageDevelopGpuCurrentV1(request, (view: Readonly<LinearWorkingPixelFrameV1>, execution, overlay) => {
				calls++; outputBacking = view.pixels.buffer;
				return { ...execution, comparison: compareFullStackCurrentV1(expected!, view.pixels, true), actualReadback: native.isReadback(view.pixels.buffer),
					handlesAtDelivery: native.read().alive, overlayMatches: overlay !== undefined && expectedOverlay !== undefined && overlay.coverage.every((byte, at) => byte === expectedOverlay![at]) };
			}, PROFILE);
			return { delivery, calls, observation: native.read(), outputRetired: outputBacking !== undefined && retired(outputBacking) };
		} finally { native.close(); }
	} finally { clearTimeout(timer); expected?.fill(0); expectedOverlay?.fill(0); pixels.fill(0); }
}
