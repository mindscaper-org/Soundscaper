/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const role of ['regular', 'submix', 'master'] as const) for (const value of [0, 25, 50, 100]) {
	test(`File Open preserves the ${role} pan at ${value} percent of its declared range`, async () => {
		const project = await openPanFile('percent', value, role);
		const strip = role === 'regular' ? project.tracks[0]
			: role === 'master' ? project.master : project.mixer.groups[0];
		assert.ok(strip);
		// Bitwig's Unit.java defines percent as 0–100, and normalized as 0–1.
		assert.equal(strip.pan, value / 50 - 1);
	});
}

for (const [unit, value] of [['normalized', .5], ['linear', 0]] as const) {
	test(`File Open retains the existing centered ${unit} pan contract`, async () => {
		assert.equal((await openPanFile(unit, value)).tracks[0]?.pan, 0);
	});
}

async function openPanFile(unit: string, value: number, role = 'regular') {
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>', files: [{ path: 'take.wav',
		blob: new Blob([Uint8Array.from(encodeWav([new Float32Array(12_000).fill(.2)], { sampleRate: 48_000, float: true }))]),
	}], projectXml: `<Project version="1.0"><Structure><Track id="track" name="Recording" contentType="audio">
		<Channel id="channel" role="${role}" audioChannels="1"><Pan unit="${unit}" value="${value}"/></Channel></Track></Structure>
		<Arrangement><Lanes timeUnit="seconds"><Lanes track="track"><Clips><Clip time="0" duration=".25">
		<Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`,
	});
	let ordinal = 0;
	const fixture = createFixture({ createStableId: prefix => `${prefix}-${++ordinal}`,
		adaptAudacityProject: importSoundscaperAudacityProject });
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Percentage pan.dawproject'));
	assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
	return opened.project;
}
