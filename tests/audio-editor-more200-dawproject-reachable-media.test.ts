/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const location of ['disabled', 'scene'] as const) test(`File Open does not decode ${location} DAWproject media into the arrangement`, async () => {
	const file = await archive(location);
	const fixture = createFixture();
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(file);
	assert.ok(opened);
	assert.equal(opened.project.clips.length, 1, 'an unused wide source cannot discard a healthy arrangement');
	assert.equal(opened.project.sources.length, 1);
});

test('a referenced audio timeline declared in a Scene still supplies the enabled arrangement alias', async () => {
	const file = await archive('alias');
	const fixture = createFixture();
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(file);
	assert.equal(opened?.project.clips.length, 1);
});

test('an actually enabled 33-channel arrangement source keeps its existing import refusal', async () => {
	const fixture = createFixture();
	await assert.rejects(createNativeProjectService(fixture.runtime).openDawproject(await archive('active')),
		/Audio import supports 1–32 channels/u);
	assert.deepEqual(fixture.switched, []);
});

for (const location of ['deep', 'cycle'] as const) test(`arrangement reference discovery respects ${location} expansion admission`, async () => {
	const fixture = createFixture();
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(await archive(location));
	assert.equal(opened?.project.clips.length, 1);
});

async function archive(location: 'disabled' | 'scene' | 'alias' | 'active' | 'deep' | 'cycle'): Promise<File> {
	const audio = (path: string, id = '') => `<Audio ${id ? `id="${id}"` : ''} channels="${path === 'wide.wav' ? 33 : 1}" sampleRate="48000" duration="0.01"><File path="${path}"/></Audio>`;
	const clip = (path: string, enabled = true) => `<Clip time="0" duration="0.01" enable="${enabled}">${audio(path)}</Clip>`;
	const arrangement = location === 'alias' ? '<Clip time="0" duration="0.01" reference="shared"/>'
		: location === 'active' ? clip('wide.wav') : clip('healthy.wav') + (location === 'disabled' ? clip('wide.wav', false)
			: location === 'deep' || location === 'cycle' ? '<Clip time="0" duration="0.01" reference="chain0"/>' : '');
	const scene = location === 'scene' ? `<Scene><Clips>${clip('wide.wav')}</Clips></Scene>`
		: location === 'alias' ? `<Scene>${audio('healthy.wav', 'shared')}</Scene>`
			: location === 'deep' || location === 'cycle' ? `<Scene><Lanes>${Array.from({ length: 30 }, (_, index) =>
				`<Lanes id="chain${index}"><Clips><Clip time="0" duration="0.01" reference="chain${index + 1}"/></Clips></Lanes>`).join('')}
				<Lanes id="chain30"><Clips><Clip time="0" duration="0.01"${location === 'cycle' ? ' reference="chain0"' : ''}>
				${location === 'deep' ? audio('wide.wav') : ''}</Clip></Clips></Lanes></Lanes></Scene>` : '';
	const blob = (channels: number) => new Blob([Uint8Array.from(encodeWav(
		Array.from({ length: channels }, () => new Float32Array(480).fill(.25)), { sampleRate: 48_000, float: true }))]);
	const body = await writeDawprojectArchive({ metadataXml: '<MetaData/>',
		projectXml: `<Project version="1.0"><Structure><Track id="track" contentType="audio"><Channel role="regular"/></Track></Structure>
			<Arrangement><Lanes timeUnit="seconds" track="track"><Clips>${arrangement}</Clips></Lanes></Arrangement><Scenes>${scene}</Scenes></Project>`,
		files: [{ path: 'healthy.wav', blob: blob(1) }, { path: 'wide.wav', blob: blob(33) }],
	});
	return new File([body], 'Unused media.dawproject');
}
