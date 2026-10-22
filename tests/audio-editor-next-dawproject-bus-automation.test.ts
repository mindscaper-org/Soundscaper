/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const role of ['submix', 'effect'] as const) test(`File Open DAWproject retains ${role} volume automation in the current product document`, async () => {
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>', files: [],
		projectXml: `<Project version="1.0"><Structure>
			<Track id="bus-track" name="Automated bus" contentType="audio"><Channel id="bus" role="${role}" audioChannels="2">
			<Volume id="bus-volume" unit="linear" value="0.25"/></Channel></Track>
			</Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="bus-track">
			<Points unit="linear"><Target parameter="bus-volume"/>
			<RealPoint time="0" value="0.1" interpolation="linear"/>
			<RealPoint time="1" value="0.8" interpolation="linear"/>
			</Points></Lanes></Lanes></Arrangement></Project>`,
	});
	Object.defineProperty(archive, 'name', { value: 'Automated buses.dawproject' });
	let ordinal = 0;
	const fixture = createFixture({ createStableId: prefix => `${prefix}-${++ordinal}`,
		adaptAudacityProject: importSoundscaperAudacityProject });
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(archive as Blob & { name: string });
	assert.ok(opened);
	assert.ok(validateSoundscaperProject(opened.project));
	const project = opened.project;
	const bus = (role === 'submix' ? project.mixer.groups : project.mixer.sends).find(bus => bus.name === 'Automated bus');
	assert.ok(bus);
	const lane = project.automationLanes.find(lane => lane.address.kind === 'strip'
		&& lane.address.strip.kind === 'mixer-node' && lane.address.strip.id === bus.id
		&& lane.address.parameterId === 'gain');
	assert.ok(lane, 'the reported preserved bus automation must remain audible after product promotion');
	assert.deepEqual(lane.points.map(point => ({ position: point.position, value: point.value })), [
		{ position: 0, value: 0.1 }, { position: 48_000, value: 0.8 },
	]);
	assert.equal(bus.gain, 1, 'absolute imported automation does not multiply the original fader');
	assert.deepEqual(fixture.switched, [project.id]);
});
