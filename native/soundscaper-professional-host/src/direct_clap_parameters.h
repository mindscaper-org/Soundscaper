/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include "professional_host_api.h"
#include <clap/clap.h>
#include <vector>

namespace soundscaper {
class DirectClapParameters final {
public:
	explicit DirectClapParameters(const clap_plugin_t *);
	bool valid() const { return valid_; }
	uint32_t count() const { return static_cast<uint32_t>(descriptions.size()); }
	soundscaper_pro_status describe(std::vector<soundscaper_pro_plugin_parameter> &) const;
	soundscaper_pro_status read(uint32_t, double &) const;
	soundscaper_pro_status write(uint32_t, double);
private:
	const clap_plugin_t *plugin;
	const clap_plugin_params_t *extension;
	bool valid_ = true;
	std::vector<clap_param_info_t> infos;
	std::vector<soundscaper_pro_plugin_parameter> descriptions;
};
}
