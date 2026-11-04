# Shared helpers for the bus helper tests. Dot-source from BeforeAll.
# The mutex Local\ClaudeSessionHubBus is global to the logon session: tests using it must not
# run in parallel with each other or with a real Session Hub.

$script:BusScript = (Resolve-Path (Join-Path $PSScriptRoot '..\bin\bus.ps1')).Path
$script:MutexName = 'Local\ClaudeSessionHubBus'

function ConvertTo-Base64Utf8 {
    param([Parameter(Mandatory)][string]$Text)
    [Convert]::ToBase64String((New-Object System.Text.UTF8Encoding($false)).GetBytes($Text))
}

function New-TempBusDir {
    $dir = Join-Path ([IO.Path]::GetTempPath()) ('bus-test-' + [guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $dir)
    $dir
}

function Start-Ps51 {
    # Starts powershell.exe (5.1) with redirected output; returns the Process.
    param([Parameter(Mandatory)][string]$Arguments)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'powershell.exe'
    $psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass $Arguments"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    [System.Diagnostics.Process]::Start($psi)
}

function Invoke-BusAppendProcess {
    # Runs `bus.ps1 append` under powershell.exe 5.1 and returns ExitCode/StdOut/StdErr/ElapsedMs.
    param([Parameter(Mandatory)][string]$Path, [string]$LineBase64)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Ps51 "-File `"$script:BusScript`" append -Path `"$Path`" -LineBase64 `"$LineBase64`""
    $out = $p.StandardOutput.ReadToEndAsync()
    $err = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    $sw.Stop()
    [pscustomobject]@{
        ExitCode  = $p.ExitCode
        StdOut    = $out.Result
        StdErr    = $err.Result
        ElapsedMs = $sw.ElapsedMilliseconds
    }
}

function Start-MutexHolder {
    # Child powershell.exe that takes the bus mutex, prints "held", then sleeps. Returns once held.
    param([int]$Seconds = 30)
    $code = "`$m = New-Object System.Threading.Mutex(`$false, '$script:MutexName'); " +
        "[void]`$m.WaitOne(); [Console]::Out.WriteLine('held'); [Console]::Out.Flush(); " +
        "Start-Sleep -Seconds $Seconds"
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    $p = Start-Ps51 "-EncodedCommand $enc"
    $first = $p.StandardOutput.ReadLine()
    if ($first -ne 'held') {
        try { $p.Kill() } catch { }
        throw "mutex holder did not report 'held' (got '$first')"
    }
    $p
}

function Start-AppendLoop {
    # Child powershell.exe that calls bus.ps1 append $Count times with ids p<proc>-<n>.
    # Exit code = number of failed appends.
    param([Parameter(Mandatory)][string]$Path, [int]$Proc, [int]$Count)
    $code = @"
`$f = 0
for (`$n = 1; `$n -le $Count; `$n++) {
    `$j = '{"id":"p$Proc-' + `$n + '"}'
    `$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$j))
    & '$script:BusScript' append -Path '$Path' -LineBase64 `$b
    if (`$LASTEXITCODE -ne 0) { `$f++ }
}
exit `$f
"@
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    Start-Ps51 "-EncodedCommand $enc"
}

# ---- tail helpers --------------------------------------------------------------------------------

if (-not ('BusTestNative' -as [type])) {
    # Independent re-implementation of the NTFS file id, so the tests cross-check bus.ps1's format.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class BusTestNative
{
    [StructLayout(LayoutKind.Sequential)] struct FT { public uint L; public uint H; }
    [StructLayout(LayoutKind.Sequential)]
    struct INFO { public uint A; public FT C; public FT X; public FT W; public uint Vol; public uint SH; public uint SL; public uint Links; public uint IH; public uint IL; }
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetFileInformationByHandle(SafeFileHandle h, out INFO i);
    public static string FileId(SafeFileHandle h)
    {
        INFO i; if (!GetFileInformationByHandle(h, out i)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return string.Format("{0:x8}-{1:x8}{2:x8}", i.Vol, i.IH, i.IL);
    }
}
'@
}

function Get-TestFileId {
    param([Parameter(Mandatory)][string]$Path)
    $fs = New-Object System.IO.FileStream($Path, 'Open', 'Read', 'ReadWrite,Delete')
    try { [BusTestNative]::FileId($fs.SafeFileHandle) } finally { $fs.Dispose() }
}

function Add-BusRaw {
    # Appends text as UTF-8 in one write, sharing the file with the tail; creates the folder/file.
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Text)
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($Text)
    $fs = New-Object System.IO.FileStream($Path, 'Append', 'Write', 'ReadWrite,Delete')
    try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Dispose() }
}

function Start-BusTail {
    # Starts `bus.ps1 tail` under powershell.exe 5.1; stdout is read asynchronously by Update-BusTail.
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$From)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'powershell.exe'
    $psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script:BusScript`" tail -Path `"$Path`" -From `"$From`""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    [pscustomobject]@{
        Process = $p
        Lines   = New-Object 'System.Collections.Generic.List[string]'
        Pending = $null
        Eof     = $false
        StdErr  = $p.StandardError.ReadToEndAsync()
    }
}

function Update-BusTail {
    param([Parameter(Mandatory)]$Tail)
    while (-not $Tail.Eof) {
        if ($null -eq $Tail.Pending) { $Tail.Pending = $Tail.Process.StandardOutput.ReadLineAsync() }
        if (-not $Tail.Pending.IsCompleted) { return }
        $l = $Tail.Pending.Result
        $Tail.Pending = $null
        if ($null -eq $l) { $Tail.Eof = $true } else { $Tail.Lines.Add($l) }
    }
}

function Wait-BusTail {
    # Polls until the scriptblock (given $Tail) is true or the timeout passes. Returns $true/$false.
    param([Parameter(Mandatory)]$Tail, [Parameter(Mandatory)][scriptblock]$Until, [int]$TimeoutMs = 5000)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    do {
        Update-BusTail $Tail
        if (& $Until $Tail) { return $true }
        Start-Sleep -Milliseconds 25
    } while ($sw.ElapsedMilliseconds -lt $TimeoutMs)
    Update-BusTail $Tail
    [bool](& $Until $Tail)
}

function Get-BusTailBusLines { param($Tail) @($Tail.Lines | Where-Object { $_ -notlike '#pos *' }) }
function Get-BusTailPosLines { param($Tail) @($Tail.Lines | Where-Object { $_ -like '#pos *' }) }

function Stop-BusTail {
    param($Tail)
    if ($null -eq $Tail) { return }
    try { if (-not $Tail.Process.HasExited) { $Tail.Process.Kill() } } catch { }
    try { [void]$Tail.Process.WaitForExit(5000) } catch { }
    $Tail.Process.Dispose()
}
