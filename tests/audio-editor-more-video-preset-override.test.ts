/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { importDeliveryPresets } from '../src/common/editor/delivery-preset-store.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { mountedExportDialog } from './helpers/audio-editor-export-dialog-fixture.ts';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const edited of ['size', 'rate', 'target'] as const) test(`MI30: an imported automatic video preset permits an explicit ${edited} override`, async () => {
	const presets = importDeliveryPresets({}, JSON.stringify({ schemaVersion: 1, presets: [{
		schemaVersion: 1, id: 'automatic', label: 'Small automatic', kind: 'video', format: 'mp4',
		settings: { maximumWidth: 640, maximumHeight: 360, maximumFrameRate: { num: 24, den: 1 } },
	}] })).presets;
	const fixture = await mountedExportDialog({ video: true, presets });
	try {
		await fixture.chooseFormat(ENGLISH_COPY.videoExportMp4);
		const trigger = fixture.dom.one('[data-delivery-preset-bar]').querySelector('.dropdown__trigger'); assert.ok(trigger);
		await fixture.click(trigger);
		const option = (document.body as unknown as ReactTestElement).querySelectorAll('[role="option"]')
			.find(node => node.textContent.includes('Small automatic')); assert.ok(option);
		await fixture.click(option);
		if (edited === 'target') {
			const target = fixture.dom.one('[data-effect-field="deliveryTarget"]').querySelector('.dropdown__trigger'); assert.ok(target);
			await fixture.click(target);
			const choice = (document.body as unknown as ReactTestElement).querySelectorAll('[role="option"]')
				.find(node => node.textContent === 'Web 1080p'); assert.ok(choice);
			await fixture.click(choice);
		}
		else {
			const changes = edited === 'size' ? [['canvasWidth', '1920'], ['canvasHeight', '1080']] : [['canvasFrameRate', '60']];
			for (const [name, value] of changes) {
				const input = fixture.dom.one(`[data-export-field="${name === 'canvasFrameRate' ? name : 'canvasSize'}"]`)
					.querySelector(name === 'canvasFrameRate' ? 'input' : `[aria-label="${name === 'canvasWidth' ? ENGLISH_COPY.videoCanvasWidth : ENGLISH_COPY.videoCanvasHeight}"]`);
				assert.ok(input);
				await act(async () => { reactProps(input).onChange({ currentTarget: { value } }); });
			}
		}
		await fixture.startExport();
		assert.equal(fixture.requests.length, 1);
		const project = { sampleRate: 48_000,
			clips: [{ id: 'clip', kind: 'video', sourceId: 'camera', timelineStartFrame: 0, sourceStartFrame: 0,
				durationFrames: 48_000, sourceDurationFrames: 48_000 }],
			tracks: [{ id: 'video', type: 'video', clipIds: ['clip'] }],
			sources: [{ id: 'camera', kind: 'video', storageKey: 'camera', name: 'Camera.mp4', mimeType: 'video/mp4',
				frameRate: 60, sampleRate: 48_000, frameCount: 48_000, width: 1920, height: 1080, hasAudio: false }] };
		const plan = createVideoExportPlan(project, { ...fixture.requests[0], format: 'mp4', range: 'project' });
		assert.deepEqual([plan.canvas.width, plan.canvas.height], edited === 'rate' ? [640, 360] : [1920, 1080]);
		assert.equal(plan.canvas.frameRate, edited === 'rate' ? 60 : 24);
	} finally { await fixture.unmount(); }
});
