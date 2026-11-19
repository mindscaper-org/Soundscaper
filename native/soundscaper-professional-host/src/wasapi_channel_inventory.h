/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <juce_core/juce_core.h>
#include <algorithm>
#include <cstring>
#include <memory>
#include <vector>

#if JUCE_WINDOWS
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#include <functiondiscoverykeys_devpkey.h>
#include <wrl/client.h>
#endif

namespace soundscaper {

#if JUCE_WINDOWS
inline juce::String wasapiEndpointId(IMMDevice &endpoint)
{
	LPWSTR data = nullptr;
	if (FAILED(endpoint.GetId(&data))) return {};
	const std::unique_ptr<wchar_t, decltype(&CoTaskMemFree)> id(data, &CoTaskMemFree);
	return juce::String{id.get()};
}
#endif

/** Read the shared-mode channel configuration without opening any audio streams. */
inline std::vector<int> wasapiInventoryChannels(
	[[maybe_unused]] const juce::StringArray &names, [[maybe_unused]] bool input)
{
#if JUCE_WINDOWS
	using Microsoft::WRL::ComPtr;
	ComPtr<IMMDeviceEnumerator> enumerator;
	const auto flow = input ? eCapture : eRender;
	if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&enumerator)))) return {};
	ComPtr<IMMDeviceCollection> endpoints;
	UINT endpointCount = 0;
	if (FAILED(enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &endpoints))
		|| FAILED(endpoints->GetCount(&endpointCount))) return {};

	ComPtr<IMMDevice> defaultEndpoint;
	const auto primaryId = SUCCEEDED(enumerator->GetDefaultAudioEndpoint(flow, eMultimedia, &defaultEndpoint))
		? wasapiEndpointId(*defaultEndpoint.Get()) : juce::String{};
	juce::StringArray orderedNames;
	std::vector<int> widths;
	for (UINT index = 0; index < endpointCount; ++index) {
		ComPtr<IMMDevice> endpoint;
		ComPtr<IPropertyStore> properties;
		if (FAILED(endpoints->Item(index, &endpoint)) || FAILED(endpoint->OpenPropertyStore(STGM_READ, &properties))) continue;
		PROPVARIANT label{};
		juce::String name;
		if (SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &label)) && label.vt == VT_LPWSTR) name = label.pwszVal;
		PropVariantClear(&label);
		PROPVARIANT format{};
		WAVEFORMATEX wave{};
		if (SUCCEEDED(properties->GetValue(PKEY_AudioEngine_DeviceFormat, &format)) && format.vt == VT_BLOB
			&& format.blob.cbSize >= sizeof(wave) && format.blob.pBlobData != nullptr) {
			std::memcpy(&wave, format.blob.pBlobData, sizeof(wave));
		}
		PropVariantClear(&format);
		const bool primary = primaryId.isNotEmpty() && primaryId == wasapiEndpointId(*endpoint.Get());
		orderedNames.insert(primary ? 0 : -1, name);
		widths.insert(primary ? widths.begin() : widths.end(), std::min<int>(wave.nChannels, 32));
	}
	// Compare with JUCE's openable names after applying its duplicate disambiguation.
	orderedNames.appendNumbersToDuplicates(false, false);
	if (orderedNames == names) return widths;
#endif
	return {};
}

} // namespace soundscaper
