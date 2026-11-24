/* SPDX-License-Identifier: AGPL-3.0-only */

export interface TracktionDeviceChoice {
	readonly id: string;
	readonly name: string;
}

export interface TracktionAudioSetup {
	readonly hostId: string;
	readonly outputId: string;
	readonly inputId: string;
	readonly inputChannel: number;
	readonly outputChannel: number;
	readonly sampleRate: number;
	readonly blockSize: number;
}

export interface TracktionAppliedAudioSetup {
	readonly setup: TracktionAudioSetup;
	readonly actualSampleRate: number;
	readonly actualBlockSize: number;
}

export interface TracktionAudioHosts {
	readonly hosts: readonly TracktionDeviceChoice[];
	readonly selected: TracktionAppliedAudioSetup | null;
	readonly preferred?: TracktionAudioSetup | null;
}

export interface TracktionAudioDevices {
	readonly inputs: readonly TracktionDeviceChoice[];
	readonly outputs: readonly TracktionDeviceChoice[];
	readonly separateDevices: boolean;
}

export type TracktionAudioDeviceCommand =
	| Readonly<{ kind: 'audioHosts' }>
	| Readonly<{ kind: 'audioDevices'; hostId: string }>
	| (Readonly<{ kind: 'setAudioSetup' }> & TracktionAudioSetup);

export type TracktionAudioDeviceReply<Command extends TracktionAudioDeviceCommand> =
	Command extends { kind: 'audioHosts' } ? TracktionAudioHosts
		: Command extends { kind: 'audioDevices' } ? TracktionAudioDevices
			: TracktionAppliedAudioSetup;
