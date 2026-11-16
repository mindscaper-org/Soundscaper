/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { AiDenoiseSessions, type AiDenoisePort } from '../desktop/ai-denoise-sessions.ts';

const request = (id = 0) => ({ sessionId: id.toString(16).padStart(40, '0'), sampleRate: 48000, channelCount: 1 });
class Owner extends EventEmitter { isDestroyed() { return false; } }
class Port implements AiDenoisePort {
	readonly messages: unknown[] = [];
	closed = false;
	postMessage(value: unknown) { this.messages.push(value); }
	close() { this.closed = true; }
}
class Child extends EventEmitter {
	readonly pid = 1;
	killed = false;
	readonly posts: { value: unknown; ports: AiDenoisePort[] }[] = [];
	postMessage(value: unknown, ports: AiDenoisePort[] = []) { this.posts.push({ value, ports }); }
	kill() { this.killed = true; this.emit('exit'); }
}
test('only bounded, closed-shape session requests can reach process creation', async () => {
	const children: Child[] = [], errors: unknown[] = [];
	const sessions = new AiDenoiseSessions({ prepare: async () => ({ modelPath: '/private' }),
		spawn: () => { const child = new Child(); children.push(child); return child; },
		sampleRss: () => null, onError: error => errors.push(error) });
	const owner = new Owner();
	for (const value of [{ ...request(), modelPath: '/attacker' }, { ...request(), sampleRate: 44100 }, { ...request(), channelCount: 32 }]) {
		const port = new Port(); await sessions.open(value, port, owner);
		assert.ok(port.closed); assert.ok(!JSON.stringify(port.messages).includes('/private'));
	}
	assert.equal(children.length, 0);
	for (let id = 0; id < 4; id++) await sessions.open(request(id), new Port(), owner);
	assert.equal(children.length, 4);
	const refused = new Port(); await sessions.open(request(5), refused, owner); assert.ok(refused.closed);
	children[0]!.emit('message', 'closed');
	await sessions.open(request(5), new Port(), owner); assert.equal(children.length, 5);
	owner.emit('destroyed'); assert.ok(children.every(child => child.killed));
	assert.equal(owner.listenerCount('destroyed'), 0);
	sessions.dispose(); sessions.dispose();
	assert.equal(errors.length, 4);
});
test('shutdown during authentication revokes the pending request without spawning', async () => {
	let settle!: (value: Record<string, unknown>) => void, spawned = false;
	const sessions = new AiDenoiseSessions({ prepare: () => new Promise(resolve => { settle = resolve; }),
		spawn: () => { spawned = true; return new Child(); }, sampleRss: () => null, onError: () => undefined });
	const owner = new Owner(), port = new Port();
	const opening = sessions.open(request(), port, owner);
	sessions.dispose(); settle({}); await opening;
	assert.equal(spawned, false); assert.ok(port.closed); assert.equal(owner.listenerCount('destroyed'), 0);
});

test('failed GPU preparation retires its process before CPU retry and never transfers the port twice', async () => {
	const children: Child[] = [];
	const sessions = new AiDenoiseSessions({ prepare: async () => ({ executionProviders: ['webgpu', 'cpu'] }),
		spawn: () => { const child = new Child(); children.push(child); return child; }, sampleRss: () => null, onError: () => undefined });
	const owner = new Owner(), port = new Port();
	await sessions.open(request(), port, owner);
	assert.deepEqual(children[0]!.posts[0]!.ports, []);
	assert.equal((children[0]!.posts[0]!.value as { provider: string }).provider, 'webgpu');
	children[0]!.emit('message', { type: 'error', recoverable: true, message: 'GPU unavailable' });
	assert.equal(children[0]!.killed, true); assert.equal(children.length, 2); assert.equal(port.closed, false);
	assert.equal((children[1]!.posts[0]!.value as { provider: string }).provider, 'cpu');
	children[0]!.emit('message', { type: 'ready' });
	assert.equal(children[0]!.posts.length, 1);
	children[1]!.emit('message', { type: 'ready' });
	assert.deepEqual(children[1]!.posts[1]!.ports, [port]);
	children[1]!.emit('message', { type: 'error', recoverable: true, message: 'Live failure' });
	assert.equal(children.length, 2); assert.equal(children[1]!.killed, true);
	sessions.dispose();
});

test('failed fallback process creation closes its held port without throwing from a native callback', async () => {
	const child = new Child(); let starts = 0;
	const sessions = new AiDenoiseSessions({ prepare: async () => ({ executionProviders: ['webgpu', 'cpu'] }),
		spawn: () => { if (starts++) throw new Error('spawn failed'); return child; }, sampleRss: () => null, onError: () => undefined });
	const port = new Port(); await sessions.open(request(), port, new Owner());
	assert.doesNotThrow(() => child.emit('message', { type: 'error', recoverable: true, message: 'GPU unavailable' }));
	assert.equal(port.closed, true); assert.equal(child.killed, true); sessions.dispose();
});
