/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import AudioSettingsPreferencesPage from '../src/common/editor/ui/dialogs/AudioSettingsPreferencesPage.jsx';
import DesktopFfmpegPreferencePanel from '../src/common/editor/ui/dialogs/DesktopFfmpegPreferencePanel.tsx';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function setup() {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	return { dom, root, async restore() {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	} };
}

test('Audio settings switches the offset target to Default input when an unsaved device is unplugged', async () => {
	const fixture = setup();
	const { dom, root } = fixture;
	const saved: unknown[] = [];
	const controller = { actions: { recording: {
		setLatencyOffset: (value: number) => { saved.push(['global', value]); },
		setSourceOffset: (key: string, value: number) => { saved.push([key, value]); },
	} } };
	const render = (devices: readonly { deviceId: string; label: string }[]) => root.render(
		<AudioSettingsPreferencesPage controller={controller} copy={ENGLISH_COPY}
			snapshot={{ monitor: { latencyOffsetMs: 10 }, recordingInputs: { devices, offsets: {} } }}
			run={(operation: () => unknown) => operation()} />,
	);
	try {
		await act(async () => render([{ deviceId: 'usb-mic', label: 'USB microphone' }]));
		const source = dom.container.querySelectorAll('select').find((candidate) => candidate.querySelector('[value="device:usb-mic"]'));
		assert.ok(source);
		await act(async () => reactProps(source).onChange({ currentTarget: { value: 'device:usb-mic' } }));
		assert.equal(dom.one(`[aria-label="${ENGLISH_COPY.latencyOffset}"]`).value, '0');
		await act(async () => render([]));
		const offset = dom.one(`[aria-label="${ENGLISH_COPY.latencyOffset}"]`);
		assert.equal(offset.value, '10', 'the visible fallback must use the global offset');
		await act(async () => reactProps(offset).onChange({ currentTarget: { value: '25' } }));
		await act(async () => reactProps(offset).onBlur());
		assert.deepEqual(saved, [['global', 25]], 'editing the visible Default input must update that source');
	} finally { await fixture.restore(); }
});

test('External FFmpeg keeps the configured location and enabled retry actions after a transient Browse failure', async () => {
	for (const configured of [
		{ location: '/usr/local/bin/ffmpeg', version: '8.0' },
		{ location: '/fixture/bin/ffmpeg', version: '9.0.1' },
	]) {
		const fixture = setup();
		const { dom, root } = fixture;
		const ready = { state: 'ready', ...configured, detail: '',
			canInstall: false, canBrowse: true, canClear: true };
		let attempts = 0;
		const calls: string[] = [];
		const bridge = {
			getExternalFfmpegStatus: async () => { calls.push('get'); return ready; },
			chooseExternalFfmpeg: async () => {
				calls.push('choose');
				attempts += 1;
				if (attempts === 1) throw new Error('The file chooser could not open.');
				return ready;
			},
			clearExternalFfmpeg: async () => { assert.fail('Browse must not clear the configured host.'); },
			rescanExternalFfmpeg: async () => { assert.fail('Browse must use the real chooser bridge method.'); },
		};
		const fileService = createAudioEditorFileService({ bridge });
		try {
			await act(async () => root.render(<DesktopFfmpegPreferencePanel fileService={fileService} />));
			assert.equal(fileService.isDesktop, true);
			assert.equal(dom.one('[data-external-ffmpeg-preference]').getAttribute('data-external-ffmpeg-state'), 'ready');
			assert.deepEqual(calls, ['get']);
			const browse = dom.container.querySelectorAll('button').find((candidate) => candidate.textContent === 'Browse');
			assert.ok(browse);
			await act(async () => { void reactProps(browse).onClick({}); await Promise.resolve(); });
			assert.equal(dom.one('[data-external-ffmpeg-preference]').getAttribute('data-external-ffmpeg-state'), 'error');
			assert.equal(browse.hasAttribute('disabled'), false, 'Browse remains available for a retry');
			assert.equal(dom.one('input').value, ready.location, 'an IPC failure does not erase the last known configuration');
			assert.ok(dom.container.textContent.includes('The file chooser could not open.'));
			assert.ok(dom.container.textContent.includes(`Detected version: ${ready.version}`));
			await act(async () => { void reactProps(browse).onClick({}); await Promise.resolve(); });
			assert.equal(attempts, 2);
			assert.equal(dom.one('[data-external-ffmpeg-preference]').getAttribute('data-external-ffmpeg-state'), 'ready');
			assert.equal(dom.one('input').value, ready.location);
			assert.deepEqual(calls, ['get', 'choose', 'choose']);
			assert.equal(dom.container.textContent.includes('The file chooser could not open.'), false);
		} finally { await fixture.restore(); }
	}
});
