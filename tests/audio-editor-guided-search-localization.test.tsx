/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reviewLocalAssistanceGuidedResult } from '../src/common/editor/assistance/local-assistance-guided-result-review.ts';
import LocalAssistanceGuidedReview from '../src/common/editor/ui/dialogs/LocalAssistanceGuidedReview.tsx';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';
import AudioEditorSearch from '../src/common/editor/ui/AudioEditorSearch.jsx';
import { useWorkspaceAssistanceSearchRuntime } from '../src/common/editor/ui/workspace/useWorkspaceAssistanceSearchRuntime.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
Object.assign(globalThis,{React,IS_REACT_ACT_ENVIRONMENT:true});
test('actual admitted caption review exposes semantic counts and localized choice names',async()=>{
	const workflow=assistanceWorkflowFixture();
	const review=await reviewLocalAssistanceGuidedResult({workflow,result:{contractVersion:1,jobId:workflow.jobId,workflowId:workflow.workflowId,stageIds:workflow.stageIds,outputs:workflow.outputs},readOutput:async()=>new Blob([JSON.stringify({schemaVersion:1,kind:'captions',sourceId:'source-a',sampleRate:48000,alignmentApplied:false,cues:[{cueId:'caption:0',startFrame:0,endFrame:24000,text:'Authored $&',words:[]}]})],{type:'application/vnd.soundscaper.captions+json'})});
	const html=renderToStaticMarkup(<LocalAssistanceGuidedReview copy={{'ui.localAssistance.localAssistanceChoiceCaptionOne':'{count} Untertitel'}} review={review} selectedChoiceIds={[]} onChoiceChange={()=>undefined}/>);
	assert.match(html,/aria-label="1 Untertitel"/u);assert.doesNotMatch(html,/1 caption cue/u);
});
test('indexed-search lifecycle presents localized reasons through its real menu action',async()=>{
	const dom=installReactTestDom();const {createRoot}=await import('react-dom/client');const root=createRoot(dom.container as unknown as Element);
	const failure=Object.assign(new Error('English query models failure'),{reason:'query-models-unavailable'});
	const source={open:async()=>{throw failure;}};
	function View(){const runtime=useWorkspaceAssistanceSearchRuntime({project:{id:'project',revision:1,schemaFamily:'soundscaper',schemaVersion:1},source});return <><button data-open="true" onClick={runtime.openAssistanceSearch}>Open</button><AudioEditorSearch copy={{'ui.indexedSearch.modelsUnavailable':'Installieren Sie die Suchmodelle.'}} locale="de" open assistanceSearch={runtime.assistanceSearch} onActivate={()=>undefined} onOpenChange={()=>undefined}/></>;}
	try{await act(async()=>root.render(<View/>));await act(async()=>reactProps(dom.one('[data-open="true"]')).onClick?.());assert.ok(dom.container.textContent.includes('Installieren Sie die Suchmodelle.'));assert.ok(!dom.container.textContent.includes('English query models failure'));}finally{await act(async()=>root.unmount());dom.restore();}
});

test('review item labels and editorial article names localize without changing model-authored prose', async()=>{
	const {localizedGuidedReviewChoice}=await import('../src/common/editor/ui/guided-review-choice-label.ts');
	const number=new Intl.NumberFormat('de');
	for(const [kind,key]of [['cleanup','Cleanup'],['reaction','Reaction'],['beat','Beat'],['cut','Cut'],['highlight','Highlight'],['editorial','Editorial']] as const){
		const label=localizedGuidedReviewChoice({id:'authored-id',kind,label:'English fallback',presentation:{kind,index:1234},selected:false,enabled:true},{[`ui.localAssistance.localAssistanceChoice${key}`]:'Vorschlag {index}'},number);
		assert.equal(label,'Vorschlag 1.234');
	}
	const candidate={candidateId:'candidate',title:'Authored $& title',hook:null,chapters:[],explanation:null};
	const review: import('../src/common/editor/assistance/local-assistance-guided-result-review.ts').LocalAssistanceGuidedReviewedResult={reviewVersion:1,jobId:'job',workflowId:'generate-editorial-text',choices:[],outputs:[{stageId:'generate-editorial-text',slotId:'editorial-proposal',claim:{claimVersion:1,direction:'output',claimId:'a'.repeat(40),jobId:'job',stageId:'generate-editorial-text',slotId:'editorial-proposal'},mediaType:'application/json',byteLength:0,sha256:'a'.repeat(64),body:new Blob(),semantic:{candidates:[candidate]}}]};
	const html=renderToStaticMarkup(<LocalAssistanceGuidedReview copy={{'ui.localAssistance.localAssistanceEditorialProposal':'Redaktioneller Vorschlag {index}'}} review={review} selectedChoiceIds={[]} onChoiceChange={()=>undefined}/>);
	assert.match(html,/aria-label="Redaktioneller Vorschlag 1"/u);assert.ok(html.includes('Authored $&amp; title'));
});

test('a pending indexed search follows copy changes without reopening the index', async()=>{
	const dom=installReactTestDom();const{createRoot}=await import('react-dom/client');const root=createRoot(dom.container as unknown as Element);let openings=0;
	const source={open:()=>{openings++;return new Promise<never>(()=>undefined);}};
	function View({label}:{label:string}){const runtime=useWorkspaceAssistanceSearchRuntime({project:{id:'project',revision:1,schemaFamily:'soundscaper',schemaVersion:1},source});return <><button data-open="true" onClick={runtime.openAssistanceSearch}>Open</button><AudioEditorSearch copy={{'ui.indexedSearch.opening':label}} locale="de" open assistanceSearch={runtime.assistanceSearch} onActivate={()=>undefined} onOpenChange={()=>undefined}/></>;}
	try{await act(async()=>root.render(<View label="Öffnen"/>));await act(async()=>reactProps(dom.one('[data-open="true"]')).onClick?.());assert.ok(dom.container.textContent.includes('Öffnen'));await act(async()=>root.render(<View label="Ouverture"/>));assert.ok(dom.container.textContent.includes('Ouverture'));assert.equal(openings,1);}finally{await act(async()=>root.unmount());dom.restore();}
});
