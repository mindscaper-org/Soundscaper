// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include <optional>
#include <string>
#include <vector>

namespace soundscaper::tracktion_backend
{
struct DeviceChoice
{
	std::string id;
	std::string name;
};

struct AudioSetup
{
	std::string hostId;
	std::string outputId;
	std::string inputId;
	int inputChannel = 0;
	int outputChannel = 0;
	int sampleRate = 0;
	int blockSize = 0;
};

struct AppliedAudioSetup
{
	AudioSetup setup;
	int actualSampleRate;
	int actualBlockSize;
};

struct AudioHosts
{
	std::vector<DeviceChoice> hosts;
	std::optional<AppliedAudioSetup> selected;
};

struct AudioDevices
{
	std::vector<DeviceChoice> inputs;
	std::vector<DeviceChoice> outputs;
	bool separateDevices;
};
}
