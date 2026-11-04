/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const DESIGN_SYSTEM_RUNTIME = new URL('src/common/editor/ui/DesignSystemRuntime.jsx', ROOT);
const DESIGN_SYSTEM_STYLES = new URL('src/common/editor/ui/audio-editor-design-system/', ROOT);
const DIALOG_STYLES = new URL('src/common/editor/ui/dialogs/', ROOT);

/**
 * A `var()` fallback is silent: a token that exists nowhere always resolves to
 * its hardcoded literal, so a light-theme colour survives into dark theme with
 * no error anywhere. Every custom property a stylesheet reads therefore has to
 * be defined by the runtime, base stylesheet or the owning component.
 */
test('dialog stylesheets only read defined editor theme tokens', async () => {
	const runtime = await readFile(DESIGN_SYSTEM_RUNTIME, 'utf8');
	const defined = new Set([...runtime.matchAll(/'(--[\w-]+)'\s*:/gu)].map(([, name]) => name));
	const base = await readFile(new URL('01-tokens-base.css', DESIGN_SYSTEM_STYLES), 'utf8');
	for (const [, name] of base.matchAll(/(--[\w-]+)\s*:/gu)) defined.add(name);
	assert.ok(defined.size > 10, 'the runtime publishes a token palette');

	const missing = [];
	const dialogFiles = await readdir(DIALOG_STYLES);
	const components = await Promise.all(dialogFiles.filter((entry) => /\.[jt]sx$/u.test(entry))
		.map((entry) => readFile(new URL(entry, DIALOG_STYLES), 'utf8')));
	for (const entry of dialogFiles) {
		if (!entry.endsWith('.css')) continue;
		const css = await readFile(new URL(entry, DIALOG_STYLES), 'utf8');
		for (const name of undefinedDialogTokens(entry, css, defined, components)) missing.push(`${entry}: ${name}`);
	}

	assert.deepEqual(missing, [], 'undefined tokens always fall back to their literal colour');
});

test('dialog token ownership follows JSX and TSX stylesheet imports', () => {
	const components = [
		"import './spectrum-plot.css'; const style = { '--curve': color };",
		'import "./spectrum-plot.css"; const style = { "--legend": color } as CSSProperties;',
		"import './other-dialog.css'; const style = { '--unrelated': color };",
	];
	assert.deepEqual(undefinedDialogTokens('spectrum-plot.css', `
		.plot { --local: red; color: var(--theme); stroke: var(--curve); }
		.legend { color: var(--legend); background: var(--local); }
		.missing { color: var(--unrelated, red); border-color: var(--typo); }
	`, new Set(['--theme']), components), ['--unrelated', '--typo']);
	assert.deepEqual(undefinedDialogTokens('unowned.css', '.plot { color: var(--curve); }',
		new Set(), components), ['--curve']);
});

function undefinedDialogTokens(stylesheet, css, defined, components) {
	const ownedTokens = new Set(defined);
	for (const [, name] of css.matchAll(/(--[\w-]+)\s*:/gu)) ownedTokens.add(name);
	// Only components importing this stylesheet can supply its local tokens.
	for (const component of components) {
		const imports = [...component.matchAll(/^\s*import\s+['"]\.\/([^'"]+\.css)['"]/gmu)];
		if (!imports.some(([, path]) => path === stylesheet)) continue;
		for (const [, name] of component.matchAll(/['"](--[\w-]+)['"]\s*:/gu)) ownedTokens.add(name);
	}
	return [...css.matchAll(/var\(\s*(--[\w-]+)/gu)]
		.map(([, name]) => name).filter((name) => !ownedTokens.has(name));
}

test('the vendored footer stylesheet only reads tokens the runtime publishes', async () => {
	const runtime = await readFile(DESIGN_SYSTEM_RUNTIME, 'utf8');
	const defined = new Set([...runtime.matchAll(/'(--[\w-]+)'\s*:/gu)].map(([, name]) => name));
	const css = await readFile(new URL('vendor/audacity-design-system/components/src/Footer/Footer.css', ROOT), 'utf8');
	const read = [...new Set([...css.matchAll(/var\(\s*(--[\w-]+)/gu)].map(([, name]) => name))];

	assert.ok(read.length > 0, 'the footer is themed through custom properties');
	assert.deepEqual(
		read.filter((name) => !defined.has(name)),
		[],
		'an undefined token leaves the footer on its light literal fallback in every theme',
	);
});

test('editor design-system styles do not read nonexistent theme-token aliases', async () => {
	const invalid = [];
	for (const entry of await readdir(DESIGN_SYSTEM_STYLES)) {
		if (!entry.endsWith('.css')) continue;
		const css = await readFile(new URL(entry, DESIGN_SYSTEM_STYLES), 'utf8');
		for (const [, name] of css.matchAll(
			/var\(\s*(--(?:border|control-hover|text-muted))(?![\w-])/gu,
		)) invalid.push(`${entry}: ${name}`);
	}

	assert.deepEqual(invalid, []);
});

test('the inline video clip rename field does not inherit its light-on-dark header colour', async () => {
	const componentRoot = new URL('vendor/audacity-design-system/components/src/ClipHeader/', ROOT);
	const [css, component] = await Promise.all([
		readFile(new URL('ClipHeader.css', componentRoot), 'utf8'),
		readFile(new URL('ClipHeader.tsx', componentRoot), 'utf8'),
	]);
	const rule = /\.clip-header__name-input\s*\{([^}]*)\}/u.exec(css);
	assert.ok(rule, 'the rename field is styled');
	assert.match(rule[1], /background:\s*rgba\(255,\s*255,\s*255/u, 'the field is a light surface');
	assert.doesNotMatch(
		rule[1],
		/color:\s*inherit/u,
		'inheriting the header colour puts near-white text on a near-white field',
	);
	assert.match(rule[1], /color:\s*var\(--clip-header-text\)/u);
	assert.match(component, /'--clip-header-text':\s*'#14151A'/u, 'the shared header supplies dark text');
});

test('checkboxes keep their design-system appearance without editor border overrides', async () => {
	const css = await readFile(new URL('01-tokens-base.css', DESIGN_SYSTEM_STYLES), 'utf8');
	assert.doesNotMatch(css, /\.checkbox\s*\{/u, 'the design system owns checkbox styling');
});

test('context-menu checkmark cells keep their design-system appearance', async () => {
	const css = await readFile(new URL('01-tokens-base.css', DESIGN_SYSTEM_STYLES), 'utf8');
	assert.doesNotMatch(css, /\.context-menu-item-checkmark\s*\{/u);
});
