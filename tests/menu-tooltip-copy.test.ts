/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMenuTooltipResolver } from '../src/common/editor/ui/menu-tooltip-copy.ts';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { timeCodeFormatOptionsForDomain } from '../vendor/audacity-design-system/components/src/TimeCode/time-code-formats.ts';
import { createTrackSelectionContextMenuItems } from '../src/common/editor/ui/timeline/track-selection-context-menu.ts';
import { createTrackHeightMenu } from '../src/common/editor/ui/timeline/track-height-menu.ts';

test('purpose copy explains the result without repeating the command name', () => {
	const resolve = createMenuTooltipResolver(EDITOR_ENGLISH_COPY);
	assert.match(String(resolve('Limiter', 'audacity-limiter')), /threshold.*clipping/u);
	assert.doesNotMatch(String(resolve('Limiter', 'audacity-limiter')), /limit/iu);
	assert.match(String(resolve('Copy', 'copy')), /clipboard/u);
	assert.equal(resolve('Unknown extension command'), null);
	assert.equal(resolve('Convolution Reverb', 'juce-effect-convolution'), null);
	assert.equal(resolve('Convolution Reverb'), null);
});

test('translated labels and independently translated explanations resolve through catalog identities', () => {
	const resolve = createMenuTooltipResolver({ ...EDITOR_ENGLISH_COPY, copy: 'Kopieren',
		'ui.menuTooltips.copy': 'Legt die gewählten Inhalte in die Zwischenablage.' });
	assert.equal(resolve('Kopieren'), 'Legt die gewählten Inhalte in die Zwischenablage.');
	assert.equal(resolve('A user project title', 'recent-project-123'), EDITOR_ENGLISH_COPY['ui.menuTooltips.recent-project']);
});

test('context commands and time display formats have purposes appropriate to their scope', () => {
	const resolve = createMenuTooltipResolver(EDITOR_ENGLISH_COPY);
	for (const option of timeCodeFormatOptionsForDomain('time', 60)) {
		assert.ok(resolve(option.label, `time-format-${option.format}`), option.format);
	}
	assert.match(String(resolve('Seconds', 'time-format-seconds')), /duration/u);
	assert.match(String(resolve('Seconds', 'snap-seconds')), /Align edits/u);
	const track = { id: 'lane', type: 'audio', clipIds: [] };
	const commands = createTrackSelectionContextMenuItems({ project: { tracks: [track], clips: [] }, track,
		copy: EDITOR_ENGLISH_COPY, audioEffects: true, blocked: false });
	const height = createTrackHeightMenu({ copy: EDITOR_ENGLISH_COPY, disabled: false,
		onDecrease() {}, onIncrease() {}, onFit() {} });
	for (const item of [...commands.shared, ...commands.audio.flatMap(item => item.items ?? []), height, ...height.items]) {
		assert.ok(resolve(item.label, item.id), `${item.id}: ${item.label}`);
	}
});
