/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PhotoMediaCubeLutResourcesV1 } from '../../src/lightscaper/storage/photo-media-cube-lut-resources-v1.ts';
import type { PhotoMediaMaskRasterResourcesV1 } from '../../src/lightscaper/storage/photo-media-mask-raster-resources-v1.ts';
import { parseCubeLutV1 } from '../../src/common/imaging/cube-lut-v1.ts';

export async function nativeResourceFixtureCurrentV1(run: (appDataPath: string) => Promise<void>): Promise<void> {
	const path = await mkdtemp(join(tmpdir(), 'lightscaper-native-resources-'));
	try { await run(path); } finally { await rm(path, { recursive: true, force: true }); }
}

export function nativeCubeResourceCurrentV1() {
	const text = 'TITLE "Größe"\r\nLUT_3D_SIZE 2\r\n0 0 0\r\n1 0 0\r\n0 1 0\r\n1 1 0\r\n0 0 1\r\n1 0 1\r\n0 1 1\r\n1 1 1';
	const parsed = parseCubeLutV1(text), bytes = new TextEncoder().encode(text);
	return { bytes, reference: { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256,
		byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax } };
}

export function nativeBrushResourceCurrentV1() {
	const bytes = Uint8Array.of(83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 2, 0, 0, 0, 0, 64, 128, 255);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	return { bytes, reference: { storageKey: `brush-mask-v1:2:2:${sha256}`, sha256, width: 2, height: 2, byteLength: bytes.length } };
}

export function nativeResourceOpaqueCurrentV1() {
	let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw new Error('Opaque reason was reflected.'); },
		getPrototypeOf() { traps++; throw new Error('Opaque reason prototype was inspected.'); } });
	return { reason, traps: () => traps };
}

export async function nativeResourceExactFailureCurrentV1(work: Promise<unknown>, reason: unknown): Promise<void> {
	let refused = false;
	await work.then(() => undefined, (error: unknown) => { refused = true; if (!Object.is(error, reason)) throw new Error('The owning reason was replaced.'); });
	if (!refused) throw new Error('Expected the exact owning refusal.');
}

/** Invoke the actual family's typed source for deliberate malformed-admission
 * cases as well as legal references, preserving its real receiver and promise. */
export function nativeResourceBorrowCurrentV1<Result>(resources: Readonly<PhotoMediaCubeLutResourcesV1 | PhotoMediaMaskRasterResourcesV1>,
	reference: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
	const source = resources.source;
	return Reflect.apply(source.withBytes, source, [reference, consume, options]) as Promise<Result>;
}
