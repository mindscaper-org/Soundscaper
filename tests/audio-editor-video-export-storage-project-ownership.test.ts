/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { deferred } from './helpers/async-test-control.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { nativeVideoAudioTailFixture } from './helpers/native-video-audio-tail-fixture.ts';

const AVAILABLE = { usage: 0, quota: 4 * 1024 ** 3 };
const INSUFFICIENT = { usage: 0, quota: 1 };

for (const { name, switchTab, estimate } of [
	{ name: 'retired video storage admission cannot mark the next tab as rendering', switchTab: true, estimate: AVAILABLE },
	{ name: 'retired video storage admission cannot report an error in the next tab', switchTab: true, estimate: INSUFFICIENT },
	{ name: 'the active video export still reports insufficient storage', switchTab: false, estimate: INSUFFICIENT },
]) test(name, async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-video-export-storage-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const admissionStarted = deferred<void>();
	const admissionEstimate = deferred<typeof AVAILABLE>();
	let delayNextEstimate = false;
	const environment = await createFramescaperEditorProjectEnvironment({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB(), preferOpfs: false,
			storageManager: { async estimate() {
				if (!delayNextEstimate) return AVAILABLE;
				delayNextEstimate = false;
				admissionStarted.resolve();
				return await admissionEstimate.promise;
			} },
		},
	});
	const controller = createFramescaperAudioEditorController(environment, { locale: 'en' });
	context.after(async () => { await controller.dispose(); await environment.close(); });
	// Node needs the WebCodecs capability reply to reach the browser storage gate.
	const previousFrame = Object.getOwnPropertyDescriptor(globalThis, 'VideoFrame');
	const previousEncoder = Object.getOwnPropertyDescriptor(globalThis, 'VideoEncoder');
	Object.defineProperty(globalThis, 'VideoFrame', { configurable: true, value: class VideoFrame {} });
	Object.defineProperty(globalThis, 'VideoEncoder', { configurable: true, value: class VideoEncoder {
		static async isConfigSupported() { return { supported: true }; }
	} });
	context.after(() => {
		if (previousFrame) Object.defineProperty(globalThis, 'VideoFrame', previousFrame);
		else Reflect.deleteProperty(globalThis, 'VideoFrame');
		if (previousEncoder) Object.defineProperty(globalThis, 'VideoEncoder', previousEncoder);
		else Reflect.deleteProperty(globalThis, 'VideoEncoder');
	});
	const other = await writeArchive(directory, 'other-cut', 2);
	const first = await writeArchive(directory, 'first-cut', 1);
	await controller.ready;
	await controller.actions.project.openScapeFile(other, () => 'copy');
	assert.equal(controller.project?.id, 'other-cut');
	await controller.actions.project.openScapeFile(first, () => 'copy');
	assert.equal(controller.project?.id, 'first-cut');
	const project = controller.getSnapshot().project;
	const settings = { ...createExportDialogInitialSettings(project), format: 'video-webm' };
	delayNextEstimate = true;
	const pending = Promise.allSettled([controller.actions.export.start(createExportDialogRequest(settings, { project }))]);
	try {
		await Promise.race([admissionStarted.promise, pending.then(() => assert.fail('Export never reached the storage check.'))]);
		assert.equal(controller.getSnapshot().storage.lastPreflight?.operation, 'export');
		if (switchTab) await controller.actions.project.openById('other-cut');
		assert.equal(controller.project?.id, switchTab ? 'other-cut' : 'first-cut');
		const before = controller.getSnapshot();
		admissionEstimate.resolve(estimate);
		assert.deepEqual(await pending, [{ status: 'fulfilled', value: null }]);
		const after = controller.getSnapshot();
		assert.equal(after.export.output, null);
		if (switchTab) assert.deepEqual(after.status, before.status);
		else assert.match(after.status.message, /Not enough local storage for export/);
	} finally { admissionEstimate.resolve(AVAILABLE); await pending; }
});

async function writeArchive(directory: string, id: string, seconds: 1 | 2): Promise<File> {
	const bytes = Uint8Array.from(nativeVideoAudioTailFixture(seconds));
	const videoPath = join(directory, `${id}.mp4`);
	await writeFile(videoPath, bytes);
	const rate = { num: 25, den: 1 };
	const source = createVideoSource({ id: `${id}-source`, storageKey: `${id}-media`, name: `${id}.mp4`,
		mimeType: 'video/mp4', contentSha256: createHash('sha256').update(bytes).digest('hex'),
		frameCount: seconds * 48_000, sampleFrameCount: seconds * 48_000, sampleRate: 48_000,
		sourceFrameCount: seconds * 25, frameRate: rate, width: 64, height: 32,
		videoCodec: 'h264', audioCodec: 'aac', hasAudio: true,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate, reason: 'timing-probe-unavailable', failures: [] } });
	const project = createFramescaperProject(PROFILE, { id, title: id, sources: [source],
		clips: [{ kind: 'video', id: 'picture', title: 'Picture', sourceId: source.id, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: seconds * 25, sourceInFrame: 0, sourceFrameCount: seconds * 25, retimeMap: null }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['picture'] }],
		sequences: [{ id: 'main', rate, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	try {
		await store.writeMediaAsset(source.storageKey, await openAsBlob(videoPath, { type: 'video/mp4' }),
			{ name: `${id}.mp4`, mimeType: 'video/mp4' });
		const { blob } = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
		assert.ok(blob);
		const path = join(directory, `${id}.fscape`);
		await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
		return new File([await openAsBlob(path)], `${id}.fscape`);
	} finally { await store.close(); }
}
