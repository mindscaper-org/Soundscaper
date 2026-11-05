/* SPDX-License-Identifier: AGPL-3.0-only */
/* Include the maintained controller unchanged; only libproc calls use test-only shims. */
#define main motion_darwin_controller_main
#include MOTION_DARWIN_CONTROLLER_SOURCE
#undef main

static const char *scenario;
int proc_listallpids(void *buffer, int size) {
	if (!strcmp(scenario, "permission")) { errno = EACCES; return 0; }
	if (!strcmp(scenario, "zero")) { errno = 0; return 0; }
	if (!strcmp(scenario, "negative")) { errno = EIO; return -1; }
	if (!strcmp(scenario, "overflow")) { errno = 0; return LIMIT; }
	if (size < (int)sizeof(pid_t)) { errno = ENOMEM; return 0; }
	((pid_t *)buffer)[0] = getpid();
	return 1;
}
int proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int size) {
	(void)arg;
	if (pid != getpid() || flavor != PROC_PIDTBSDINFO || size != (int)sizeof(struct proc_bsdinfo)) { errno = ESRCH; return 0; }
	struct proc_bsdinfo *value = buffer;
	memset(value, 0, sizeof(*value));
	value->pbi_pid = (uint32_t)getpid(); value->pbi_ppid = (uint32_t)getppid();
	value->pbi_uid = getuid(); value->pbi_gid = getgid(); value->pbi_ruid = getuid(); value->pbi_rgid = getgid();
	value->pbi_pgid = (uint32_t)getpgrp(); value->pbi_status = 1; value->pbi_start_tvsec = 1;
	return (int)sizeof(*value);
}
int proc_pidpath(int pid, void *buffer, uint32_t size) {
	if (pid != getpid() || size < 2) { errno = ESRCH; return 0; }
	ssize_t count = readlink("/proc/self/exe", buffer, size - 1);
	if (count < 0) return 0;
	((char *)buffer)[count] = 0; return (int)count;
}
int main(int argc, char **argv) {
	if (argc != 3) return 126;
	scenario = argv[1];
	if (!strcmp(argv[2], "session")) {
		pid_t pids[LIMIT]; errno = 0;
		int result = session_members(getpid(), pids), error = errno;
		printf("{\"result\":%d,\"errno\":%d}\n", result, error); return 0;
	}
	if (!strcmp(argv[2], "snapshot")) {
		char *arguments[] = {argv[0], "snapshot", NULL};
		return motion_darwin_controller_main(2, arguments);
	}
	return 126;
}
