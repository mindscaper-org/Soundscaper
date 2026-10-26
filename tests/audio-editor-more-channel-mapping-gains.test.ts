/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importDeliveryPresets } from '../src/common/editor/delivery-preset-store.ts';
import { elementByTag, mountedExportDialog } from './helpers/audio-editor-export-dialog-fixture.ts';
import { type ReactTestElement } from './helpers/react-test-dom.ts';

const cases = [
	{ name: 'reviewing without an edit', inputs: [{ channel: 0, gain: 0.25 }, { channel: 1, gain: -0.5 }], edit: null, expected: [{ channel: 0, gain: 0.25 }, { channel: 1, gain: -0.5 }] },
	{ name: 'adding another route', inputs: [{ channel: 0, gain: -0.5 }], edit: 1, expected: [{ channel: 0, gain: -0.5 }, { channel: 1, gain: 1 }] },
	{ name: 'removing another route', inputs: [{ channel: 0, gain: 0.25 }, { channel: 1, gain: -0.5 }], edit: 0, expected: [{ channel: 1, gain: -0.5 }] },
] as const;

for (const entry of cases) test(`imported channel mapping retains untouched gains when ${entry.name}`, async () => {
	const mapping = { channels: [{ inputs: entry.inputs }] };
	const presets = importDeliveryPresets({}, JSON.stringify({ schemaVersion: 1, presets: [{ schemaVersion: 1,
		id: 'quiet', label: 'Quiet difference', kind: 'audio', format: 'wav', settings: { channelMapping: mapping },
	}] })).presets;
	const fixture = await mountedExportDialog({ presets });
	try {
		const trigger = fixture.dom.one('[data-delivery-preset-bar]').querySelector('.dropdown__trigger');
		assert.ok(trigger); await fixture.click(trigger);
		const option = (document.body as unknown as ReactTestElement).querySelectorAll('[role="option"]')
			.find(candidate => candidate.textContent.includes('Quiet difference'));
		assert.ok(option); await fixture.click(option);
		await fixture.click(fixture.editMappingButton());
		if (entry.edit !== null) await fixture.click(fixture.mappingCell(entry.edit, 0));
		await fixture.click(elementByTag(fixture.dom.one('[data-export-channel-mapping-action="apply"]'), 'button'));
		await fixture.startExport();
		assert.deepEqual(fixture.requests[0]?.channelMapping, { channels: [{ inputs: entry.expected }] });
	} finally { await fixture.unmount(); }
});
