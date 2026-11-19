/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { linkedOriginalsFixtureCurrentV1 as fixture, options, withInput, path, hash, ticket, GRANTED_FS_OP as OP,
	remainsPending, linkedBytesCurrentV1 as bytes, linkedExactFailureCurrentV1 as exact } from './helpers/lightscaper-native-linked-originals-integration-fixture-current.ts';

void test('Lightscaper linked input close retains actual consumer and read ownership through callback settlement and native close', options, async context => {
	await fixture(context, async f => {
		const entry=await f.prepare(), entered=f.gate(), release=f.gate();
		const consuming=f.track(withInput(entry.input,f.mediaDatabasePath,async view=>{ assert.equal(hash(await view.read(0,view.byteLength)),hash(entry.bytes)); entered.release(); await release.promise; }));
		await f.reached(entered.promise,consuming); const hold=f.holdNext(OP.fileClose);
		try {
			const closing=f.track(entry.input.close()); assert.equal(closing,entry.input.close()); assert.equal(await remainsPending(closing),true);
			let invoked=0; await assert.rejects(withInput(entry.input,f.mediaDatabasePath,()=>{invoked++;})); assert.equal(invoked,0);
			release.release(); await f.reached(hold.entered,closing); assert.equal(await remainsPending(closing),true);
			hold.release(); await consuming; await closing;
		} finally { release.release(); hold.release(); await Promise.allSettled([consuming,entry.input.close()]); }
	});
});

void test('Lightscaper local linked input abort joins held actual FILE_OPEN without killing an unrelated native root', options, async context => {
	await fixture(context, async f => {
		const independent=await f.root(), caller=new AbortController(), reason=new Proxy({}, {get(){throw new Error('opaque reason reflected');}}),hold=f.holdNext(OP.fileOpen);
		try {
			const preparing=f.track(f.linked.prepareInput(f.grant.grantId,[path('photo.bin')],{signal:caller.signal}));
			await f.reached(hold.entered,preparing); caller.abort(reason); assert.equal(await remainsPending(preparing),true);
			hold.release(); await exact(preparing,reason);
			const file=await independent.openFile([path('photo.bin')]);
			try { assert.equal(hash(await file.read(0,f.bytes.byteLength)),hash(f.bytes)); } finally { await file.close(); }
		} finally { hold.release(); await independent.close(); }
	});
});

void test('Lightscaper revoke fences new linked reads and waits actual ticket consumer retirement before its durable tombstone', options, async context => {
	await fixture(context, async f => {
		const entry=await f.prepare(); await f.publish(entry); const request=f.request(entry), opened=ticket(await f.tickets.transport.open(request),request);
		const revoking=f.track(f.grants.revoke(f.grant.grantId));
		try {
			assert.equal(await remainsPending(revoking),true); await assert.rejects(f.tickets.transport.open(request));
			assert.equal(await remainsPending(revoking),true); await f.tickets.transport.close({id:opened.id}); assert.equal(await revoking,true);
			assert.equal((await f.grants.revalidate(f.grant.grantId))?.revoked,true);
			const unrelated=await f.root(); await unrelated.close();
		} finally { await f.tickets.transport.close({id:opened.id}); await Promise.allSettled([revoking]); }
	});
});

void test('Lightscaper Media close joins actual linked native file retirement while ticket cleanup remains available', options, async context => {
	await fixture(context, async f => {
		const entry=await f.prepare(); await f.publish(entry); const request=f.request(entry), opened=ticket(await f.tickets.transport.open(request),request);
		assert.equal(hash(bytes(await f.tickets.transport.read(opened,0,entry.bytes.byteLength))),hash(entry.bytes));
		const hold=f.holdNext(OP.fileClose);
		try {
			const retiring=f.track(f.tickets.transport.close({id:opened.id})); await f.reached(hold.entered,retiring);
			const closing=f.track(f.media.close()); assert.equal(closing,f.media.close()); assert.equal(await remainsPending(closing),true);
			hold.release(); await retiring; await closing;
		} finally { hold.release(); await f.tickets.transport.close({id:opened.id}); }
	});
});

void test('Lightscaper linked native reads share four actual IO slots and never queue a fifth pull', options, async context => {
	await fixture(context, async f => {
		const entry=await f.prepare(); await f.publish(entry); const request=f.request(entry), opened=[];
		for (let i=0;i<5;i++) opened.push(ticket(await f.tickets.transport.open(request),request));
		const hold=f.holdNext(OP.read); const accepted=opened.slice(0,4).map(value=>f.track(f.tickets.transport.read(value,0,entry.bytes.byteLength)));
		try {
			await f.reached(hold.entered,Promise.all(accepted)); await assert.rejects(f.tickets.transport.read(opened[4]!,0,1),/busy|capacity/iu);
			hold.release(); for (const value of await Promise.all(accepted)) assert.equal(hash(bytes(value)),hash(entry.bytes));
			assert.ok(f.native.maximumResponse(OP.read)<=1048576);
		} finally { hold.release(); await Promise.allSettled(accepted); await Promise.allSettled(opened.map(value=>f.tickets.transport.close({id:value.id}))); }
	});
});

void test('Lightscaper linked capture registers before options close reentry and refuses later front doors without inspecting arguments', options, async context => {
	await fixture(context, async f => {
		const reason=Symbol('linked capture'), before=f.count(OP.rootOpen); let closing:Promise<void>|undefined, reflected=0;
		const reenter=():never=>{reflected++;closing=f.linked.close();throw reason;},poison=new Proxy({}, {ownKeys:reenter,get:reenter,getOwnPropertyDescriptor:reenter});
		await exact(f.linked.prepareInput(f.grant.grantId,[path('photo.bin')],poison),reason); assert.ok(closing); await closing;
		assert.equal(reflected,1); assert.equal(f.count(OP.rootOpen),before);
		await assert.rejects(f.linked.prepareInput(poison as never,poison as never,poison)); assert.equal(reflected,1);
	});
});
