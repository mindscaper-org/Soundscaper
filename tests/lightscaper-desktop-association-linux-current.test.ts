/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readLightscaperLinuxAssociationMetadataCurrentV1 as metadata } from '../scripts/lib/lightscaper-desktop-association-linux-current-v1.ts';
import { associationFileCurrentV1 as pin, associationRecordCurrentV1 as record,
	createLightscaperAssociationProcessOwnerCurrentV1 as processes } from '../scripts/lib/lightscaper-desktop-association-evidence-current-v1.ts';

const MIME = 'application/vnd.lightscaper.liscape+zip', EXE = '/opt/Lightscaper/lightscaper';
const DESKTOP = `[Desktop Entry]\nName=Lightscaper\nExec=${EXE} %U\nTerminal=false\nType=Application\nIcon=lightscaper\nMimeType=${MIME};\n`;
const XML = `<?xml version="1.0"?><mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info"><mime-type type="${MIME}"><glob pattern="*.liscape"/><comment>Lightscaper photo catalog</comment></mime-type></mime-info>`;

void test('Linux registration metadata admits only the installed archive-only Exec and exact own MIME/glob, never another product claim', () => {
	assert.deepEqual(metadata(DESKTOP, XML, EXE), { desktopId: 'org.lightscaper.desktop', mimeType: MIME, extension: 'liscape', exec: `${EXE} %U` });
	for (const [desktop, xml] of [
		[DESKTOP.replace(EXE, '/opt/foreign/app'), XML], [DESKTOP.replace(' %U', ' --user-data-dir=/foreign %U'), XML],
		[DESKTOP.replace(' %U', ' /preselected.liscape %U'), XML], [DESKTOP + 'DBusActivatable=true\n', XML],
		[DESKTOP + `MimeType=${MIME};\n`, XML], [DESKTOP.replace(`${MIME};`, `${MIME};application/vnd.soundscaper.scape+zip;`), XML],
		[DESKTOP, XML.replace('*.liscape', '*.sscape')], [DESKTOP, XML.replace('</mime-type>', '<glob pattern="*.fscape"/></mime-type>')],
		[DESKTOP, XML.replace('</mime-type>', '<alias type="application/vnd.soundscaper.scape+zip"/></mime-type>')],
		[DESKTOP, '<!DOCTYPE mime-info [<!ENTITY foreign SYSTEM "file:///foreign">]>' + XML],
	]) assert.throws(() => metadata(desktop!, xml!, EXE));
});

void test('association byte evidence reads real bounded files, rejects symlinks and closed-record accessors without invoking them', { timeout: 10_000 }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-association-evidence-'));
	try {
		const path = join(root, 'owned.json'), bytes = Buffer.from('{"actual":"bytes"}\n'); await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
		assert.deepEqual(await pin(path, 256), { path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
		await assert.rejects(pin(path, 1)); const alias = join(root, 'alias.json'); await symlink(path, alias); await assert.rejects(pin(alias, 256));
		let reflected = false; const value = { get field() { reflected = true; throw new Error('must not read'); } };
		assert.throws(() => record(value, ['field'])); assert.equal(reflected, false);
		assert.throws(() => record({ field: 1, foreign: 2 }, ['field'])); assert.deepEqual(await readFile(path), bytes);
	} finally { await rm(root, { recursive: true, force: true }); }
});

void test('association utilities retain actual natural exit/group evidence and remain usable after a distinct nonzero command', {
	timeout: 20_000, skip: process.platform === 'win32' ? 'Native Windows actual Job refusal fixtures own this path.' : false,
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-association-process-'));
	try {
		const owner = processes({ evidenceRoot: root });
		const okay = await owner.run(process.execPath, ['--input-type=module', '-e', 'process.stdout.write("real-child");'], { deadlineMs: 5000 });
		assert.equal(okay.exitCode, 0); assert.equal(okay.stdout, 'real-child'); assert.equal(okay.readersRetired, true); assert.equal(okay.forcedGroupRetirement, false);
		await assert.rejects(owner.run(process.execPath, ['--input-type=module', '-e', 'process.exitCode=7;'], { deadlineMs: 5000 }));
		assert.equal(owner.readersRetired, true); const next = await owner.run(process.execPath, ['--input-type=module', '-e', 'process.stdout.write("healthy-next");'], { deadlineMs: 5000 });
		assert.equal(next.stdout, 'healthy-next'); assert.equal(next.readersRetired, true); assert.equal(next.expired, false);
	} finally { await rm(root, { recursive: true, force: true }); }
});
