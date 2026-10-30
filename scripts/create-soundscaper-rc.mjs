#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { prepareSoundscaperRelease } from './prepare-soundscaper-release.mjs';
import { readProductReleaseLines, resolveProductApplicationVersion } from './lib/product-release-lines.mjs';

const execute = promisify(execFile);
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const TAG_PREFIX = 'soundscaper-v';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GIT_OPERATIONS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer'];

export function nextSoundscaperRcVersion(currentVersion, now, tags = []) {
	if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('The RC date must be valid.');
	const match = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-(?:rc|beta)\.[0-9A-Za-z.-]+)?$/u.exec(currentVersion);
	if (!match) throw new TypeError('The current Soundscaper version is invalid.');
	const prefix = `${match[1]}-rc.${MONTHS[now.getMonth()]}.${now.getDate()}.`;
	const versions = [currentVersion, ...tags.filter(tag => tag.startsWith(TAG_PREFIX)).map(tag => tag.slice(TAG_PREFIX.length))];
	let latest = '';
	for (const version of versions) {
		if (!version.startsWith(prefix)) continue;
		const suffix = version.slice(prefix.length);
		if (/^[a-z]+$/u.test(suffix)
			&& (suffix.length > latest.length || (suffix.length === latest.length && suffix > latest))) latest = suffix;
	}
	return `${prefix}${incrementSuffix(latest)}`;
}

export async function createSoundscaperRc({ repositoryRoot = REPOSITORY_ROOT, now = new Date(),
	writeOutput = value => process.stdout.write(value) } = {}) {
	const root = await realpath(repositoryRoot);
	const git = async args => (await execute('git', args, { cwd: root, maxBuffer: 10 * 1024 * 1024 })).stdout.trim();
	await assertGitReady(root, git);
	const releaseLines = await readProductReleaseLines(root);
	const currentVersion = resolveProductApplicationVersion('soundscaper', releaseLines);
	const tags = (await git(['tag', '--list', `${TAG_PREFIX}*`])).split(/\r?\n/u);
	const version = nextSoundscaperRcVersion(currentVersion, now, tags);
	const tag = `${TAG_PREFIX}${version}`;
	await prepareSoundscaperRelease({ repositoryRoot: root, version, writeOutput: () => {} });
	try {
		// The owner command includes staged, unstaged, new, and deleted files;
		// Git's ignore rules continue to exclude local build output and notes.
		await git(['add', '--all', '--', '.']);
		await git(['commit', '--message', `chore(release): prepare Soundscaper ${version}`]);
	} catch (error) {
		throw new Error(`RC commit failed; your changes are preserved and no tag was created.\n${error.message}`, { cause: error });
	}
	const commit = await git(['rev-parse', 'HEAD']);
	try {
		await git(['tag', '--annotate', tag, commit, '--message', `Soundscaper ${version}`]);
	} catch (error) {
		throw new Error(`RC commit ${commit} was created, but tagging failed.\n`
			+ `After fixing the Git error, tag that commit with:\n`
			+ `git tag --annotate ${tag} ${commit} --message 'Soundscaper ${version}'\n${error.message}`, { cause: error });
	}
	writeOutput(`Created Soundscaper ${version}\nCommit: ${commit}\nTag: ${tag}\n\n`
		+ `Push when ready:\ngit push --atomic origin HEAD refs/tags/${tag}\n`);
	return { version, tag, commit };
}

function incrementSuffix(value) {
	const letters = [...value];
	for (let index = letters.length - 1; index >= 0; index -= 1) {
		if (letters[index] !== 'z') {
			letters[index] = String.fromCharCode(letters[index].charCodeAt(0) + 1);
			return letters.join('');
		}
		letters[index] = 'a';
	}
	return `a${letters.join('')}`;
}

async function assertGitReady(root, git) {
	if (await realpath(await git(['rev-parse', '--show-toplevel'])) !== root) {
		throw new Error('Run RC creation from the Soundscaper repository root.');
	}
	try { await git(['symbolic-ref', '--quiet', 'HEAD']); }
	catch (error) { throw new Error('Check out a branch before creating an RC; HEAD is detached.', { cause: error }); }
	await git(['rev-parse', '--verify', 'HEAD']);
	for (const operation of GIT_OPERATIONS) {
		const path = resolve(root, await git(['rev-parse', '--git-path', operation]));
		try { await access(path); }
		catch (error) { if (error.code === 'ENOENT') continue; throw error; }
		throw new Error('Finish the Git operation in progress before creating an RC.');
	}
	if (await git(['ls-files', '--unmerged'])) throw new Error('Resolve Git conflicts before creating an RC.');
	await git(['var', 'GIT_AUTHOR_IDENT']);
	await git(['var', 'GIT_COMMITTER_IDENT']);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	try {
		const args = process.argv.slice(2);
		if (args.length === 1 && args[0] === '--help') {
			process.stdout.write('Usage: npm run release:soundscaper:rc\n'
				+ 'Choose the next local-date RC, commit all nonignored changes, and create an annotated tag.\n'
				+ 'Pushing is manual.\n');
		} else {
			if (args.length !== 0) throw new Error('Usage: npm run release:soundscaper:rc (no arguments)');
			await createSoundscaperRc();
		}
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
