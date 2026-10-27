// SPDX-License-Identifier: AGPL-3.0-only
#pragma warning disable 0649 // Native APIs populate the declared interop layouts.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

namespace Soundscaper.Qualification.Win32 {
 public sealed class Identity {
  public string platform { get; set; }
  public uint pid { get; set; }
  public uint parent { get; set; }
  public string birth { get; set; }
  public string executable { get; set; }
 }
 public sealed class Custody {
  public string directory { get; set; }
  public string id { get; set; }
  public string jobName { get; set; }
  public string controlId { get; set; }
 }
 public sealed class VisibilityGap {
  public uint pid { get; set; }
  public string error { get; set; }
 }
 public sealed class ProcessSnapshot {
  public Identity[] processes { get; set; }
  public VisibilityGap[] visibilityGaps { get; set; }
 }
 public sealed class Grant : IDisposable {
  internal IntPtr Process;
  internal IntPtr Job;
  internal IntPtr Controller;
  internal Identity ControllerOwner;
  public Identity Owner { get; private set; }
  internal Grant(IntPtr process, IntPtr job, Identity owner,IntPtr controller,Identity controllerOwner) { Process=process; Job=job; Owner=owner;Controller=controller;ControllerOwner=controllerOwner; }
  public void Verify() {
   Native.RequireSame(Controller,ControllerOwner);Native.RequireSame(Process,Owner);
   bool member; if(!Native.IsProcessInJob(Process,Job,out member) || !member) throw new InvalidOperationException("Process is no longer in the granted owned job.");
  }
  public void Kill() { Verify(); if(!Native.TerminateJobObject(Job,137)) throw Native.Error("TerminateJobObject"); }
  public void Dispose() { Native.Close(ref Process); Native.Close(ref Job);Native.Close(ref Controller); }
 }
 public static class Native {
  internal const uint QueryLimited=0x1000, Synchronize=0x100000, WaitTimeout=258, JobQuery=4, JobTerminate=8;
  internal const uint CreateSuspended=4, CreateUnicodeEnvironment=0x400, CreateNewProcessGroup=0x200, ExtendedStartup=0x80000;
  internal const int MaxMembers=4096;
  [StructLayout(LayoutKind.Sequential)] internal struct FileTime { internal uint low,high; }
  [StructLayout(LayoutKind.Sequential)] internal struct BasicProcessInfo { internal IntPtr reserved,peb,reserved2,reserved3; internal UIntPtr unique; internal IntPtr parent; }
  [StructLayout(LayoutKind.Sequential)] internal struct SecurityAttributes { internal int length; internal IntPtr descriptor; [MarshalAs(UnmanagedType.Bool)] internal bool inherit; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] internal struct StartupInfo {
   internal int cb; internal string reserved,desktop,title; internal uint x,y,width,height,xCount,yCount,fill,flags; internal ushort show,reservedBytes; internal IntPtr reservedData,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] internal struct StartupInfoEx { internal StartupInfo startup; internal IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] internal struct ProcessInfo { internal IntPtr process,thread; internal uint pid,threadId; }
  [StructLayout(LayoutKind.Sequential)] internal struct BasicLimits {
   internal long processTime,jobTime; internal uint flags; internal UIntPtr minWorkingSet,maxWorkingSet; internal uint activeLimit; internal UIntPtr affinity; internal uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] internal struct IoCounters { internal ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] internal struct ExtendedLimits { internal BasicLimits basic; internal IoCounters io; internal UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory; }
  [StructLayout(LayoutKind.Sequential)] public struct Accounting {
   public long totalUserTime,totalKernelTime,periodUserTime,periodKernelTime;
   public uint pageFaults,totalProcesses,activeProcesses,terminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential)] internal struct SystemInfo {
   internal ushort architecture,reserved; internal uint pageSize; internal IntPtr minAddress,maxAddress; internal UIntPtr mask; internal uint processors,type,granularity; internal ushort level,revision;
  }
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern IntPtr GetStdHandle(int identifier);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern uint GetFileType(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool GetProcessTimes(IntPtr process,out FileTime creation,out FileTime exit,out FileTime kernel,out FileTime user);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder name,ref int length);
  [DllImport("ntdll.dll")] internal static extern int NtQueryInformationProcess(IntPtr process,int kind,ref BasicProcessInfo info,int size,out int returned);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool GetExitCodeProcess(IntPtr process,out uint exit);
  [DllImport("kernel32.dll")] internal static extern uint GetCurrentProcessId();
  [DllImport("kernel32.dll")] internal static extern void GetNativeSystemInfo(out SystemInfo info);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool TerminateJobObject(IntPtr job,uint exit);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool TerminateProcess(IntPtr process,uint exit);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimits limits,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr info,uint size,out uint returned);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SecurityAttributes attributes,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern IntPtr CreateFile(string name,uint access,uint share,ref SecurityAttributes attributes,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr bytes);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool CreateProcess(string executable,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupInfoEx startup,out ProcessInfo info);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern uint ResumeThread(IntPtr thread);
  internal static Exception Error(string operation) { return new Win32Exception(Marshal.GetLastWin32Error(),operation); }
  internal static void Close(ref IntPtr h) { if(h!=IntPtr.Zero && h!=new IntPtr(-1)) { CloseHandle(h); h=IntPtr.Zero; } }
  public static string Architecture() {
   if(IntPtr.Size!=8) throw new PlatformNotSupportedException("A 64-bit controller is required.");
   SystemInfo info; GetNativeSystemInfo(out info);
   if(info.architecture==9) return "x64";
   if(info.architecture==12) return "arm64";
   throw new PlatformNotSupportedException("Only Windows x64 and ARM64 are maintained.");
  }
  public static string FullLocalPath(string path) {
   if(String.IsNullOrEmpty(path)||path.Length<3||!Char.IsLetter(path[0])||path[1]!=':'||(path[2]!='\\'&&path[2]!='/')) throw new ArgumentException("A fully qualified local drive path is required.");
   return Path.GetFullPath(path);
  }
  public static string CanonicalDirectory(string path) {
   string full=FullLocalPath(path),root=Path.GetPathRoot(full);
   if(full.Length>root.Length) full=full.TrimEnd(Path.DirectorySeparatorChar);
   DirectoryInfo directory=new DirectoryInfo(full);
   if(!directory.Exists) throw new DirectoryNotFoundException(full);
   for(DirectoryInfo p=directory;p!=null;p=p.Parent) if((p.Attributes&FileAttributes.ReparsePoint)!=0) throw new IOException("Reparse-point custody directory is refused.");
   DirectorySecurity acl=directory.GetAccessControl(AccessControlSections.Access|AccessControlSections.Owner);
   SecurityIdentifier user=WindowsIdentity.GetCurrent().User;
   SecurityIdentifier owner=(SecurityIdentifier)acl.GetOwner(typeof(SecurityIdentifier));
   bool adminOwner=owner.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)&&new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
   if(user==null || (!user.Equals(owner)&&!adminOwner)) throw new UnauthorizedAccessException("Custody directory must be owned by the current user or its elevated administrator token.");
   foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
    SecurityIdentifier sid=(SecurityIdentifier)rule.IdentityReference;
    bool publicSid=sid.IsWellKnown(WellKnownSidType.WorldSid)||sid.IsWellKnown(WellKnownSidType.BuiltinUsersSid)||sid.IsWellKnown(WellKnownSidType.AuthenticatedUserSid);
    FileSystemRights writes=FileSystemRights.WriteData|FileSystemRights.AppendData|FileSystemRights.WriteExtendedAttributes|FileSystemRights.WriteAttributes|FileSystemRights.Delete|FileSystemRights.DeleteSubdirectoriesAndFiles|FileSystemRights.ChangePermissions|FileSystemRights.TakeOwnership;
    if(publicSid && rule.AccessControlType==AccessControlType.Allow && (rule.FileSystemRights&writes)!=0) throw new UnauthorizedAccessException("Custody directory grants public write access.");
   }
   return full;
  }
  public static string CustodyFile(string directory,string id,string suffix) {
   string full=CanonicalDirectory(directory);
   if(String.IsNullOrEmpty(id)||id.Length>80) throw new ArgumentException("Invalid custody id.");
   foreach(char c in id) if(!(Char.IsLetterOrDigit(c)||c=='-'||c=='_')) throw new ArgumentException("Invalid custody id.");
   return Path.Combine(full,id+suffix);
  }
  internal static Identity ReadIdentity(IntPtr handle,uint pid) {
   uint state=WaitForSingleObject(handle,0);if(state==0) return null;if(state!=WaitTimeout) throw Error("Wait process identity HANDLE");
   FileTime creation,exit,kernel,user;
   if(!GetProcessTimes(handle,out creation,out exit,out kernel,out user)) throw Error("GetProcessTimes");
   StringBuilder image=new StringBuilder(32768);int length=image.Capacity;
   if(!QueryFullProcessImageName(handle,0,image,ref length)) throw Error("QueryFullProcessImageName");
   BasicProcessInfo basic=new BasicProcessInfo();int returned;
   if(NtQueryInformationProcess(handle,0,ref basic,Marshal.SizeOf(typeof(BasicProcessInfo)),out returned)!=0) throw new IOException("Parent identity is unavailable.");
   ulong birth=((ulong)creation.high<<32)|creation.low;
   return new Identity { platform="win32",pid=pid,parent=checked((uint)basic.parent.ToInt64()),birth=birth.ToString(CultureInfo.InvariantCulture),executable=Path.GetFullPath(image.ToString()) };
  }
  public static Identity Inspect(uint pid) {
   if(pid==0) return null;
   IntPtr handle=OpenProcess(QueryLimited|Synchronize,false,pid);
   if(handle==IntPtr.Zero) { int error=Marshal.GetLastWin32Error(); if(error==87) return null; throw new Win32Exception(error,"OpenProcess identity"); }
   try { return ReadIdentity(handle,pid); } finally { Close(ref handle); }
  }
  public static ProcessSnapshot Snapshot() {
   List<Identity> identities=new List<Identity>();List<VisibilityGap> gaps=new List<VisibilityGap>();
   Process[] processes=Process.GetProcesses();
   if(processes.Length>32768) throw new IOException("Process snapshot exceeds its bound.");
   foreach(Process p in processes) {
    uint pid=0;
    try { pid=checked((uint)p.Id);Identity identity=Inspect(pid);if(identity!=null) identities.Add(identity); }
    catch(Exception error) { gaps.Add(new VisibilityGap { pid=pid,error=error.Message }); }
    finally { p.Dispose(); }
   }
   return new ProcessSnapshot { processes=identities.ToArray(),visibilityGaps=gaps.ToArray() };
  }
  internal static void RequireSame(IntPtr handle,Identity owner) {
   Identity actual=ReadIdentity(handle,owner.pid);
   if(actual==null || owner.platform!="win32" || actual.pid!=owner.pid || actual.parent!=owner.parent || actual.birth!=owner.birth || !String.Equals(actual.executable,owner.executable,StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Owned process identity is retired or changed.");
  }
  public static Grant Acquire(Identity owner,Custody custody,Identity controllerOwner,bool mayKill) {
   CanonicalDirectory(custody.directory);
   Guid control;if(!Guid.TryParseExact(custody.controlId,"N",out control) || custody.jobName!="Local\\SoundscaperQualification-"+custody.controlId) throw new ArgumentException("Invalid job capability.");
   IntPtr process=OpenProcess(QueryLimited|Synchronize,false,owner.pid);if(process==IntPtr.Zero) throw Error("OpenProcess owned grant");
   IntPtr job=IntPtr.Zero,controller=IntPtr.Zero;
   try { if(owner.parent!=controllerOwner.pid) throw new InvalidOperationException("Owner parent does not match its controller receipt.");controller=OpenProcess(QueryLimited|Synchronize,false,controllerOwner.pid);if(controller==IntPtr.Zero) throw Error("Open retained controller grant");RequireSame(controller,controllerOwner);RequireSame(process,owner);job=OpenJobObject(JobQuery|(mayKill?JobTerminate:0),false,custody.jobName);if(job==IntPtr.Zero) throw Error("OpenJobObject owned grant");Grant grant=new Grant(process,job,owner,controller,controllerOwner);grant.Verify();return grant; }
   catch { Close(ref process);Close(ref job);Close(ref controller);throw; }
  }
  internal static Accounting JobAccounting(IntPtr job) {
   int size=Marshal.SizeOf(typeof(Accounting));IntPtr data=Marshal.AllocHGlobal(size);
   try { uint returned;if(!QueryInformationJobObject(job,1,data,(uint)size,out returned)) throw Error("Job accounting");return (Accounting)Marshal.PtrToStructure(data,typeof(Accounting)); }
   finally { Marshal.FreeHGlobal(data); }
  }
  internal static uint[] JobPids(IntPtr job) {
   int size=8+MaxMembers*IntPtr.Size;IntPtr data=Marshal.AllocHGlobal(size);
   try {
    uint returned;if(!QueryInformationJobObject(job,3,data,(uint)size,out returned)) throw Error("Owned job member snapshot");
    int count=Marshal.ReadInt32(data,4);if(count<0||count>MaxMembers) throw new IOException("Owned job exceeds snapshot bound.");uint[] pids=new uint[count];
    for(int i=0;i<count;i++) pids[i]=checked((uint)Marshal.ReadIntPtr(data,8+i*IntPtr.Size).ToInt64());return pids;
   } finally { Marshal.FreeHGlobal(data); }
  }
  internal static string Quote(string value) {
   if(value==null || value.IndexOf('\0')>=0) throw new ArgumentException("Invalid command argument.");
   StringBuilder result=new StringBuilder("\"");int slashes=0;
   foreach(char c in value) { if(c=='\\') { slashes++;continue; } if(c=='\"') result.Append('\\',slashes*2+1);else result.Append('\\',slashes);result.Append(c);slashes=0; }
   result.Append('\\',slashes*2);return result.Append('"').ToString();
  }
  internal static string Json(string value) {
   StringBuilder result=new StringBuilder("\"");foreach(char c in value) { if(c=='"'||c=='\\') result.Append('\\').Append(c);else if(c<32) result.Append("\\u").Append(((int)c).ToString("x4",CultureInfo.InvariantCulture));else result.Append(c); }return result.Append('"').ToString();
  }
  internal static string IdentityJson(Identity owner) { return "{\"platform\":\"win32\",\"pid\":"+owner.pid+",\"parent\":"+owner.parent+",\"birth\":"+Json(owner.birth)+",\"executable\":"+Json(owner.executable)+"}"; }
  internal static string OwnerJson(Identity owner,Custody custody,Identity controller) {
   return "{\"owner\":"+IdentityJson(owner)+",\"controller\":"+IdentityJson(controller)+",\"custody\":{\"directory\":"+Json(custody.directory)+",\"id\":"+Json(custody.id)+",\"jobName\":"+Json(custody.jobName)+",\"controlId\":"+Json(custody.controlId)+"}}\n";
  }
  public static void AssertUniqueJsonKeys(string json) {
   if(json==null||json.Length>65536) throw new ArgumentException("JSON input exceeds its bound.");
   Stack<HashSet<string>> objects=new Stack<HashSet<string>>();
   for(int i=0;i<json.Length;i++) {
    char c=json[i];
    if(c=='{'||c=='[') { if(objects.Count>=32) throw new ArgumentException("JSON depth exceeds its bound.");objects.Push(c=='{'?new HashSet<string>(StringComparer.OrdinalIgnoreCase):null);continue; }
    if(c=='}'||c==']') { if(objects.Count==0) throw new ArgumentException("Invalid JSON nesting.");objects.Pop();continue; }
    if(c!='"') continue;StringBuilder value=new StringBuilder();bool ended=false;
    while(++i<json.Length) {
     c=json[i];if(c=='"') { ended=true;break; }
     if(c<' ') throw new ArgumentException("Unescaped control character in JSON string.");
     if(c!='\\') { value.Append(c);continue; }
     if(++i>=json.Length) throw new ArgumentException("Invalid JSON escape.");c=json[i];
     if(c=='u') { if(i+4>=json.Length) throw new ArgumentException("Invalid JSON Unicode escape.");value.Append((char)UInt16.Parse(json.Substring(i+1,4),NumberStyles.AllowHexSpecifier,CultureInfo.InvariantCulture));i+=4; }
     else if(c=='"'||c=='\\'||c=='/') value.Append(c);
     else if(c=='b') value.Append('\b');else if(c=='f') value.Append('\f');else if(c=='n') value.Append('\n');else if(c=='r') value.Append('\r');else if(c=='t') value.Append('\t');else throw new ArgumentException("Invalid JSON escape.");
    }
    if(!ended) throw new ArgumentException("Unterminated JSON string.");int next=i+1;while(next<json.Length&&Char.IsWhiteSpace(json[next])) next++;
    if(next<json.Length&&json[next]==':') { if(objects.Count==0||objects.Peek()==null||!objects.Peek().Add(value.ToString())) throw new ArgumentException("Duplicate or invalid JSON object key."); }
   }
   if(objects.Count!=0) throw new ArgumentException("Unterminated JSON container.");
  }
  public static void WriteExclusive(string path,string text) {
   string directory=Path.GetDirectoryName(Path.GetFullPath(path));
   string temporary=Path.Combine(directory,"."+Path.GetFileName(path)+"."+Guid.NewGuid().ToString("N")+".tmp");
   try {
    using(FileStream stream=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None)) { byte[] bytes=new UTF8Encoding(false,true).GetBytes(text);stream.Write(bytes,0,bytes.Length);stream.Flush(true); }
    // File.Move has no overwrite form here: readers see one complete, exclusive receipt.
    File.Move(temporary,path);
   } finally { if(File.Exists(temporary)) File.Delete(temporary); }
  }
 }
}
