/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import EffectPresetBar from '../src/common/editor/ui/inspector/EffectPresetBar.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

function renderBar(options: { defaultParams?: Record<string, unknown>; currentParams?: Record<string, unknown>; selectedId?: string; unsaved?: boolean } = {}): string {
	return renderToStaticMarkup(<ThemeProvider><EffectPresetBar
		copy={{ noEffectPreset: 'No preset', effectPresetCustom: 'custom' }}
		presets={[{ id: 'custom', label: 'My preset', custom: true }]}
		onSelect={() => undefined} onSave={() => undefined} onSaveAs={() => undefined}
		onReset={() => undefined} onDelete={() => undefined} onImport={() => undefined}
		onExport={() => undefined} onDefault={() => undefined}
		{...options}
	/></ThemeProvider>);
}

function resetDisabled(markup: string): boolean {
	const button = markup.match(/<button[^>]*aria-label="Undo"[^>]*>/u)?.[0];
	assert.ok(button);
	return /disabled=""/u.test(button);
}

test('Audacity default baseline displays Default preset and arms Reset only for edits', () => {
	const clean = renderBar({ defaultParams: { ratio: 10, thresholdDb: -10 }, currentParams: { thresholdDb: -10, ratio: 10 } });
	assert.match(clean, />Default preset</u);
	assert.doesNotMatch(clean, />Default preset\*</u);
	assert.equal(resetDisabled(clean), true);
	const edited = renderBar({ defaultParams: { ratio: 10, thresholdDb: -10 }, currentParams: { thresholdDb: -12, ratio: 10 } });
	assert.match(edited, />Default preset\*</u);
	assert.equal(resetDisabled(edited), false);
});

test('native preset bars keep the No preset baseline and named preset Reset behavior', () => {
	const empty = renderBar({ unsaved: true });
	assert.match(empty, />No preset</u);
	assert.equal(resetDisabled(empty), true);
	const edited = renderBar({ selectedId: 'custom', unsaved: true });
	assert.match(edited, />My preset \(custom\)\*</u);
	assert.equal(resetDisabled(edited), false);
	assert.equal(resetDisabled(renderBar({ selectedId: 'custom', unsaved: false })), true);
});

test('selecting a named preset retains its own edit state even when Audacity defaults are supplied', () => {
	const named = renderBar({
		selectedId: 'custom', unsaved: false,
		defaultParams: { ratio: 10 }, currentParams: { ratio: 4 },
	});
	assert.match(named, />My preset \(custom\)</u);
	assert.equal(resetDisabled(named), true);
});

test('same-name delivery presets preserve distinct selection identities', async () => {
	const dom = installReactTestDom();
	const selected: string[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		await act(async () => { root.render(<EffectPresetBar
			copy={{ noEffectPreset: 'No preset', effectPresetCustom: 'custom' }}
			presets={[{ id: 'first', label: 'Favorite', custom: true },
				{ id: 'second', label: 'Favorite', custom: true }]}
			selectedId="second" onSelect={(id: string) => selected.push(id)}
			onSave={() => undefined} onSaveAs={() => undefined} onReset={() => undefined}
			onDelete={() => undefined} onImport={() => undefined} onExport={() => undefined}
		/>); });
		const toggle = reactProps(dom.one('.dropdown__trigger')).onClick;
		await act(async () => { (toggle as () => void)(); });
		const options = dom.container.ownerDocument.body.querySelectorAll('[role="option"]');
		assert.equal(options.length, 3);
		assert.equal(options[1].getAttribute('aria-selected'), 'false');
		assert.equal(options[2].getAttribute('aria-selected'), 'true');
		const choose = reactProps(options[2]).onClick;
		await act(async () => { (choose as () => void)(); });
		assert.deepEqual(selected, ['second']);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
