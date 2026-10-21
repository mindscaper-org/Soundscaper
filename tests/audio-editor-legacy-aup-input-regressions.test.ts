/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeLegacyAupProject } from '../src/common/editor/aup-legacy.js';
import { convertLegacyAupToProject } from '../src/common/editor/aup-legacy-conversion.js';
import { createLegacyAudacityProjectImport } from '../src/common/editor/controller/import/internal/legacy-audacity-project-import.ts';

function convert(clips: Record<string, unknown>[]) {
	let id = 0;
	return convertLegacyAupToProject({ sampleRate: 48_000, tracks: [
		{ type: 'audio', name: 'Voice', rate: 48_000, clips },
	] }, { idFactory: (prefix: string) => `${prefix}-${String(++id)}` });
}

test('empty legacy AUP audio tracks remain available for recording and edits', () => {
	const imported = convert([]);
	assert.equal(imported.project.tracks.length, 1);
	assert.equal(imported.project.tracks[0]?.name, 'Voice');
});

test('out-of-order legacy AUP clips do not become unnecessary separate tracks', () => {
	const imported = convert([
		{ name: 'Late', channels: [new Float32Array(48_000)], startSeconds: 2 },
		{ name: 'Early', channels: [new Float32Array(48_000)], startSeconds: 0 },
	]);
	assert.equal(imported.project.tracks.length, 1);
	const clipIds = imported.project.tracks[0]?.clipIds;
	assert.ok(Array.isArray(clipIds));
	assert.equal(clipIds.length, 2);
});

test('legacy AUP stereo channels with unequal sample rates are refused before changing pitch', async () => {
	const xml = `<project rate="48000"><wavetrack linked="1" channel="0" rate="48000">
		<waveclip><sequence><waveblock><silentblockfile len="4"/></waveblock></sequence></waveclip></wavetrack>
		<wavetrack channel="1" rate="44100"><waveclip><sequence><waveblock><silentblockfile len="4"/></waveblock></sequence></waveclip>
		</wavetrack></project>`;
	await assert.rejects(decodeLegacyAupProject(new File([xml], 'stereo.aup'), []), /sample rates/iu);
});

test('cancelling legacy AUP while decoding prevents conversion and project publication', async () => {
	let finishDecode: ((value: unknown) => void) | undefined;
	const decoding = new Promise<unknown>((resolve) => { finishDecode = resolve; });
	const calls: string[] = [];
	const importer = createLegacyAudacityProjectImport({
		copy: { aupImporting: 'Importing' },
		getProject: () => ({ id: 'current' }),
		preflightStorage: async () => undefined,
		setStatus: () => undefined,
		decodeLegacyAupProject: () => decoding,
		convertLegacyAupToProject: () => { calls.push('convert'); return { warnings: [] }; },
		createStableId: () => 'new-project',
		stripExtension: () => 'Legacy',
		formatLegacyAupWarning: (warning: unknown) => String(warning),
		persistDecodedLegacyAupProject: async () => { calls.push('publish'); return {}; },
	});
	const controller = new AbortController();
	const pending = importer(new File(['<project/>'], 'legacy.aup'), [], { signal: controller.signal });
	await Promise.resolve();
	controller.abort(new DOMException('Canceled import', 'AbortError'));
	finishDecode?.({ tracks: [] });
	await assert.rejects(pending, { name: 'AbortError' });
	assert.deepEqual(calls, []);
});
