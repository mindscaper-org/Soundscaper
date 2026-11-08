/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorMixerPanel from '../src/common/editor/ui/workspace/AudioEditorMixerPanel.jsx';
import { createNativePluginEffect } from '../src/common/editor/native-plugin-effect.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const readOnly of [false, true]) {
	test(`Mixer ${readOnly ? 'suspends project edits' : 'labels its local enabled action'} for a manually bypassed native effect`, async () => {
		const effect = createNativePluginEffect({ id: 'gain', enabled: true, bypassed: true,
			params: { instanceId: 'gain-instance', latencyFrames: 0 },
			context: { format: 'ladspa', stablePluginId: 'org.test.gain', binarySha256: 'a'.repeat(64) } });
		const project = createSoundscaperProject({ id: 'mixer-controls',
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', effects: [effect] })] });
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const prior = { react: globals.React, act: globals.IS_REACT_ACT_ENVIRONMENT };
		globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const updates: unknown[][] = [];
		const controller = { getSnapshot: () => ({ project }), getTelemetrySnapshot: () => ({ meters: {} }),
			subscribeTelemetry: () => () => undefined, actions: {
				effects: { update: (...args: unknown[]) => { updates.push(args); } }, track: { update() {} },
				mixer: { beginParameterGesture: () => 0, previewParameterGesture() {}, commitParameterGesture() {}, cancelParameterGesture() {} },
			} };
		try {
			await act(async () => root.render(<AudioEditorMixerPanel controller={controller}
				snapshot={{ project, readOnly, productId: 'soundscaper', capabilities: {}, effects: { rackTypes: [] } }}
				copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()} showArmControls={false}
				displayAudioSupported={false} onOpenEffects={() => undefined} automationRuntime={undefined} />));
			const power = dom.one('.mixer-effect__power');
			assert.equal(power.getAttribute('aria-label'), 'Disable effect');
			assert.equal(power.hasAttribute('disabled'), readOnly);
			assert.equal(dom.one('.mixer-fader').getAttribute('aria-disabled'), readOnly ? 'true' : null);
			if (!readOnly) {
				await act(async () => { reactProps(power).onClick?.({}); });
				assert.deepEqual(updates, [['track', 'voice', 'gain', { enabled: false }]]);
			}
		} finally {
			await act(async () => root.unmount());
			globals.React = prior.react; globals.IS_REACT_ACT_ENVIRONMENT = prior.act;
			dom.restore();
		}
	});
}
