/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';
import { installMilestone7LocalAssistanceFixture } from './helpers/milestone-7-local-assistance.js';
import { createRound7SpeechPreviewBridge } from '../helpers/round7-speech-preview-bridge.ts';
import { resolveEditorCopyScope } from '../../src/common/i18n/editor-copy-scope.ts';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { currentTranslations } from '../../src/common/i18n/translation-catalog.js';
import germanCatalog from '../../src/common/i18n/translations/de.json' with { type: 'json' };
import { COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE } from '../../src/common/i18n/community-translations-copy.ts';

test('translation preview preserves speech already generated for review', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1100 });
	await installMilestone7LocalAssistanceFixture(page);
	await page.addInitScript(createRound7SpeechPreviewBridge, true);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const en = COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE.en;
	await chooseCommandAction(page, editor, 'Help', en.menu);
	const translator = page.getByRole('dialog', { name: en.title, exact: true });
	await expect(translator.getByRole('checkbox', { name: en.preview, exact: true })).toBeVisible();
	await chooseCommandAction(page, editor, 'Generate', 'Text to Speech');
	const speech = page.locator('[data-text-to-speech]');
	await speech.getByRole('textbox', { name: 'Script', exact: true }).fill('A normal narration to review.');
	await speech.getByRole('button', { name: 'Generate preview', exact: true }).click();
	const audio = speech.locator('audio');
	await expect.poll(() => audio.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
	const source = await audio.getAttribute('src');
	await translator.getByRole('checkbox', { name: en.preview, exact: true }).check();
	await expect(page.getByRole('dialog', { name: resolveEditorCopyScope('communityTranslations', COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE.en, currentTranslations(germanCatalog, EDITOR_ENGLISH_COPY)).title, exact: true })).toBeVisible();
	await expect(audio).toHaveCount(1);
	await expect(audio).toHaveAttribute('src', source);
	await expect(speech.getByRole('button', { name: 'Generate preview', exact: true })).toHaveCount(0);
	expect(errors).toEqual([]);
});
