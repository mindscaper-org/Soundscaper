/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentCopyProvider } from '../vendor/audacity-design-system/components/src/contexts/ComponentCopyContext.tsx';
import { COMPONENT_COPY } from '../vendor/audacity-design-system/components/src/component-copy.ts';
import { AccessibilityProfileProvider } from '../vendor/audacity-design-system/components/src/contexts/AccessibilityProfileContext.tsx';
import { TrackControlPanel } from '../vendor/audacity-design-system/components/src/TrackControlPanel/TrackControlPanel.tsx';
import { TrackNew } from '../vendor/audacity-design-system/components/src/Track/TrackNew.tsx';
import { Clip } from '../vendor/audacity-design-system/components/src/Clip/Clip.tsx';
import { ClipHeader } from '../vendor/audacity-design-system/components/src/ClipHeader/ClipHeader.tsx';
import { RulerFlyout } from '../vendor/audacity-design-system/components/src/RulerFlyout/RulerFlyout.tsx';
import { TimelineRulerContextMenu } from '../vendor/audacity-design-system/components/src/TimelineRulerContextMenu/TimelineRulerContextMenu.tsx';
import { EffectsPanel } from '../vendor/audacity-design-system/components/src/EffectsPanel/EffectsPanel.tsx';
import { MixerPanel } from '../vendor/audacity-design-system/components/src/MixerPanel/MixerPanel.tsx';
import { timeCodeFormatOptionsForDomain } from '../vendor/audacity-design-system/components/src/TimeCode/time-code-formats.ts';
import { clipAccessibleName } from '../vendor/audacity-design-system/components/src/utils/clipAccessibleName.ts';
Object.assign(globalThis, { React });
const copy = Object.fromEntries(Object.entries(COMPONENT_COPY).map(([k, v]) => [k, `LOC:${v}`]));
const render = (children: React.ReactNode) => renderToStaticMarkup(<ComponentCopyProvider copy={copy} locale="de"><AccessibilityProfileProvider initialProfileId="au4-tab-groups">{children}</AccessibilityProfileProvider></ComponentCopyProvider>);
const noop = () => undefined;
test('track control names localize the complete header while preserving authored names', () => {
	const html = render(<TrackControlPanel trackName="$& Voice" tabIndex={0} onRename={noop} onMenuClick={noop} />);
	for (const label of ['LOC:$&amp; Voice track controls','LOC:$&amp; Voice track type','LOC:Rename track: $&amp; Voice','LOC:Track menu','LOC:Pan','LOC:Volume','LOC:Mute','LOC:Solo']) assert.ok(html.includes(label), label);
});
test('clip header name and menu use application labels', () => {
	assert.match(render(<ClipHeader name="Clip" showMenu onMenuClick={noop} />), /aria-label="LOC:Clip menu"/u);
});
test('ruler settings and context menus use localized descriptions', () => {
	const flyout = render(<RulerFlyout isOpen mode="waveform" x={0} y={0} onClose={noop} />);
	for (const label of ['LOC:Reset','LOC:Ruler format','LOC:Linear (amp)','LOC:Half wave','LOC:Zoom controls']) assert.ok(flyout.includes(label), label);
	const menu = render(<TimelineRulerContextMenu isOpen x={0} y={0} onClose={noop} />);
	for (const label of ['LOC:Minutes &amp; seconds','LOC:Beats &amp; measures','LOC:Scroll view to playhead','LOC:Pinned play head','LOC:Show vertical rulers']) assert.ok(menu.includes(label),label);
});
test('rack and independently reused effect actions receive localized copy', () => {
	const html = render(<EffectsPanel isOpen mode="overlay" trackSection={{trackName:'Voice',effects:[{id:'authored',name:'Authored $&',enabled:true}],allEnabled:true,onAddEffect:noop}} masterSection={{effects:[],allEnabled:true,onAddEffect:noop}} onClose={noop} />);
	for (const label of ['LOC:Add effect','LOC:Master track','LOC:Effects panel','LOC:Close effects panel','LOC:Disable all track effects','LOC:Disable all master effects','LOC:Disable effect','LOC:Select effect','LOC:Press Enter to reorder effect','Authored $&amp;']) assert.ok(html.includes(label),label);
});
test('mixer labels and owned channel/effect controls receive localized copy', () => {
	const html = render(<MixerPanel channels={[{id:'voice',channelProps:{trackName:'Voice',effects:[{name:'Effect',enabled:true}]}}]} masterChannel={{trackName:'Master'}} />);
	for (const label of ['LOC:Audio FX','LOC:Pan','LOC:Volume','LOC:Mute/Solo','LOC:Voice volume','LOC:Mute','LOC:Select effect']) assert.ok(html.includes(label),label);
});
test('format IDs retain technical syntax and receive translated descriptions', () => {
	const options = timeCodeFormatOptionsForDomain('time', 30, {...COMPONENT_COPY,...copy});
	assert.equal(options.find(x=>x.format==='hh:mm:ss+frames')?.label,'LOC:hh:mm:ss + frames (30fps)');
	assert.equal(options.find(x=>x.format==='seconds')?.label,'LOC:seconds');
});
test('spoken clip timing follows the active locale and preserves authored literals', () => {
	assert.equal(clipAccessibleName({name:'$& {start}',start:1,duration:65},{...COMPONENT_COPY,...copy},'de'),'LOC:$& {start} clip, starts at 1 Sekunde, 1 Minute 5 Sekunden long');
});

test('actual audio track and clip edges use the localized navigation contract', () => {
	const html = render(<TrackNew width={600} trackIndex={0} trackName="$& Voice" trackTabIndex={0} clips={[{id:'clip',name:'$& Clip',start:1,duration:2}]} />);
	assert.ok(html.includes('LOC:$&amp; Voice, LOC:audio track'));
	assert.ok(html.includes('LOC:$&amp; Clip clip, starts at 1 Sekunde, 2 Sekunden long'));
	const edges = render(<Clip name="Clip" selected onTrimEdge={noop} onStretchEdge={noop} />);
	for(const label of ['Trim left edge','Trim right edge','Stretch left edge','Stretch right edge']) assert.ok(edges.includes(`aria-label="LOC:${label}"`),label);
});

test('translated track menus retain their real keyboard anchor', async () => {
	const { act } = await import('react');
	const { createRoot } = await import('react-dom/client');
	const { installReactTestDom, reactProps } = await import('./helpers/react-test-dom.ts');
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	let anchor: EventTarget | null = null;
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	try {
		await act(async () => root.render(<ComponentCopyProvider copy={copy}><TrackControlPanel trackName="Voice" tabIndex={0} onMenuClick={event => { anchor = event.currentTarget; }} /></ComponentCopyProvider>));
		const panel = dom.one('.track-control-panel');
		await act(async () => reactProps(panel).onKeyDown?.({key:'F10',shiftKey:true,preventDefault(){},stopPropagation(){},target:panel,currentTarget:panel}));
		assert.equal(anchor,dom.one('.track-control-panel__menu-button'));
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
