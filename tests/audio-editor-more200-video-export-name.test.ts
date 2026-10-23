/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { createEditorVideoExportAction } from '../src/common/editor/controller/export/internal/video/video-export-service.ts';
import { createFixture } from './helpers/export-service-fixture.ts';

function programme(title: string) {
	const source = createVideoSource({ id: 'camera', name: 'Camera.webm', storageKey: 'Camera.webm',
		mimeType: 'video/webm', contentSha256: 'ab'.repeat(32), sampleFrameCount: 48_000,
		sourceFrameCount: 30, frameRate: { num: 30, den: 1 }, width: 96, height: 54 });
	return createSoundscaperProject({ id: 'delivery-name', title, sampleRate: 48_000, sources: [source],
		primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['picture'] }],
		clips: [{ kind: 'video', id: 'picture', sourceId: source.id, title: 'Camera', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }],
		tracks: [{ id: 'picture', type: 'video', clipIds: ['picture'] }],
	});
}

for (const format of ['mp4', 'webm']) for (const title of ['東京の街', '音楽の映像', '  Café / Film -- ', '映'.repeat(96), '𐐀'.repeat(96)]) {
	test(`${format} delivery retains a distinct portable name for ${title.slice(0, 20)}`, async () => {
		const project = programme(title), fixture = createFixture(), names: string[] = [];
		const exporting = createEditorVideoExportAction({ ...fixture.runtime, getProject: () => project, createVideoExportPlan,
			fileService: { isDesktop: true, getDesktopVideoExportCapabilities: async () => ({ schemaVersion: 1,
				formats: { mp4: { available: true, provider: 'external-ffmpeg' }, webm: { available: true, provider: 'external-ffmpeg' } } }),
				createDownload: async (request: { suggestedName: string }) => {
					names.push(request.suggestedName);
					return { url: 'blob:movie', fileName: request.suggestedName, method: 'memory' };
				} },
		}, async () => { throw new Error('This programme has no audio'); });
		assert.ok(await exporting({ format, includeAudio: false }));
		assert.deepEqual(fixture.errors, []); assert.equal(names.length, 1);
		const name = names[0]!;
		assert.ok(Buffer.byteLength(name) <= 255); assert.ok(name.endsWith(`.${format}`));
		assert.equal(new TextDecoder().decode(new TextEncoder().encode(name)), name);
		const stem = name.slice(0, -(format.length + 1));
		const limit = Math.min(96, Math.floor((255 - format.length - 1) / Buffer.byteLength(Array.from(title)[0]!)));
		assert.equal(stem, title.includes('Café') ? 'Cafe-Film' : Array.from(title).slice(0, limit).join(''));
		assert.ok(stem.length > 0); assert.notEqual(stem, 'video-project');
	});
}
