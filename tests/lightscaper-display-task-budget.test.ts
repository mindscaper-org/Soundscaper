/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PixelFrameDescriptorV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';

// Observe real native allocations at module capture, then restore the global.
// Both production owners retain their real constructors, physical backings and
// cleanup. No render, timer or byte result is supplied by this observer.
const allocations: Uint8Array<ArrayBuffer>[] = [], NativeBytes = globalThis.Uint8Array;
const displayApis = await (async () => {
	globalThis.Uint8Array = new Proxy(NativeBytes, { construct(target, args) {
		const bytes = Reflect.construct(target, args) as Uint8Array<ArrayBuffer>;
		if (typeof args[0] === 'number') allocations.push(bytes);
		return bytes;
	} });
	try {
		const permanent = await import('../src/common/editor/imaging/photo-develop-display-frame-v1.ts');
		const current = await import('../src/common/editor/imaging/photo-develop-display-frame-current-v1.ts');
		return [permanent.withPhotoDevelopDisplayFrameV1, current.withPhotoDevelopDisplayFrameCurrentV1] as const;
	} finally { globalThis.Uint8Array = NativeBytes; allocations.length = 0; }
})();
type ByteFrame = Readonly<{ descriptor: Readonly<PixelFrameDescriptorV1>; pixels: Uint8Array<ArrayBuffer> }>;
interface TimerWitness { scheduled: number; fired: number; delays: unknown[] }
const witness = (): TimerWitness => ({ scheduled: 0, fired: 0, delays: [] });

async function observeTimers<Result>(observed: TimerWitness, work: () => Promise<Result>, first?: () => void): Promise<Result> {
	const nativeTimer = globalThis.setTimeout;
	globalThis.setTimeout = new Proxy(nativeTimer, { apply(target, receiver, args) {
		const sequence = ++observed.scheduled, callback: unknown = args[0]; observed.delays.push(args[1]);
		assert.equal(typeof callback, 'function');
		const wrapped = function (this: unknown, ...values: unknown[]): void {
			observed.fired++; if (sequence === 1) first?.();
			void Reflect.apply(callback as (...args: unknown[]) => unknown, this, values);
		};
		return Reflect.apply(target, receiver, [wrapped, ...args.slice(1)]) as ReturnType<typeof setTimeout>;
	} });
	try { return await work(); } finally { globalThis.setTimeout = nativeTimer; }
}

function fixture(width = 512, height = 512, primaries: 'srgb' | 'display-p3' = 'srgb') {
	const pixels = new NativeBytes(width * height * 4), coverage = new NativeBytes(width * height);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const index = y * width + x, at = index * 4;
		pixels[at] = (x * 37 + y * 11 + 3) % 256; pixels[at + 1] = (x * 17 + y * 71 + 13) % 256;
		pixels[at + 2] = (x * 97 + y * 29 + 23) % 256; pixels[at + 3] = [0, 1, 127, 254, 255][index % 5]!;
		coverage[index] = (x * 13 + y * 61 + 7) % 256;
	}
	const frame: ByteFrame = { descriptor: { schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries, transfer: 'srgb' }, pixels };
	return { frame, observed: { maskId: 'mask', effectId: 'effect', width, height, coverage } };
}
function ownedSince(start: number): Uint8Array<ArrayBuffer>[] { return allocations.splice(start); }
function retired(planes: readonly Uint8Array<ArrayBuffer>[]): void {
	assert.ok(planes.length >= 2, 'the image copy and overlay both have real owned backings');
	assert.ok(planes.every(plane => plane.every(byte => byte === 0)), 'every owned backing is physically wiped');
}
function held() {
	let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; });
	return { promise, release };
}

test('one MiB display copies use at most four real zero-delay task yields in both fixed display owners', async () => {
	for (const display of displayApis) {
		const { frame } = fixture(), original = frame.pixels.slice(), timers = witness(), start = allocations.length;
		const actual = await observeTimers(timers, () => display({ frame }, view => view.frame.pixels.slice(), 'proxy'));
		assert.deepEqual(actual, original); assert.deepEqual(frame.pixels, original);
		assert.equal(timers.scheduled, 4, '256 KiB copy spans avoid nested-timer accumulation and still yield bounded real tasks');
		assert.equal(timers.fired, 4); assert.deepEqual(timers.delays, [0, 0, 0, 0]);
		const planes = ownedSince(start); assert.equal(planes.length, 1); assert.ok(planes[0]?.every(byte => byte === 0));
	}
});

test('both owners join true first-task opaque cancellation and wipe image plus overlay before refusing delivery', async () => {
	for (const display of displayApis) {
		const { frame, observed } = fixture(), source = frame.pixels.slice(), coverage = observed.coverage.slice();
		const stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
		const timers = witness(), start = allocations.length; let consumed = false;
		const work = observeTimers(timers, () => display({ frame, maskOverlay: observed, signal: stop.signal }, () => { consumed = true; }, 'proxy'),
			() => { stop.abort(reason.proxy); });
		const outcome = await work.then(() => ({ failed: false, reason: undefined as unknown }), error => ({ failed: true, reason: error as unknown }));
		assert.equal(outcome.failed, true); assert.ok(Object.is(outcome.reason, reason.proxy));
		assert.equal(timers.scheduled, 1); assert.equal(timers.fired, 1); assert.equal(consumed, false);
		retired(ownedSince(start)); assert.deepEqual(frame.pixels, source); assert.deepEqual(observed.coverage, coverage);
	}
});

test('Current first-task source or coverage detachment remains a refusal with both owned planes retired', async () => {
	for (const target of ['source', 'coverage'] as const) {
		const { frame, observed } = fixture(), input = target === 'source' ? frame.pixels : observed.coverage, original = input.slice();
		const timers = witness(), start = allocations.length; let consumed = false, transferred: ArrayBuffer | undefined;
		const work = observeTimers(timers, () => displayApis[1]({ frame, maskOverlay: observed }, () => { consumed = true; }, 'proxy'),
			() => { transferred = structuredClone(input.buffer, { transfer: [input.buffer] }); });
		await assert.rejects(work, /source detached/u);
		assert.equal(timers.fired, 1); assert.equal(consumed, false); assert.equal(input.byteLength, 0);
		assert.ok(transferred); assert.deepEqual(new NativeBytes(transferred), original); retired(ownedSince(start));
	}
});

test('display consumers remain joined through fulfillment, refusal and late opaque cancellation', async () => {
	for (const display of displayApis) for (const outcome of ['success', 'failure', 'cancel'] as const) {
		const { frame, observed } = fixture(3, 2), source = frame.pixels.slice(), coverage = observed.coverage.slice();
		const stop = new AbortController(), reason = Object.freeze({ outcome }), entry = held(), gate = held(), start = allocations.length;
		let settled = false;
		const work = display({ frame, maskOverlay: observed, signal: stop.signal }, async () => {
			entry.release(); await gate.promise; if (outcome === 'failure') throw reason; return 'used';
		}, 'proxy');
		void work.then(() => { settled = true; }, () => { settled = true; }); await entry.promise;
		if (outcome === 'cancel') stop.abort(reason);
		await Promise.resolve(); assert.equal(settled, false);
		assert.ok(allocations.slice(start).some(plane => plane.some(byte => byte !== 0)), 'held consumer retains live private output');
		gate.release(); if (outcome === 'success') assert.equal(await work, 'used'); else await assert.rejects(work, error => error === reason);
		retired(ownedSince(start)); assert.deepEqual(frame.pixels, source); assert.deepEqual(observed.coverage, coverage);
	}
});

// Independent CSS Color4 rational sRGB -> XYZ-D65 -> Display P3 reference.
const XYZ = [[506752 / 1228815, 87881 / 245763, 12673 / 70218], [87098 / 409605, 175762 / 245763, 12673 / 175545], [7918 / 409605, 87881 / 737289, 1001167 / 1053270]];
const P3 = [[446124 / 178915, -333277 / 357830, -72051 / 178915], [-14852 / 17905, 63121 / 35810, 423 / 17905], [11844 / 330415, -50337 / 660830, 316169 / 330415]];
function overlayRgb(primaries: 'srgb' | 'display-p3'): readonly number[] {
	if (primaries === 'srgb') return [255, 48, 48];
	const rgb = [255, 48, 48].map(code => { const value = code / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
	const xyz = XYZ.map(row => row.reduce((sum, coefficient, channel) => sum + coefficient * rgb[channel]!, 0));
	return P3.map(row => {
		const value = Math.max(0, Math.min(1, row.reduce((sum, coefficient, channel) => sum + coefficient * xyz[channel]!, 0)));
		return Math.round(255 * (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055));
	});
}

test('Before and After display grids retain exact nearest pixels, overlay modes and truthful P3 colors without changing Original', async () => {
	for (const [owner, display] of displayApis.entries()) for (const primaries of owner === 0 ? ['srgb'] as const : ['srgb', 'display-p3'] as const) {
		for (const resolution of ['proxy', 'full'] as const) for (const mode of ['color', 'grayscale'] as const) {
			const { frame, observed } = fixture(4100, 7, primaries), source = frame.pixels.slice(), coverage = observed.coverage.slice(), start = allocations.length;
			const width = resolution === 'proxy' ? 2048 : 4100, height = resolution === 'proxy' ? 3 : 7;
			const expected = new NativeBytes(width * height * 4), overlay = new NativeBytes(width * height * 4), rgb = overlayRgb(primaries);
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				const sample = Math.floor(y * 7 / height) * 4100 + Math.floor(x * 4100 / width), offset = (y * width + x) * 4;
				for (let channel = 0; channel < 4; channel++) expected[offset + channel] = source[sample * 4 + channel]!;
				const c = coverage[sample]!;
				for (let channel = 0; channel < 3; channel++) overlay[offset + channel] = mode === 'grayscale' ? c : rgb[channel]!;
				overlay[offset + 3] = mode === 'grayscale' ? 255 : c;
			}
			await display({ frame, maskOverlay: observed, maskOverlayMode: mode }, view => {
				assert.deepEqual(view.frame.descriptor, { ...frame.descriptor, width, height }); assert.deepEqual(view.frame.pixels, expected);
				assert.ok(view.overlay); assert.deepEqual(view.overlay.descriptor, view.frame.descriptor); assert.deepEqual(view.overlay.pixels, overlay);
				assert.equal(view.frame.pixels.buffer === frame.pixels.buffer, resolution === 'full', 'full borrowing and proxy ownership remain unchanged');
			}, resolution);
			const planes = ownedSince(start); assert.ok(planes.every(plane => plane.every(byte => byte === 0)));
			assert.deepEqual(frame.pixels, source); assert.deepEqual(observed.coverage, coverage);
		}
	}
});
