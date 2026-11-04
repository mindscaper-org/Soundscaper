/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { exportDialogCompressionLevels } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';

test('desktop export dialog lists every format and checks the selected format without a global codec notice', async () => {
	const [dialog, overlays] = await Promise.all([
		readFile('src/common/editor/ui/inspector/ExportDialog.jsx', 'utf8'),
		readFile('src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', 'utf8'),
	]);
	assert.match(overlays, /<ExportDialog[\s\S]*?fileService=\{fileService\}/u);
	assert.match(dialog, /useDesktopExportAvailability\(fileService, isOpen, operationOwner, settings/u);
	assert.match(dialog, /audioFormatDescriptors\.map/u);
	assert.doesNotMatch(dialog, /desktopExportFormatAvailable|desktopCodecNotice/u);
	assert.match(dialog, /exportDialogCompressionLevels\(settings\.format, desktop\)/u);
	assert.deepEqual(exportDialogCompressionLevels('wavpack', true), [0, 1, 2, 3, 4, 5]);
	assert.match(dialog, /!availability\.available/u);
	assert.match(dialog, /hasTimelineVideo \? VIDEO_EXPORT_DIALOG_FORMATS\.map/u);
	assert.match(dialog, /<ExportFormatAvailabilityDialog/u);
	assert.match(dialog, /exportDialogBitRateOptions\(settings\.format, desktop, settings\.sampleRate/u);
	assert.match(dialog, /exportDialogVorbisQualityOptions\(desktop\)/u);
	assert.match(dialog, /max=\{maximumAudioSampleRate\}/u);
	assert.match(dialog, /disabled=\{blocked \|\| admRequired \|\| Boolean\(desktopFormatRefusal\)\}/u);
	assert.doesNotMatch(dialog, /data-desktop-codec-status/u);
});
