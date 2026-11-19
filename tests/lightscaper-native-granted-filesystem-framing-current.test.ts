/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { grantedFilesystemWireFixtureCurrentV1 as fixture, grantedFsInitCurrentV1 as init,
	grantedFsErrorCurrentV1 as error, grantedFsTargetCurrentV1 as target } from './helpers/lightscaper-native-granted-filesystem-wire-fixture-current.ts';
const deadline = { timeout: 15000 };

void test('actual FS peer INIT echoes authenticated nonce and exact maintained target/capacity profile', deadline, async context => fixture(context, async peer => {
	const hello = init(), result = await peer.request(1, hello); assert.equal(result.opcode, 129); assert.equal(result.body.byteLength, 53);
	assert.equal(result.body.subarray(0, 33).toString('hex'), hello.toString('hex'));
	assert.equal(result.body.readUInt16BE(33), 64); assert.equal(result.body.readUInt16BE(35), 4094);
	assert.equal(result.body[37], 4); assert.equal(result.body[38], 4); assert.equal(result.body.readUInt32BE(39), 1048576);
	assert.equal(result.body.readUInt32BE(43), 262144); assert.equal(result.body.readUInt16BE(47), 64); assert.equal(result.body.readUInt32BE(49), 65536);
	const bye = await peer.request(10); assert.equal(bye.opcode, 138); assert.equal(bye.body.byteLength, 0); await peer.joined;
}));

void test('native INIT refuses another maintained target rather than relabeling the actual executable', deadline, async context => fixture(context, async peer => {
	error(await peer.request(1, init(target() === 1 ? 2 : 1))); await peer.joined;
}));

void test('native unknown owner reads refuse while repeated unknown CLOSE stays idempotent without tombstones', deadline, async context => fixture(context, async peer => {
	await peer.request(1, init()); const id = randomBytes(32), range = Buffer.alloc(12); range.writeUInt32BE(1, 8);
	error(await peer.request(5, Buffer.concat([id, range])));
	for (const opcode of [3, 6, 9, 3, 6, 9]) { const reply = await peer.request(opcode, id); assert.equal(reply.opcode, opcode | 128); assert.equal(reply.body.length, 0); }
	const bye = await peer.request(10); assert.equal(bye.body.length, 0); await peer.joined;
}));

void test('native watermark is consumed on actual owner refusal and duplicate IDs retire the peer', deadline, async context => fixture(context, async peer => {
	await peer.request(1, init()); const absentRead = Buffer.alloc(44); absentRead[0] = 1; absentRead.writeUInt32BE(1, 40);
	error(await peer.request(5, absentRead, 2));
	error(await peer.request(10, Buffer.alloc(0), 2)); await peer.joined;
}));

void test('oversized declared native request refuses before reading or allocating its absent payload', deadline, async context => fixture(context, async peer => {
	await peer.request(1, init()); error(await peer.request(2, Buffer.alloc(0), undefined, 262145)); await peer.joined;
}));

void test('shipping peer refuses fixture-only commands and trailing control fields', deadline, async context => {
	for (const [opcode, payload] of [[48, Buffer.alloc(0)], [3, Buffer.concat([randomBytes(32), Buffer.alloc(1)])]] as const) await fixture(context, async peer => {
		await peer.request(1, init()); error(await peer.request(opcode, payload)); await peer.joined;
	});
});
