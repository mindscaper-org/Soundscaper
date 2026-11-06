/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { parseIxmlPayload } from '../src/common/editor/ixml.ts';
import { createDeliveryReportForPlan } from '../src/common/editor/delivery-conversion-inventory.ts';
import { createOriginalOverwriteActions, isOriginalOverwriteSettings } from '../src/common/editor/controller/export/internal/overwrite-original-action.ts';
import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { createDesktopOriginalImportRecorder, resetDesktopOriginal } from '../src/common/editor/desktop-overwrite-original.ts';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import { createFixture } from './helpers/export-service-fixture.ts';

const warning = 'delivery.ixml-file-uid-omitted';
async function recorderProject() {
	// BWF MetaEdit26.08.1 embeds physical FILE_UID and shared FAMILY_UID into stereo PCM.
	const encoded = await readFile(new URL('./fixtures/bwfmetaedit-file-uid.wav.base64', import.meta.url), 'utf8');
	const input = new File([Buffer.from(encoded.trim(), 'base64')], 'Recorder.wav', { type: 'audio/wav' });
	const info = await inspectWavBlobPcm(input); assert.ok(info.ixml);
	return createSoundscaperProject({ sampleRate: 48_000, masterChannels: 2,
		sources: [{ id: 'source', name: input.name, channelCount: 2, frameCount: 4800, sampleRate: 48_000, sampleFormat: 'float32', storageKey: 'source' }],
		clips: [{ id: 'clip', sourceId: 'source', sourceStartFrame: 0, timelineStartFrame: 0, durationFrames: 4800 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Recorder', clipIds: ['clip'] }], metadata: { ixml: info.ixml } });
}

test('new rendered BWF ranges omit physical source identity and report the conversion', async () => {
	const project = await recorderProject();
	const source = structuredClone(project.metadata.ixml);
	for (const endFrame of [1920, 3840]) {
		const plan = createExportPlan(project, { format: 'bwf', channelMapping: 'preserve', bitDepth: 16, range: { startFrame: 0, endFrame } });
		assert.ok(plan.ixml); assert.doesNotMatch(plan.ixml.rawXml, /<FILE_UID>/u);
		assert.match(plan.ixml.rawXml, /<FAMILY_UID>TAKE-FAMILY-0001<\/FAMILY_UID>/u);
		assert.deepEqual(plan.ixml.tracks.map(track => track.channelIndex), [4, 6]);
		const report = createDeliveryReportForPlan(plan, { sampleRate: 48_000 });
		const omitted = report.items.find(item => item.code === warning);
		assert.ok(omitted); assert.equal(omitted.disposition, 'omitted'); assert.equal(omitted.severity, 'warning');
		assert.equal(plan.outputFrames, endFrame);
	}
	assert.deepEqual(project.metadata.ixml, source, 'native/source recorder identity remains untouched');
});

for (const mode of ['mix', 'stems', 'clips', 'chapters']) test(`new ${mode} files never claim the original physical FILE_UID`, async () => {
	const original = await recorderProject();
	const project = createSoundscaperProject({ ...original, sequences: undefined, tracks: [...original.tracks,
		{ id: 'labels', type: 'label', name: 'Chapters', labels: [{ id: 'a', title: 'First', startFrame: 0, endFrame: 2400 }, { id: 'b', title: 'Second', startFrame: 2400, endFrame: 4800 }] }] });
	const plan = createExportPlan(project, { format: 'bwf', mode, channelMapping: 'preserve', bitDepth: 16 });
	assert.ok(plan.ixml); assert.doesNotMatch(plan.ixml.rawXml, /<FILE_UID>/u);
	for (const output of plan.outputs) if (output.ixml) assert.doesNotMatch(output.ixml.rawXml, /<FILE_UID>/u);
	assert.equal(createDeliveryReportForPlan(plan, { sampleRate: 48_000 }).items.filter(item => item.code === warning).length, 1);
	assert.deepEqual(createExportPlan(project, { format: 'bwf', mode, channelMapping: 'preserve', bitDepth: 16 }), plan,
		'planned delivery remains deterministic for persistent exact-plan execution');
});

test('vendor file identifiers, inert text and ordinary metadata do not become physical-file warnings', async () => {
	const original = await recorderProject();
	const rawXml = '<BWFXML><PROJECT>Location</PROJECT><VENDOR><FILE_UID>Private recorder identity</FILE_UID></VENDOR>'
		+ '<!--<FILE_UID>Inert</FILE_UID>--><NOTE><![CDATA[<FILE_UID>Literal</FILE_UID>]]></NOTE></BWFXML>';
	const project = createSoundscaperProject({ ...original, metadata: { ixml: parseIxmlPayload(new TextEncoder().encode(rawXml)) } });
	const plan = createExportPlan(project, { format: 'bwf', channelMapping: 'preserve', bitDepth: 16 });
	assert.equal(plan.ixml?.rawXml, rawXml);
	assert.equal(createDeliveryReportForPlan(plan, { sampleRate: 48_000 }).items.some(item => item.code === warning), false);
});

test('same-file Original preserves identity only during its authorized adapter invocation', async () => {
	const project = await recorderProject();
	const encoded = await readFile(new URL('./fixtures/bwfmetaedit-file-uid.wav.base64', import.meta.url), 'utf8');
	const file = new File([Buffer.from(encoded.trim(), 'base64')], 'Recorder.wav', { type: 'audio/wav' });
	const fixture = createFixture();
	let current = createSoundscaperProject({ id: project.id, sampleRate: project.sampleRate });
	const plans: ReturnType<typeof createExportPlan>[] = [];
	const stopAtPlan = new Error('Plan captured before rendering');
	const service = createEditorExportService({ ...fixture.runtime, getProject: () => current,
		createExportPlan: (_project: unknown, options: Readonly<Record<string, unknown>>) => {
			plans.push(createExportPlan(project, options)); throw stopAtPlan;
		} });
	registerDesktopOriginalFile(file, { id: 'c'.repeat(48), name: file.name });
	await createDesktopOriginalImportRecorder({ state: fixture.state, getProject: () => ({ ...current }) }, async () => { current = project; })(file);
	let authorized: unknown;
	const actions = createOriginalOverwriteActions({ state: fixture.state, getProject: () => ({ ...current }),
		fileService: { originalOverwriteAvailable: true, prepareOriginalOverwrite: async () => ({ id: 'original-target' }) },
		handleExportAction: async (action, settings) => {
			authorized = settings; assert.equal(isOriginalOverwriteSettings(settings), true);
			assert.ok(settings && typeof settings === 'object');
			assert.equal(isOriginalOverwriteSettings({ ...settings }), false, 'copied settings have no original-file identity authority');
			return await service.handleExportAction(action, settings);
		} });
	try {
		assert.equal(actions.overwriteOriginalAvailable(), true);
		await actions.overwriteOriginal();
		const original = plans[0]; assert.ok(original);
		assert.match(original.ixml?.rawXml ?? '', /<FILE_UID>RECORDER-FILE-UNIQUE-0001<\/FILE_UID>/u);
		assert.equal(createDeliveryReportForPlan(original, { sampleRate: 48_000 }).items.some(item => item.code === warning), false);
		assert.equal(isOriginalOverwriteSettings(authorized), false, 'identity authority ends when the invocation settles');
		assert.ok(authorized && typeof authorized === 'object');
		await service.handleExportAction('start', { ...authorized, preserveIxmlFileIdentity: true, saveTarget: { id: 'new-file-target' } });
		const delivered = plans[1]; assert.ok(delivered);
		assert.doesNotMatch(delivered.ixml?.rawXml ?? '', /<FILE_UID>/u, 'a new-file saveTarget and caller field cannot claim Original identity');
		assert.deepEqual(fixture.errors, [stopAtPlan, stopAtPlan]);
	} finally { resetDesktopOriginal(fixture.state); }
});
