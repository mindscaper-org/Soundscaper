/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportProjectFcpxml, exportProjectOtio } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { resolveActiveVideoLayers } from '../src/common/editor/video-timeline.js';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { readWithReference } from './helpers/interchange-reference.ts';

function layeredProject() {
	const source = createVideoSource({ id: 'camera', name: 'Camera.mp4', storageKey: 'media/camera.mp4',
		contentSha256: 'ab'.repeat(32), sampleFrameCount: 144_000, sourceFrameCount: 90,
		frameRate: { num: 30, den: 1 }, width: 320, height: 180 });
	return createFramescaperProject(PROFILE, { id: 'layers', sampleRate: 48_000, sources: [source],
		primarySequenceId: 'main',
		tracks: ['foreground', 'middle', 'background'].map(id => ({
			id, type: 'video', name: id, clipIds: [`${id}-clip`],
		})),
		clips: ['foreground', 'middle', 'background'].map(id => ({
			id: `${id}-clip`, kind: 'video', title: id, sourceId: source.id, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30,
		})),
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['foreground', 'middle', 'background'] }],
	});
}

for (const [format, exporting, adapter] of [
	['OTIO', exportProjectOtio, 'otio_json'],
	['FCPXML', exportProjectFcpxml, 'fcpx_xml'],
] as const) {
	test(`MI15: ${format} menu delivery preserves the foreground seen in the native preview`, async () => {
		const project = layeredProject();
		const preview: readonly Readonly<{ trackId: string }>[] = resolveActiveVideoLayers(project, 0);
		assert.equal(preview.at(-1)?.trackId, 'foreground');
		const saved: Blob[] = [];
		const result = await exporting({ getProject: () => project, state: {},
			fileService: { saveFile: request => {
				assert.ok(request.blob instanceof Blob); saved.push(request.blob);
			} } });
		assert.ok(result); assert.equal(saved.length, 1);
		const delivered = readWithReference(await saved[0]!.text(), adapter);
		const videoTracks = delivered[0]?.tracks.filter(track => track.kind === 'Video');
		assert.deepEqual(videoTracks?.flatMap(track => track.items.filter(item => item.schema === 'Clip').map(item => item.name)),
			['background', 'middle', 'foreground'], 'reference reader sees the same bottom-to-top painter order');
	});
}
