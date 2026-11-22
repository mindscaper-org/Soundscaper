#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
/** Build the pinned Wine-compatible bridge. Generated payloads never enter Git. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { authenticateYabridgePayload, YABRIDGE_EXECUTABLE_FILES } from '../desktop/yabridge-payload.ts';

export async function buildYabridge(repositoryRoot) {
	if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Yabridge builds require Linux x64.');
	const specification = JSON.parse(await readFile(join(repositoryRoot, 'config/yabridge-native-payload.json'), 'utf8'));
	const root = join(repositoryRoot, '.native-build/yabridge');
	const source = join(root, 'source');
	const output = join(root, 'runtime', specification.runtimePrefix);
	const receiptPath = join(root, 'manifest.json');
	const launcherSource = join(repositoryRoot, 'native/soundscaper-wine-launcher/launcher.c');
	const launcherSourceSha256 = digest(await readFile(launcherSource));
	const buildRecipeSha256 = digest(await readFile(import.meta.filename));
	try {
		const previous = JSON.parse(await readFile(receiptPath, 'utf8'));
		if (JSON.stringify(previous.source) === JSON.stringify(specification.source) && previous.buildRecipeSha256 === buildRecipeSha256) {
			await authenticateYabridgePayload(previous, join(root, 'runtime'));
			if (previous.launcherSourceSha256 !== launcherSourceSha256) {
				return await refreshLauncher({ repositoryRoot, launcherSource, launcherSourceSha256, root, output, previous, receiptPath });
			}
			return { manifest: previous, runtimeRoot: join(root, 'runtime') };
		}
	} catch { /* Rebuild an absent, stale or corrupt cache from its exact source. */ }
	const programs = ['git', 'meson', 'ninja', 'wine', 'winegcc', 'wineg++', 'cc', 'tar', 'pkg-config'];
	if (process.env.CI === 'true' && (programs.some((program) => spawnSync(program, ['--version'], { stdio: 'ignore' }).status !== 0)
		|| spawnSync('pkg-config', ['--exists', 'xcb', 'dbus-1'], { stdio: 'ignore' }).status !== 0)) {
		run('bash', [join(repositoryRoot, 'scripts/ci-apt-install.sh'), 'meson', 'ninja-build', 'wine',
			'wine64-tools', 'libwine-dev', 'libxcb1-dev', 'libdbus-1-dev', 'pkg-config'], repositoryRoot);
	}
	for (const program of programs) {
		run(program, ['--version'], repositoryRoot);
	}
	await rm(root, { recursive: true, force: true });
	await mkdir(source, { recursive: true });
	run('git', ['init', '--quiet'], source);
	run('git', ['fetch', '--depth=1', specification.source.repository, specification.source.commit], source);
	run('git', ['checkout', '--detach', 'FETCH_HEAD'], source);
	if (run('git', ['rev-parse', 'HEAD'], source).trim() !== specification.source.commit) throw new Error('Yabridge source identity differs.');
	const wrap = join(source, 'subprojects/vst3.wrap');
	await writeFile(wrap, (await readFile(wrap, 'utf8')).replace(/^revision = .*$/mu,
		`revision = ${specification.source.vst3SdkCommit}`));
	const crossFile = join(source, 'cross-wine.conf');
	const crossConfig = await readFile(crossFile, 'utf8');
	const pkgConfig = "pkg-config = 'pkg-config'";
	if (!crossConfig.includes(pkgConfig)) throw new Error('The pinned Yabridge cross file no longer declares pkg-config.');
	// Ubuntu 22.04 ships Meson 0.61, which looks up the legacy key.
	await writeFile(crossFile, crossConfig.replace(pkgConfig, `${pkgConfig}\npkgconfig = 'pkg-config'`));
	const build = join(root, 'build');
	run('meson', ['setup', build, '--buildtype=release', '--cross-file=cross-wine.conf', '--wrap-mode=forcefallback',
		'-Dbitbridge=false', '-Dclap=false', '-Dvst3=true', '-Db_lto=false'], source);
	run('meson', ['compile', '-C', build, '-j', '2'], source);
	await mkdir(output, { recursive: true });
	for (const name of YABRIDGE_EXECUTABLE_FILES.filter((name) => name !== 'soundscaper-wine-launcher')) {
		await copyFile(join(build, name), join(output, name));
	}
	run('cc', ['-std=c17', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-fno-ident',
		'-Wl,--build-id=none', launcherSource, '-o', join(output, 'soundscaper-wine-launcher')], repositoryRoot);
	for (const name of ['yabridge-host.exe', 'soundscaper-wine-launcher']) await chmod(join(output, name), 0o755);
	await copyFile(join(source, 'COPYING'), join(output, 'COPYING'));
	await copyFile(launcherSource, join(source, 'soundscaper-wine-launcher.c'));
	await copyFile(join(repositoryRoot, 'native/soundscaper-wine-launcher/BUILD.md'), join(source, 'SOUNDSCAPER-BUILD.md'));
	await copyFile(import.meta.filename, join(source, 'soundscaper-build-recipe.mjs'));
	/* The complete source tree includes every dependency Meson resolved at its
	 * pinned wrap/gitlink revision, their notices, and the SDK compatibility patch. */
	run('tar', ['--exclude=.git', '-czf', join(output, 'corresponding-source.tar.gz'), '-C', root, 'source'], repositoryRoot);
	const sourceIdentity = { ...specification.source, launcherSourceSha256, buildRecipeSha256 };
	await writeFile(join(output, 'SOURCE.json'), `${JSON.stringify(sourceIdentity, null, '\t')}\n`);
	const names = [...YABRIDGE_EXECUTABLE_FILES, 'COPYING', 'corresponding-source.tar.gz', 'SOURCE.json'];
	const files = [];
	for (const path of names) {
		const bytes = await readFile(join(output, path));
		files.push({ path, byteLength: bytes.byteLength, sha256: digest(bytes) });
	}
	const manifest = { ...specification, launcherSourceSha256, buildRecipeSha256, status: 'built', files };
	await authenticateYabridgePayload(manifest, join(root, 'runtime'));
	await writeFile(receiptPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	return { manifest, runtimeRoot: join(root, 'runtime') };
}

function run(program, args, cwd) {
	const result = spawnSync(program, args, { cwd, shell: false, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 });
	if (result.error || result.status !== 0) throw new Error(
		`Yabridge build failed (${program}). Install Meson, Ninja, Wine, wine64-tools, libwine-dev, libxcb1-dev, libdbus-1-dev and pkg-config.\n${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function refreshLauncher({ repositoryRoot, launcherSource, launcherSourceSha256, root, output, previous, receiptPath }) {
	run('cc', ['-std=c17', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-fno-ident',
		'-Wl,--build-id=none', launcherSource, '-o', join(output, 'soundscaper-wine-launcher')], repositoryRoot);
	const repack = join(root, 'source-repack');
	await rm(repack, { recursive: true, force: true }); await mkdir(repack);
	try {
		run('tar', ['-xzf', join(output, 'corresponding-source.tar.gz'), '-C', repack], repositoryRoot);
		await copyFile(launcherSource, join(repack, 'source/soundscaper-wine-launcher.c'));
		run('tar', ['-czf', join(root, 'corresponding-source.tar.gz'), '-C', repack, 'source'], repositoryRoot);
		await copyFile(join(root, 'corresponding-source.tar.gz'), join(output, 'corresponding-source.tar.gz'));
		await writeFile(join(output, 'SOURCE.json'), `${JSON.stringify({ ...previous.source, launcherSourceSha256, buildRecipeSha256: previous.buildRecipeSha256 }, null, '\t')}\n`);
		const files = [];
		for (const descriptor of previous.files) {
			const bytes = await readFile(join(output, descriptor.path));
			files.push({ path: descriptor.path, byteLength: bytes.byteLength, sha256: digest(bytes) });
		}
		const manifest = { ...previous, launcherSourceSha256, files };
		await authenticateYabridgePayload(manifest, join(root, 'runtime'));
		await writeFile(receiptPath, `${JSON.stringify(manifest, null, '\t')}\n`);
		return { manifest, runtimeRoot: join(root, 'runtime') };
	} finally { await rm(repack, { recursive: true, force: true }); await rm(join(root, 'corresponding-source.tar.gz'), { force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await buildYabridge(resolve(import.meta.dirname, '..'));
}
