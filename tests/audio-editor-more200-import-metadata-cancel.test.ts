/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { nativeOriginalImportFixture } from './helpers/native-original-import-fixture.ts';
import { createDesktopSelectedRangeBlob, retireDesktopSelectedRangeBlob, type DesktopSelectedRangeDescriptor } from '../src/common/editor/desktop-selected-range-blob.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY } from './helpers/audio-editor-multitrack-selection-harness.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';

function latch(): { ready: Promise<void>; release: () => void } {
	let release = (): void => {};
	const ready = new Promise<void>(resolve => { release = resolve; }); return { ready, release };
}

for (const phase of ['header', 'metadata'] as const) test(`Cancel retires the foreground import while its native ${phase} read remains pending`, async () => {
	const file = new File([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.2)], { sampleRate: 48_000, metadata: { title: 'Native metadata' } }))], 'Metadata.wav');
	const native = await nativeOriginalImportFixture(file);
	const fixture = await createTwoTrackFixture(`metadata-cancel-${phase}`, new Map<string, Float32Array>(), 48_000);
	const choices = await native.bridge.chooseFiles({ purpose: 'audio', multiple: false }); assert.ok(Array.isArray(choices));
	const entered = latch(), resume = latch(); let held = false; let reads = 0;
	const selected = createDesktopSelectedRangeBlob(choices[0] as DesktopSelectedRangeDescriptor, { fetch: async (url, init) => {
		const response = await native.fetch(url, init); reads++;
		const range = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get('Range')!); assert.ok(range);
		if (!held && (phase === 'header' || Number(range[2]) - Number(range[1]) + 1 > 12)) {
			held = true; entered.release(); await resume.ready;
		}
		return response;
	} });
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store: fixture.store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: { dispose() {} } as Options['ffmpeg'] });
	let pending: Promise<unknown> | undefined;
	try {
		await controller.ready; pending = controller.actions.project.importFiles([selected]); await entered.ready;
		assert.equal(controller.getSnapshot().importing, true); let settled = false; void pending.then(() => { settled = true; });
		assert.equal(controller.actions.project.cancelTask(), true);
		for (let turn = 0; turn < 30; turn++) await nextTurn();
		assert.equal(settled, true, 'Cancel must release ownership before the native read settles');
		assert.equal(controller.getSnapshot().importing, false);
		await controller.actions.project.importFiles([new File([Uint8Array.from(encodeWav([new Float32Array(2400).fill(.125)], { sampleRate: 48_000 }))], 'Fresh.wav')]);
		const project = controller.getSnapshot().project; assert.ok(validateAudioEditorProjectV17(project));
		assert.deepEqual(project.sources.map(source => source.name), ['Fresh.wav']);
		const readCount = reads; resume.release(); for (let turn = 0; turn < 30; turn++) await nextTurn();
		assert.equal(reads, readCount, 'a retired metadata reader must not schedule another native read');
		assert.deepEqual(controller.getSnapshot().project, project); assert.equal(controller.getSnapshot().importing, false);
	} finally {
		resume.release(); await pending?.catch(() => undefined); retireDesktopSelectedRangeBlob(selected);
		await controller.dispose(); await native.close();
	}
});
