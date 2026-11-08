/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { inactiveDawprojectTrackFile } from './helpers/dawproject-inactive-track-fixture.ts';

for (const loaded of [undefined, true, false]) test(`FileOpen retains loaded=${String(loaded)} track silence and media`, async () => {
	const { project, state } = await open({ loaded });
	const track = project.tracks.find(track => track.name === 'Voice'); assert.ok(track);
	assert.equal(track.mute, loaded === false); assert.equal(project.clips.length, 1); assert.equal(project.sources.length, 1);
	const report = state.deliveryReport;
	assert.ok(report && typeof report === 'object' && 'items' in report && Array.isArray(report.items));
	assert.equal(report.items.some((item: unknown) => item && typeof item === 'object'
		&& 'code' in item && item.code === 'dawproject.inactive-track-converted'), loaded === false);
	const active = applySoundscaperProjectCommand(project, { type: 'track/update', trackId: track.id, changes: { mute: false } });
	assert.equal(active.tracks.find(candidate => candidate.id === track.id)?.mute, false);
	assert.deepEqual(active.sources, project.sources); assert.deepEqual(active.clips, project.clips);
});

test('deactivated folder owns one gate while its own media and child remain available', async () => {
	const { project } = await open({ loaded: false, folder: true, solo: true });
	const folder = project.trackFolders.find(folder => folder.name === 'Voice'); assert.ok(folder);
	assert.equal(folder.mute, true); assert.equal(folder.solo, true);
	const bus = project.mixer.groups.find(bus => bus.id === folder.id); assert.ok(bus);
	assert.equal(bus.mute, false); assert.equal(bus.solo, false);
	assert.equal(project.tracks.length, 2); assert.ok(project.tracks.every(track => track.mute === false));
	assert.equal(project.clips.length, 1);
});

for (const role of ['submix', 'effect', 'master'] as const) test(`deactivated ${role} channel imports muted`, async () => {
	const { project } = await open({ loaded: false, role });
	const strip = role === 'master' ? project.master
		: (role === 'submix' ? project.mixer.groups : project.mixer.sends).find(bus => bus.name === 'Voice');
	assert.ok(strip); assert.equal(strip.mute, true); assert.equal(project.sources.length, 1);
});

for (const loaded of [undefined, true, false]) test(`explicit mute and solo remain authored when loaded=${String(loaded)}`, async () => {
	const { project } = await open({ loaded, mute: true, solo: true });
	const track = project.tracks[0]; assert.ok(track); assert.equal(track.mute, true); assert.equal(track.solo, true);
});

test('reported unsupported mute automation cannot reactivate a deactivated track', async () => {
	const { project, state } = await open({ loaded: false, muteAutomation: true });
	assert.equal(project.tracks[0]?.mute, true);
	assert.equal(project.automationLanes.length, 0);
	const report = state.deliveryReport;
	assert.ok(report && typeof report === 'object' && 'items' in report && Array.isArray(report.items));
	assert.ok(report.items.some((item: unknown) => item && typeof item === 'object'
		&& 'code' in item && item.code === 'dawproject.automation-omitted'));
});

async function open(options: Parameters<typeof inactiveDawprojectTrackFile>[0]) {
	let id = 0;
	const fixture = createFixture({ createStableId: prefix => `${prefix}-${++id}`, adaptAudacityProject: importSoundscaperAudacityProject });
	const result = await createNativeProjectService(fixture.runtime).openDawproject(await inactiveDawprojectTrackFile(options));
	assert.ok(result && validateSoundscaperProject(result.project));
	return { project: result.project, state: fixture.runtime.state };
}
