/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { createFramescaperMediaHostBuildCommands, framescaperMediaHostBuildPaths } from '../native/framescaper-media-host/build/media-build-commands.mjs';

interface Command {
	readonly phase: string;
	readonly executable: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly environment: Readonly<Record<string, string>>;
}

const root = join(tmpdir(), 'motion-ffmpeg-flags-plan');
const helper = resolve(import.meta.dirname, '../native/framescaper-media-host/build/windows-ffmpeg-msvc-flags.cmake');
const upstreamSha256 = '5b281b249ad5ad859030b4da0a24ec105b5abff7b3d87a65b302df8bf5fd9833';
const directive = '            -D*) [ "$_flags_type" = "link" ] || echo $flag ;;';
const corrected = directive.replace('-D*)', '-D*|-U*)');
const cmake = process.env.CMAKE ?? 'cmake';
const bash = process.env.MOTION_NATIVE_BASH ?? 'bash';
const cmakeAvailable = spawnSync(cmake, ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0;

// Authentic FFmpeg 9.0.1 flag filters: exercise their shell behavior without configuring or compiling.
const fixture = [
	'# retained notice @copyright@ ${literal}; C:\\retained',
	'msvc_common_flags(){',
	'    for flag; do',
	'        case $flag in',
	'            # In addition to specifying certain flags under the compiler',
	'            # specific filters, they must be specified here as well or else the',
	'            # generic catch all at the bottom will print the original flag.',
	'            -Wall)                ;;',
	'            -Wextra)              ;;',
	'            -std=c*)              echo /std:${flag#-std=};;',
	'            # Common flags',
	'            -fomit-frame-pointer) ;;',
	'            -g)                   echo -Z7 ;;',
	'            -fno-math-errno)      ;;',
	'            -fno-common)          ;;',
	'            -fno-signed-zeros)    ;;',
	'            -fPIC)                ;;',
	'            -mthumb)              ;;',
	'            -march=*)             ;;',
	'            -mfp16-format=*)      ;;',
	'            -lz)                  echo zlib.lib ;;',
	'            -lx264)               echo libx264.lib ;;',
	'            -lstdc++)             ;;',
	'            -l*)                  echo ${flag#-l}.lib ;;',
	'            -LARGEADDRESSAWARE)   echo $flag ;;',
	'            -L*) [ "$_flags_type" != "link" ] || echo -libpath:${flag#-L} ;;',
	'            -I*) [ "$_flags_type" = "link" ] || echo $flag ;;',
	directive,
	'            -Wl,*)                ;;',
	'            *)                    echo $flag ;;',
	'        esac',
	'    done',
	'}',
	'',
	'msvc_flags(){',
	'    msvc_common_flags "$@"',
	'    for flag; do',
	'        case $flag in',
	'            -Wall)                echo -W3 -wd4018 -wd4146 -wd4244 -wd4305     \\',
	'                                       -wd4554 -wd4267 ;;',
	'            -Wextra)              echo -W4 -wd4244 -wd4127 -wd4018 -wd4389     \\',
	'                                       -wd4146 -wd4057 -wd4204 -wd4706 -wd4305 \\',
	'                                       -wd4152 -wd4324 -we4013 -wd4100 -wd4214 \\',
	'                                       -wd4307 \\',
	'                                       -wd4273 -wd4554 -wd4701 -wd4703 ;;',
	'        esac',
	'    done',
	'}',
	'',
	'msvc_flags_link(){',
	'    _flags_type=link',
	'    msvc_flags "$@"',
	'    unset _flags_type',
	'}',
	'',
].join('\n');

function sha256(bytes: string | Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function adapt(file: string, expected: string | null = sha256(readFileSync(file))) {
	return spawnSync(cmake, [
		`-DFFMPEG_CONFIGURE_FILE=${file}`,
		...(expected === null ? [] : [`-DFFMPEG_CONFIGURE_SHA256=${expected}`]),
		'-P', helper,
	], { encoding: 'utf8', timeout: 5000 });
}

function commands(target: string): readonly Command[] {
	const roles = ['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'nasm', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell'];
	return createFramescaperMediaHostBuildCommands({
		target: { id: target, cmakePreset: target }, hostRoot: join(root, 'host'),
		ffmpegSourceRoot: join(root, 'ffmpeg'), boostSourceRoot: join(root, 'boost'),
		externalSourceRoots: Object.fromEntries(['x264', 'x265', 'libvpx', 'svt-av1', 'libopus', 'zlib'].map(id => [id, join(root, id)])),
		paths: framescaperMediaHostBuildPaths(join(root, 'work')),
		tools: { executables: Object.fromEntries(roles.map(role => [role, { path: join(root, 'tools', role) }])) },
		environment: { PATH: join(root, 'tools'), SOURCE_DATE_EPOCH: '1786492800' }, configureFlags: [],
	}) as unknown as readonly Command[];
}

for (const target of ['win-x64', 'win-arm64', 'linux-x64', 'linux-arm64', 'mac-arm64']) {
	test(`Motion ${target} adapts only the pinned Windows FFmpeg configure copy immediately before configuration`, () => {
		const plan = commands(target);
		const normalize = plan.find(command => command.phase === 'ffmpeg-normalize-msvc-flags');
		if (!target.startsWith('win-')) return assert.equal(normalize, undefined);
		assert.ok(normalize);
		const configure = plan.find(command => command.phase === 'ffmpeg-configure');
		const install = plan.find(command => command.phase === 'libopus-install');
		assert.ok(configure);
		assert.ok(install);
		assert.equal(plan.filter(command => command.phase === normalize.phase).length, 1);
		assert.equal(normalize.executable, install.executable);
		assert.deepEqual(normalize.environment, install.environment);
		assert.equal(normalize.cwd, configure.cwd);
		assert.equal(plan.indexOf(normalize), plan.indexOf(configure) - 1);
		assert.deepEqual(normalize.args, [
			`-DFFMPEG_CONFIGURE_FILE=${join(root, 'work/ffmpeg-build/src/configure')}`,
			`-DFFMPEG_CONFIGURE_SHA256=${upstreamSha256}`,
			'-P', join(root, 'host/build/windows-ffmpeg-msvc-flags.cmake'),
		]);
	});
}

for (const newline of ['\n', '\r\n']) {
	test(`Windows FFmpeg flags adaptation changes only its unique directive and retains ${newline.length === 1 ? 'LF' : 'CRLF'} bytes and mode`, context => {
		if (!cmakeAvailable) return context.skip('CMake is unavailable');
		const directory = mkdtempSync(join(tmpdir(), 'motion-ffmpeg-flags-'));
		context.after(() => rmSync(directory, { recursive: true, force: true }));
		const source = join(directory, 'original-configure');
		const staged = join(directory, 'staged-configure');
		const original = Buffer.from(fixture.replaceAll('\n', newline));
		writeFileSync(source, original);
		copyFileSync(source, staged);
		chmodSync(staged, 0o751);
		const mode = statSync(staged).mode & 0o777;
		const result = adapt(staged);
		assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
		assert.deepEqual(readFileSync(staged), Buffer.from(original.toString().replace(directive, corrected)));
		assert.deepEqual(readFileSync(source), original);
		assert.equal(statSync(staged).mode & 0o777, mode);
		const adapted = readFileSync(staged);
		assert.notEqual(adapt(staged).status, 0, 'An already adapted context must be refused even with its actual SHA');
		assert.deepEqual(readFileSync(staged), adapted);
	});
}

test('Windows FFmpeg authentic Bash filters retain -U for compilation and remove it only from link flags', context => {
	if (!cmakeAvailable) return context.skip('CMake is unavailable');
	if (spawnSync(bash, ['--version'], { encoding: 'utf8', timeout: 5000 }).status !== 0) return context.skip('Bash is unavailable');
	const directory = mkdtempSync(join(tmpdir(), 'motion-ffmpeg-flags-shell-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const file = join(directory, 'configure');
	writeFileSync(file, fixture);
	const flags = ['-U_FORTIFY_SOURCE', '-DSVT_AV1', '-Icodec/include', '-lSvtAv1Enc', '-Lcodec/lib', '-unknown-linker-flag'];
	const filter = (name: string): string => {
		const result = spawnSync(bash, ['-c', '. "$1"; function_name=$2; shift 2; "$function_name" "$@"', '--', file, name, ...flags], { encoding: 'utf8', timeout: 5000 });
		assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
		return result.stdout;
	};
	const compile = '-U_FORTIFY_SOURCE\n-DSVT_AV1\n-Icodec/include\nSvtAv1Enc.lib\n-unknown-linker-flag\n';
	assert.equal(filter('msvc_flags'), compile);
	assert.equal(filter('msvc_flags_link'), '-U_FORTIFY_SOURCE\nSvtAv1Enc.lib\n-libpath:codec/lib\n-unknown-linker-flag\n');
	const result = adapt(file);
	assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
	assert.equal(filter('msvc_flags'), compile);
	assert.equal(filter('msvc_flags_link'), 'SvtAv1Enc.lib\n-libpath:codec/lib\n-unknown-linker-flag\n');
});

test('Windows FFmpeg flags adaptation refuses missing, malformed and mismatched SHA pins without mutation', context => {
	if (!cmakeAvailable) return context.skip('CMake is unavailable');
	const directory = mkdtempSync(join(tmpdir(), 'motion-ffmpeg-flags-sha-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const file = join(directory, 'configure');
	writeFileSync(file, fixture);
	for (const pin of [null, '', 'A'.repeat(64), '0'.repeat(63), 'g'.repeat(64), '0'.repeat(64)]) {
		const result = adapt(file, pin);
		assert.notEqual(result.status, 0, `Invalid expected SHA ${String(pin)} was admitted`);
		assert.equal(readFileSync(file, 'utf8'), fixture);
	}
	const previousSha = sha256(fixture);
	writeFileSync(file, `${fixture}# changed after pinning\n`);
	assert.notEqual(adapt(file, previousSha).status, 0);
	assert.equal(readFileSync(file, 'utf8'), `${fixture}# changed after pinning\n`);
});

test('Windows FFmpeg flags adaptation refuses absent, repeated and modified authentic contexts without mutation', context => {
	if (!cmakeAvailable) return context.skip('CMake is unavailable');
	const directory = mkdtempSync(join(tmpdir(), 'motion-ffmpeg-flags-context-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const file = join(directory, 'configure');
	for (const original of [
		fixture.replace(directive, ''), `${fixture}${directive}\n`,
		fixture.replace(directive, directive.replace('echo $flag', 'echo "$flag"')),
		fixture.replace(directive, corrected),
	]) {
		writeFileSync(file, original);
		assert.notEqual(adapt(file).status, 0);
		assert.equal(readFileSync(file, 'utf8'), original);
	}
});

test('Windows FFmpeg flags adaptation refuses mixed line endings without changing bytes', context => {
	if (!cmakeAvailable) return context.skip('CMake is unavailable');
	const directory = mkdtempSync(join(tmpdir(), 'motion-ffmpeg-flags-mixed-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const file = join(directory, 'configure');
	const original = Buffer.from(fixture.replace('\n', '\r\n'));
	writeFileSync(file, original);
	const result = adapt(file);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /unsupported line endings or encoding/u);
	assert.deepEqual(readFileSync(file), original);
});

test('Windows FFmpeg flags adaptation requires an existing canonical regular configure file', context => {
	if (!cmakeAvailable) return context.skip('CMake is unavailable');
	const directory = mkdtempSync(join(tmpdir(), 'motion-ffmpeg-flags-path-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const file = join(directory, 'configure');
	writeFileSync(file, fixture);
	mkdirSync(join(directory, 'child'));
	for (const invalid of [join(directory, 'absent'), directory, 'relative-configure', `${directory}/child/../configure`]) {
		assert.notEqual(adapt(invalid, sha256(fixture)).status, 0);
		assert.equal(readFileSync(file, 'utf8'), fixture);
	}
	if (process.platform === 'win32') return context.diagnostic('Symlink cases require unprivileged POSIX symlink creation');
	const link = join(directory, 'configure-link');
	symlinkSync(file, link);
	assert.notEqual(adapt(link, sha256(fixture)).status, 0);
	const parentLink = `${directory}-link`;
	symlinkSync(directory, parentLink, 'dir');
	context.after(() => rmSync(parentLink, { force: true }));
	assert.notEqual(adapt(join(parentLink, 'configure'), sha256(fixture)).status, 0);
	assert.equal(readFileSync(file, 'utf8'), fixture);
});
