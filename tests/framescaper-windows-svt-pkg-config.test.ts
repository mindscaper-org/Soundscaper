/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createFramescaperMediaHostBuildCommands, framescaperMediaHostBuildPaths } from '../native/framescaper-media-host/build/media-build-commands.mjs';

const hostRoot = resolve(import.meta.dirname, '../native/framescaper-media-host');
const shell = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe') : '/bin/bash';
const PREFIX = 'C:/a/_temp/framescaper-media-work/media-build/svt-av1-install';
// Exact metadata retained from native Windows ARM64 failure artifact, FFmpeg9.0.1/SVT4.2.0.
const CAPTURED_PC = ['prefix=' + PREFIX, 'exec_prefix=${prefix}', 'includedir=${prefix}/include', 'libdir=${exec_prefix}/lib', '',
 'Name: SvtAv1Enc', 'Description: SVT (Scalable Video Technology) for AV1 encoder library', 'Version: 4.2.0', 'Requires.private: ',
 'Libs: -L${libdir} -lSvtAv1Enc', 'Libs.private: ', 'Cflags: -I${includedir}/svt-av1 -DRTC_BUILD=0', 'Cflags.private: -UEB_DLL', ''].join('\r\n');
// Verbatim owning functions from authenticated FFmpeg9.0.1 configure, archive
// Copyright (c) 2000-2002 Fabrice Bellard
// Copyright (c) 2005-2008 Diego Biurrun
// Copyright (c) 2005-2008 Mans Rullgard
// cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635,
// configure5b281b249ad5ad859030b4da0a24ec105b5abff7b3d87a65b302df8bf5fd9833.
// These execute the real compiler/link filters and LNK4044 refusal; compiler and
// linker transports below only record argv/status. This is not Windows binary qualification.
const PINNED_CONFIGURE_PROBE = `filter(){
    pat=$1
    shift
    for v; do
        eval "case '$v' in $pat) printf '%s ' '$v' ;; esac"
    done
}

filter_out(){
    pat=$1
    shift
    for v; do
        eval "case '$v' in $pat) ;; *) printf '%s ' '$v' ;; esac"
    done
}

ld_o(){
    eval printf '%s\\\\n' $LD_O
}

msvc_common_flags(){
    for flag; do
        case $flag in
            # In addition to specifying certain flags under the compiler
            # specific filters, they must be specified here as well or else the
            # generic catch all at the bottom will print the original flag.
            -Wall)                ;;
            -Wextra)              ;;
            -std=c*)              echo /std:\${flag#-std=};;
            # Common flags
            -fomit-frame-pointer) ;;
            -g)                   echo -Z7 ;;
            -fno-math-errno)      ;;
            -fno-common)          ;;
            -fno-signed-zeros)    ;;
            -fPIC)                ;;
            -mthumb)              ;;
            -march=*)             ;;
            -mfp16-format=*)      ;;
            -lz)                  echo zlib.lib ;;
            -lx264)               echo libx264.lib ;;
            -lstdc++)             ;;
            -l*)                  echo \${flag#-l}.lib ;;
            -LARGEADDRESSAWARE)   echo $flag ;;
            -L*) [ "$_flags_type" != "link" ] || echo -libpath:\${flag#-L} ;;
            -I*) [ "$_flags_type" = "link" ] || echo $flag ;;
            -D*) [ "$_flags_type" = "link" ] || echo $flag ;;
            -Wl,*)                ;;
            *)                    echo $flag ;;
        esac
    done
}

msvc_flags(){
    msvc_common_flags "$@"
    for flag; do
        case $flag in
            -Wall)                echo -W3 -wd4018 -wd4146 -wd4244 -wd4305     \\
                                       -wd4554 -wd4267 ;;
            -Wextra)              echo -W4 -wd4244 -wd4127 -wd4018 -wd4389     \\
                                       -wd4146 -wd4057 -wd4204 -wd4706 -wd4305 \\
                                       -wd4152 -wd4324 -we4013 -wd4100 -wd4214 \\
                                       -wd4307 \\
                                       -wd4273 -wd4554 -wd4701 -wd4703 ;;
        esac
    done
}

msvc_flags_link(){
    _flags_type=link
    msvc_flags "$@"
    unset _flags_type
}

test_ld(){
    log test_ld "$@"
    type=$1
    shift 1
    flags=$(filter_out '-l*|*.so' $@)
    libs=$(filter '-l*|*.so' $@)
    test_$type $($cflags_filter $flags) || return
    flags=$($ldflags_filter $flags)
    libs=$($ldflags_filter $libs)
    log $ld $LDFLAGS $LDEXEFLAGS $flags $(ld_o $TMPE) $TMPO $libs $extralibs
    output=$($ld $LDFLAGS $LDEXEFLAGS $flags $(ld_o $TMPE) $TMPO $libs $extralibs 2>&1)
    ret=$?
    echo "$output" >> $logfile
    # link.exe and lld-link exit 0 even for unrecognized options, emitting
    # only a warning (LNK4044 / "ignoring unknown argument").  Treat such
    # output as failure so check_ldflags rejects those flags correctly.
    test $ret -eq 0 && ! echo "$output" | grep -qE 'LNK4044|lld-link: warning: ignoring unknown argument'
}
`;
const PROBE_SHA256 = 'b2fdd22c113ca04c38bfe9097879ee373d31daba6eef9608235cf52f3483eaf2';

interface Command { readonly phase: string; readonly executable: string; readonly args: readonly string[]; readonly cwd: string; readonly environment: NodeJS.ProcessEnv }
function fixture(context: TestContext) {
 const root = mkdtempSync(join(tmpdir(), 'framescaper-svt-pc-'));
 context.after(() => rmSync(root, { recursive: true, force: true }));
 const file = join(root, 'SvtAv1Enc.pc'); writeFileSync(file, CAPTURED_PC);
 return { root, file };
}
function plan(root: string, target: string): readonly Command[] {
 const executables = Object.fromEntries(['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'nasm', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell']
  .map(role => [role, { path: role === 'shell' ? shell : '/tools/' + role }]));
 return createFramescaperMediaHostBuildCommands({ target: { id: target, cmakePreset: target }, hostRoot,
  ffmpegSourceRoot: 'C:/sources/ffmpeg', boostSourceRoot: '/boost', paths: framescaperMediaHostBuildPaths(root), tools: { executables },
  environment: { PATH: process.env.PATH }, configureFlags: [],
  externalSourceRoots: Object.fromEntries(['x264', 'x265', 'libvpx', 'svt-av1', 'libopus', 'zlib'].map(role => [role, 'C:/sources/' + role])),
 }) as readonly Command[];
}
function runNormalizer(file: string) {
 return spawnSync(process.execPath, [join(hostRoot, 'build/windows-svt-pkg-config.ts'), file], { encoding: 'utf8', timeout: 10_000 });
}
function runProbe(root: string, metadata: string, compilerFlags: string, warning = '', status = 0) {
 const compiler = join(root, 'compiler-argv'), linker = join(root, 'linker-argv'), logfile = join(root, 'configure.log');
 const link = join(root, 'link.sh');
 writeFileSync(link, '#!/bin/bash\nprintf "%s\\0" "$@" > "$LINK_CAPTURE"\nif [[ -n ${LINK_WARNING-} ]]; then printf "%s\n" "$LINK_WARNING"; fi\nfor arg; do if [[ $arg == -UEB_DLL ]]; then printf "%s\n" "LINK : warning LNK4044: unrecognized option /UEB_DLL; ignored"; fi; done\nexit "$LINK_STATUS"\n', { mode: 0o755 });
 const field = (name: string) => new RegExp('^' + name.replaceAll('.', '\\.') + ':([^\r\n]*)', 'mu').exec(metadata)?.[1]?.trim() ?? '';
 const expand = (value: string) => value.replaceAll('${includedir}', PREFIX + '/include').replaceAll('${libdir}', PREFIX + '/lib');
 const flags = [field('Cflags'), field('Cflags.private'), field('Libs'), field('Libs.private')].map(expand).join(' ').trim().split(/\s+/u);
 assert.equal(createHash('sha256').update(PINNED_CONFIGURE_PROBE).digest('hex'), PROBE_SHA256);
 const script = PINNED_CONFIGURE_PROBE + '\nlog(){ echo "$@" >> "$logfile"; }\ntest_cc(){ printf "%s\\0" $CFLAGS "$@" > "$COMPILER_CAPTURE"; }\ncflags_filter=msvc_flags\nldflags_filter=msvc_flags_link\nLD_O=-out:\\$@\nLDFLAGS=-nologo\nLDEXEFLAGS=\nextralibs=advapi32.lib\nTMPE=probe.exe\nTMPO=probe.o\nld="$LINK_EXECUTABLE"\ntest_ld cc "$@"\n';
 const result = spawnSync(shell, ['-c', script, 'probe', ...flags], { encoding: 'utf8', timeout: 10_000, env: { ...process.env,
  logfile, CFLAGS: compilerFlags, COMPILER_CAPTURE: compiler, LINK_CAPTURE: linker, LINK_EXECUTABLE: link,
  LINK_WARNING: warning, LINK_STATUS: String(status) } });
 const args = (path: string) => readFileSync(path, 'utf8').split('\0').filter(Boolean);
 return { ...result, compiler: args(compiler), linker: args(linker), diagnostic: readFileSync(logfile, 'utf8') };
}

for (const target of ['win-x64', 'win-arm64']) test(`${target} static SVT probe keeps compiler undefine and link search roots without LNK4044`, { skip: !existsSync(shell) }, context => {
 const f = fixture(context), commands = plan(f.root, target), normalize = commands.find(command => command.phase === 'svt-av1-normalize-pkg-config');
 if (normalize) {
  const metadata = normalize.args.at(-1)!; mkdirSync(dirname(metadata), { recursive: true }); writeFileSync(metadata, CAPTURED_PC);
  const normalized = spawnSync(normalize.executable, [...normalize.args], { cwd: f.root, env: { ...process.env, ...normalize.environment }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(normalized.status, 0, normalized.stderr); writeFileSync(f.file, readFileSync(metadata));
 }
 const configure = commands.find(command => command.phase === 'ffmpeg-configure')!;
 const extraCflags = configure.args.filter(arg => arg.startsWith('--extra-cflags=')).map(arg => arg.slice('--extra-cflags='.length)).join(' ');
 const probe = runProbe(f.root, readFileSync(f.file, 'utf8'), extraCflags);
 assert.equal(probe.status, 0, probe.diagnostic + probe.stderr);
 assert.equal(probe.compiler.filter(arg => arg === '-UEB_DLL').length, 1, 'Static ABI undefine reaches compiler exactly once.');
 assert.ok(probe.compiler.includes('-DRTC_BUILD=0'));
 assert.ok(probe.compiler.includes('-I' + PREFIX + '/include/svt-av1'));
 assert.equal(probe.linker.includes('-UEB_DLL'), false);
 assert.ok(probe.linker.includes('-libpath:' + PREFIX + '/lib'));
 assert.ok(probe.linker.includes('SvtAv1Enc.lib')); assert.ok(probe.linker.includes('advapi32.lib'));
 assert.ok(normalize, 'Both Windows targets must normalize their actual installed metadata.');
 assert.ok(commands.indexOf(normalize) > commands.findIndex(command => command.phase === 'svt-av1-install'));
 assert.ok(commands.indexOf(normalize) < commands.indexOf(configure));
 assert.equal(configure.args.some(arg => arg.startsWith('--ld=')), false, 'The authenticated native linker keeps its own MSVC search-path filter.');
 assert.equal(readFileSync(f.file, 'utf8'), CAPTURED_PC.replace('-UEB_DLL', ''));
});

test('normalization preserves every captured CRLF byte outside the private token and removes temporary files', context => {
 const f = fixture(context); const result = runNormalizer(f.file); assert.equal(result.status, 0, result.stderr);
 assert.equal(readFileSync(f.file, 'utf8'), CAPTURED_PC.replace('-UEB_DLL', '')); assert.deepEqual(readdirSync(f.root), ['SvtAv1Enc.pc']);
});

for (const [label, metadata] of [
 ['wrong-version', CAPTURED_PC.replace('4.2.0', '4.3.0')], ['wrong-name', CAPTURED_PC.replace('Name: SvtAv1Enc', 'Name: Foreign')],
 ['missing-private', CAPTURED_PC.replace('Cflags.private: -UEB_DLL\r\n', '')],
 ['duplicate-private', CAPTURED_PC + 'Cflags.private: -UEB_DLL\r\n'],
 ['unexpected-private', CAPTURED_PC.replace('-UEB_DLL', '-UEB_DLL -DOTHER=1')],
 ['wrong-undefine', CAPTURED_PC.replace('-UEB_DLL', '-UOTHER')], ['embedded-nul', CAPTURED_PC + '\0'],
 ['oversized', CAPTURED_PC + ' '.repeat(16_384)],
] as const) test(`normalizer refuses ${label} before mutation`, context => {
 const f = fixture(context); writeFileSync(f.file, metadata); const result = runNormalizer(f.file);
 assert.notEqual(result.status, 0); assert.match(result.stderr, /SVT|pkg-config|metadata|private|bound/iu);
 assert.equal(readFileSync(f.file, 'utf8'), metadata); assert.deepEqual(readdirSync(f.root), ['SvtAv1Enc.pc']);
});

test('failed atomic publication retains original metadata and removes only its own temporary file', async context => {
 const f = fixture(context), failure = new Error('publish-failure-sentinel');
 const { normalizeWindowsSvtPkgConfig } = await import('../native/framescaper-media-host/build/windows-svt-pkg-config.ts');
 let publications = 0;
 await assert.rejects(normalizeWindowsSvtPkgConfig(f.file, { publish: async (temporary: string, destination: string) => {
  publications++; assert.equal(destination, f.file); assert.equal(await readFile(destination, 'utf8'), CAPTURED_PC);
  assert.equal(await readFile(temporary, 'utf8'), CAPTURED_PC.replace('-UEB_DLL', '')); throw failure;
 } }), error => error === failure);
 assert.equal(publications, 1); assert.equal(readFileSync(f.file, 'utf8'), CAPTURED_PC); assert.deepEqual(readdirSync(f.root), ['SvtAv1Enc.pc']);
});

test('upstream linker warnings and nonzero exit statuses still refuse the normalized static probe', { skip: !existsSync(shell) }, context => {
 const f = fixture(context), metadata = CAPTURED_PC.replace('-UEB_DLL', '');
 const warning = 'LINK : warning LNK4044: unrecognized option /FOREIGN; ignored';
 const warned = runProbe(f.root, metadata, '-MT -UEB_DLL', warning); assert.notEqual(warned.status, 0); assert.ok(warned.diagnostic.includes(warning));
 const failed = runProbe(f.root, metadata, '-MT -UEB_DLL', '', 23); assert.notEqual(failed.status, 0);
 assert.ok(failed.linker.includes('-libpath:' + PREFIX + '/lib'));
});

test('all non-Windows recipes retain their original metadata and compiler flags', context => {
 const f = fixture(context);
 for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64']) {
  const commands = plan(f.root, target); assert.equal(commands.some(command => command.phase === 'svt-av1-normalize-pkg-config'), false);
  const configure = commands.find(command => command.phase === 'ffmpeg-configure')!;
  assert.equal(configure.args.some(arg => arg.includes('EB_DLL')), false);
 }
});
