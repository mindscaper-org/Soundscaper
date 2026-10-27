/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { LIGHTSCAPER_SHARED_EFFECT_COPY_DE } from '../src/common/i18n/lightscaper-develop-shared-effect-copy.ts';
import { VIDEO_EFFECT_COPY_BY_LOCALE } from '../src/common/i18n/video-effect-copy.js';
import { EAGER_CHUNK_GROUPS, dynamicRelativeImports, resolveRelativeModule, sourceModules, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HOOK = 'src/common/editor/ui/lightscaper/use-lightscaper-editor-copy.ts';
const DEVELOP = ['lightscaper-develop-copy', 'lightscaper-develop-settings-copy', 'lightscaper-develop-soft-proof-copy',
	'lightscaper-develop-brush-mask-copy', 'lightscaper-develop-local-adjustments-copy', 'lightscaper-develop-mask-management-copy',
	'lightscaper-develop-preview-renderer-copy', 'lightscaper-raw-development-copy', 'lightscaper-develop-repair-spots-copy',
	'lightscaper-develop-input-quality-copy', 'lightscaper-develop-shared-effect-copy'].map(name => `src/common/i18n/${name}.ts`);
const HDR_MENU = 'src/common/editor/ui/lightscaper/use-photo-hdr-merge-entry-current-v1.tsx';
const HDR_COPY = 'src/common/i18n/image-hdr-merge-copy.ts';
const DEPTH_COPY = 'src/common/i18n/lightscaper-photo-raster-depth-copy.ts';
const VISUAL = 'src/common/i18n/video-effect-copy.js';
const GERMAN_VISUAL = 'src/common/i18n/lightscaper-develop-shared-effect-copy.ts';
const COPY_MODULES = [...sourceModules(resolve(ROOT, 'src/common/i18n')), resolve(ROOT, HOOK)];
const TRANSFER = 'src/common/editor/platform/bounded-transfer.ts';
const CURRENT_IMAGE_LEAVES = ['video-effects-v2.ts', 'video-color-cube-lut-v27.ts',
	'video-color-management-v27.ts', 'video-color-byte-encoding.ts', 'video-color-grade-channels.ts'].map(name => `src/common/editor/${name}`);
const CURRENT_PACK_TAGS = ['scape-photo-catalog-pack-v2.ts', 'scape-photo-catalog-pack-v3.ts', 'scape-photo-catalog-pack-v4.ts', 'scape-photo-cube-lut.ts'].map(name => `src/common/editor/${name}`);
const PHOTO_OWNERS = new Set(['editor-neutral-foundations', 'editor-photo-library-scalars', 'editor-imaging',
	'editor-media-storage-contracts', 'editor-media-custody-storage',
	'editor-dialog-foundations', 'editor-file-saving', 'editor-scape-archive-bytes',
	'lightscaper-editor-copy', 'lightscaper-develop-copy', 'editor-visual-effect-copy']);
const PHOTO_COOWNERS = sourceModules(resolve(ROOT, 'src')).filter(path => PHOTO_OWNERS.has(chunkGroupForModulePath(path) ?? ''));

test('optional develop labels and shared visual labels have exact independent nonrecursive owners', () => {
	for (const [paths, owner] of [[DEVELOP, 'lightscaper-develop-copy'], [[VISUAL], 'editor-visual-effect-copy']] as const) {
		for (const path of paths) for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), owner, path);
			for (const impostor of [path + '.foreign', path.replace('-copy.', '-future-copy.')]) {
				assert.notEqual(chunkGroupForModulePath(impostor.replaceAll('/', separator)), owner, impostor);
			}
		}
		const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
		assert.equal(group.priority, 98); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
		assert.equal(group.includeDependenciesRecursively, false);
	}
	for (const path of [HOOK, 'src/common/i18n/lightscaper-editor-copy.ts', 'src/common/i18n/lightscaper-develop-menu-copy.ts']) {
		assert.equal(chunkGroupForModulePath(path), 'lightscaper-editor-copy', path);
	}
});

test('shared HDR and raster depth labels keep exact inert owners apart from canonical timeline catalogs', () => {
	const source = runtimeSource(resolve(ROOT, HDR_MENU));
	assert.ok(staticRelativeDependencies(source).includes('../../../i18n/image-hdr-merge-copy.ts'));
	assertLazyEntry(source, '../dialogs/ImageHdrMergeDialogCurrentV1.tsx');
	// Pay every i18n co-owner reached through the real eager menu hook, even
	// when that owner is not in the photo runtime walker's finite owner set.
	const reached = copyClosure(HDR_MENU); assert.ok(reached.has(HDR_COPY));
	assert.deepEqual(COPY_MODULES.filter(path => chunkGroupForModulePath(path) === 'editor-hdr-merge-copy')
		.map(path => relative(ROOT, path).split(sep).join('/')).sort(), [HDR_COPY]);
	assert.deepEqual(staticRelativeDependencies(runtimeSource(resolve(ROOT, HDR_COPY))), []);
	assert.deepEqual(dynamicRelativeImports(runtimeSource(resolve(ROOT, HDR_COPY))), []);
	assert.ok(EAGER_CHUNK_GROUPS.has('editor-hdr-merge-copy'));
	for (const owner of ['lightscaper-develop-copy', 'lightscaper-photo-png-export-copy']) assert.ok(!EAGER_CHUNK_GROUPS.has(owner));
	for (const path of reached) assert.doesNotMatch(path, /\/i18n\/(?:canonical-extras[^/]*|catalogs|runtime|editor-copy-inventory)\.|\/project-strip-control-index-v21\./u, path);
	for (const [path, owner] of [[HDR_COPY, 'editor-hdr-merge-copy'], [DEPTH_COPY, 'lightscaper-photo-png-export-copy']] as const) {
		for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), owner, path);
			for (const foreign of [path + '.foreign', path.replace('-copy.', '-future-copy.'), path.replace('i18n/', 'i18n/nested/')]) {
				assert.notEqual(chunkGroupForModulePath(foreign.replaceAll('/', separator)), owner, foreign);
			}
		}
		const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
		assert.equal(group.priority, 98); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
		assert.equal(group.includeDependenciesRecursively, false);
	}
	for (const path of ['src/common/i18n/canonical-extras.js', 'src/common/i18n/canonical-extras-standard-effects.js']) {
		assert.equal(chunkGroupForModulePath(path), 'editor-copy', path);
	}
	const canonical = chunkGroups.find(candidate => candidate.name === 'editor-copy'); assert.ok(canonical);
	assert.equal(canonical.priority, 97); assert.equal(canonical.maxSize, 490_000); assert.equal(canonical.includeDependenciesRecursively, false);
});

test('ordinary photo copy cannot acquire develop or timeline catalogs through co-owned labels', () => {
	const reached = copyClosure(HOOK);
	for (const path of [...DEVELOP, VISUAL, 'src/common/i18n/canonical-extras.js', 'src/common/i18n/catalogs.js']) {
		assert.ok(!reached.has(path), `Ordinary photo copy loads ${path}`);
	}
});

test('the real import-preset copy route retains visual labels without canonical audio catalogs', () => {
	for (const version of ['V2', 'CurrentV1']) {
		const dialog = `src/common/editor/ui/lightscaper/PhotoImportDialog${version}.tsx`;
		assert.ok(staticRelativeDependencies(runtimeSource(resolve(ROOT, dialog))).includes('./internal/PhotoImportDialogKernelV1.tsx'));
	}
	const kernel = runtimeSource(resolve(ROOT, 'src/common/editor/ui/lightscaper/internal/PhotoImportDialogKernelV1.tsx'));
	assert.ok(staticRelativeDependencies(kernel).includes('../../../../i18n/lightscaper-develop-settings-copy.ts'));
	const reached = copyClosure(DEVELOP[1]!);
	assert.ok(reached.has(DEVELOP[0]!)); assert.ok(reached.has(VISUAL));
	assert.ok(reached.has(GERMAN_VISUAL));
	for (const path of reached) assert.doesNotMatch(path, /\/i18n\/(?:canonical-extras[^/]*|catalogs|runtime|editor-copy-inventory)\./u);
	assert.deepEqual(staticRelativeDependencies(runtimeSource(resolve(ROOT, VISUAL))), []);
	assert.deepEqual(staticRelativeDependencies(runtimeSource(resolve(ROOT, GERMAN_VISUAL))), []);
	assert.deepEqual(dynamicRelativeImports(runtimeSource(resolve(ROOT, GERMAN_VISUAL))), []);
});

test('historical and Current photo applications retain actual lazy entries with unchanged shared label identity', () => {
	const legacy = runtimeSource(resolve(ROOT, 'src/common/editor/ui/lightscaper/LightscaperApp.tsx'));
	for (const name of ['./PhotoImportDialog.tsx', './PhotoDevelopWorkspace.tsx']) assertLazyEntry(legacy, name);
	for (const version of ['V2', 'CurrentV1']) {
		const wrapper = runtimeSource(resolve(ROOT, `src/common/editor/ui/lightscaper/LightscaperApp${version}.tsx`));
		assert.ok(staticRelativeDependencies(wrapper).includes('./LightscaperAppKernelV1.tsx'));
	}
	const kernel = runtimeSource(resolve(ROOT, 'src/common/editor/ui/lightscaper/LightscaperAppKernelV1.tsx'));
	assertLazyEntry(kernel, './LightscaperPhotoImportSurfaceV1.tsx');
	assert.ok(staticRelativeDependencies(kernel).includes('./LightscaperPhotoDevelopSurfaceV1.tsx'));
	const imports = runtimeSource(resolve(ROOT, 'src/common/editor/ui/lightscaper/LightscaperPhotoImportSurfaceV1.tsx'));
	const develop = runtimeSource(resolve(ROOT, 'src/common/editor/ui/lightscaper/LightscaperPhotoDevelopSurfaceV1.tsx'));
	for (const version of ['V2', 'CurrentV1']) {
		assert.ok(staticRelativeDependencies(imports).includes(`./PhotoImportDialog${version}.tsx`));
		assertLazyEntry(develop, `./PhotoDevelopWorkspace${version}.tsx`);
	}
	for (const [locale, shared] of [['en', VIDEO_EFFECT_COPY_BY_LOCALE.en], ['de', LIGHTSCAPER_SHARED_EFFECT_COPY_DE],
		['de-AT', LIGHTSCAPER_SHARED_EFFECT_COPY_DE]] as const) {
		assert.equal(photoDevelopCopy(locale).shared, shared);
		assert.equal(photoDevelopSettingsCopy(locale).shared, shared);
	}
});

test('the photo-owned German effect table preserves every prior shared label', () => {
	assert.deepEqual(Object.keys(LIGHTSCAPER_SHARED_EFFECT_COPY_DE).sort(), Object.keys(VIDEO_EFFECT_COPY_BY_LOCALE.en).sort());
	// Snapshot of VIDEO_EFFECT_COPY_BY_LOCALE.de at 220099a0e, before the common German table moved to JSON.
	const snapshot = JSON.stringify(Object.keys(LIGHTSCAPER_SHARED_EFFECT_COPY_DE).sort()
		.map(key => [key, LIGHTSCAPER_SHARED_EFFECT_COPY_DE[key as keyof typeof LIGHTSCAPER_SHARED_EFFECT_COPY_DE]]));
	assert.equal(createHash('sha256').update(snapshot).digest('hex'), '07cb5a1d23789f13a496966d33bf6b1f4c8127cf1bd5fd4ba59f79ad055cb539');
	assert.ok(Object.isFrozen(LIGHTSCAPER_SHARED_EFFECT_COPY_DE));
});

test('shared current transfer and image leaves have neutral owners without timeline dependencies', () => {
	assert.equal(chunkGroupForModulePath(TRANSFER), 'editor-neutral-foundations');
	assert.deepEqual(staticRelativeDependencies(runtimeSource(resolve(ROOT, TRANSFER))), []);
	for (const path of CURRENT_IMAGE_LEAVES) {
		for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), 'editor-imaging', path);
			assert.notEqual(chunkGroupForModulePath((path + '.foreign').replaceAll('/', separator)), 'editor-imaging');
		}
		const source = runtimeSource(resolve(ROOT, path));
		assert.deepEqual(dynamicRelativeImports(source), [], path);
		for (const specifier of staticRelativeDependencies(source)) {
			const target = resolveRelativeModule(resolve(ROOT, path), specifier); assert.ok(target, specifier);
			assert.ok(PHOTO_OWNERS.has(chunkGroupForModulePath(target) ?? ''), `${path} imports ${specifier}`);
		}
	}
	const channels = runtimeSource(resolve(ROOT, 'src/common/editor/video-color-grade-channels.ts'));
	assert.deepEqual(staticRelativeDependencies(channels), [], 'Channel arithmetic retains no runtime timeline or grade-model dependency.');
	for (const name of ['video-effects-v3.ts', 'video-color-management-v28.ts', 'video-color-cube-lut-v28.ts',
		'video-color-grade-channels-future.ts', 'internal/video-color-grade-channels.ts', 'video-clip-composition.ts']) {
		assert.notEqual(chunkGroupForModulePath(`src/common/editor/${name}`), 'editor-imaging', name);
	}
});

// These are generic pixel/frame mask evaluators, not project/timeline owners.
const MASK_PROCESSING_DEPENDENCIES = {
	'video-mask-luminance-range-v1.ts': ['./closed-domain-value.ts', './imaging/pixel-frame-contract-v1.ts'],
	'video-mask-color-range-v1.ts': [],
	'video-mask-matte-graph-work-v1.ts': ['./video-mask-matte-v24.ts', './video-mask-path-raster.ts'],
	'video-mask-path-raster.ts': [],
	'video-mask-matte-rgba-v13.ts': ['./closed-domain-value.ts', './video-mask-matte-v24.ts', './video-mask-luminance-range-v1.ts',
		'./video-mask-color-range-v1.ts', './video-mask-matte-graph-work-v1.ts', './imaging/image-develop-brush-mask-v1.ts', './imaging/mask-raster-source-scope-v1.ts'],
} as const;
void test('the finite generic mask pixel closure keeps exact imaging ownership and closed runtime dependencies', () => {
	const group = chunkGroups.find(candidate => candidate.name === 'editor-imaging'); assert.ok(group);
	assert.equal(group.priority, 66); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
	assert.equal(group.includeDependenciesRecursively, false);
	for (const [leaf, dependencies] of Object.entries(MASK_PROCESSING_DEPENDENCIES)) {
		const path = `src/common/editor/${leaf}`;
		for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), 'editor-imaging', path);
			for (const impostor of [path + '.foreign', path.replace(/(?:-v[0-9]+)?\.ts$/u, '-v999.ts'), path.replace('editor/', 'editor/internal/')]) {
				assert.notEqual(chunkGroupForModulePath(impostor.replaceAll('/', separator)), 'editor-imaging', impostor);
			}
		}
		const source = runtimeSource(resolve(ROOT, path));
		assert.deepEqual([...staticRelativeDependencies(source)].sort(), [...dependencies].sort(), path);
		assert.deepEqual(dynamicRelativeImports(source), [], path);
		for (const specifier of dependencies) {
			const target = resolveRelativeModule(resolve(ROOT, path), specifier); assert.ok(target, specifier);
			assert.equal(chunkGroupForModulePath(target), specifier === './closed-domain-value.ts' ? 'editor-neutral-foundations' : 'editor-imaging', specifier);
		}
	}
	for (const leaf of ['video-mask-matte-ffmpeg-v1.ts', 'video-mask-luminance-range-v2.ts', 'video-mask-color-range-v2.ts', 'video-mask-project-v1.ts', 'video-mask-path-raster-v2.ts']) {
		assert.notEqual(chunkGroupForModulePath(`src/common/editor/${leaf}`), 'editor-imaging', leaf);
	}
});

test('shared scalar admission and archive JSON leaves keep exact owners and finite runtime dependencies', () => {
	const contracts = {
		'project-validation-primitives.ts': ['editor-neutral-foundations', []],
		'video-preview-capture-admission.ts': ['editor-neutral-foundations', []],
		'scape-literal-json-keys.ts': ['editor-neutral-foundations', []],
		'scape-project-document-encode.ts': ['editor-scape-archive-bytes', ['./scape-literal-json-keys.ts']],
	} as const;
	for (const [leaf, [owner, dependencies]] of Object.entries(contracts)) {
		const path = `src/common/editor/${leaf}`;
		for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), owner, path);
			for (const foreign of [path + '.foreign', path.replace('editor/', 'editor/internal/')]) {
				assert.notEqual(chunkGroupForModulePath(foreign.replaceAll('/', separator)), owner, foreign);
			}
		}
		const source = runtimeSource(resolve(ROOT, path));
		assert.deepEqual(staticRelativeDependencies(source), dependencies, path);
		assert.deepEqual(dynamicRelativeImports(source), [], path);
	}
});

void test('all actual photo cold entries retain an empty complete timeline-domain closure', () => {
	const violations = new Set<string>();
	for (const entry of ['src/lightscaper/ui/LightscaperBootstrap.tsx', 'src/common/editor/ui/lightscaper/PhotoImportDialogV2.tsx',
		'src/common/editor/ui/lightscaper/PhotoImportDialogCurrentV1.tsx', 'src/lightscaper/controller/photo-library-backup-v5.ts',
		'src/lightscaper/controller/photo-library-backup-current-v1.ts']) {
		for (const path of inspectPhotoRuntimeClosure(entry)) {
			if (chunkGroupForModulePath(resolve(ROOT, path)) === 'editor-domain') violations.add(path);
		}
	}
	assert.deepEqual([...violations].sort(), [], 'The complete real static and paid co-owned photo runtime must contain no timeline-domain leaves.');
});

test('the actual photo bootstrap and import dialog stay cold across non-i18n co-owned runtime modules', () => {
	for (const entry of ['src/lightscaper/ui/LightscaperBootstrap.tsx', 'src/common/editor/ui/lightscaper/PhotoImportDialogV2.tsx',
		'src/common/editor/ui/lightscaper/PhotoImportDialogCurrentV1.tsx']) {
		const reached = photoRuntimeClosure(entry);
		for (const path of [TRANSFER, ...CURRENT_IMAGE_LEAVES]) assert.ok(reached.has(path), `${entry} omitted ${path}`);
		for (const path of reached) assert.doesNotMatch(path, /\/i18n\/(?:canonical-extras[^/]*|catalogs|runtime|editor-copy-inventory)\./u);
	}
});

test('current photo archive tags retain the existing exact nonrecursive byte owner', () => {
	for (const path of CURRENT_PACK_TAGS) {
		for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), 'editor-scape-archive-bytes', path);
			assert.notEqual(chunkGroupForModulePath((path + '.foreign').replaceAll('/', separator)), 'editor-scape-archive-bytes');
		}
		assert.deepEqual(staticRelativeDependencies(runtimeSource(resolve(ROOT, path))), [], path);
		assert.deepEqual(dynamicRelativeImports(runtimeSource(resolve(ROOT, path))), [], path);
	}
	for (const path of ['scape-photo-catalog-pack-v5.ts', 'scape-photo-cube-lut-future.ts']) {
		assert.notEqual(chunkGroupForModulePath(`src/common/editor/${path}`), 'editor-scape-archive-bytes', path);
	}
	const group = chunkGroups.find(candidate => candidate.name === 'editor-scape-archive-bytes'); assert.ok(group);
	assert.equal(group.priority, 99); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
	assert.equal(group.includeDependenciesRecursively, false);
});

test('the actual current backup entry stays cold across file and archive byte co-owners', () => {
	for (const entry of ['src/lightscaper/controller/photo-library-backup-v5.ts', 'src/lightscaper/controller/photo-library-backup-current-v1.ts']) {
		const reached = photoRuntimeClosure(entry);
		for (const path of CURRENT_PACK_TAGS) assert.ok(reached.has(path), `${entry} omitted ${path}`);
		for (const path of reached) assert.doesNotMatch(path, /\/i18n\/(?:canonical-extras[^/]*|catalogs|runtime|editor-copy-inventory)\./u);
	}
});

void test('Photo cold byte planning pays only exact scalar ports and archive validation without analysis or audio processing', () => {
	const contracts = {
		'photo-library-develop-mask-raster-port-v1.ts': 'editor-neutral-foundations',
		'photo-library-develop-original-current-v1.ts': 'editor-neutral-foundations',
		'video-timing-asset-reference.ts': 'editor-media-storage-contracts',
		'video-motion-model-v27.ts': 'editor-imaging',
		'video-motion-analysis-body-v1.ts': 'editor-scape-archive-bytes',
	} as const;
	for (const [leaf, owner] of Object.entries(contracts)) {
		const path = `src/common/editor/${leaf}`;
		for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), owner, path);
			for (const invalid of [path + '.foreign', path.replace('editor/', 'editor/internal/')]) {
				assert.notEqual(chunkGroupForModulePath(invalid.replaceAll('/', separator)), owner, invalid);
			}
		}
	}
	const core = runtimeSource(resolve(ROOT, 'src/common/editor/scape-durable-asset-plan-core-v1.ts'));
	assert.deepEqual([...staticRelativeDependencies(core)].sort(), [
		'./controller/shared/file-size-warning.ts', './scape-abort.ts', './scape-byte-stream.ts', './storage/media-content-digest.ts',
		'./video-color-management-v27.ts', './video-motion-analysis-body-v1.ts', './video-motion-model-v27.ts', './video-timing-asset-reference.ts',
	].sort());
	const body = runtimeSource(resolve(ROOT, 'src/common/editor/video-motion-analysis-body-v1.ts'));
	assert.deepEqual(staticRelativeDependencies(body), ['./video-motion-model-v27.ts']);
	assert.deepEqual(dynamicRelativeImports(body), []);
	for (const leaf of ['video-motion-analysis-v27.ts', 'video-motion-processing-v27.ts', 'gray-video-frame-sampling-v1.ts',
		'scape-archive-media.ts', 'scape-expanded-byte-budget.ts']) {
		assert.equal(chunkGroupForModulePath(`src/common/editor/${leaf}`), 'editor-domain', leaf);
	}
	for (const entry of ['src/lightscaper/ui/LightscaperBootstrap.tsx', 'src/lightscaper/controller/photo-library-backup-current-v1.ts']) {
		const reached = inspectPhotoRuntimeClosure(entry);
		for (const leaf of ['video-motion-analysis-v27.ts', 'video-motion-processing-v27.ts', 'gray-video-frame-sampling-v1.ts',
			'scape-archive-media.ts', 'scape-expanded-byte-budget.ts', 'video-timing-asset.ts']) {
			assert.equal(reached.has(`src/common/editor/${leaf}`), false, `${entry} acquires ${leaf}`);
		}
	}
});

function assertLazyEntry(source: string, name: string): void {
	assert.ok(dynamicRelativeImports(source).includes(name), name);
	assert.ok(!staticRelativeDependencies(source).includes(name), name);
}

function runtimeSource(path: string): string {
	return transformSync(readFileSync(path, 'utf8'), { loader: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.ts') ? 'ts' : path.endsWith('.jsx') ? 'jsx' : path.endsWith('.json') ? 'json' : 'js', format: 'esm' }).code;
}

// A neutral or image owner's static dependency is paid even when a different
// co-owned consumer uses it. Inspect real product entries, not just their copy hook.
function photoRuntimeClosure(entry: string): ReadonlySet<string> {
	const reached = inspectPhotoRuntimeClosure(entry);
	assert.deepEqual([...reached].filter(path => chunkGroupForModulePath(resolve(ROOT, path)) === 'editor-domain').sort(), [],
		`Photo runtime ${entry} loads timeline domain leaves`);
	return reached;
}

function inspectPhotoRuntimeClosure(entry: string): ReadonlySet<string> {
	const reached = new Set<string>(), pending = [resolve(ROOT, entry)];
	while (pending.length) {
		const path = pending.pop()!, repositoryPath = relative(ROOT, path).split(sep).join('/');
		if (reached.has(repositoryPath)) continue;
		reached.add(repositoryPath);
		const owner = chunkGroupForModulePath(path);
		if (owner && PHOTO_OWNERS.has(owner)) for (const candidate of PHOTO_COOWNERS) {
			if (chunkGroupForModulePath(candidate) === owner && !reached.has(relative(ROOT, candidate).split(sep).join('/'))) pending.push(candidate);
		}
		for (const specifier of staticRelativeDependencies(runtimeSource(path))) {
			const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target);
		}
	}
	return reached;
}

// Follow real runtime imports and also pay for every copy module sharing an owner.
// A source-only import walk misses the co-owned optional labels that caused this failure.
function copyClosure(entry: string): ReadonlySet<string> {
	const reached = new Set<string>(), pending = [resolve(ROOT, entry)];
	while (pending.length) {
		const path = pending.pop()!, repositoryPath = relative(ROOT, path).split(sep).join('/');
		if (reached.has(repositoryPath)) continue;
		reached.add(repositoryPath);
		const owner = chunkGroupForModulePath(path);
		if (owner) for (const candidate of COPY_MODULES) {
			if (chunkGroupForModulePath(candidate) === owner && !reached.has(relative(ROOT, candidate).split(sep).join('/'))) pending.push(candidate);
		}
		for (const specifier of staticRelativeDependencies(runtimeSource(path))) {
			const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target);
		}
	}
	return reached;
}
