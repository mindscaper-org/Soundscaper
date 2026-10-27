/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopExportCodecQuery, desktopExportCodecCapabilities, desktopExportFormatReason } from '../src/common/editor/ui/desktop-export-codec-model.ts';
import { desktopVideoExportCapabilities, desktopVideoExportFormatReason } from '../src/common/editor/desktop-video-export-capability.ts';

const copy = { 'ui.desktopFfmpeg.codecConfigure': 'FFmpeg unter {edit} > {preferences} > {general} einrichten.',
	'ui.desktopFfmpeg.codecSettings': 'Rate oder Kanäle ändern; {preferences} öffnen.',
	'ui.desktopFfmpeg.codecCustomUnsupported': 'Eigene FFmpeg-Argumente sind hier nicht verfügbar.',
	'ui.desktopFfmpeg.codecVideoUnavailable': '{formats}: FFmpeg unter {preferences} einrichten.',
	editMenu: 'Bearbeiten', preferences: 'Einstellungen', effectCardGeneral: 'Allgemein' };

test('actual failed desktop codec capability data retains semantic reasons and localizes menu guidance', () => {
	const query = createDesktopExportCodecQuery({ sampleRate: 48_000, channelMapping: 'stereo' }, 2);
	const capabilities = desktopExportCodecCapabilities(null, query);
	assert.equal(capabilities.formats.opus?.reasonCode, 'configure-external-ffmpeg');
	assert.equal(desktopExportFormatReason('opus', capabilities, false, copy), 'FFmpeg unter Bearbeiten > Einstellungen > Allgemein einrichten.');
	assert.equal(desktopExportFormatReason('opus', capabilities, true, copy), 'Rate oder Kanäle ändern; Einstellungen öffnen.');
	assert.equal(desktopExportFormatReason('custom-ffmpeg', capabilities, false, copy), 'Eigene FFmpeg-Argumente sind hier nicht verfügbar.');
});
test('real missing desktop video capabilities display translated guidance rather than the stored diagnostic', () => {
	const capabilities = desktopVideoExportCapabilities(null);
	assert.equal(desktopVideoExportFormatReason('mp4', capabilities, copy), 'MP4: FFmpeg unter Einstellungen einrichten.');
	assert.match(capabilities.formats.mp4.reason ?? '', /FFmpeg/u, 'original capability diagnostic retained');
});
