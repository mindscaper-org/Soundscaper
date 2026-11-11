/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DesktopSettingsStore } from '../desktop/settings.js';
import type { ExternalFfmpegPreferenceSettings } from '../desktop/external-ffmpeg-preference-service.ts';

test('automatic selection provenance survives evidence updates, invalidation, and disk reload', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-ffmpeg-selection-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const filePath = join(root, 'settings.json');
	const executablePath = join(root, 'ffmpeg');
	const settings = new DesktopSettingsStore(filePath);
	await settings.load(['en']);
	await settings.setExternalFfmpegSelection(executablePath, 'automatic');
	assert.equal(selectionSource(settings), 'automatic');
	await settings.setExternalFfmpegProbeMetadata({ executablePath, identity: null, capabilities: null });
	assert.equal(selectionSource(settings), 'automatic');
	await settings.clearExternalFfmpegProbeMetadata(executablePath);
	const reopened = new DesktopSettingsStore(filePath);
	await reopened.load(['en']);
	assert.equal(selectionSource(reopened), 'automatic');
	await reopened.setExternalFfmpegSelection(executablePath);
	assert.equal(selectionSource(reopened), 'manual');
	const pinned = new DesktopSettingsStore(filePath);
	await pinned.load(['en']);
	assert.equal(selectionSource(pinned), 'manual');
});

test('legacy selections retain their manual priority when provenance was not recorded', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-ffmpeg-legacy-selection-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const filePath = join(root, 'settings.json');
	const executablePath = join(root, 'ffmpeg');
	await writeFile(filePath, JSON.stringify({
		schemaVersion: 1, locale: 'en',
		externalFfmpegSelection: { executablePath, identity: null, capabilities: null },
	}));
	const settings = new DesktopSettingsStore(filePath);
	await settings.load(['en']);
	assert.equal(selectionSource(settings), 'manual');
});

function selectionSource(settings: Pick<ExternalFfmpegPreferenceSettings, 'snapshot'>) {
	return settings.snapshot().externalFfmpegSelection?.source;
}
