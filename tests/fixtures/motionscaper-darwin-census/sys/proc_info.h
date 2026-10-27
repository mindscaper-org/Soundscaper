/* SPDX-License-Identifier: AGPL-3.0-only */
/* Only the fields referenced by the production controller are declared in this test shim. */
#ifndef MOTION_TEST_PROC_INFO_H
#define MOTION_TEST_PROC_INFO_H
#include <stdint.h>
#define PROC_PIDTBSDINFO 3
#define PROC_PIDPATHINFO_MAXSIZE 4096
struct proc_bsdinfo {
	uint32_t pbi_pid, pbi_ppid, pbi_uid, pbi_gid, pbi_ruid, pbi_rgid, pbi_pgid, pbi_status;
	uint64_t pbi_start_tvsec, pbi_start_tvusec;
};
#endif
