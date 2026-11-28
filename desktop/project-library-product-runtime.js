/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';

const START_FIELDS = Object.freeze([
	'productId', 'appDataPath', 'processId', 'instanceId', 'onLeaseLost', 'leaseTestControl',
]);
const BRIDGE_FIELDS = Object.freeze([
	'handle', 'ownerFor', 'removeHandler',
]);

/** Start the project library for the Framescaper desktop main process. */
export async function startDesktopProjectLibraryProductRuntime(value) {
	const options = closedRecord(value, START_FIELDS, 'desktop project-library product runtime');
	if (options.productId !== 'framescaper') throw new TypeError('The desktop project library requires Framescaper.');
	const appDataPath = absolutePath(options.appDataPath, 'appData');
	const owner = Object.freeze({
		product: options.productId,
		processId: positiveSafeInteger(options.processId, 'process id'),
		instanceId: opaqueId(options.instanceId, 'instance id'),
	});
	if (typeof options.onLeaseLost !== 'function') {
		throw new TypeError('Desktop project-library startup seams are invalid');
	}
	const [{ createFramescaperDesktopProjectLibraryHandshake },
		{ FramescaperDesktopProjectLibraryMain },
		{ registerFramescaperDesktopProjectLibraryMainIpc }] = await Promise.all([
		import('./project-library-runtime/desktop/framescaper-project-library-contract.js'),
		import('./project-library-runtime/desktop/framescaper-project-library-main.js'),
		import('./project-library-runtime/desktop/framescaper-project-library-main-ipc.js'),
	]);
	return startLoadedDesktopProjectLibraryProductRuntime({
		appDataPath,
		owner,
		onLeaseLost: options.onLeaseLost,
		leaseTestControl: options.leaseTestControl,
		createHandshake: createFramescaperDesktopProjectLibraryHandshake,
		startHost: (startOptions) => FramescaperDesktopProjectLibraryMain.start(startOptions),
		registerIpc: registerFramescaperDesktopProjectLibraryMainIpc,
	});
}

/** Bind the loaded library modules to the desktop runtime owner. */
export async function startLoadedDesktopProjectLibraryProductRuntime({
	appDataPath,
	owner,
	onLeaseLost,
	leaseTestControl,
	createHandshake,
	startHost,
	registerIpc,
}) {
	const host = await startHost({
		appDataPath,
		owner,
		handshake: createHandshake(),
		onLeaseLost,
		testControl: projectLibraryTestControl(leaseTestControl),
	});
	return new DesktopProjectLibraryProductRuntime({
		host,
		register: (bridge) => registerIpc({
			handle: bridge.handle,
			removeHandler: bridge.removeHandler,
			ownerFor: bridge.ownerFor,
			main: host,
		}),
		smokeEvidence: (projectId) => createExactSmokeEvidence(
			host, projectId, 'Framescaper', '1.0',
		),
	});
}

function projectLibraryTestControl(value) {
	if (value === null) return null;
	return Object.freeze({
		leaseTtlMs: value.leaseTtlMs,
		renewIntervalMs: value.renewIntervalMs,
		checkpoint: value.checkpoint,
	});
}

async function createExactSmokeEvidence(host, projectId, productName, generation) {
	const session = host.openSession(host.localHandshake);
	let bundle = null;
	let readFailure = null;
	try { bundle = await session.readProjectBundle(projectId); }
	catch (error) { readFailure = error; }
	try { await session.close(); }
	catch (error) {
		if (readFailure) {
			throw new AggregateError(
				[readFailure, error],
				`${productName} ${generation} smoke readback cleanup failed`,
				{ cause: error },
			);
		}
		throw error;
	}
	if (readFailure) throw readFailure;
	if (!bundle) throw new Error(`${productName} ${generation} smoke project was not persisted by main`);
	const snapshot = host.snapshot();
	return Object.freeze({
		host: Object.freeze({
			product: snapshot.owner.product,
			closed: snapshot.closed,
			fenced: snapshot.fenced,
			activePublication: snapshot.activePublication,
		}),
		project: Object.freeze({
			projectId: bundle.project.projectId,
			title: bundle.project.name,
			schemaFamily: bundle.project.schemaFamily,
			schemaVersion: bundle.project.schemaVersion,
			projectRevision: bundle.project.projectRevision,
			metadataRevision: bundle.metadataRevision,
			byteLength: bundle.project.byteLength,
			sha256: bundle.project.sha256,
			bodyCount: bundle.bodies.length,
		}),
	});
}

class DesktopProjectLibraryProductRuntime {
	#bridge = null;
	#closePromise = null;
	#closed = false;
	#host;
	#register;
	#smokeEvidence;

	constructor({ host, register, smokeEvidence }) {
		this.#host = host;
		this.#register = register;
		this.#smokeEvidence = smokeEvidence;
	}

	snapshot() {
		return this.#host.snapshot();
	}

	smokeEvidence(projectId) {
		return this.#smokeEvidence(projectId);
	}

	nativeServicesAuthority() {
		if (typeof this.#host.nativeProjectState !== 'function'
			|| typeof this.#host.nativeProjectRecord !== 'function'
			|| typeof this.#host.readNativeProjectBundle !== 'function'
			|| typeof this.#host.readNativeBody !== 'function'
			|| typeof this.#host.materializeNativeBody !== 'function') return null;
		return Object.freeze({
			schemaFamily: this.#host.localHandshake.schemaFamily,
			schemaVersion: this.#host.localHandshake.schemaVersion,
			projectState: (projectId) => Object.freeze({
				schemaFamily: this.#host.localHandshake.schemaFamily,
				schemaVersion: this.#host.localHandshake.schemaVersion,
				...this.#host.nativeProjectState(projectId),
				binId: 'project-bin',
			}),
			projectRecord: (projectId) => this.#host.nativeProjectRecord(projectId),
			readProjectBundle: (projectId) => this.#host.readNativeProjectBundle(projectId),
			readBody: (body) => this.#host.readNativeBody(body),
			materializeBody: (body, destination, signal) => (
				this.#host.materializeNativeBody(body, destination, signal)
			),
		});
	}

	registerRendererBridge(value) {
		if (this.#closed) throw new Error('Desktop project-library product runtime is closed');
		if (this.#bridge) throw new Error('Desktop project-library renderer bridge is already registered');
		const options = closedRecord(value, BRIDGE_FIELDS, 'desktop project-library renderer bridge');
		if (typeof options.handle !== 'function' || typeof options.ownerFor !== 'function'
			|| typeof options.removeHandler !== 'function') {
			throw new TypeError('Desktop project-library renderer bridge seams are invalid');
		}
		const bridge = new DesktopProjectLibraryRendererBridge(this.#register(options));
		this.#bridge = bridge;
		return bridge;
	}

	close() {
		this.#closePromise ??= this.#close();
		return this.#closePromise;
	}

	async #close() {
		this.#closed = true;
		const failures = [];
		const bridge = this.#bridge;
		if (bridge) {
			try { await bridge.dispose(); } catch (error) { failures.push(error); }
		}
		try { await this.#host.close(); } catch (error) { failures.push(error); }
		throwFailures(failures, 'Desktop project-library product runtime shutdown failed');
	}
}

class DesktopProjectLibraryRendererBridge {
	#disposePromise = null;
	#registration;

	constructor(registration) {
		this.#registration = registration;
	}

	dispose() {
		this.#disposePromise ??= Promise.resolve().then(() => this.#registration.dispose());
		return this.#disposePromise;
	}

	revokeOwner(owner) {
		return this.#registration.revokeOwner(owner);
	}
}

function throwFailures(failures, message) {
	if (failures.length === 0) return;
	if (failures.length === 1) throw failures[0];
	throw new AggregateError(failures, message);
}

function closedRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} has missing or unsupported fields`);
	}
	const result = Object.create(null);
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError(`Desktop project-library ${label} must be an absolute path`);
	}
	return resolve(value);
}

function positiveSafeInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError(`Desktop project-library ${label} must be a positive safe integer`);
	}
	return value;
}

function opaqueId(value, label) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/u.test(value)) {
		throw new TypeError(`Desktop project-library ${label} is invalid`);
	}
	return value;
}
