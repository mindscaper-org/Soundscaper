/* SPDX-License-Identifier: AGPL-3.0-only */
// Reuse maintained M5 argument/profile/mapped-vnode primitives. The fixed Photo
// entry below keeps the supervisor alive to reap its actual one parser child.
#define main photo_previous_setexec_entry
#include "../../milestone-5-native-isolation-launcher/src/macos_launcher.mm"
#undef main
#include <chrono>
namespace {
constexpr char photoExpectedBroker[] = "{\"schemaVersion\":1,\"id\":\"lightscaper-photo-macos-seatbelt-broker-v1\",\"maximumGrants\":0,\"pathAuthority\":\"fcntl-f-getpath-from-inherited-fd\",\"filesystem\":\"seatbelt-exact-runtime-literals-zero-source-grants\",\"network\":\"denied\",\"childProcesses\":\"fork-denied-one-supervised-peer\",\"environment\":\"fixed-empty\",\"executionIdentity\":\"posix-spawn-stopped-mapped-vnode-v1\",\"sandboxEntry\":\"peer-bootstrap-before-work-v1\",\"memory\":\"reaped-supervisor-physical-footprint-10ms-v1\",\"enforcementHandshake\":\"peer-post-sandbox-enforcement-pipe-v1\"}\n";
volatile sig_atomic_t photoChild = -1;
void stopPhotoChild(int) { if (photoChild > 0) (void)kill(static_cast<pid_t>(photoChild), SIGKILL); }
int reapPhotoChild(pid_t child, bool force) {
 if (force) (void)kill(child, SIGKILL);
 int status = 0; pid_t done;
 do { done = waitpid(child, &status, 0); } while (done < 0 && errno == EINTR);
 photoChild = -1;
 if (done != child) return 125;
 return WIFEXITED(status) ? WEXITSTATUS(status) : WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 125;
}
}
int main(int argc, char **argv) {
 const auto value = request(argc, argv);
 if (value.enforcementFd < 0 || value.profileFd < 0 || value.brokerFd < 0 || value.executableFd < 0
  || value.durationMs == 0 || value.durationMs > 30000 || value.rssBytes == 0 || value.rssBytes > 805306368
  || value.childArgv == nullptr || value.childArgv[0] == nullptr || value.childArgv[1] != nullptr
  || std::strcmp(value.childArgv[0], "lightscaper-photo-native-raw") != 0 || value.extraInputFd >= 0
  || !value.grants.empty() || !valid(value)) return 125;
 const auto policy = profile(value);
 if (policy.empty() || policy.size() > bootstrap::maximumPolicyBytes || exactText(value.brokerFd, 4096) != photoExpectedBroker) return 125;
 FileIdentity executableIdentity{}; if (!descriptorIdentity(value.executableFd, executableIdentity)) return 125;
 const auto executablePath = pathFor(value.executableFd);
 int policyPipe[2]{ -1, -1 }; if (pipe(policyPipe) != 0) return 125;
 const int enforcementSource = fcntl(value.enforcementFd, F_DUPFD_CLOEXEC, 64);
 const int policySource = fcntl(policyPipe[0], F_DUPFD_CLOEXEC, 64);
 if (enforcementSource < 0 || policySource < 0) return 125;
 std::vector<int> descriptors; if (!snapshotOpenDescriptors(descriptors)) return 125;
 posix_spawn_file_actions_t actions{}; posix_spawnattr_t attributes{};
 if (posix_spawn_file_actions_init(&actions) != 0 || posix_spawnattr_init(&attributes) != 0) return 125;
 if (posix_spawn_file_actions_adddup2(&actions, enforcementSource, bootstrap::enforcementDescriptor) != 0
  || posix_spawn_file_actions_adddup2(&actions, policySource, bootstrap::policyDescriptor) != 0) return 125;
 for (const int descriptor : descriptors) if (descriptor > bootstrap::policyDescriptor && posix_spawn_file_actions_addclose(&actions, descriptor) != 0) return 125;
 if (posix_spawnattr_setflags(&attributes, POSIX_SPAWN_START_SUSPENDED) != 0) return 125;
 struct sigaction stop{}; stop.sa_handler = stopPhotoChild;
 if (sigemptyset(&stop.sa_mask) != 0 || sigaction(SIGTERM, &stop, nullptr) != 0 || sigaction(SIGINT, &stop, nullptr) != 0) return 125;
 char language[] = "LANG=C", locale[] = "LC_ALL=C", path[] = "PATH=", home[] = "HOME=/nonexistent";
 char *environment[]{ language, locale, path, home, nullptr }; pid_t child = -1;
 const int spawned = posix_spawn(&child, executablePath.c_str(), &actions, &attributes, value.childArgv, environment);
 (void)posix_spawn_file_actions_destroy(&actions); (void)posix_spawnattr_destroy(&attributes);
 (void)close(enforcementSource); (void)close(policySource); (void)close(policyPipe[0]);
 if (spawned != 0) { (void)close(policyPipe[1]); return 125; }
 photoChild = static_cast<sig_atomic_t>(child);
 // The kernel's actual suspended mapped vnode is checked before any parser or
 // sandbox bootstrap work is resumed. A path string is not image authority.
 bool authenticated = false; const timespec interval{ 0, 10000000 };
 for (size_t attempt = 0; attempt < verifierAttempts; ++attempt) {
  FileIdentity mapped{};
  if (firstMappedVnode(child, mapped) && stopped(child)) { authenticated = sameIdentity(mapped, executableIdentity); break; }
  if (kill(child, 0) != 0) break;
  (void)nanosleep(&interval, nullptr);
 }
 const auto header = policyHeader(policy.size(), false);
 if (!authenticated || !exactWrite(policyPipe[1], header.data(), header.size()) || kill(child, SIGCONT) != 0
  || !exactWrite(policyPipe[1], policy.data(), policy.size()) || close(policyPipe[1]) != 0
  || close(value.enforcementFd) != 0) return reapPhotoChild(child, true);
 const auto started = std::chrono::steady_clock::now(); int status = 0;
 for (;;) {
  const pid_t done = waitpid(child, &status, WNOHANG);
  if (done == child) { photoChild = -1; return WIFEXITED(status) ? WEXITSTATUS(status) : WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 125; }
  if (done < 0 && errno != EINTR) return reapPhotoChild(child, true);
  rusage_info_v2 usage{};
  if (std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count() > static_cast<long long>(value.durationMs)
   || proc_pid_rusage(child, RUSAGE_INFO_V2, reinterpret_cast<rusage_info_t *>(&usage)) != 0 || usage.ri_phys_footprint > value.rssBytes) return reapPhotoChild(child, true);
  if (nanosleep(&interval, nullptr) != 0 && errno != EINTR) return reapPhotoChild(child, true);
 }
}
