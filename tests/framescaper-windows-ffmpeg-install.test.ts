/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createFramescaperMediaHostBuildCommands, framescaperMediaHostBuildPaths } from '../native/framescaper-media-host/build/media-build-commands.mjs';

const shell = '/bin/bash';
const hasTools = process.platform !== 'win32' && existsSync(shell) && spawnSync('make', ['--version'], { stdio: 'ignore', timeout: 5_000 }).status === 0;
const hostRoot = resolve(import.meta.dirname, '../native/framescaper-media-host');
// Verbatim FFmpeg 9.0.1 common.mak quiet-mode block and library.mak header rule.
// Retained under the owning recipe's selected GPL-2.0-or-later FFmpeg profile;
// the original fragments carry no additional per-file copyright/license notice.
// Archive SHA-256: cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635;
// common.mak SHA-256: d034717744c175698b077c831abc2b6a5aff1c7baef5e30b19a30343289c1cc3;
// library.mak SHA-256: 51807aec99466b154db239113a472c754943026045950b480aa6d1aceb29631d.
// The shell transport below replays the observed native 8191-byte boundary;
// real Make and install execute the pinned rule. This is not native MSVC qualification.
const QUIET = `ifndef V
Q      = @
ECHO   = printf "$(1)\\t%s\\n" $(2)
BRIEF  = CC CXX OBJCC HOSTCC HOSTLD AS X86ASM AR LD LDXX STRIP CP WINDRES GLSLC NVCC BIN2C METALCC METALLIB
SILENT = DEPCC DEPCXX DEPHOSTCC DEPAS DEPX86ASM RANLIB RM

MSG    = $@
M      = @$(call ECHO,$(TAG),$@);
$(foreach VAR,$(BRIEF), \\
    $(eval override $(VAR) = @$$(call ECHO,$(VAR),$$(MSG)); $($(VAR))))
$(foreach VAR,$(SILENT),$(eval override $(VAR) = @$($(VAR))))
$(eval INSTALL = @$(call ECHO,INSTALL,$$(^:$(SRC_DIR)/%=%)); $(INSTALL))
endif`;
const HEADER_RULE = `install-lib$(NAME)-headers: $(addprefix $(SUBDIR),$(HEADERS) $(BUILT_HEADERS))
	$(Q)mkdir -p "$(INCINSTDIR)"
	$$(INSTALL) -m 644 $$^ "$(INCINSTDIR)"`;
const QUIET_SHA256 = 'e43d7f77cffc4ad6b7944feb7c0bb5b041ad37ca6f154e13334b7fd4419f7ac1', RULE_SHA256 = '8889fac074919fb20a0e84aa2fb1ee555dabb12aca1f4e76a33454d49752535a';
const PREFIXES: Readonly<Record<string, string>> = {
	"win-x64": "D:/a/_temp/soundscaper-framescaper-ffmpeg-0siL49/source/",
	"win-arm64": "C:/a/_temp/soundscaper-framescaper-ffmpeg-IHchq6/source/"
};
// All 100 source headers observed before the two built headers in both 568 failures.
const SOURCE_HEADERS = [
	"adler32.h",
	"aes.h",
	"aes_ctr.h",
	"ambient_viewing_environment.h",
	"attributes.h",
	"audio_fifo.h",
	"avassert.h",
	"avstring.h",
	"avutil.h",
	"base64.h",
	"blowfish.h",
	"bprint.h",
	"bswap.h",
	"buffer.h",
	"cast5.h",
	"camellia.h",
	"channel_layout.h",
	"common.h",
	"container_fifo.h",
	"cpu.h",
	"crc.h",
	"csp.h",
	"des.h",
	"detection_bbox.h",
	"dict.h",
	"display.h",
	"dovi_meta.h",
	"downmix_info.h",
	"encryption_info.h",
	"error.h",
	"eval.h",
	"executor.h",
	"fifo.h",
	"file.h",
	"film_grain_params.h",
	"frame.h",
	"hash.h",
	"hdr_dynamic_metadata.h",
	"hdr_dynamic_vivid_metadata.h",
	"hmac.h",
	"hwcontext.h",
	"hwcontext_cuda.h",
	"hwcontext_d3d11va.h",
	"hwcontext_d3d12va.h",
	"hwcontext_drm.h",
	"hwcontext_dxva2.h",
	"hwcontext_amf.h",
	"hwcontext_qsv.h",
	"hwcontext_mediacodec.h",
	"hwcontext_opencl.h",
	"hwcontext_oh.h",
	"hwcontext_vaapi.h",
	"hwcontext_videotoolbox.h",
	"hwcontext_vdpau.h",
	"hwcontext_vulkan.h",
	"iamf.h",
	"imgutils.h",
	"intfloat.h",
	"intreadwrite.h",
	"lfg.h",
	"log.h",
	"lzo.h",
	"macros.h",
	"mathematics.h",
	"mastering_display_metadata.h",
	"md5.h",
	"mem.h",
	"motion_vector.h",
	"murmur3.h",
	"opt.h",
	"parseutils.h",
	"pixdesc.h",
	"pixelutils.h",
	"pixfmt.h",
	"random_seed.h",
	"raw_color_params.h",
	"rc4.h",
	"rational.h",
	"refstruct.h",
	"replaygain.h",
	"ripemd.h",
	"samplefmt.h",
	"sha.h",
	"sha512.h",
	"spherical.h",
	"stereo3d.h",
	"tdrdi.h",
	"threadmessage.h",
	"time.h",
	"timecode.h",
	"timestamp.h",
	"tree.h",
	"twofish.h",
	"uuid.h",
	"version.h",
	"video_enc_params.h",
	"xtea.h",
	"tea.h",
	"tx.h",
	"video_hint.h"
];
const BUILT_HEADERS = ['libavutil/avconfig.h', 'libavutil/ffversion.h'];
interface Command { readonly phase: string; readonly executable: string; readonly args: readonly string[]; readonly cwd: string; readonly environment: NodeJS.ProcessEnv }
function plan(root: string, source: string, shellPath: string, target: string): readonly Command[] {
	const executables = Object.fromEntries(['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'nasm', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell']
		.map(role => [role, { path: role === 'shell' ? shellPath : '/tools/' + role }]));
	return createFramescaperMediaHostBuildCommands({ target: { id: target, cmakePreset: target }, hostRoot,
		ffmpegSourceRoot: source, boostSourceRoot: '/boost', paths: framescaperMediaHostBuildPaths(root), tools: { executables },
		environment: { PATH: process.env.PATH }, configureFlags: [],
		externalSourceRoots: Object.fromEntries(['x264', 'x265', 'libvpx', 'svt-av1', 'libopus', 'zlib'].map(role => [role, source])),
	}) as readonly Command[];
}
function fixture(context: TestContext, target: string) {
	const root = mkdtempSync(join(tmpdir(), 'framescaper-ffmpeg-install-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const source = join(root, 'source'), boundary = join(root, 'native-shell.sh'), scripts = join(root, 'shell-scripts'); mkdirSync(source);
	writeFileSync(boundary, '#!/bin/bash\nset -eu\nscript=${!#}\nprintf "%s\\0" "$script" >> "$INSTALL_FIXTURE_SCRIPTS"\nexec /bin/bash -e -c "${script:0:8191}"\n', { mode: 0o755 });
	const commands = plan(root, source, boundary, target), install = commands.find(command => command.phase === 'ffmpeg-install')!;
	mkdirSync(install.cwd, { recursive: true });
	const paths = [...SOURCE_HEADERS.map(name => PREFIXES[target]! + 'libavutil/' + name), ...BUILT_HEADERS];
	const originals = paths.map((path, index) => ({ path, bytes: Buffer.from('retained-header-' + index + ':' + path + '\n') }));
	for (const { path, bytes } of originals) { const file = join(install.cwd, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); }
	const library = Buffer.from('unchanged-static-library-bytes\0\xff'), pkg = Buffer.from('Name: libavutil\nVersion: 60.26.100\n');
	writeFileSync(join(install.cwd, 'libavutil/avutil.lib'), library); writeFileSync(join(install.cwd, 'libavutil/libavutil.pc'), pkg);
	// On POSIX, escape only virtual drive colons when declaring Make prerequisites.
	// Make's $^ and the actual shell argv retain the exact captured C:/D: names.
	const escaped = paths.slice(0, -2).map(path => path.replace(':', '\\:')).join(' ');
	const makefile = 'NAME = avutil\nSRC_DIR = .\nINSTALL = install\nINCINSTDIR = installed/libavutil\nHEADERS = ' + escaped
		+ '\nBUILT_HEADERS = ' + BUILT_HEADERS.join(' ') + '\n' + QUIET + '\ndefine RULES\n' + HEADER_RULE + '\nendef\n$(eval $(RULES))\n'
		+ '.PHONY: install\ninstall: install-libavutil-headers install-library install-pkgconfig\n'
		+ 'install-library: libavutil/avutil.lib\n\t$(Q)mkdir -p installed/lib\n\t$(INSTALL) -m 644 $^ installed/lib\n'
		+ 'install-pkgconfig: libavutil/libavutil.pc\n\t$(Q)mkdir -p installed/lib/pkgconfig\n\t$(INSTALL) -m 644 $^ installed/lib/pkgconfig\n';
	writeFileSync(join(source, 'Makefile'), makefile);
	return { root, source, commands, install, originals, library, pkg, scripts };
}

for (const target of ['win-x64', 'win-arm64']) test(`${target} FFmpeg install preserves all 102 captured headers across the native command boundary`, { skip: !hasTools }, context => {
	assert.equal(createHash('sha256').update(QUIET).digest('hex'), QUIET_SHA256);
	assert.equal(createHash('sha256').update(HEADER_RULE).digest('hex'), RULE_SHA256);
	const f = fixture(context, target);
	assert.equal(f.originals.length, 102);
	const result = spawnSync('make', [...f.install.args], { cwd: dirname(f.install.cwd), encoding: 'utf8', timeout: 15_000,
		env: { ...process.env, ...f.install.environment, INSTALL_FIXTURE_SCRIPTS: f.scripts } });
	assert.equal(result.status, 0, result.stdout + result.stderr);
	const scripts = readFileSync(f.scripts, 'utf8').split('\0').filter(Boolean);
	const installCommands = scripts.filter(script => script.includes('install -m 644'));
	assert.ok(installCommands.length >= 3); assert.ok(installCommands.every(script => Buffer.byteLength(script) <= 8191));
	assert.ok(f.install.args.includes('V=1'), 'Only upstream install verbosity removes the duplicate quiet header list.');
	for (const { path, bytes } of f.originals) {
		assert.deepEqual(readFileSync(join(f.install.cwd, path)), bytes, 'Every original header remains unchanged.');
		const name = path.split('/').at(-1)!; const delivered = join(f.install.cwd, 'installed/libavutil', name);
		assert.deepEqual(readFileSync(delivered), bytes, 'Every exact named header reaches the prefix.'); assert.equal(statSync(delivered).mode & 0o777, 0o644);
	}
	assert.deepEqual(readdirSync(join(f.install.cwd, 'installed/libavutil')).sort(), [...SOURCE_HEADERS, 'avconfig.h', 'ffversion.h'].sort());
	assert.deepEqual(readFileSync(join(f.install.cwd, 'installed/lib/avutil.lib')), f.library);
	assert.deepEqual(readFileSync(join(f.install.cwd, 'installed/lib/pkgconfig/libavutil.pc')), f.pkg);
	assert.equal(f.commands.find(command => command.phase === 'ffmpeg-build')!.args.includes('V=1'), false);
});

test('captured native quiet command truncates exactly at the reported partial fourth header for both targets', () => {
	for (const target of ['win-x64', 'win-arm64']) {
		const names = [...SOURCE_HEADERS.map(name => PREFIXES[target]! + 'libavutil/' + name), ...BUILT_HEADERS], args = names.join(' ');
		const command = 'printf "INSTALL\\t%s\\n" ' + args + '; install -m 644 ' + args + ' "'
			+ PREFIXES[target]!.slice(0, 2) + '/a/_temp/framescaper-media-work/media-build/ffmpeg-install/include/libavutil"';
		assert.equal(Buffer.byteLength(args), 7847); assert.equal(Buffer.byteLength(command), 15815);
		const verboseCommand = command.slice(command.indexOf('; ') + 2);
		assert.ok(Buffer.byteLength(verboseCommand) <= 8191, 'The complete production V=1 command retains the actual captured destination within the native boundary.');
		assert.ok(command.slice(0, 8191).endsWith(PREFIXES[target]! + 'libavutil/ambient_viewin'));
	}
});

test('non-Windows FFmpeg install plans and Windows build plans retain their normal verbosity', () => {
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']) {
		const commands = plan('/work', '/source', shell, target);
		for (const command of commands.filter(({ phase }) => phase === 'ffmpeg-build' || (phase === 'ffmpeg-install' && !target.startsWith('win-')))) {
			assert.equal(command.args.some(arg => arg.startsWith('V=')), false);
		}
	}
});
