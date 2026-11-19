/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { downloadPinnedFramescaperMediaHostSource } from '../scripts/lib/framescaper-media-host-external-source-ci.mjs';

const bytes = Buffer.from('source archive');
const source = {
	id: 'fixture', url: 'https://example.test/source.tar.gz', byteLength: bytes.byteLength,
	sha256: createHash('sha256').update(bytes).digest('hex'),
};
const prefix = 'fixture download could not reach its pinned URL.';

test('curl transport refusal reports bounded status, signal and sanitized stderr without publishing an archive', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-curl-failure-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const destination = join(directory, 'source.archive');
	let calls = 0;
	await assert.rejects(downloadPinnedFramescaperMediaHostSource({
		destination, source,
		runCurl(command: string, args: readonly string[], options: { shell: boolean; maxBuffer: number }) {
			calls++;
			assert.equal(command, 'curl');
			assert.deepEqual(args, ['--fail', '--location', '--silent', '--show-error', '--retry', '2',
				'--max-time', '300', '--max-filesize', String(source.byteLength), '--proto', '=https', source.url]);
			assert.equal(options.shell, false);
			assert.equal(options.maxBuffer, source.byteLength + 1024 * 1024);
			return { status: 22, signal: null, stdout: Buffer.alloc(0),
				stderr: Buffer.from(`HTTP 503\r\n\u001b[31mtemporarily unavailable\u0000${'x'.repeat(5000)}must-not-appear`) };
		},
	}), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.ok(error.message.startsWith(prefix));
		assert.match(error.message, /status[=: ]+22/u);
		assert.match(error.message, /signal[=: ]+null/u);
		assert.match(error.message, /HTTP 503/u);
		assert.match(error.message, /temporarily unavailable/u);
		assert.equal([...error.message].some(character => {
			const code = character.charCodeAt(0);
			return code < 32 || (code >= 127 && code <= 159);
		}), false, 'The diagnostic must not contain control characters.');
		assert.doesNotMatch(error.message, /must-not-appear/u);
		assert.ok(error.message.length < 4352, 'The diagnostic must retain only bounded stderr.');
		return true;
	});
	assert.equal(calls, 1, 'Reporting must not add another retry policy.');
	await assert.rejects(access(destination), { code: 'ENOENT' });
});

test('curl signal and spawn failure keep the original cause and leave no destination', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-curl-signal-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const destination = join(directory, 'source.archive');
	const failure = Object.assign(new Error('curl could not start'), { code: 'ENOENT' });
	await assert.rejects(downloadPinnedFramescaperMediaHostSource({
		destination, source,
		runCurl: () => ({ status: null, signal: 'SIGTERM', error: failure,
			stdout: Buffer.alloc(0), stderr: Buffer.from('transfer terminated') }),
	}), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.ok(error.message.startsWith(prefix));
		assert.match(error.message, /status[=: ]+null/u);
		assert.match(error.message, /signal[=: ]+SIGTERM/u);
		assert.match(error.message, /transfer terminated/u);
		assert.equal(error.cause, failure);
		return true;
	});
	await assert.rejects(access(destination), { code: 'ENOENT' });
});

test('the curl path still authenticates exact bytes and removes a digest-mismatched archive', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-curl-authentication-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const destination = join(directory, 'source.archive');
	const runCurl = () => ({ status: 0, signal: null, stdout: bytes, stderr: Buffer.alloc(0) });
	await downloadPinnedFramescaperMediaHostSource({ destination, source, runCurl });
	assert.deepEqual(await readFile(destination), bytes);
	const invalidDestination = join(directory, 'invalid.archive');
	await assert.rejects(downloadPinnedFramescaperMediaHostSource({
		destination: invalidDestination, source: { ...source, sha256: '0'.repeat(64) }, runCurl,
	}), /digest authentication/u);
	await assert.rejects(access(invalidDestination), { code: 'ENOENT' });
});
