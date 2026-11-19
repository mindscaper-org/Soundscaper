/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { DESKTOP_LIGHTSCAPER_RAW_FILES_CURRENT_V1 as files, stageDesktopLightscaperRawRuntimeCurrentV1 as stage,
 verifyDesktopLightscaperRawRuntimeCurrentV1 as verify } from '../scripts/lib/desktop-lightscaper-raw-runtime-current-v1.ts';

const ROOT = resolve(import.meta.dirname, '..'), execute = promisify(execFile);
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
void test('all33 reviewed desktop RAW payloads survive an actual CRLF Git checkout and strict public staging unchanged', { timeout: 60_000 }, async context => {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-raw-checkout-'))), repository = join(base, 'repository');
 await mkdir(repository); const empty = join(base, 'empty-git-config'), templates = join(base, 'empty-git-templates');
 await writeFile(empty, ''); await mkdir(templates);
 context.after(() => rm(base, { recursive: true, force: true }));
 const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/iu.test(name))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: empty, GIT_CONFIG_GLOBAL: empty, GIT_ATTR_NOSYSTEM: '1' };
 async function git(args: readonly string[]): Promise<void> {
  await execute('git', ['-C', repository, '-c', 'core.attributesFile=', '-c', `core.hooksPath=${templates}`, ...args],
   { env, timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true });
 }
 assert.equal(files.length, 33);
 for (const pin of files) {
  const bytes = await readFile(join(ROOT, pin.source)); assert.equal(bytes.length, pin.byteLength, pin.source); assert.equal(hash(bytes), pin.sha256, pin.source);
  const target = join(repository, pin.source); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
 }
 await writeFile(join(repository, '.gitattributes'), await readFile(join(ROOT, '.gitattributes')));
 await git(['init', '-q', `--template=${templates}`]);
 await git(['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'add', '--', '.gitattributes', ...files.map(file => file.source)]);
 for (const source of new Set(files.map(file => file.source))) await rm(join(repository, source));
 await git(['-c', 'core.autocrlf=true', '-c', 'core.eol=crlf', 'checkout-index', '--force', '--all']);
 const changed: { path: string; expectedByteLength: number; actualByteLength: number; expectedSha256: string; actualSha256: string }[] = [];
 for (const pin of files) {
  const bytes = await readFile(join(repository, pin.source)), sha256 = hash(bytes);
  if (bytes.length !== pin.byteLength || sha256 !== pin.sha256) changed.push({ path: pin.source, expectedByteLength: pin.byteLength, actualByteLength: bytes.length, expectedSha256: pin.sha256, actualSha256: sha256 });
 }
 assert.deepEqual(changed, [], 'checkout conversion must preserve every reviewed payload byte, including source notices, licenses and sidecars');
 const runtimeRoot = join(base, 'runtime'), staged = await stage({ repositoryRoot: repository, runtimeRoot });
 assert.equal(staged.files.length, 33); assert.deepEqual(await verify({ runtimeRoot }), staged);
});
