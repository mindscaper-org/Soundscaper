/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { AudioDevicesFlyout } from '../src/common/editor/ui/toolbar/AudioDevicesFlyout.jsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('the display source chooser shares the device controls recording admission', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = (busy: Readonly<Record<string, unknown>>) => <AudioDevicesFlyout
		copy={ENGLISH_COPY} audioHostRuntime={null} displayAudioSupported
		snapshot={{ ...busy, audioDevices: {
			host: 'browser', inputs: [], outputs: [], preferredInputDeviceId: 'display',
			inputSupported: true, displayInputSupported: true, displayCaptureOpen: true,
		} }}
		controller={{ actions: { audioDevices: { configureDisplayInput() {} }, recording: {} } }}
		run={(operation: () => unknown) => operation()}
	/>;
	try {
		for (const phase of ['recording', 'recordingStarting', 'recordingScheduling', 'scheduledRecording']) {
			await act(async () => root.render(render({ [phase]: true })));
			const chooser = [...dom.container.querySelectorAll('button')].find(button => button.textContent === ENGLISH_COPY.audioDeviceChangeDisplaySource);
			assert.ok(chooser);
			assert.equal(chooser.hasAttribute('disabled'), true, `${phase} prevents changing the active capture source`);
		}
		await act(async () => root.render(render({})));
		const chooser = [...dom.container.querySelectorAll('button')].find(button => button.textContent === ENGLISH_COPY.audioDeviceChangeDisplaySource);
		assert.ok(chooser);
		assert.equal(chooser.hasAttribute('disabled'), false, 'the source can be changed again after recording finishes');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
