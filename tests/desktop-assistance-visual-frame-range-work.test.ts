/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { nativeChildFileIdentityFromStat } from '../desktop/native-child-file-identity.ts';
import { createAssistanceVisualFramePackV2 } from '../src/common/editor/assistance/visual-frame-pack-v2.ts';
import { createAssistanceVisualFramePackSetV1 } from '../src/common/editor/assistance/visual-frame-pack-set-v1.ts';
import { openAssistanceOnnxVisualFrameSourceV1 } from '../desktop/assistance-onnx-visual-frame-source.ts';

test('reviewed inference frames use a cached ordinal range and indexed jumps without linear pack searches', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'visual-range-work-')); context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	const count = 8; const perPack = 1024;
	const parts = createAssistanceVisualFramePackSetV1(Array.from({ length: count }, (_, pack) => createAssistanceVisualFramePackV2({
		sourceWidth: 16, sourceHeight: 16, rasterWidth: 16, rasterHeight: 16, timescale: 1000,
		frames: Array.from({ length: perPack }, (_, local) => { const ordinal = pack * perPack + local;
			return { sourceFrame: ordinal, presentationTick: String(ordinal * 500), rgba: new Uint8Array(16 * 16 * 4).fill(ordinal) }; }),
	})));
	const bytes = Buffer.concat(parts.map(part => Buffer.from(part))); const path = join(directory, 'frames.pack'); await writeFile(path, bytes);
	const source = await openAssistanceOnnxVisualFrameSourceV1([{ claimId: 'ab'.repeat(20), role: 'frame-pack', mediaType: 'application/vnd.soundscaper.frame-pack',
		path, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), identity: nativeChildFileIdentityFromStat(await stat(path, { bigint: true })) }]);
	context.after(() => { source.release(); });
	const find = Array.prototype.find; let scans = 0;
	Object.defineProperty(Array.prototype, 'find', { value: function (this: unknown[], predicate: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
		if (this.length === count && this[0] && typeof this[0] === 'object' && 'ordinalStart' in this[0]) scans += 1;
		return Reflect.apply(find, this, [predicate, thisArg]) as unknown;
	} });
	context.after(() => { Object.defineProperty(Array.prototype, 'find', { value: find }); });
	for (let ordinal = 0; ordinal < source.frameCount; ordinal += 1) {
		const frame = await source.readFrame(ordinal); assert.equal(frame.sourceFrame, ordinal); assert.equal(frame.rgba[0], ordinal % 256);
	}
	for (const ordinal of [0, source.frameCount - 1, 1024, 500, 4096]) assert.equal((await source.readFrame(ordinal)).presentationTick, String(ordinal * 500));
	assert.equal(scans, 0, 'sequential and random inference reads do not scan the complete pack catalog');
	source.release(); await assert.rejects(source.readFrame(0), /released/u);
});
