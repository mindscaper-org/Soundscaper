/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DesktopFfmpegPreferencePanel, {
	normalizeDesktopFfmpegStatus,
} from '../src/common/editor/ui/dialogs/DesktopFfmpegPreferencePanel.tsx';

test('normalizes the sanitized desktop FFmpeg status contract defensively', () => {
	assert.deepEqual(normalizeDesktopFfmpegStatus({
		state: 'ready',
		location: '/opt/homebrew/bin/ffmpeg',
		version: '7.1.1',
		detail: 'Capability probes passed.',
		canInstall: false,
		canBrowse: true,
		canClear: true,
	}), {
		state: 'ready',
		location: '/opt/homebrew/bin/ffmpeg',
		version: '7.1.1',
		detail: 'Capability probes passed.',
		canInstall: false,
		canBrowse: true,
		canClear: true,
	});
	assert.deepEqual(normalizeDesktopFfmpegStatus({
		state: 'invented', location: '/untrusted/ffmpeg', canBrowse: 'yes',
	}), {
		state: 'unavailable',
		location: null,
		version: null,
		detail: '',
		canInstall: false,
		canBrowse: false,
		canClear: false,
	});
});

test('renders the configured location as display-only status with bounded actions', () => {
	const markup = renderToStaticMarkup(<DesktopFfmpegPreferencePanel
		fileService={{
			getExternalFfmpegStatus: async () => ({ state: 'unavailable' }),
			chooseExternalFfmpeg: async () => ({ state: 'unavailable' }),
			clearExternalFfmpeg: async () => ({ state: 'unavailable' }),
			rescanExternalFfmpeg: async () => ({ state: 'unavailable' }),
			installExternalFfmpeg: async () => ({ state: 'unavailable' }),
		}}
		initialStatus={{
			state: 'ready',
			location: 'C:\\Tools\\ffmpeg.exe',
			version: '8.0.2',
			detail: 'FFmpeg 8.0.2 passed the compatibility probe.',
			canInstall: true,
			canBrowse: true,
			canClear: true,
		}}
	/>);

	assert.match(markup, /data-external-ffmpeg-preference="true"/u);
	assert.match(markup, /data-external-ffmpeg-state="ready"/u);
	assert.match(markup, /value="C:\\Tools\\ffmpeg.exe"/u);
	assert.match(markup, /readOnly=""/u);
	assert.match(markup, /<h4[^>]*>FFmpeg<\/h4>/u);
	assert.match(markup, /Used to import\/export proprietary file formats\./u);
	assert.match(markup, /Detected version: <\/span><strong>8\.0\.2<\/strong>/u);
	assert.doesNotMatch(markup, /is ready|passed the compatibility probe/u);
	assert.match(markup, />Browse</u);
	assert.doesNotMatch(markup, />Clear</u);
	assert.match(markup, />Rescan</u);
	assert.doesNotMatch(markup, />Install</u);
});

for (const state of ['unconfigured', 'unsupported', 'quarantined', 'error']) {
	test(`keeps Install and diagnostic details available when FFmpeg is ${state}`, () => {
		const markup = renderToStaticMarkup(<DesktopFfmpegPreferencePanel
			fileService={{
				getExternalFfmpegStatus: async () => ({ state }),
				installExternalFfmpeg: async () => ({ state: 'ready' }),
			}}
			initialStatus={{
				state,
				location: '/fixture/bin/ffmpeg',
				version: '3.0.0',
				detail: 'The selected installation needs attention.',
				canInstall: true,
			}}
		/>);

		assert.match(markup, /The selected installation needs attention\./u);
		assert.match(markup, />Install</u);
		assert.doesNotMatch(markup, /disabled=""[^>]*><span[^>]*>Install</u);
	});
}

test('a missing desktop bridge yields a disabled, actionable unavailable surface', () => {
	const markup = renderToStaticMarkup(<DesktopFfmpegPreferencePanel
		fileService={{}}
		initialStatus={{ state: 'unavailable' }}
	/>);

	assert.match(markup, /External FFmpeg controls are unavailable in this desktop build/u);
	assert.equal((markup.match(/disabled=""/gu) || []).length, 3);
});
