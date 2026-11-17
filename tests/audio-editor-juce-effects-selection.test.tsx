/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JUCE_EFFECTS, juceEffectLabel } from '../src/common/editor/juce-effects/catalog.ts';
import { findJuceEffectEntry } from '../src/common/editor/juce-effects/registry-selection.ts';
import type { NativePluginEntryView } from '../src/common/editor/native-plugin-host-contract.ts';
import { SoundscaperNativeEffectManagePanel } from '../src/common/editor/ui/dialogs/SoundscaperNativeEffectPanels.tsx';
import { EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE } from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import { resolveSoundscaperNativeServicesCopy } from '../src/common/editor/ui/soundscaper-native-services-copy.ts';
import { createSoundscaperNativeServicesSurfaceHost } from '../src/common/editor/ui/workspace/SoundscaperNativeServicesSurface.tsx';
import type { SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import type { SoundscaperNativeServicesDialogProps } from '../src/common/editor/ui/dialogs/SoundscaperNativeServicesDialog.tsx';

const chorus: NativePluginEntryView = { entryId: 'chorus', stablePluginId: 'org.soundscaper.juce.chorus',
	format: 'clap', name: 'JUCE Chorus', vendor: 'Soundscaper', eligible: false, ineligibleReason: 'allowance-required',
	installations: [{ installationId: 'chorus-install', version: '1', allowed: false, selected: true, quarantined: false }] };

test('menu insertion forwards the chosen identity, keeps manager controls on reopen and starts another insertion separately', async () => {
	let rendered: React.ReactNode;
	const host = createSoundscaperNativeServicesSurfaceHost({ bridge: {} as SoundscaperNativeServicesBridge,
		documentValue: { createElement: () => ({ dataset: {}, remove() {} }), querySelector: () => null,
			body: { append() {} } } as unknown as Document,
		createHostRoot: () => ({ render(node) { rendered = node; }, unmount() {} }) });
	const props = (): SoundscaperNativeServicesDialogProps => (rendered as React.ReactElement<{
		children: React.ReactElement<SoundscaperNativeServicesDialogProps>;
	}>).props.children.props;
	host.open('native-effect-manage', chorus.stablePluginId);
	assert.equal(props().requestedJuceEffectId, chorus.stablePluginId);
	const first = host.dialogRuntime;
	assert.equal(props().runtime, first);
	host.open('native-effect-manage');
	assert.equal(host.dialogRuntime, first, 'ordinary manager reopens existing controls');
	host.open('native-effect-manage', 'org.soundscaper.juce.phaser');
	assert.notEqual(host.dialogRuntime, first, 'another insertion has independent controls');
	assert.equal(props().requestedJuceEffectId, 'org.soundscaper.juce.phaser');
	const effectRuntime = host.dialogRuntime;
	host.open('native-instrument-manage');
	assert.notEqual(host.dialogRuntime, effectRuntime, 'MIDI instrument controls have their own runtime');
	const instrumentRuntime = host.dialogRuntime;
	host.open('native-instrument-manage');
	assert.equal(host.dialogRuntime, instrumentRuntime, 'instrument controls remain reachable after closing their view');
	host.open('native-effect-manage');
	assert.equal(host.dialogRuntime, effectRuntime, 'effects cannot reopen an instrument editor');
	await host.dispose();
});

test('JUCE selection uses scanned CLAP identity and cannot match a copied display name', () => {
	const spoof = { ...chorus, stablePluginId: 'other.chorus' };
	assert.equal(findJuceEffectEntry([spoof, chorus], chorus.stablePluginId), chorus);
	assert.equal(findJuceEffectEntry([spoof], chorus.stablePluginId), undefined);
	assert.equal(findJuceEffectEntry([{ ...chorus, format: 'vst3' }], chorus.stablePluginId), undefined);
	assert.equal(findJuceEffectEntry([chorus], 'unknown'), undefined);
});

test('targeted JUCE manager selects the requested installation without granting allowance', () => {
	const actions: unknown[] = [];
	const html = renderToStaticMarkup(<SoundscaperNativeEffectManagePanel
		copy={resolveSoundscaperNativeServicesCopy()} disabled={false} requestedJuceEffectId={chorus.stablePluginId}
		state={{ ...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, registry: { entries: [chorus] } }}
		perform={action => { actions.push(action); }} />);
	assert.match(html, /aria-selected="true"/u);
	assert.match(html, /data-native-plugin-allowance="allow"/u);
	assert.match(html, /<h3>JUCE Chorus<\/h3>/u);
	assert.deepEqual(actions, []);
});

test('catalogue identities, normalized bounds, enum choices and translated menu labels are consistent', () => {
	assert.equal(new Set(JUCE_EFFECTS.map(effect => effect.stablePluginId)).size, 18);
	for (const [index, effect] of JUCE_EFFECTS.entries()) {
		assert.equal(effect.code, index + 1);
		assert.equal(effect.parameters.at(-1)?.name, 'Output gain');
		for (const parameter of effect.parameters) {
			assert.ok(parameter.min <= parameter.initial && parameter.initial <= parameter.max);
			assert.ok(!parameter.logarithmic || parameter.min > 0);
			if (parameter.choices) assert.equal(parameter.choices.length, parameter.max - parameter.min + 1);
		}
	}
	assert.equal(juceEffectLabel(JUCE_EFFECTS[3]!, { 'ui.soundscaperNative.juceChorus': 'Chor übersetzt' }), 'Chor übersetzt');
});
