/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect } from '@playwright/test';
import { commitInput } from './audio-editor-test-helpers.js';

const LABELS = { startFrame: 'Start', durationFrame: 'Length', sourceInFrame: 'Trim start',
	fadeInFrame: 'Fade in', fadeOutFrame: 'Fade out' };

/** Numeric inspector fields show seconds; focus exposes their complete native precision. */
export async function readClipTimeFrames(properties, field, sampleRate = 48_000) {
	const input = properties.getByRole('textbox', { name: LABELS[field], exact: true });
	await input.focus();
	await expect(input).toBeFocused();
	return Math.round(Number(await input.inputValue()) * sampleRate);
}

export async function expectClipTimeFrames(properties, field, frames, sampleRate = 48_000) {
	await expect.poll(() => readClipTimeFrames(properties, field, sampleRate)).toBe(frames);
}

export async function setClipTimeFrames(properties, field, frames, sampleRate = 48_000) {
	await commitInput(properties.getByRole('textbox', { name: LABELS[field], exact: true }), String(frames / sampleRate));
	await expectClipTimeFrames(properties, field, frames, sampleRate);
}
