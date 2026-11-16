/* SPDX-License-Identifier: AGPL-3.0-only */
import { MtcDecoder } from '../../timecode-mtc.ts';
import { timecodeRate, wrapTimecodeFrame } from '../../timecode-sync-format.ts';
import type { EngineAudioContext } from '../../engine/public-api.ts';
import type { TimecodeSyncIo, TimecodeDevices, TimecodeSyncSettings, TimecodeIoSession, TimecodeTransportPosition } from './internal/timecode-sync-ports.ts';

export interface TimecodeBrowserResources {
	readonly navigator: Pick<Navigator, 'requestMIDIAccess' | 'mediaDevices'>;
	readonly createContext: () => EngineAudioContext;
	readonly loadWorklet: (context: AudioContext) => Promise<void>;
	readonly createNode: (context: AudioContext, options: AudioWorkletNodeOptions) => AudioWorkletNode;
	readonly now: () => number;
}
// Web MIDI defines clear(), but the pinned DOM typings omit it.
interface ScheduledMidiOutput extends MIDIOutput { clear(): void }
function browserResources(): TimecodeBrowserResources {
	return {
		navigator,
		createContext: () => new AudioContext({ latencyHint: 'interactive' }),
		loadWorklet: async context => {
			const url = import.meta.env?.DEV || import.meta.env?.PROD
				? (await import('../../timecode-ltc-worklet.ts?worker&url')).default
				: new URL('../../timecode-ltc-worklet.ts', import.meta.url).href;
			await context.audioWorklet.addModule(url);
		},
		createNode: (context, options) => new AudioWorkletNode(context, 'scape-timecode-ltc', options),
		now: () => performance.now(),
	};
}

/** Web MIDI and a dedicated, discrete-channel audio graph; LTC never enters the program mix. */
export function createBrowserTimecodeSyncIo(resources?: TimecodeBrowserResources): TimecodeSyncIo {
	const r = resources ?? browserResources();
	let midi: MIDIAccess | null = null;
	let prepared: { context: EngineAudioContext; resumed: Promise<void>; claimed: boolean } | null = null;
	async function requestMidi(): Promise<MIDIAccess> {
		if (!r.navigator.requestMIDIAccess) throw new Error('MIDI Time Code requires Web MIDI with SysEx permission.');
		midi ??= await r.navigator.requestMIDIAccess({ sysex: true });
		if (!midi.sysexEnabled) throw new Error('MIDI Time Code requires SysEx permission.');
		return midi;
	}
	return {
		prepare: () => {
			const context = r.createContext();
			// Safari requires resume() in the original menu-button gesture, before teardown awaits.
			const resumed = context.resume();
			void resumed.catch(() => {});
			const lease = { context, resumed, claimed: false };
			prepared = lease;
			return async () => {
				if (prepared === lease) prepared = null;
				if (!lease.claimed && context.state !== 'closed') await context.close();
			};
		},
		devices: async (requestAccess: boolean): Promise<TimecodeDevices> => {
			if (requestAccess) await requestMidi();
			const audio = await r.navigator.mediaDevices?.enumerateDevices() ?? [];
			const project = (port: MIDIPort) => ({ id: port.id, name: port.name || port.id });
			return { midiInputs: midi ? [...midi.inputs.values()].map(project) : [], midiOutputs: midi ? [...midi.outputs.values()].map(project) : [],
				audioInputs: audio.filter(device => device.kind === 'audioinput').map(device => ({ id: device.deviceId, name: device.label || device.deviceId })),
				audioOutputs: audio.filter(device => device.kind === 'audiooutput').map(device => ({ id: device.deviceId, name: device.label || device.deviceId })) };
		},
		open: async (settings: TimecodeSyncSettings, receive, fail, signal): Promise<TimecodeIoSession> => {
			let context: EngineAudioContext | null = null, node: AudioWorkletNode | null = null;
			let stream: MediaStream | null = null, source: MediaStreamAudioSourceNode | null = null;
			let input: MIDIInput | null = null, output: ScheduledMidiOutput | null = null, access: MIDIAccess | null = null;
			const ownedPorts: MIDIPort[] = [];
			let closed = false;
			let anchor: (TimecodeTransportPosition & { time: number }) | null = null;
			const decoder = new MtcDecoder();
			const message = (event: MIDIMessageEvent): void => {
				if (!closed && event.data) for (const reading of decoder.push(event.data, event.timeStamp)) receive(reading, event.timeStamp);
			};
			const disconnect = (): void => {
				if (!closed && (input?.state === 'disconnected' || output?.state === 'disconnected')) fail(new Error('The timecode MIDI port disconnected.'));
			};
			const inputLost = (): void => { if (!closed) fail(new Error('The LTC audio input disconnected.')); };
			const contextLost = (): void => { if (!closed && context?.state !== 'running') fail(new Error('The LTC audio clock stopped.')); };
			const assertCurrent = (): void => { if (closed || signal?.aborted) throw new DOMException('Timecode connection canceled.', 'AbortError'); };
			const abort = (): void => { void close().catch(() => {}); };
			async function close(): Promise<void> {
				if (closed) return;
				closed = true;
				signal?.removeEventListener('abort', abort);
				input?.removeEventListener('midimessage', message);
				access?.removeEventListener('statechange', disconnect);
				try { output?.clear(); } catch { /* Closing a disconnected port must still release audio. */ }
				source?.disconnect(); node?.disconnect(); node?.port.close();
				for (const track of stream?.getTracks() ?? []) { track.removeEventListener('ended', inputLost); track.stop(); }
				context?.removeEventListener('statechange', contextLost);
				await Promise.all([...ownedPorts.map(port => port.close()), ...(context && context.state !== 'closed' ? [context.close()] : [])]);
			}
			signal?.addEventListener('abort', abort, { once: true });
			try {
				assertCurrent();
				if (settings.sendLtc || settings.receive === 'ltc') {
					const lease = prepared; prepared = null;
					if (lease) lease.claimed = true;
					context = lease?.context ?? r.createContext();
					await (lease?.resumed ?? context.resume());
					assertCurrent();
					if (settings.audioOutput && settings.audioOutput !== 'default') {
						if (!context.setSinkId) throw new Error('This browser cannot select an LTC audio output device.');
						await context.setSinkId(settings.audioOutput);
						assertCurrent();
					}
					if (settings.sendLtc) {
						if (settings.outputChannel >= context.destination.maxChannelCount) throw new RangeError('The selected LTC output channel is unavailable.');
						context.destination.channelCount = settings.outputChannel + 1;
						context.destination.channelInterpretation = 'discrete';
					}
					await r.loadWorklet(context);
					assertCurrent();
					node = r.createNode(context, { numberOfInputs: settings.receive === 'ltc' ? 1 : 0, numberOfOutputs: 1,
						outputChannelCount: [settings.sendLtc ? settings.outputChannel + 1 : 1], channelCount: Math.max(1, settings.inputChannel + 1),
						channelCountMode: 'explicit', channelInterpretation: 'discrete',
						processorOptions: { rate: settings.rate, receive: settings.receive === 'ltc', inputChannel: settings.inputChannel, outputChannel: settings.outputChannel } });
					node.onprocessorerror = () => { if (!closed) fail(new Error('The LTC audio processor stopped.')); };
					node.port.onmessage = (event: MessageEvent<{ frame: number; direction: -1 | 1; time: number }>) => {
						if (closed || !context) return;
						const data = event.data;
						// The final edge completes the preceding frame; compensate that frame and delivery delay.
						receive({ frame: wrapTimecodeFrame(data.frame + data.direction, settings.rate), rate: settings.rate, direction: data.direction },
							r.now() + (data.time - context.currentTime) * 1000);
					};
					if (settings.receive === 'ltc') {
						stream = await r.navigator.mediaDevices.getUserMedia({ audio: { ...(settings.audioInput ? { deviceId: { exact: settings.audioInput } } : {}),
							channelCount: { ideal: settings.inputChannel + 1 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
						if (closed || signal?.aborted) { for (const track of stream.getTracks()) track.stop(); assertCurrent(); }
						const channels = stream.getAudioTracks()[0]?.getSettings().channelCount;
						if (channels !== undefined && settings.inputChannel >= channels) throw new RangeError('The selected LTC input channel is unavailable.');
						for (const track of stream.getTracks()) track.addEventListener('ended', inputLost);
						source = context.createMediaStreamSource(stream); source.connect(node);
					}
					node.connect(context.destination);
					context.addEventListener('statechange', contextLost);
				}
				if (settings.sendMtc || settings.receive === 'mtc') {
					access = await requestMidi();
					assertCurrent();
					if (settings.receive === 'mtc') {
						input = access.inputs.get(settings.midiInput) ?? null;
						if (!input || input.state !== 'connected') throw new Error('Select an available MTC MIDI input.');
						if (input.connection !== 'open') { ownedPorts.push(input); await input.open(); if (closed || signal?.aborted) { await input.close(); assertCurrent(); } }
						input.addEventListener('midimessage', message);
					}
					if (settings.sendMtc) {
						output = access.outputs.get(settings.midiOutput) as ScheduledMidiOutput | undefined ?? null;
						if (!output || output.state !== 'connected') throw new Error('Select an available MTC MIDI output.');
						if (output.connection !== 'open') { ownedPorts.push(output); await output.open(); if (closed || signal?.aborted) { await output.close(); assertCurrent(); } }
					}
					access.addEventListener('statechange', disconnect);
				}
				return { sendMidi: (bytes, timestamp) => output?.send(bytes, timestamp), clearMidi: () => output?.clear(), close,
					updateLtc: position => {
						if (!context || !node) return;
						const time = context.currentTime;
						const expected = anchor ? anchor.seconds + (anchor.playing ? (time - anchor.time) * anchor.speed : 0) : NaN;
						if (anchor && position.playing === anchor.playing && position.speed === anchor.speed && Math.abs(position.seconds - expected) < 0.5 / timecodeRate(settings.rate)) return;
						anchor = { ...position, time };
						const rate = timecodeRate(settings.rate), speed = Math.max(0.01, position.speed);
						const frame = Math.ceil((position.seconds + 0.02 * speed) * rate);
						node.port.postMessage({ playing: position.playing, frame, startTime: time + (frame / rate - position.seconds) / speed, speed });
					},
				};
			} catch (error) { await close(); throw error; }
		},
	};
}
