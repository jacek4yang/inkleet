// Disposable CI harness only: reduce the CALLER's token for its own child.
// No credentials, account/policy/ACL changes, privilege enablement or debug app code.
// Microsoft CreateRestrictedToken / CreateProcessAsUser / Job Objects contracts.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

public static class InkLeetCiToken {
  public sealed class Proof {
    public string user_sid; public string owner_sid; public int integrity_rid;
    public bool elevated; public bool admin_enabled; public bool sandbox_inert;
    public string[] enabled_privileges; public int process_id; public int session_id;
  }
  public sealed class RunResult {
    public Proof parent; public Proof child; public string mode; public int exit_code;
    public bool exited; public bool timed_out; public bool job_handle_closed; public bool job_tree_empty;
    public bool failure_cleanup_tree_empty; public string failure_cleanup_error;
  }
  [StructLayout(LayoutKind.Sequential)] struct SidAttrs { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct GroupOne { public uint Count; public SidAttrs Group; }
  [StructLayout(LayoutKind.Sequential)] struct Luid { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] struct Priv { public Luid Id; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public uint cb; public string reserved,desktop,title; public uint x,y,xsize,ysize,xchars,ychars,fill,flags;
    public ushort show,reserved2; public IntPtr reservedPtr,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint processId,threadId; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking; public uint active;
    public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct JobAccounting {public long user,kernel,periodUser,periodKernel;public uint pageFaults,totalProcesses,activeProcesses,terminatedProcesses;}
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint rights,bool inherit,int pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint rights,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr data,int bytes,out int needed);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetTokenInformation(IntPtr token,int kind,IntPtr data,int bytes);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr token,uint flags,uint disable,IntPtr disabled,uint delete,IntPtr deleted,uint restrict,IntPtr restricted,out IntPtr result);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool LookupPrivilegeName(string system,ref Luid id,StringBuilder name,ref int chars);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSidToSid(string sid,out IntPtr value);
  [DllImport("advapi32.dll")] static extern uint GetLengthSid(IntPtr sid);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessAsUser(IntPtr token,string app,StringBuilder command,IntPtr processAttrs,IntPtr threadAttrs,bool inherit,uint flags,IntPtr environment,string directory,ref Startup startup,out ProcessInfo info);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr processAttrs,IntPtr threadAttrs,bool inherit,uint flags,IntPtr environment,string directory,ref Startup startup,out ProcessInfo info);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attrs,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimits limits,uint length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out JobAccounting accounting,uint length,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint exitCode);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  static void Check(bool ok,string action) { if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error(),action); }
  static IntPtr Info(IntPtr token,int kind) {
    int size; GetTokenInformation(token,kind,IntPtr.Zero,0,out size);
    if(size<=0||size>1048576)throw new InvalidOperationException("Invalid token information size");
    IntPtr data=Marshal.AllocHGlobal(size);try { Check(GetTokenInformation(token,kind,data,size,out size),"GetTokenInformation "+kind);return data; } catch {Marshal.FreeHGlobal(data);throw;}
  }
  static int Integer(IntPtr token,int kind) {IntPtr p=Info(token,kind);try{return Marshal.ReadInt32(p);}finally{Marshal.FreeHGlobal(p);}}
  static string Sid(IntPtr token,int kind) {IntPtr p=Info(token,kind);try{return new SecurityIdentifier(Marshal.ReadIntPtr(p)).Value;}finally{Marshal.FreeHGlobal(p);}}
  static Proof InspectToken(IntPtr token,int pid) {
    var p=new Proof {user_sid=Sid(token,1),owner_sid=Sid(token,4),elevated=Integer(token,20)!=0,sandbox_inert=Integer(token,15)!=0,process_id=pid,session_id=Integer(token,12)};
    string integrity=Sid(token,25);p.integrity_rid=int.Parse(integrity.Substring(integrity.LastIndexOf('-')+1));
    IntPtr groups=Info(token,2);try {
      int count=Marshal.ReadInt32(groups),start=Marshal.OffsetOf(typeof(GroupOne),"Group").ToInt32(),size=Marshal.SizeOf(typeof(SidAttrs));
      if(count<0||count>4096)throw new InvalidOperationException("Invalid token groups");
      for(int i=0;i<count;i++){var g=Marshal.PtrToStructure<SidAttrs>(IntPtr.Add(groups,start+i*size));if(new SecurityIdentifier(g.Sid).Value=="S-1-5-32-544")p.admin_enabled=(g.Attributes&4)!=0&&(g.Attributes&16)==0;}
    } finally {Marshal.FreeHGlobal(groups);}
    var enabled=new List<string>();IntPtr privileges=Info(token,3);try {
      int count=Marshal.ReadInt32(privileges),size=Marshal.SizeOf(typeof(Priv));if(count<0||count>4096)throw new InvalidOperationException("Invalid token privileges");
      for(int i=0;i<count;i++){var v=Marshal.PtrToStructure<Priv>(IntPtr.Add(privileges,4+i*size));if((v.Attributes&2)!=0){int chars=0;LookupPrivilegeName(null,ref v.Id,null,ref chars);var name=new StringBuilder(chars+1);chars=name.Capacity;Check(LookupPrivilegeName(null,ref v.Id,name,ref chars),"LookupPrivilegeName");enabled.Add(name.ToString());}}
    } finally {Marshal.FreeHGlobal(privileges);}
    p.enabled_privileges=enabled.ToArray();return p;
  }
  public static Proof Inspect(int pid) {
    IntPtr process=OpenProcess(0x1000,false,pid),token=IntPtr.Zero;Check(process!=IntPtr.Zero,"Open owned process");
    try {Check(OpenProcessToken(process,8,out token),"Open owned process token");return InspectToken(token,pid);}finally{if(token!=IntPtr.Zero)CloseHandle(token);CloseHandle(process);}
  }
  public static void ValidateStandard(Proof proof,string sameUser) {
    if(proof==null||proof.user_sid!=sameUser||proof.owner_sid!=sameUser||proof.integrity_rid!=0x2000||proof.elevated||proof.admin_enabled||proof.sandbox_inert)throw new InvalidOperationException("Child must be the same user, user-owned, medium integrity and not elevated/admin-enabled/inert");
    if(proof.enabled_privileges==null)throw new InvalidOperationException("Missing privilege diagnostics");
    foreach(string privilege in proof.enabled_privileges)if(privilege!="SeChangeNotifyPrivilege")throw new InvalidOperationException("Unexpected enabled child privilege: "+privilege);
  }
  public static string CommandLine(string executable,string script,string config) {
    foreach(string arg in new[]{executable,script,config})if(String.IsNullOrWhiteSpace(arg)||arg.IndexOfAny(new[]{'"','\r','\n','\0'})>=0||arg.EndsWith("\\"))throw new InvalidOperationException("Unsafe launcher argument");
    return "\""+executable+"\" \""+script+"\" \""+config+"\"";
  }
  static void SetSid(IntPtr token,int kind,string sid,uint attributes) {
    IntPtr value=IntPtr.Zero,data=IntPtr.Zero;try {
      Check(ConvertStringSidToSid(sid,out value),"Convert owned token SID");
      if(kind==25){int header=Marshal.SizeOf(typeof(SidAttrs)),sidLength=(int)GetLengthSid(value);data=Marshal.AllocHGlobal(header+sidLength);byte[] sidBytes=new byte[sidLength];Marshal.Copy(value,sidBytes,0,sidLength);IntPtr embedded=IntPtr.Add(data,header);Marshal.Copy(sidBytes,0,embedded,sidLength);var label=new SidAttrs {Sid=embedded,Attributes=attributes};Marshal.StructureToPtr(label,data,false);Check(SetTokenInformation(token,kind,data,header+sidLength),"Set child medium integrity");}
      else {data=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(data,value);Check(SetTokenInformation(token,kind,data,IntPtr.Size),"Set child default owner to same user");}
    }finally{if(data!=IntPtr.Zero)Marshal.FreeHGlobal(data);if(value!=IntPtr.Zero)LocalFree(value);}
  }
  static bool AwaitEmptyJob(IntPtr job,int milliseconds) {
    var deadline=System.Diagnostics.Stopwatch.StartNew();
    do {JobAccounting accounting;Check(QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(JobAccounting)),IntPtr.Zero),"Read owned job process count");if(accounting.activeProcesses==0)return true;System.Threading.Thread.Sleep(50);}while(deadline.ElapsedMilliseconds<milliseconds);
    return false;
  }
  public static RunResult Run(string executable,string script,string config,string directory,int timeoutMs,Action<RunResult> checkpoint) {
    var result=new RunResult();IntPtr own=IntPtr.Zero,limited=IntPtr.Zero,job=IntPtr.Zero;ProcessInfo child=new ProcessInfo();bool assigned=false;
    try {
      Check(OpenProcessToken(GetCurrentProcess(),0x8B,out own),"Open caller token");
      result.parent=InspectToken(own,System.Diagnostics.Process.GetCurrentProcess().Id);checkpoint(result);
      if(result.parent.user_sid=="S-1-5-18"||result.parent.sandbox_inert)throw new InvalidOperationException("Refusing SYSTEM or inert caller token");
      bool alreadyStandard=result.parent.integrity_rid==0x2000&&!result.parent.elevated&&!result.parent.admin_enabled;
      if(alreadyStandard){ValidateStandard(result.parent,result.parent.user_sid);result.mode="already-standard-no-token-change";}
      else {
        if(result.parent.integrity_rid!=0x3000||!result.parent.elevated||!result.parent.admin_enabled)throw new InvalidOperationException("Unexpected host token; diagnose rather than force a workaround");
        // 0x1 DISABLE_MAX_PRIVILEGE + 0x4 LUA_TOKEN. NEVER 0x2 SANDBOX_INERT.
        Check(CreateRestrictedToken(own,0x5,0,IntPtr.Zero,0,IntPtr.Zero,0,IntPtr.Zero,out limited),"Create same-user least-privilege token");
        SetSid(limited,25,"S-1-16-8192",0x20);SetSid(limited,4,result.parent.user_sid,0);
        ValidateStandard(InspectToken(limited,0),result.parent.user_sid);result.mode="same-user-LUA-medium";
      }
      job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"Create owned child job");
      var limits=new ExtendedLimits();limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE; no breakaway or policy exemptions.
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))),"Set owned child teardown");
      var start=new Startup();start.cb=(uint)Marshal.SizeOf(typeof(Startup));start.desktop="winsta0\\default";
      var command=new StringBuilder(CommandLine(executable,script,config));uint flags=0x08000404; // NO_WINDOW (Node only), UNICODE_ENVIRONMENT, SUSPENDED
      Check(alreadyStandard?CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,false,flags,IntPtr.Zero,directory,ref start,out child):CreateProcessAsUser(limited,executable,command,IntPtr.Zero,IntPtr.Zero,false,flags,IntPtr.Zero,directory,ref start,out child),"Create verified standard child");
      Check(AssignProcessToJobObject(job,child.process),"Assign owned child tree");assigned=true;
      result.child=Inspect((int)child.processId);ValidateStandard(result.child,result.parent.user_sid);if(result.child.session_id!=result.parent.session_id)throw new InvalidOperationException("Child session must match parent");checkpoint(result);
      if(ResumeThread(child.thread)==UInt32.MaxValue)throw new Win32Exception(Marshal.GetLastWin32Error(),"Resume verified child");
      uint waited=WaitForSingleObject(child.process,(uint)timeoutMs);
      if(waited==258){result.timed_out=true;throw new TimeoutException("Standard child exceeded its bounded wait; owned job will close");}
      if(waited!=0)throw new Win32Exception(Marshal.GetLastWin32Error(),"Wait for owned child");
      uint code;Check(GetExitCodeProcess(child.process,out code),"Read owned child exit");result.exit_code=unchecked((int)code);result.exited=true;result.job_tree_empty=AwaitEmptyJob(job,10000);if(!result.job_tree_empty)throw new InvalidOperationException("Owned child tree remained after normal Node exit");return result;
    } finally {
      if(child.process!=IntPtr.Zero&&!assigned)TerminateProcess(child.process,1);
      if(job!=IntPtr.Zero){
        if(!result.job_tree_empty){try {Check(TerminateJobObject(job,1),"Terminate failed owned child job");result.failure_cleanup_tree_empty=AwaitEmptyJob(job,10000);}catch(Exception error){result.failure_cleanup_error=error.Message;}}
        result.job_handle_closed=CloseHandle(job);
      }
      if(child.thread!=IntPtr.Zero)CloseHandle(child.thread);if(child.process!=IntPtr.Zero)CloseHandle(child.process);
      if(limited!=IntPtr.Zero)CloseHandle(limited);if(own!=IntPtr.Zero)CloseHandle(own);checkpoint(result);
    }
  }
}
