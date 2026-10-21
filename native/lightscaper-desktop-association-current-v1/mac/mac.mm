/* SPDX-License-Identifier: AGPL-3.0-only */
#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#import <CommonCrypto/CommonDigest.h>
#include <cerrno>
#include <climits>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <poll.h>
#include <spawn.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#if !defined(__APPLE__) || !(defined(__arm64__) || defined(__aarch64__))
#error This qualification helper requires target-native macOS arm64.
#endif
extern char **environ;

static void require(BOOL condition, NSString *message) {
  if (!condition) @throw [NSException exceptionWithName:@"LightscaperAssociationRefusal" reason:message userInfo:nil];
}
static BOOL hex(NSString *value, NSUInteger length) {
  return [value isKindOfClass:NSString.class] && value.length == length &&
    [value rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet]].location == NSNotFound;
}
static BOOL integer(id value, long long minimum, long long maximum) {
  return [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) != CFBooleanGetTypeID() &&
    [value doubleValue] == [value longLongValue] && [value longLongValue] >= minimum && [value longLongValue] <= maximum;
}
static NSString *bounded(NSString *value) { return value.length > 2048 ? [value substringToIndex:2048] : value; }
static NSString *canonical(NSString *path, BOOL owned, BOOL directory) {
  require([path isKindOfClass:NSString.class] && path.length > 1 && path.length <= 4096 && [path hasPrefix:@"/"] &&
    [path rangeOfString:[NSString stringWithFormat:@"%C", (unichar)0]].location == NSNotFound &&
    [path isEqualToString:path.stringByStandardizingPath], @"Path must be absolute and canonical.");
  char resolved[PATH_MAX]; require(realpath(path.fileSystemRepresentation, resolved) != nullptr, @"Path does not exist.");
  require([path isEqualToString:[NSString stringWithUTF8String:resolved]], @"Symlink or noncanonical path refused.");
  NSString *cursor = @"/"; struct stat st{};
  for (NSString *part in path.pathComponents) {
    if ([part isEqualToString:@"/"]) continue;
    cursor = [cursor stringByAppendingPathComponent:part];
    require(lstat(cursor.fileSystemRepresentation, &st) == 0 && !S_ISLNK(st.st_mode), @"Symlink path component refused.");
  }
  require(directory ? S_ISDIR(st.st_mode) : S_ISREG(st.st_mode), @"Path has the wrong physical kind.");
  require(!owned || (st.st_uid == geteuid() && !(st.st_mode & 0022)), @"Path is not exclusively owned by this account.");
  return path;
}
static BOOL sameStamp(const struct stat &a, const struct stat &b) {
  return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_size == b.st_size && a.st_mode == b.st_mode &&
    a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec &&
    a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec;
}
static NSData *readRegular(NSString *path, NSUInteger limit) {
  canonical(path, YES, NO);
  int fd = open(path.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  require(fd >= 0, @"Cannot open physical input.");
  @try {
    struct stat before{}, after{};
    require(fstat(fd, &before) == 0 && S_ISREG(before.st_mode) && before.st_nlink == 1 && before.st_uid == geteuid() &&
      before.st_size > 0 && (uint64_t)before.st_size <= limit && !(before.st_mode & 0022), @"Input ownership or size refused.");
    NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)before.st_size]; NSUInteger offset = 0;
    while (offset < data.length) {
      ssize_t count = read(fd, (char *)data.mutableBytes + offset, data.length - offset);
      if (count < 0 && errno == EINTR) continue;
      require(count > 0, @"Input read did not complete."); offset += (NSUInteger)count;
    }
    char extra; ssize_t count; do { count = read(fd, &extra, 1); } while (count < 0 && errno == EINTR);
    require(count == 0 && fstat(fd, &after) == 0 && sameStamp(before, after), @"Input changed during its read.");
    return data;
  } @finally { int result = close(fd); require(result == 0, @"Input descriptor close failed."); }
}
static NSString *sha256(NSData *data) {
  unsigned char bytes[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(data.bytes, (CC_LONG)data.length, bytes);
  NSMutableString *value = [NSMutableString stringWithCapacity:64];
  for (unsigned char byte : bytes) [value appendFormat:@"%02x", byte]; return value;
}
static NSString *nativePath(NSURL *url) {
  require(url != nil && url.isFileURL, @"Native application URL is unavailable.");
  return url.URLByResolvingSymlinksInPath.path;
}
static NSURL *resolver(NSWorkspace *workspace, NSURL *archive, NSMutableDictionary *counters) {
  counters[@"resolverQueries"] = @([counters[@"resolverQueries"] unsignedIntegerValue] + 1);
  return [workspace URLForApplicationToOpenURL:archive];
}
static void runningIdentity(NSRunningApplication *app, NSDictionary *request, NSMutableDictionary *result) {
  require(app && !app.terminated && app.processIdentifier == [request[@"primaryPid"] intValue], @"Default open did not return the existing primary PID.");
  require([app.bundleIdentifier isEqualToString:@"org.lightscaper.desktop"] &&
    [nativePath(app.bundleURL) isEqualToString:request[@"bundlePath"]] &&
    [nativePath(app.executableURL) isEqualToString:request[@"executablePath"]], @"Running application identity differs from the installed primary.");
  result[@"deliveredPid"] = @(app.processIdentifier); result[@"deliveredBundlePath"] = nativePath(app.bundleURL);
  result[@"deliveredExecutablePath"] = nativePath(app.executableURL);
}
static void validateBundle(NSDictionary *request, NSMutableDictionary *result) {
  NSString *bundle = canonical(request[@"bundlePath"], YES, YES);
  require([bundle.pathExtension isEqualToString:@"app"], @"Only an owned app bundle can be registered.");
  NSString *executable = canonical(request[@"executablePath"], YES, NO);
  NSString *info = [bundle stringByAppendingPathComponent:@"Contents/Info.plist"];
  NSError *error = nil; id plist = [NSPropertyListSerialization propertyListWithData:readRegular(info, 2 * 1024 * 1024)
    options:NSPropertyListImmutable format:nullptr error:&error];
  require([plist isKindOfClass:NSDictionary.class] && error == nil, @"Installed Info.plist is invalid.");
  NSDictionary *metadata = plist;
  require([metadata[@"CFBundleIdentifier"] isEqual:@"org.lightscaper.desktop"] && [metadata[@"CFBundlePackageType"] isEqual:@"APPL"], @"Installed bundle identifier is not Lightscaper.");
  NSString *name = metadata[@"CFBundleExecutable"];
  require([name isKindOfClass:NSString.class] && name.length && [name isEqualToString:name.lastPathComponent] &&
    [executable isEqualToString:[bundle stringByAppendingPathComponent:[@"Contents/MacOS" stringByAppendingPathComponent:name]]], @"Installed executable does not match its bundle metadata.");
  require(access(executable.fileSystemRepresentation, X_OK) == 0, @"Installed primary is not executable.");
  NSArray *types = metadata[@"CFBundleDocumentTypes"];
  require([types isKindOfClass:NSArray.class] && types.count == 1 && [types[0] isKindOfClass:NSDictionary.class], @"Installed document types must be one exact catalog declaration.");
  NSDictionary *type = types[0]; NSSet *allowed = [NSSet setWithArray:@[@"CFBundleTypeExtensions", @"CFBundleTypeName", @"CFBundleTypeRole", @"LSHandlerRank", @"CFBundleTypeIconFile"]];
  require([[NSSet setWithArray:type.allKeys] isSubsetOfSet:allowed] && [type[@"CFBundleTypeExtensions"] isEqual:@[@"liscape"]] &&
    [type[@"CFBundleTypeName"] isEqual:@"Lightscaper Catalog"] && [type[@"CFBundleTypeRole"] isEqual:@"Editor"] &&
    (!type[@"LSHandlerRank"] || [type[@"LSHandlerRank"] isEqual:@"Default"]), @"Installed document claims differ from the product-owned catalog association.");
  result[@"bundlePath"] = bundle; result[@"executablePath"] = executable; result[@"bundleIdentifier"] = @"org.lightscaper.desktop";
  result[@"extension"] = @"liscape"; result[@"documentName"] = @"Lightscaper Catalog"; result[@"documentRole"] = @"Editor";
  // electron-builder declares its MIME on Linux only. No nonexistent macOS MIME is certified.
  result[@"mimeType"] = NSNull.null;
}
static double now() { struct timespec t{}; require(clock_gettime(CLOCK_MONOTONIC, &t) == 0, @"Clock unavailable."); return t.tv_sec + t.tv_nsec / 1e9; }
static void unregisterTool(NSString *bundle, NSMutableDictionary *counters) {
  const char *tool = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  struct stat st{}; require(lstat(tool, &st) == 0 && S_ISREG(st.st_mode) && st.st_uid == 0 && !(st.st_mode & 0022) && access(tool, X_OK) == 0,
    @"The system lsregister utility is unavailable or unsafe; no public unregister API is claimed.");
  int pipes[2]; require(pipe(pipes) == 0, @"Cannot create utility output pipe.");
  posix_spawn_file_actions_t actions; int init = posix_spawn_file_actions_init(&actions);
  if (init != 0) { close(pipes[0]); close(pipes[1]); require(NO, @"Cannot initialize utility launch."); }
  pid_t child = -1; BOOL reaped = NO; NSMutableData *output = NSMutableData.data; int status = 0; NSException *primary = nil;
  @try {
    require(fcntl(pipes[0], F_SETFL, O_NONBLOCK) == 0 && fcntl(pipes[0], F_SETFD, FD_CLOEXEC) == 0 && fcntl(pipes[1], F_SETFD, FD_CLOEXEC) == 0,
      @"Cannot configure utility pipe.");
    require(posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0) == 0 &&
      posix_spawn_file_actions_adddup2(&actions, pipes[1], STDOUT_FILENO) == 0 && posix_spawn_file_actions_adddup2(&actions, pipes[1], STDERR_FILENO) == 0 &&
      posix_spawn_file_actions_addclose(&actions, pipes[0]) == 0 && posix_spawn_file_actions_addclose(&actions, pipes[1]) == 0, @"Cannot configure utility descriptors.");
    char *const args[] = {(char *)tool, (char *)"-u", (char *)bundle.fileSystemRepresentation, nullptr};
    int code = posix_spawn(&child, tool, &actions, nullptr, args, environ);
    require(code == 0, @"System unregister utility failed to start."); counters[@"unregisterToolStarts"] = @1;
    close(pipes[1]); pipes[1] = -1; BOOL eof = NO; double deadline = now() + 15;
    while (!reaped || !eof) {
      require(now() < deadline, @"System unregister utility exceeded its bounded close deadline.");
      char buffer[4096]; ssize_t size = read(pipes[0], buffer, sizeof(buffer));
      if (size > 0) { require(output.length + (NSUInteger)size <= 16384, @"System unregister output exceeded its bound."); [output appendBytes:buffer length:(NSUInteger)size]; }
      else if (size == 0) eof = YES;
      else require(errno == EAGAIN || errno == EINTR, @"Cannot drain system unregister output.");
      if (!reaped) { pid_t waited = waitpid(child, &status, WNOHANG); require(waited >= 0 || errno == EINTR, @"Cannot join system unregister utility."); reaped = waited == child; }
      if (!reaped || !eof) { struct pollfd fd{pipes[0], POLLIN | POLLHUP, 0}; require(poll(&fd, 1, 100) >= 0 || errno == EINTR, @"Utility output poll failed."); }
    }
    counters[@"unregisterToolReaped"] = @YES;
    counters[@"unregisterToolExitCode"] = WIFEXITED(status) ? @(WEXITSTATUS(status)) : NSNull.null;
    require(WIFEXITED(status) && WEXITSTATUS(status) == 0,
      [@"System unregister utility refused: " stringByAppendingString:bounded([[NSString alloc] initWithData:output encoding:NSUTF8StringEncoding] ?: @"non-text output")]);
  } @catch (NSException *failure) { primary = failure; }
  @finally {
    if (child > 0 && !reaped) {
      int killed = kill(child, SIGKILL), killError = killed == 0 ? 0 : errno;
      for (unsigned attempt = 0; attempt < 200 && !reaped; ++attempt) {
        pid_t waited = waitpid(child, &status, WNOHANG);
        if (waited == child) reaped = YES;
        else if (waited < 0 && errno != EINTR) break;
        else (void)poll(nullptr, 0, 10);
      }
      counters[@"unregisterToolReaped"] = @(reaped);
      if ((killed != 0 && killError != ESRCH) || !reaped) {
        NSString *reason = [NSString stringWithFormat:@"%@ Cleanup could not prove exact-child retirement (kill errno %d); the outer owner must retain the scope.", primary.reason ?: @"Unregister utility failed.", killError];
        primary = [NSException exceptionWithName:@"LightscaperAssociationRetirementRefusal" reason:reason userInfo:nil];
      }
    }
    posix_spawn_file_actions_destroy(&actions); close(pipes[0]); if (pipes[1] >= 0) close(pipes[1]);
  }
  if (primary) @throw primary;
}
static void perform(NSDictionary *request, NSMutableDictionary *result, NSMutableDictionary *counters) {
  validateBundle(request, result);
  NSString *archive = canonical(request[@"archivePath"], YES, NO);
  require([archive.pathExtension.lowercaseString isEqualToString:@"liscape"], @"Only the owned catalog suffix can be dispatched.");
  NSString *digest = sha256(readRegular(archive, 64 * 1024 * 1024));
  require([digest isEqual:request[@"archiveSha256"]], @"Archive digest differs from the accepted request.");
  result[@"archivePath"] = archive; result[@"archiveSha256"] = digest;
  NSWorkspace *workspace = NSWorkspace.sharedWorkspace; NSURL *file = [NSURL fileURLWithPath:archive]; NSString *operation = request[@"operation"];
  if ([operation isEqual:@"unregister"]) {
    for (NSRunningApplication *app in [NSRunningApplication runningApplicationsWithBundleIdentifier:@"org.lightscaper.desktop"])
      require(![nativePath(app.bundleURL) isEqual:request[@"bundlePath"]] || app.terminated, @"Owned application must retire before unregister.");
    unregisterTool(request[@"bundlePath"], counters);
    NSUInteger matches = 0; for (NSURL *url in [workspace URLsForApplicationsToOpenURL:file]) if ([nativePath(url) isEqual:request[@"bundlePath"]]) ++matches;
    counters[@"postUnregisterMatches"] = @(matches);
    NSURL *preferred = resolver(workspace, file, counters); if (preferred) result[@"resolverBundlePath"] = nativePath(preferred);
    require(matches == 0 && (!preferred || ![nativePath(preferred) isEqual:request[@"bundlePath"]]), @"Owned LaunchServices registration retirement was not proved.");
  } else {
    NSURL *preferred = resolver(workspace, file, counters);
    result[@"priorResolverBundlePath"] = preferred ? nativePath(preferred) : (id)NSNull.null;
    if ([operation isEqual:@"register"]) {
      // Before registration, a new suffix may resolve by ZIP contents. Register
      // this own candidate only; never set a default or select an explicit app.
      counters[@"registerCalls"] = @1; OSStatus status = LSRegisterURL((__bridge CFURLRef)[NSURL fileURLWithPath:request[@"bundlePath"]], true);
      if (status != noErr) result[@"error"] = @{@"domain":@"NSOSStatusErrorDomain", @"code":@(status), @"message":@"LSRegisterURL refused the owned bundle."};
      require(status == noErr, [NSString stringWithFormat:@"LSRegisterURL failed with status %d.", (int)status]);
      preferred = resolver(workspace, file, counters); result[@"resolverBundlePath"] = preferred ? nativePath(preferred) : (id)NSNull.null;
      require(preferred && [nativePath(preferred) isEqual:request[@"bundlePath"]], @"Registration did not produce the expected default route; no default was forced.");
    } else {
      result[@"resolverBundlePath"] = preferred ? nativePath(preferred) : (id)NSNull.null;
      require(preferred && [nativePath(preferred) isEqual:request[@"bundlePath"]], @"Actual default handler is not the owned catalog application; no override is authorized.");
      require([request[@"primaryPid"] intValue] > 0, @"Open requires the actual primary PID.");
      NSMutableDictionary *before = NSMutableDictionary.dictionary;
      runningIdentity([NSRunningApplication runningApplicationWithProcessIdentifier:[request[@"primaryPid"] intValue]], request, before);
      dispatch_semaphore_t completed = dispatch_semaphore_create(0); NSObject *lock = NSObject.new;
      __block NSRunningApplication *opened = nil; __block NSError *failure = nil; __block NSUInteger calls = 0; __block BOOL sealed = NO;
      counters[@"openCalls"] = @1;
      [workspace openURL:file configuration:NSWorkspaceOpenConfiguration.configuration completionHandler:^(NSRunningApplication *app, NSError *error) {
        @synchronized(lock) { if (!sealed) { opened = app; failure = error; ++calls; } }
        dispatch_semaphore_signal(completed);
      }];
      long wait = dispatch_semaphore_wait(completed, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
      @synchronized(lock) { sealed = YES; counters[@"completionCalls"] = @(calls); }
      require(wait == 0 && calls == 1, @"Default NSWorkspace open completion did not join exactly once.");
      if (failure) { result[@"error"] = @{@"domain":bounded(failure.domain), @"code":@(failure.code), @"message":bounded(failure.localizedDescription)}; require(NO, @"Default NSWorkspace open failed."); }
      runningIdentity(opened, request, result);
    }
  }
  validateBundle(request, result);
  require([sha256(readRegular(archive, 64 * 1024 * 1024)) isEqual:digest], @"Archive changed during native association operation.");
}
static void exclusiveResult(int fd, NSDictionary *result) {
  @try {
    NSError *error = nil; NSData *data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingSortedKeys error:&error];
    require(data && !error && data.length < 16384, @"Native result cannot be encoded within its bound.");
    NSUInteger offset = 0; while (offset < data.length) { ssize_t count = write(fd, (const char *)data.bytes + offset, data.length - offset); if (count < 0 && errno == EINTR) continue; require(count > 0, @"Native result write failed."); offset += (NSUInteger)count; }
    require(fsync(fd) == 0, @"Native result sync failed.");
  }
  @finally { require(close(fd) == 0, @"Native result close failed."); }
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 5 || strcmp(argv[1], "--request") || strcmp(argv[3], "--result")) { fprintf(stderr, "Expected --request absolute.json --result new-absolute.json\n"); return 2; }
    NSString *input = [NSString stringWithUTF8String:argv[2]], *output = [NSString stringWithUTF8String:argv[4]];
    NSMutableDictionary *counters = [@{@"registerCalls":@0, @"resolverQueries":@0, @"openCalls":@0, @"completionCalls":@0,
      @"unregisterToolStarts":@0, @"unregisterToolExitCode":NSNull.null, @"unregisterToolReaped":@NO, @"postUnregisterMatches":NSNull.null} mutableCopy];
    NSMutableDictionary *result = [@{@"schemaVersion":@1, @"target":@"mac-arm64", @"status":@"failed", @"mimeType":NSNull.null, @"counters":counters, @"error":NSNull.null} mutableCopy];
    for (NSString *key in @[@"nonce", @"sourceRevision", @"operation", @"bundlePath", @"executablePath", @"bundleIdentifier", @"extension", @"documentName", @"documentRole", @"archivePath", @"archiveSha256", @"primaryPid", @"priorResolverBundlePath", @"resolverBundlePath", @"deliveredPid", @"deliveredBundlePath", @"deliveredExecutablePath"]) result[key] = NSNull.null;
    BOOL passed = NO; int resultFd = -1;
    @try {
      require(getuid() == geteuid() && geteuid() != 0, @"Qualification must use an ordinary native account.");
      NSString *parent = canonical(input.stringByDeletingLastPathComponent, YES, YES);
      require([output.stringByDeletingLastPathComponent isEqual:parent] && [output.lastPathComponent hasSuffix:@".json"] &&
        [output isEqual:output.stringByStandardizingPath] && output.length <= 4096 && [output rangeOfString:[NSString stringWithFormat:@"%C", (unichar)0]].location == NSNotFound,
        @"Result must be a new JSON file beside the private request.");
      struct stat directory{}, requestStat{};
      require(lstat(parent.fileSystemRepresentation, &directory) == 0 && (directory.st_mode & 0077) == 0, @"Request directory must remain private.");
      resultFd = open(output.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
      require(resultFd >= 0, @"Native result already exists or cannot be reserved.");
      require(lstat(input.fileSystemRepresentation, &requestStat) == 0 && (requestStat.st_mode & 0777) == 0600, @"Request file must remain private.");
      NSError *error = nil; id parsed = [NSJSONSerialization JSONObjectWithData:readRegular(input, 16384) options:0 error:&error];
      NSArray *keys = @[@"schemaVersion", @"nonce", @"target", @"sourceRevision", @"operation", @"bundlePath", @"executablePath", @"archivePath", @"archiveSha256", @"primaryPid"];
      require(!error && [parsed isKindOfClass:NSDictionary.class] && [[NSSet setWithArray:[parsed allKeys]] isEqual:[NSSet setWithArray:keys]], @"Native association request must be a closed record.");
      NSDictionary *request = parsed;
      require(integer(request[@"schemaVersion"], 1, 1) && hex(request[@"nonce"], 32) && [request[@"target"] isEqual:@"mac-arm64"] && hex(request[@"sourceRevision"], 40) &&
        hex(request[@"archiveSha256"], 64) && integer(request[@"primaryPid"], 0, INT_MAX) && [@[@"register", @"open", @"unregister"] containsObject:request[@"operation"]], @"Native request identity or operation is invalid.");
      for (NSString *key in @[@"nonce", @"sourceRevision", @"operation", @"primaryPid"]) result[key] = request[key];
      perform(request, result, counters); result[@"status"] = @"passed"; passed = YES;
    } @catch (NSException *exception) {
      if (result[@"error"] == NSNull.null) result[@"error"] = @{@"domain":@"LightscaperMacAssociation", @"code":@1, @"message":bounded(exception.reason ?: exception.name)};
    }
    if (resultFd < 0) { fprintf(stderr, "Native result directory or exclusive destination was not admitted.\n"); return 2; }
    @try { exclusiveResult(resultFd, result); } @catch (NSException *exception) { fprintf(stderr, "%s\n", bounded(exception.reason ?: exception.name).UTF8String); return 2; }
    return passed ? 0 : 1;
  }
}
