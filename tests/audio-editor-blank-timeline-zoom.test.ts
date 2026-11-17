/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';

test('ordinary zoom can frame forty minutes before recording and retains its scale across viewport updates', async context => {
	const { controller } = await controllerSession(context);
	controller.actions.timeline.setViewportWidth(960);
	for (let step = 0; step < 10; step++) controller.actions.timeline.zoomOut();
	assert.ok(960 / controller.getSnapshot().timeline.pixelsPerSecond >= 40 * 60);
	assert.equal(controller.actions.timeline.setZoom(960 / (40 * 60)), 0.4);
	controller.actions.timeline.setViewportWidth(1_200);
	assert.equal(controller.getSnapshot().timeline.pixelsPerSecond, 0.4);
	assert.equal(controller.actions.timeline.zoomIn(), 0.8);
	assert.equal(controller.actions.timeline.zoomOut(), 0.4);
	assert.equal(controller.actions.timeline.zoomFit(960), 32);
});
