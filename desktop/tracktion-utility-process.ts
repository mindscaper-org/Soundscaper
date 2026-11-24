/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ParentPort } from 'electron';

import { readClosedDomainRecord } from '../src/common/foundation/closed-domain-value.ts';
import { TracktionRejectedCommand, type TracktionCommand } from './tracktion-peer-contract.ts';
import { launchTracktionPeer } from './tracktion-peer.ts';

const parent: ParentPort | null = process.parentPort;
const [mode, executable, projectDirectory, stateDirectory, exchangeDirectory, rate, clipboardDirectory, ...extra] = process.argv.slice(2);
if (!parent || !executable || !projectDirectory || !stateDirectory || !exchangeDirectory || extra.length > 0
	|| (mode !== 'create' && mode !== 'open') || typeof rate !== 'string' || (mode === 'open' && rate !== '0')) {
	throw new Error('Invalid Tracktion utility launch.');
}

const launch = { executable, projectDirectory, stateDirectory, exchangeDirectory,
	...(clipboardDirectory === undefined ? {} : { clipboardDirectory }) };
const port = parent;
let stopping = false;
let lastRequest = 0;
let effectReply: { resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;

const peer = launchTracktionPeer(mode === 'create' ? { ...launch, mode, sampleRate: Number(rate) } : { ...launch, mode }, () => ({
	async respond(request) {
		if (stopping || effectReply) throw new Error('The Tracktion utility effect relay is busy.');
		return new Promise<unknown>((resolve, reject) => {
			port.postMessage({ kind: 'effect', sequence: lastRequest, request });
			effectReply = { resolve, reject };
		});
	},
	async dispose() {
		effectReply?.reject(new Error('The Tracktion render ended during an effect request.'));
		effectReply = undefined;
	},
}));

try {
	await peer.request({ kind: 'project', offset: 0 });
} catch (cause) {
	await peer.close();
	throw new Error('The Tracktion utility could not open its Edit.', { cause });
}

async function accept(message: unknown): Promise<void> {
	if (stopping) return;
	const envelope = readClosedDomainRecord(
		message, 'Tracktion utility message', ['kind', 'sequence', 'command', 'reply'], ['kind'],
	);
	if (envelope.kind === 'close') {
		readClosedDomainRecord(message, 'Tracktion utility close', ['kind']);
		await stop(0);
		return;
	}
	if (envelope.kind === 'effectReply') {
		readClosedDomainRecord(message, 'Tracktion utility effect reply', ['kind', 'sequence', 'reply']);
		if (!effectReply || envelope.sequence !== lastRequest) throw new TypeError('Invalid Tracktion utility effect reply sequence.');
		const pending = effectReply;
		effectReply = undefined;
		pending.resolve(envelope.reply);
		return;
	}
	readClosedDomainRecord(message, 'Tracktion utility request', ['kind', 'sequence', 'command']);
	const sequence = envelope.sequence;
	if (envelope.kind !== 'request' || sequence !== lastRequest + 1) throw new TypeError('Invalid Tracktion utility sequence.');
	lastRequest = sequence;

	// Only Electron main owns this port. The native peer checks the closed
	// command, revision, and exchange slot again before applying a command.
	try {
		const value = await peer.request(envelope.command as TracktionCommand);
		if (!stopping) port.postMessage({ kind: 'reply', sequence, reply: { ok: true, value } });
	} catch (error) {
		if (!(error instanceof TracktionRejectedCommand)) throw error;
		if (!stopping) {
			port.postMessage({ kind: 'reply', sequence, reply: { ok: false, error: 'request', detail: error.message } });
		}
	}
}

async function stop(code: number): Promise<void> {
	if (stopping) return;
	stopping = true;
	await peer.close();
	process.exit(code);
}

port.on('message', (event) => {
	void accept(event.data).catch(async (error: unknown) => {
		console.error(error);
		await stop(1);
	});
});
port.postMessage({ kind: 'ready' });
