/* SPDX-License-Identifier: AGPL-3.0-only */

/** The loopback device the synthetic backend exposes for the transport proof. */
export const SYNTHETIC_LOOPBACK_DEVICE_HANDLE = 'synthetic:loopback';

/**
 * The reserved handle that asks a backend to describe itself rather than open a
 * device. Discovery is a distinct operation with a distinct answer, but it
 * travels as an ordinary audio-device grant so it passes exactly the admission
 * an open does — a second grant family would be a second thing to get wrong.
 *
 * Deliberately duplicated from the grant vocabulary rather than imported: this
 * entry may only name modules the packaged runtime maps for it, and that one is
 * not among them. A pinning test keeps the two equal.
 */
export const NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE = 'inventory';

/**
 * The bounds one inventory answer must stay inside, duplicated from the result
 * schema for the same reason and pinned by the same test.
 */
export const NATIVE_AUDIO_INVENTORY_BOUNDS = Object.freeze({
	devices: 128,
	textBytes: 192,
	detailBytes: 1_024,
});

// The professional addon's native status names differ from the inventory wire contract.
const PROFESSIONAL_AUDIO_INVENTORY_STATUSES = new Map([
	['ok', 'available'],
	['backend-unavailable', 'backend-absent'],
	['server-unavailable', 'server-absent'],
	['unsupported', 'unsupported-platform'],
]);

export const SYNTHETIC_ENGINE_MODES = Object.freeze({
	passthrough: 0,
	gain: 1,
	tone: 2,
	impulse: 3,
});

export const SYNTHETIC_ENGINE_FAULTS = Object.freeze({
	none: 0,
	abort: 1,
	hang: 2,
});

/**
 * Loads the verified addon and runs one synthetic device session. The digest is
 * re-checked inside the helper as well as in main: main proves the file it
 * granted is the pinned one, and this proves the bytes this process is about to
 * execute are still those bytes.
 */
export function createNativeDeviceJobRunner({
	addonPath,
	addonSha256,
	loadAddon,
	hash,
	blockFrames = 1_024,
	blocks = 8,
	yieldBetweenBlocks = defaultBlockYield,
}) {
	if (typeof loadAddon !== 'function') throw new TypeError('A native addon loader is required.');
	if (typeof hash !== 'function') throw new TypeError('A native addon digest function is required.');
	let addon = null;

	return ({ grant, onProgress }) => {
		let cancelled = false;
		const completion = (async () => {
			if (grant.deviceHandle === NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE) {
				addon ??= await loadAddon({ addonPath, addonSha256 });
				return describeBackendInventory(addon, grant.backend);
			}
			if (grant.backend !== 'synthetic' || grant.deviceHandle !== SYNTHETIC_LOOPBACK_DEVICE_HANDLE) {
				throw new RangeError(`This helper build implements only the ${SYNTHETIC_LOOPBACK_DEVICE_HANDLE} device.`);
			}
			addon ??= await loadAddon({ addonPath, addonSha256 });
			const description = addon.describe();
			const channelCount = grant.direction === 'duplex' ? 2 : 1;
			const engine = addon.createSyntheticEngine({
				channelCount,
				frameCount: blockFrames,
				sampleRate: 48_000,
				generation: 1,
				mode: SYNTHETIC_ENGINE_MODES.tone,
				fault: SYNTHETIC_ENGINE_FAULTS.none,
				gain: 1,
				faultFrame: 0,
			});
			const channels = Array.from({ length: channelCount }, () => new Float32Array(blockFrames));
			const digest = hash();
			let framesRendered = 0;
			for (let block = 0; block < blocks; block += 1) {
				if (cancelled) break;
				addon.renderSyntheticBlock(engine, framesRendered, blockFrames, null, channels);
				for (const channel of channels) {
					digest.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
				}
				framesRendered += blockFrames;
				onProgress((block + 1) / blocks);
				// Yield to the macrotask queue, not just the microtask queue: a
				// loop that only drains microtasks starves its own channel, so a
				// cancellation posted from main could not arrive until the job
				// had already finished.
				await yieldBetweenBlocks();
			}
			return {
				addon: {
					addonVersion: description.addonVersion,
					buildId: description.buildId,
					napiVersion: description.napiVersion,
					maximumChannelCount: description.maximumChannelCount,
					maximumFrameCount: description.maximumFrameCount,
				},
				backend: grant.backend,
				deviceHandle: grant.deviceHandle,
				sampleRate: 48_000,
				channelCount,
				blockFrames,
				blocksRendered: framesRendered / blockFrames,
				framesRendered,
				renderedSha256: digest.digest('hex'),
			};
		})();
		return Object.freeze({
			completion,
			cancel: async () => {
				cancelled = true;
				await completion.catch(() => undefined);
			},
		});
	};
}

/**
 * Asks the addon what one backend can actually do here. The synthetic backend
 * is answered without consulting the platform and is deliberately reported with
 * no devices: it exists for the transport proof and must never be published as
 * something a user could select.
 *
 * A machine with hundreds of PCM hints is answered with as many devices as one
 * inventory can carry and told so, because an answer that overflows the wire is
 * not a longer answer: it is a dead helper and no answer at all.
 */
function describeBackendInventory(addon, backend) {
	if (backend === 'synthetic') {
		return { backend, status: 'unsupported-platform', detail: 'The synthetic backend publishes no devices.', devices: [] };
	}
	const reported = addon.enumerateAudioBackends();
	const entry = Array.isArray(reported) ? reported.find((value) => value?.backend === backend) : null;
	if (!entry) {
		return {
			backend,
			status: 'unsupported-platform',
			detail: `This payload does not implement the ${backend} backend.`,
			devices: [],
		};
	}
	const offered = Array.isArray(entry.devices) ? entry.devices : [];
	const devices = [];
	for (const device of offered) {
		if (devices.length >= NATIVE_AUDIO_INVENTORY_BOUNDS.devices) break;
		const handle = typeof device?.handle === 'string' ? device.handle : '';
		// A handle is an identity, not a display string: a device whose own is
		// too long to carry is omitted rather than published under a trimmed
		// name that would never reopen it.
		if (handle === '' || wireTextBytes(handle) > NATIVE_AUDIO_INVENTORY_BOUNDS.textBytes) continue;
		const label = typeof device.label === 'string' && device.label !== '' ? device.label : handle;
		const isDefault = backend === 'alsa' && handle === 'default' ? true : device.isDefault;
		const described = {
			handle,
			label: clampWireText(label, NATIVE_AUDIO_INVENTORY_BOUNDS.textBytes),
			direction: device.direction,
			...(typeof isDefault === 'boolean' ? { isDefault } : {}),
		};
		devices.push(Number.isSafeInteger(device.channelCount) && device.channelCount > 0
			? { ...described, channelCount: device.channelCount }
			: described);
	}
	return {
		backend,
		status: PROFESSIONAL_AUDIO_INVENTORY_STATUSES.get(entry.status) ?? entry.status,
		detail: devices.length === offered.length
			? clampWireText(entry.detail ?? '', NATIVE_AUDIO_INVENTORY_BOUNDS.detailBytes)
			: `Only ${String(devices.length)} of ${String(offered.length)} devices fit one inventory answer.`,
		devices,
	};
}

function wireTextBytes(value) {
	return Buffer.byteLength(JSON.stringify(value));
}

function clampWireText(value, maximumBytes) {
	if (wireTextBytes(value) <= maximumBytes) return value;
	const points = Array.from(value);
	while (points.length > 0 && wireTextBytes(points.join('')) > maximumBytes) points.pop();
	return points.join('');
}

function defaultBlockYield() {
	return new Promise((resolve) => { setTimeout(resolve, 0); });
}
