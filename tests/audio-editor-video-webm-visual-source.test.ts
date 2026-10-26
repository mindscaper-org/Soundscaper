/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectVisualService, type ProjectVisualProject } from '../src/common/editor/controller/document/project-visual-service.ts';

const RECORDED_WEBM =
	'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GG'
	+ 'Q2hyb21lFlSua6mup9eBAXPFh9jdXVDoi6qDgQFV7oEBhoVWX1ZQOOCKsIHAuoFsU8CBAR9DtnUB/////////+eBAKBAsqHj'
	+ 'gQAAAFAHAJ0BKsAAbAAABwiFhYiZhIgBJBATrVAfwBA0nIirtKhOKWlQnFLSoTilpUJxS0qE4paVCcUtKhOKWlQnFLSoThoA'
	+ '/v9NEv/9vff7e+/299/+3vv/s7v07v07v73wdaHKpsjugQGlw5AGAJ0BKsAAbAAAxwiFhYiZhIgEggAGIg8FEJxS0qE4paVC'
	+ 'cUtKhOKWlQnFLSoTilpUJxS0qE4paVCcUsyA/v8yqACgvKGZgQAmADECAAAQCSAAwADCwX+gAEQBKxdAAHWhm6aZ7oEBpZQR'
	+ 'AgADECwAGAAYWC/0AAiAJWLoAPuBAKC8oZmBAEgAMQIAABAJIADAAMLBf6AARAErF0AAdaGbppnugQGllBECAAMQJAAYABhY'
	+ 'L/QACIAlYugA+4EmoLyhmYEAagAxAgAAEAkgAMAAwsF/oABEASsXQAB1oZumme6BAaWUEQIAAxAYABgAGFgv9AAIgCVi6AD7'
	+ 'gUigvKGZgQCKADECAAAQCSAAwADCwX+gAEQBKxdAAHWhm6aZ7oEBpZQRAgADEBAAGAAYWC/0AAiAJWLoAPuBaqC9oZmBAKwA'
	+ 'MQIAABAJIADAAMLBf6AARAErF0AAdaGcpprugQGllTECAAMQCSAAwADCwX+gAEQBKxdAAPuBiqC9oZmBAM0AMQIAABAJIADA'
	+ 'AMLBf6AARAErF0AAdaGcpprugQGllTECAAMQCSAAwADCwX+gAEQBKxdAAPuBrKC8oZmBAO4AMQIAABAJIKMAAwsF/oABEASs'
	+ 'XQAAdaGbppnugQGllBECAAMQLBRgAGFgv9AAIgCVi6AA+4HNoL2hmYEBEAAxAgAAEAkgAMAAwsF/oABEASsXQAB1oZymmu6B'
	+ 'AaWVMQIAAxAJIADAAMLBf6AARAErF0AA+4HuoL6hmYEBMQAxAgAAEAkgAMAAwsF/oABEASsXQAB1oZymmu6BAaWVMQIAAxAJ'
	+ 'IADAAMLBf6AARAErF0AA+4IBEKC+oZmBAVcAMQIAABAJIADAAMLBf6AARAErF0AAdaGcpprugQGllTECAAMQCSAAwADCwX+g'
	+ 'AEQBKxdAAPuCATGgvqGZgQF0ADECAAAQCSAAwADCwX+gAEQBKxdAAHWhnKaa7oEBpZUxAgADEAkgAMAAwsF/oABEASsXQAD7'
	+ 'ggFXoL6hmYEBlQAxAgAAEAkgAMAAwsF/oABEASsXQAB1oZymmu6BAaWVMQIAAxAJIADAAMLBf6AARAErF0AA+4IBdKC+oZmB'
	+ 'AbYAMQIAABAJIADAAMLBf6AARAErF0AAdaGcpprugQGllTECAAMQCSAAwADCwX+gAEQBKxdAAPuCAZWgvqGZgQHYADECAAAQ'
	+ 'CSAAwADCwX+gAEQBKxdAAHWhnKaa7oEBpZUxAgADEAkgAMAAwsF/oABEASsXQAD7ggG2oL6hmYEB+QAxAgAAEAkgAMAAwsF/'
	+ 'oABEASsXQAB1oZymmu6BAaWVMQIAAxAJIADAAMLBf6AARAErF0AA+4IB2KC+oZmBAhoAMQIAABAJIADAAMLBf6AARAErF0AA'
	+ 'daGcpprugQGllTECAAMQCSAAwADCwX+gAEQBKxdAAPuCAfmgvqGZgQI8ADECAAAQCSAAwADCwX+gAEQBKxdAAHWhnKaa7oEB'
	+ 'pZUxAgADEAkgAMAAwsF/oABEASsXQAD7ggIaoL2hmYECXQAxAgAAEAkgowADCwX+gAEQBKxdAAB1oZumme6BAaWUEQIAAxAc'
	+ 'FGAAYWC/0AAiAJWLoAD7ggI8oL6hmYECfgAxAgAAEAkgAMAAwsF/oABEASsXQAB1oZymmu6BAaWVMQIAAxAJIADAAMLBf6AA'
	+ 'RAErF0AA+4ICXaC+oZmBAqAAMQIAABAJIADAAMLBf6AARAErF0AAdaGcpprugQGllTECAAMQCSAAwADCwX+gAEQBKxdAAPuC'
	+ 'An6gvqGZgQLBADECAAAQCSAAwADCwX+gAEQBKxdAAHWhnKaa7oEBpZUxAgADEAkgAMAAwsF/oABEASsXQAD7ggKgoL6hmYEC'
	+ '4gAxAgAAEAkgAMAAwsF/oABEASsXQAB1oZymmu6BAaWVMQIAAxAJIADAAMLBf6AARAErF0AA+4ICwQ==';
function recording(): Blob { return new Blob([Buffer.from(RECORDED_WEBM, 'base64')], { type: 'video/webm' }); }

function fixture(body: Blob) {
	const source = { id: 'video', kind: 'video', storageKey: 'original' };
	const project: ProjectVisualProject = { id: 'project', schemaVersion: 1, sources: [source],
		clips: [{ id: 'clip', kind: 'video', sourceId: source.id }], tracks: [] };
	const created: Blob[] = [], revoked: string[] = [];
	const service = createProjectVisualService({
		getProject: () => project, captureProject: () => project, assertProject: () => {},
		missingSourceIds: new Set(), sourceBuffers: new Map(), sourcePeaks: new Map(), waveformPcmWindows: new Map(),
		store: { loadMediaAsset: async () => body, listVideoDerivatives: async () => [], loadVideoDerivative: async () => null },
		projectDurationFrames: () => 37_008,
		url: { createObjectURL: blob => { created.push(blob); return `blob:${created.length}`; },
			revokeObjectURL: url => { revoked.push(url); } },
	});
	return { source, project, service, created, revoked };
}

test('stored timeline video opens a decoder view with the complete WebM duration and retains original bytes', async () => {
	const original = recording(), before = new Uint8Array(await original.arrayBuffer()), ports = fixture(original);
	try {
		const visual = await ports.service.activateVideoSource(ports.source);
		assert.equal(visual?.mediaUrl, 'blob:1'); assert.equal(ports.created.length, 1);
		const decoder = ports.created[0]!;
		assert.notEqual(decoder, original, 'timeline playback must not reopen the durationless original');
		const bytes = new Uint8Array(await decoder.arrayBuffer());
		const offset = bytes.findIndex((byte, index) => byte === 0x44 && bytes[index + 1] === 0x89 && bytes[index + 2] === 0x88);
		assert.ok(offset >= 0, 'the native decoder view declares its complete packet clock');
		assert.equal(new DataView(bytes.buffer).getFloat64(offset + 3), 771);
		assert.deepEqual(new Uint8Array(await original.arrayBuffer()), before);
		assert.equal(ports.service.getClipVisualData('clip')?.mediaUrl, visual.mediaUrl);
	} finally { await ports.service.dispose(); }
	assert.deepEqual(ports.revoked, ['blob:1']);
});

for (const retired of ['abort', 'superseded'] as const) test(`decoder preparation cannot publish after ${retired}`, async context => {
	const started = deferred(), release = deferred(), ports = fixture(recording()), abort = new AbortController();
	const arrayBuffer = Blob.prototype.arrayBuffer;
	let held = false;
	context.mock.method(Blob.prototype, 'arrayBuffer', async function(this: Blob): Promise<ArrayBuffer> {
		if (!held && this.size === 16) { held = true; started.resolve(); await release.promise; }
		return arrayBuffer.call(this);
	});
	const activation = ports.service.activateVideoSource(ports.source, { signal: abort.signal });
	try {
		await Promise.race([started.promise, activation.then(() => {
			throw new Error('The original media was exposed without preparing its native decoder view.');
		})]);
		if (retired === 'abort') abort.abort(new DOMException('Stopped', 'AbortError'));
		else await ports.service.revokeVideoVisual(ports.source.id);
		release.resolve();
		if (retired === 'abort') await assert.rejects(activation, { name: 'AbortError' });
		else assert.equal(await activation, null);
		assert.deepEqual(ports.created, []); assert.deepEqual(ports.revoked, []);
		assert.equal(ports.service.getVideoSourceVisualData(ports.source.id)?.mediaUrl, null);
	} finally { release.resolve(); await ports.service.dispose(); }
});

test('ordinary finite non-WebM media retains the original URL body', async () => {
	const original = new Blob(['native MP4'], { type: 'video/mp4' }), ports = fixture(original);
	try { await ports.service.activateVideoSource(ports.source); assert.equal(ports.created[0], original); }
	finally { await ports.service.dispose(); }
});

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(complete => { resolve = complete; });
	return { promise, resolve };
}
