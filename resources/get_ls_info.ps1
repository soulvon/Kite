Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;

public class ProcEnv {
    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr h, int c, ref PBI p, int s, out int l);
    [DllImport("kernel32.dll")]
    static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, int s, out int r);

    [StructLayout(LayoutKind.Sequential)]
    public struct PBI {
        public IntPtr R1;
        public IntPtr Peb;
        public IntPtr R2a, R2b, Pid, R3;
    }

    public static string GetEnv(int pid, string name) {
        var proc = Process.GetProcessById(pid);
        IntPtr h = proc.Handle;
        var pbi = new PBI();
        int l;
        NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out l);
        byte[] pb = new byte[0x30];
        int r;
        ReadProcessMemory(h, pbi.Peb, pb, pb.Length, out r);
        IntPtr pp = (IntPtr)BitConverter.ToInt64(pb, 0x20);
        byte[] prm = new byte[0x90];
        ReadProcessMemory(h, pp, prm, prm.Length, out r);
        IntPtr ep = (IntPtr)BitConverter.ToInt64(prm, 0x80);
        byte[] eb = new byte[65536];
        ReadProcessMemory(h, ep, eb, eb.Length, out r);
        string es = Encoding.Unicode.GetString(eb);
        foreach (string ln in es.Split('\0')) {
            if (ln.StartsWith(name + "=")) {
                return ln.Substring(name.Length + 1);
            }
        }
        return "";
    }
}
"@

Get-CimInstance Win32_Process -Filter "name='language_server_windows_x64.exe'" | ForEach-Object {
    $pid2 = $_.ProcessId
    $cmd = $_.CommandLine
    $csrf = [ProcEnv]::GetEnv($pid2, "WINDSURF_CSRF_TOKEN")
    if (-not $csrf) { return }
    $extPort = ""
    if ($cmd -match '--extension_server_port\s+(\d+)') { $extPort = $Matches[1] }
    $ver = "2.2.17"
    if ($cmd -match '--windsurf_version\s+([\d.]+)') { $ver = $Matches[1] }
    $ports = @()
    netstat -ano 2>$null | Select-String "LISTENING" | Select-String "$pid2" | ForEach-Object {
        if ($_ -match ':(\d+)\s') {
            $p = $Matches[1]
            if ($p -ne $extPort) { $ports += $p }
        }
    }
    foreach ($p in $ports) {
        Write-Host "$p|$csrf|$ver"
    }
}
