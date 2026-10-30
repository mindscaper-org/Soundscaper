import { readFile } from 'node:fs/promises';

import { COMPONENT_COPY } from '../../vendor/audacity-design-system/components/src/component-copy.ts';
import { currentTranslations } from '../../src/common/i18n/translation-catalog.js';

// Clip locators live outside audio-editor-test-helpers.js, which sits at the
// maintainability size cap.
//
// English callers match the name before the placement announcement. Localized
// callers supply the current description template, preserving its grammar while
// leaving only the formatted start and duration unconstrained.
export function clipNameAccessiblePattern(name, descriptionTemplate = null) {
	if (descriptionTemplate) {
		const parts = descriptionTemplate.split(/(\{(?:name|start|duration)\})/u);
		const pattern = parts.map(part => {
			if (part === '{name}') return escapeForRegExp(name);
			if (part === '{start}' || part === '{duration}') return '.+?';
			return escapeForRegExp(part);
		}).join('');
		return new RegExp(`^${pattern}$`, 'u');
	}
	return new RegExp(`^${escapeForRegExp(name)} clip(?:,|$)`);
}

export function clipByName(editor, name, descriptionTemplate = null) {
	return editor.getByRole('group', { name: clipNameAccessiblePattern(name, descriptionTemplate) });
}

function escapeForRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function clipDescriptionForLocale(locale) {
	const key = 'ui.designSystem.clipDescription';
	const catalog = JSON.parse(await readFile(new URL(`../../src/common/i18n/translations/${locale}.json`, import.meta.url), 'utf8'));
	const copy = currentTranslations(catalog, { [key]: COMPONENT_COPY.clipDescription }, { locale });
	return copy[key] ?? COMPONENT_COPY.clipDescription;
}
