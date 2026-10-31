/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createFramescaperMediaHostBuildCommands, framescaperMediaHostBuildPaths } from '../native/framescaper-media-host/build/media-build-commands.mjs';

const hostRoot = resolve(import.meta.dirname, '../native/framescaper-media-host');
const compiler = process.env.CC ?? 'cc';
const hasCompiler = spawnSync(compiler, ['--version'], { stdio: 'ignore', timeout: 5_000 }).status === 0;
// Exact zlib1.3.1 zconf.h.cmakein blocks from authenticated1,512,791-byte
// archive9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23;
// cmakeinSHA350fb02462487a3e8612c18ad279053996ce0c85ebfece25a959baea9db86562.
const LEGACY = `#ifdef HAVE_UNISTD_H    /* may be set to #if 1 by ./configure */
#  define Z_HAVE_UNISTD_H
#endif`;
const INCLUDE = `#ifndef Z_SOLO
#  if defined(Z_HAVE_UNISTD_H)
#    include <unistd.h>         /* for SEEK_*, off_t, and _LFS64_LARGEFILE */
#    ifdef VMS
#      include <unixio.h>       /* for off_t */
#    endif
#    ifndef z_off_t
#      define z_off_t off_t
#    endif
#  endif
#endif`;
const LEGACY_SHA256 = 'd6d389f3d96224c31d82ed3581c5ab7e44b0fc89c93cec3c825de43ba3d0d2f7', INCLUDE_SHA256 = '9c78a819991e6b37afc35bff45bcbdc79c30b27fc9f68ed05b653ac16fb9558a';
const API = 'extern int deflate(void *, int);\nextern int inflate(void *, int);\nextern void *gzopen(const char *, const char *);\nextern int gzread(void *, void *, unsigned);\nextern int gzwrite(void *, const void *, unsigned);\nextern int gzclose(void *);\n';
const HEADER = '/* zconf.h -- configuration of the zlib compression library */\n#ifndef ZCONF_H\n#define ZCONF_H\n'
 + LEGACY + '\n' + INCLUDE + '\n#ifndef Z_SOLO\n' + API + '#else\n#error gz_api_must_not_be_removed\n#endif\n#endif\n';

interface Command { readonly phase: string; readonly executable: string; readonly args: readonly string[]; readonly cwd: string; readonly environment: NodeJS.ProcessEnv }
function fixture(context: TestContext, text = HEADER) {
 const root = mkdtempSync(join(tmpdir(), 'framescaper-zlib-header-'));
 context.after(() => rmSync(root, { recursive: true, force: true }));
 const file = join(root, 'zconf.h'); writeFileSync(file, text); return { root, file };
}
function plan(root: string, target: string): readonly Command[] {
 const executables = Object.fromEntries(['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'nasm', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell']
  .map(role => [role, { path: '/tools/' + role }]));
 return createFramescaperMediaHostBuildCommands({ target: { id: target, cmakePreset: target }, hostRoot,
  ffmpegSourceRoot: 'C:/sources/ffmpeg', boostSourceRoot: '/boost', paths: framescaperMediaHostBuildPaths(root), tools: { executables },
  environment: { PATH: process.env.PATH }, configureFlags: [],
  externalSourceRoots: Object.fromEntries(['x264', 'x265', 'libvpx', 'svt-av1', 'libopus', 'zlib'].map(role => [role, 'C:/sources/' + role])),
 }) as readonly Command[];
}
function normalize(file: string) {
 return spawnSync(process.execPath, [join(hostRoot, 'build/windows-zlib-header.ts'), file], { encoding: 'utf8', timeout: 10_000 });
}
function preprocess(root: string, foreign: number | undefined, independent: number | undefined) {
 writeFileSync(join(root, 'config.h'), foreign === undefined ? '' : '#define HAVE_UNISTD_H ' + foreign + '\n');
 const define = independent === undefined ? '' : '#define Z_HAVE_UNISTD_H ' + independent + '\n';
 return spawnSync(compiler, ['-nostdinc', '-E', '-P', '-x', 'c', '-I', root, '-'], { encoding: 'utf8', timeout: 10_000,
  input: define + '#include "config.h"\n#include "zconf.h"\n' });
}
function assertApi(output: string) {
 for (const name of ['deflate', 'inflate', 'gzopen', 'gzread', 'gzwrite', 'gzclose']) assert.match(output, new RegExp('\\b' + name + '\\b', 'u'));
}

for (const target of ['win-x64', 'win-arm64']) test(`${target} zlib ignores FFmpeg defined-zero unistd without removing gzip APIs`, { skip: !hasCompiler }, context => {
 const f = fixture(context), commands = plan(f.root, target), phase = commands.find(command => command.phase === 'zlib-normalize-header');
 if (phase) {
  const destination = phase.args.at(-1)!; mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, HEADER);
  const result = spawnSync(phase.executable, [...phase.args], { cwd: f.root, env: { ...process.env, ...phase.environment }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr); writeFileSync(f.file, readFileSync(destination));
 }
 assert.equal(createHash('sha256').update(LEGACY).digest('hex'), LEGACY_SHA256);
 assert.equal(createHash('sha256').update(INCLUDE).digest('hex'), INCLUDE_SHA256);
 const result = preprocess(f.root, 0, undefined);
 assert.equal(result.status, 0, result.stderr); assertApi(result.stdout);
 assert.ok(phase, 'Only derived installed headers change after their real install.');
 assert.ok(commands.indexOf(phase) > commands.findIndex(command => command.phase === 'zlib-install-metadata'));
 assert.ok(commands.indexOf(phase) < commands.findIndex(command => command.phase === 'ffmpeg-configure'));
 assert.equal(commands.find(command => command.phase === 'ffmpeg-configure')!.args.some(arg => /HAVE_UNISTD|Z_SOLO/u.test(arg)), false);
});

for (const [name, foreign, independent, available] of [
 ['undefined', undefined, undefined, true], ['zero', 0, undefined, true], ['one', 1, undefined, false],
 ['independent-one', 0, 1, false], ['independent-undefined-foreign', undefined, 1, false], ['independent-zero', 0, 0, false],
] as const) test(`normalized zlib retains header availability contract ${name}`, { skip: !hasCompiler }, context => {
 const f = fixture(context); const normalized = normalize(f.file); assert.equal(normalized.status, 0, normalized.stderr);
 const result = preprocess(f.root, foreign, independent);
 if (available) { assert.equal(result.status, 0, result.stderr); assertApi(result.stdout); }
 else { assert.notEqual(result.status, 0); assert.match(result.stderr, /unistd[.]h/u); }
});

test('normalizer marks exactly the boolean guard alteration and preserves all other CRLF header/prototype bytes', context => {
 const original = HEADER.replaceAll('\n', '\r\n'), f = fixture(context, original);
 const result = normalize(f.file); assert.equal(result.status, 0, result.stderr);
 const actual = readFileSync(f.file, 'utf8'), before = original.indexOf('#ifdef HAVE_UNISTD_H'), after = before + '#ifdef HAVE_UNISTD_H'.length;
 const replacement = actual.slice(before, actual.length - (original.length - after));
 assert.match(replacement, /Soundscaper Windows/u); assert.match(replacement, /#if defined\(HAVE_UNISTD_H\) && HAVE_UNISTD_H/u);
 assert.equal(actual, original.slice(0, before) + replacement + original.slice(after));
 assert.equal(actual.replace(replacement, '#ifdef HAVE_UNISTD_H'), original); assert.ok(actual.includes(API.replaceAll('\n', '\r\n')));
 assert.deepEqual(readdirSync(f.root), ['zconf.h']);
});

for (const [name, input] of [
 ['missing', HEADER.replace(LEGACY, '')], ['duplicate', HEADER + LEGACY],
 ['changed-guard', HEADER.replace('#ifdef HAVE_UNISTD_H', '#if HAVE_UNISTD_H')],
 ['changed-include', HEADER.replace('#  if defined(Z_HAVE_UNISTD_H)', '#  if 0')],
 ['embedded-nul', HEADER + '\0'], ['oversized', HEADER + ' '.repeat(65_536)],
] as const) test(`zlib normalizer refuses ${name} before mutation`, context => {
 const f = fixture(context, input); const result = normalize(f.file); assert.notEqual(result.status, 0);
 assert.match(result.stderr, /zlib|header|metadata|guard|bound/iu); assert.equal(readFileSync(f.file, 'utf8'), input);
 assert.deepEqual(readdirSync(f.root), ['zconf.h']);
});

test('failed zlib publication preserves original header and retires only its own pending file', async context => {
 const f = fixture(context), failure = new Error('zlib-publish-sentinel');
 const { normalizeWindowsZlibHeader } = await import('../native/framescaper-media-host/build/windows-zlib-header.ts');
 let publishes = 0;
 await assert.rejects(normalizeWindowsZlibHeader(f.file, { publish: async (temporary: string, destination: string) => {
  publishes++; assert.equal(destination, f.file); assert.equal(await readFile(destination, 'utf8'), HEADER);
  assert.match(await readFile(temporary, 'utf8'), /Soundscaper Windows/u); throw failure;
 } }), error => error === failure);
 assert.equal(publishes, 1); assert.equal(readFileSync(f.file, 'utf8'), HEADER); assert.deepEqual(readdirSync(f.root), ['zconf.h']);
});

test('non-Windows zlib recipes retain original installed headers and compiler flags', context => {
 const f = fixture(context);
 for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64']) {
  const commands = plan(f.root, target); assert.equal(commands.some(command => command.phase === 'zlib-normalize-header'), false);
  assert.equal(commands.find(command => command.phase === 'ffmpeg-configure')!.args.some(arg => /HAVE_UNISTD|Z_SOLO/u.test(arg)), false);
 }
});
