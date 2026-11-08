/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { walkXml } from '../src/common/editor/dawproject-xml.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { colors } from '../vendor/audacity-design-system/tokens/src/index.ts';
import { AUDIO_EDITOR_TRACK_COLORS } from '../src/common/editor/project-audio-factory.js';
import { DAWPROJECT_PALETTE_COLORS, dawprojectExportColor, dawprojectImportColor } from '../src/common/editor/dawproject-colors.ts';
import { createDeliveryReport } from '../src/common/editor/delivery-report.ts';

function audio(): Blob {
	const encoded = encodeWav([Float32Array.of(0.25, -0.5, 0.75, 0)], { sampleRate: 8000, float: true });
	assert.ok(encoded instanceof Uint8Array);
	return new Blob([Uint8Array.from(encoded)]);
}

test('DAWproject palette conversion stays aligned with the pinned design token swatches', () => {
	assert.deepEqual(Object.keys(DAWPROJECT_PALETTE_COLORS).sort(), [...AUDIO_EDITOR_TRACK_COLORS].sort());
	const report = createDeliveryReport({ format: 'dawproject', container: 'DAWproject', codec: null,
		sampleRate: 8000, channelCount: 1, lossless: null });
	for (const name of AUDIO_EDITOR_TRACK_COLORS) {
		const token: unknown = Reflect.get(colors, name);
		assert.ok(token && typeof token === 'object' && '600' in token);
		const rgb = dawprojectExportColor(name);
		assert.equal(rgb, token['600']);
		assert.equal(dawprojectImportColor(rgb?.toLowerCase(), report, { kind: 'track', id: 'palette' }), name);
	}
	assert.equal(report.items.length, 0);
});

test('menu-authored track and clip palette colors survive own DAWproject delivery and File Open', async () => {
	let project = createAudioEditorProjectV17({ sampleRate: 8000,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 8000, channelCount: 1, frameCount: 4 })],
		tracks: [createAudioTrack({ id: 'track', name: 'Lead', clipIds: ['clip'] }, 8000)],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 4 })],
	});
	project = applyEditorCommand(project, { type: 'track/update', trackId: 'track', changes: { color: 'orange' } });
	project = applyEditorCommand(project, { type: 'clip/update', clipId: 'clip', changes: { color: 'violet' } });
	assert.ok(validateAudioEditorProjectV17(project));
	const exported = createDawprojectExport({ project: { ...project } });
	const elements = [...walkXml(exported.document)];
	assert.equal(elements.find(element => element.name === 'Track' && element.attributes.name === 'Lead')?.attributes.color, '#FF9E65');
	assert.equal(elements.find(element => element.name === 'Clip')?.attributes.color, '#9996FC');
	const archive = await writeDawprojectArchive({ projectXml: exported.projectXml, metadataXml: exported.metadataXml,
		files: exported.media.map(media => ({ path: media.path, blob: audio() })) });
	const opened = await createNativeProjectService(createFixture().runtime).openDawproject(new File([archive], 'Palette.dawproject'));
	assert.ok(opened);
	const imported: unknown = opened.project;
	assert.ok(validateAudioEditorProjectV17(imported));
	assert.equal(imported.tracks[0]?.color, 'orange');
	assert.equal(imported.clips[0]?.color, 'violet');
});

test('a DAWproject RGB outside the native palette reports color omission while retaining playable audio', async () => {
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>', files: [{ path: 'take.wav', blob: audio() }],
		projectXml: '<Project version="1.0"><Structure><Track id="t" name="Custom" contentType="audio" color="#123456"><Channel role="regular"/></Track></Structure>'
			+ '<Arrangement><Lanes timeUnit="seconds"><Lanes track="t"><Clips><Clip time="0" duration="0.0005" color="#654321">'
			+ '<Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>' });
	const fixture = createFixture();
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Custom colors.dawproject'));
	assert.ok(opened);
	const imported: unknown = opened.project;
	assert.ok(validateAudioEditorProjectV17(imported));
	assert.equal(imported.clips.length, 1);
	assert.equal(imported.tracks[0]?.color, 'blue');
	assert.equal(imported.clips[0]?.color, 'auto');
	const state: unknown = fixture.state;
	assert.ok(state && typeof state === 'object' && 'deliveryReport' in state);
	const report: unknown = state.deliveryReport;
	assert.ok(report && typeof report === 'object' && 'items' in report && Array.isArray(report.items));
	assert.equal(report.items.filter((item: unknown) => item && typeof item === 'object'
		&& 'code' in item && item.code === 'dawproject.color-omitted').length, 2);
});
