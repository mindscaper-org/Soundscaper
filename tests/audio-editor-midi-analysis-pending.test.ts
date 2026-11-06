/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiEffectsFixture } from './helpers/midi-effects-pending-fixture.ts';
import { settle } from './helpers/async-test-control.ts';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AnalysisDialog from '../src/common/editor/ui/dialogs/AnalysisDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';

function peak(report: unknown): number {
 assert.ok(report && typeof report === 'object' && 'peak' in report);
 const p = report.peak;
 assert.ok(p && typeof p === 'object' && 'frequency' in p && typeof p.frequency === 'number');
 return p.frequency;
}
for(const pending of [false,true]) test(`public Plot Spectrum measures ${pending?'pending':'settled'} requested source PCM after cached old-note report`,async t=>{
 const f=await midiEffectsFixture(t, false, 'buffer');
 const initial=await f.controller.actions.analysis.plotSpectrum('master');
 assert.ok(initial,JSON.stringify(f.controller.getSnapshot().status));
 assert.ok(Math.abs(peak(initial)-261.625565)<24);
 let updating: Promise<unknown> | undefined;
 if(pending) ({updating}=await f.pendingNote());
 else await f.controller.actions.midi.updateNote(f.clipId,'note',{pitch:67});
 let completed=false;
 const plotting=Promise.resolve(f.controller.actions.analysis.plotSpectrum('master'));
 void plotting.then(()=>{completed=true;},()=>{completed=true;});
 await settle();
 const completedBeforeWrite=completed;
 f.release.resolve();
 try{
  await updating;
  const report=await plotting;
  assert.ok(Math.abs(peak(report)-391.995435)<24,`expected requested pitch67, got ${peak(report)}Hz`);
  if(pending) assert.equal(completedBeforeWrite,false,'analysis cannot measure/cache before the requested PCM is published');
 }finally{f.release.resolve();await Promise.allSettled([updating,plotting]);}
});

for (const newer of [false, true]) test(`analysis activates ${newer ? 'the newest owned' : 'the requested'} MIDI source before measuring`, async t => {
 const f = await midiEffectsFixture(t, true, 'buffer'), { updating } = await f.pendingNote();
 const plotting = Promise.resolve(f.controller.actions.analysis.plotSpectrum('master'));
 void plotting.catch(() => {});
 f.release.resolve(); await updating; await f.sourceReadEntered.promise; await settle();
 assert.equal(f.inputs.length, 0, 'analysis cannot begin while native source registration is pending');
 if (newer) await f.controller.actions.midi.updateNote(f.clipId, 'note', { pitch: 69 });
 const latest = f.controller.project?.clips.find(clip => clip.id === f.clipId); assert.ok(latest);
 f.releaseSourceRead.resolve(); const report = await plotting;
 assert.deepEqual(f.renderedSourceIds, [latest.sourceId]); assert.deepEqual(f.readyInputs, [true]);
 assert.ok(Math.abs(peak(report) - (newer ? 440 : 391.995435)) < 24);
});

test('closing the waiting analysis retires its presentation while the requested MIDI edit and measurement finish', async t => {
	const f = await midiEffectsFixture(t, false, 'buffer'), { updating } = await f.pendingNote();
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	let measuring: Promise<unknown> | undefined, closed = 0;
	const controller = { actions: { analysis: { plotSpectrum: () => {
		measuring = Promise.resolve(f.controller.actions.analysis.plotSpectrum('master'));
		return measuring;
	} } } };
	try {
		await act(async () => { root.render(React.createElement(AnalysisDialog, {
			mode: 'spectrum', controller, snapshot: f.controller.getSnapshot(), copy: ENGLISH_COPY,
			fileService: {}, onClose: () => { closed++; root.render(null); },
		})); await settle(); });
		assert.ok(measuring);
		assert.equal(f.inputs.length, 0);
		const close = dom.container.querySelectorAll('button').find(button => button.getAttribute('aria-label') === 'Close');
		assert.ok(close);
		await act(async () => { reactProps(close).onClick?.(); });
		assert.equal(closed, 1);
		f.release.resolve();
		await act(async () => { await Promise.all([updating, measuring]); await settle(); });
		assert.equal(dom.find('[data-analysis-mode]'), null, 'a completed read cannot reopen a closed analysis surface');
		assert.equal(readMidiClip(f.controller.project?.clips.find(clip => clip.id === f.clipId))?.notes[0]?.pitch, 67);
		assert.ok(Math.abs(peak(await measuring) - 391.995435) < 24);
	} finally {
		f.release.resolve();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
