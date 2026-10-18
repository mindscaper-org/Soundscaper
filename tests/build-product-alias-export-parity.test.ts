/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	PRODUCT_STAND_IN_ALIASES,
	createProductSubstitutionResolver,
	productSubstitutionForImport,
	productStandInAliasesFor,
} from '../scripts/lib/product-aliases.mjs';

/**
 * The product split is a build-time specifier rewrite: a Soundscaper build
 * resolves `../framescaper-finishing-menu.ts` to a Soundscaper stand-in, and a
 * Framescaper build resolves `./soundscaper-workflow-product-runtime.tsx` to a
 * Framescaper one. The product composition compiler now checks the substituted
 * TypeScript graph. These tests also cover unchecked JavaScript consumers and
 * alternate import spellings across the entire source tree.
 *
 * These tests read the table the build itself resolves through: every name any
 * source file imports across a substituted seam
 * must exist on both sides of it, and every spelling of a substituted module
 * must actually be substituted.
 */

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = resolve(repositoryRoot, 'src');
const SOURCE_EXTENSION = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/u;

const COMPOSITIONS = [
	{ productId: 'soundscaper', desktopCodecComposition: false },
	{ productId: 'soundscaper', desktopCodecComposition: true },
	{ productId: 'framescaper', desktopCodecComposition: false },
	{ productId: 'framescaper', desktopCodecComposition: true },
] as const;

test('product substitutions resolve the imported file, not its relative spelling', () => {
	const composition = { productId: 'soundscaper', desktopCodecComposition: false, repositoryRoot };
	const owner = resolve(repositoryRoot, 'src/common/editor/ui/workspace/VideoPreviewPanel.jsx');
	assert.equal(productSubstitutionForImport(
		'./framescaper-video-proxy-pressure.ts', owner, composition,
	), resolve(repositoryRoot, 'src/soundscaper/editor-video-preview-product-runtime.ts'));
	assert.equal(productSubstitutionForImport(
		'../workspace/framescaper-video-proxy-pressure.ts', owner, composition,
	), resolve(repositoryRoot, 'src/soundscaper/editor-video-preview-product-runtime.ts'));
	assert.equal(productSubstitutionForImport(
		'./framescaper-video-proxy-pressure.ts',
		resolve(repositoryRoot, 'src/common/editor/ui/other/AnotherPanel.jsx'), composition,
	), null);
	assert.equal(productSubstitutionForImport(
		'../common/editor/ui/workspace/framescaper-video-proxy-pressure.ts',
		resolve(repositoryRoot, 'src/soundscaper/editor-video-preview-product-runtime.ts'), composition,
	), null, 'a stand-in may import the original seam for its type contract');
});

test('a source file cannot select two product stand-ins', () => {
	const row = PRODUCT_STAND_IN_ALIASES[0]!;
	assert.throws(() => createProductSubstitutionResolver(repositoryRoot, [
		row, { ...row, standIn: 'src/soundscaper/other-runtime.ts' },
	]), /Conflicting product substitutions/u);
});

test('only desktop Soundscaper substitutes unavailable Framescaper copy owners', () => {
	const copyModules = [
		'native-services', 'finishing-additional', 'visual-inspector-additional',
		'menus-additional', 'finishing-surface', 'inputs',
	];
	for (const composition of COMPOSITIONS) {
		for (const name of copyModules) {
			for (const [prefix, owner] of [
				['./', 'src/common/i18n/editor-copy-inventory.ts'],
				['../../i18n/', 'src/common/editor/ui/application-menu-product-runtime.js'],
				['../../../i18n/', 'src/common/editor/ui/workspace/VideoPreviewPanel.jsx'],
			] as const) {
				const specifier = `${prefix}editor-framescaper-${name}-copy.ts`;
				assert.equal(productSubstitutionForImport(specifier, resolve(repositoryRoot, owner),
					{ ...composition, repositoryRoot }), composition.productId === 'soundscaper'
					&& composition.desktopCodecComposition
					? resolve(repositoryRoot, 'src/common/i18n/editor-desktop-copy.ts') : null, specifier);
			}
		}
	}
});

test('desktop Soundscaper does not compose Framescaper capture setup surfaces', () => {
	const standIn = resolve(repositoryRoot, 'src/soundscaper/editor-capture-toolbar-control.tsx');
	for (const composition of COMPOSITIONS) {
		const expected = composition.productId === 'soundscaper' && composition.desktopCodecComposition
			? standIn : null;
		assert.equal(productSubstitutionForImport('./framescaper-capture-setup-actions.ts',
			resolve(repositoryRoot, 'src/common/editor/app.js'), { ...composition, repositoryRoot }), expected);
		assert.equal(productSubstitutionForImport('./FramescaperInputsSetupFlyout.tsx',
			resolve(repositoryRoot, 'src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx'),
			{ ...composition, repositoryRoot }), expected);
	}
});

interface ModuleImport {
	readonly specifier: string;
	readonly names: readonly string[];
	/** A namespace or bare import names nothing, so parity cannot be checked. */
	readonly opaque: boolean;
	/**
	 * `import type` is erased before the bundler resolves anything, so no alias
	 * row ever applies to it. A stand-in borrows its seam's contract this way.
	 */
	readonly typeOnly: boolean;
}

interface SourceModule {
	readonly file: string;
	readonly imports: readonly ModuleImport[];
}

const STATIC_IMPORT = /(?:^|[\n;])[ \t]*(?:import|export)\s+((?:type\s+)?[^;'"]*?)\s*from\s*['"]([^'"]+)['"]/gu;
const BARE_IMPORT = /(?:^|[\n;])[ \t]*import\s*['"]([^'"]+)['"]/gu;
const DYNAMIC_IMPORT = /(?:(?:const|let|var)\s*\{([^}]*)\}\s*=\s*)?(?:await\s+)?import\(\s*['"]([^'"]+)['"]\s*\)/gu;

const EXPORT_DECLARATION = /(?:^|\n)export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|abstract\s+class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gu;
const EXPORT_LIST = /(?:^|\n)export\s*\{([^}]*)\}/gu;
const EXPORT_STAR = /(?:^|\n)export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*['"]([^'"]+)['"]/gu;
const EXPORT_DEFAULT = /(?:^|\n)export\s+default\b/u;

/** Every maintained module under `src/`, which is the whole substitutable graph. */
function sourceFiles(directory: string, collected: string[] = []): string[] {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) sourceFiles(path, collected);
		else if (SOURCE_EXTENSION.test(entry.name)) collected.push(path);
	}
	return collected;
}

function importedNames(clause: string): { names: string[], opaque: boolean } {
	const trimmed = clause.replace(/^type\s+/u, '').trim();
	const names: string[] = [];
	const braced = /\{([\s\S]*)\}/u.exec(trimmed);
	const leading = braced ? trimmed.slice(0, trimmed.indexOf('{')) : trimmed;
	if (/\*\s+as\s+/u.test(leading)) return { names: [], opaque: true };
	if (/^\s*[A-Za-z_$][\w$]*\s*(?:,|$)/u.test(leading)) names.push('default');
	for (const piece of braced?.[1].split(',') ?? []) {
		const named = piece.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u)[0]?.trim();
		if (named) names.push(named);
	}
	return { names, opaque: false };
}

function moduleImports(text: string): ModuleImport[] {
	const imports: ModuleImport[] = [];
	for (const [, clause = '', specifier = ''] of text.matchAll(STATIC_IMPORT)) {
		imports.push({ specifier, typeOnly: /^type\s/u.test(clause), ...importedNames(clause) });
	}
	for (const [, specifier = ''] of text.matchAll(BARE_IMPORT)) {
		imports.push({ specifier, names: [], opaque: true, typeOnly: false });
	}
	for (const [, destructured, specifier = ''] of text.matchAll(DYNAMIC_IMPORT)) {
		if (destructured === undefined) imports.push({ specifier, names: [], opaque: true, typeOnly: false });
		else imports.push({ specifier, typeOnly: false, ...importedNames(`{${destructured}}`) });
	}
	return imports;
}

/** Every name a module makes importable, following `export * from` re-exports. */
function moduleExports(file: string, seen = new Set<string>()): Set<string> {
	const names = new Set<string>();
	if (seen.has(file) || !existsSync(file)) return names;
	seen.add(file);
	const text = readFileSync(file, 'utf8');
	for (const [, declared] of text.matchAll(EXPORT_DECLARATION)) if (declared) names.add(declared);
	for (const [, list = ''] of text.matchAll(EXPORT_LIST)) {
		for (const piece of list.split(',')) {
			const parts = piece.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u);
			const exported = (parts[1] ?? parts[0])?.trim();
			if (exported) names.add(exported);
		}
	}
	if (EXPORT_DEFAULT.test(text)) names.add('default');
	for (const [, alias, specifier = ''] of text.matchAll(EXPORT_STAR)) {
		if (alias) names.add(alias);
		else for (const name of moduleExports(resolve(dirname(file), specifier), seen)) names.add(name);
	}
	return names;
}

const modules: readonly SourceModule[] = sourceFiles(sourceRoot).map((file) => ({
	file,
	imports: moduleImports(readFileSync(file, 'utf8')),
}));

const standInExports = new Map<string, Set<string>>();
for (const row of PRODUCT_STAND_IN_ALIASES) {
	const standIn = resolve(repositoryRoot, row.standIn);
	standInExports.set(standIn, moduleExports(standIn));
}

test('every stand-in exports the names its substituted seam is imported by', () => {
	const holes: string[] = [];
	for (const composition of COMPOSITIONS) {
		const resolveSubstitution = createProductSubstitutionResolver(repositoryRoot, productStandInAliasesFor(composition));
		for (const { file, imports } of modules) {
			for (const entry of imports) {
				if (entry.typeOnly || entry.opaque) continue;
				const standIn = resolveSubstitution(entry.specifier, file);
				if (standIn === null) continue;
				const available = standInExports.get(standIn) ?? new Set<string>();
				const missing = entry.names.filter((name) => !available.has(name));
				if (!missing.length) continue;
				holes.push(
					`${composition.productId} resolves '${entry.specifier}' from `
					+ `${relative(repositoryRoot, file)} to ${relative(repositoryRoot, standIn)}, which does not export `
					+ missing.join(', '),
				);
			}
		}
	}
	assert.deepEqual(holes, [], holes.join('\n'));
});
