<#
.SYNOPSIS
    Session Hub bus helper. Every write to the shared bus.jsonl goes through this script.

.DESCRIPTION
    Windows PowerShell 5.1 compatible. Verbs are dispatched at the bottom of the file;
    add a new verb by writing a Invoke-Bus<Verb> function and one entry in $verbs.

    append -Path <bus file> -LineBase64 <base64 of the UTF-8 bytes of one JSON line, no trailing newline>
        Takes the named mutex Local\ClaudeSessionHubBus (waits up to 2 s), creates the folder and
        file if missing, and appends the line plus "\n" in a single write (ADR-006).
        Exit 0 and no stdout on success; non-zero with a message on stderr otherwise.

    tail -Path <bus file> -From <fileid>:<offset>|end
        Polls about once a second, takes no lock, uses no change notifications, and runs until
        killed. Prints each complete new line verbatim (UTF-8, LF-terminated) and never moves its
        offset past an unfinished line. Also prints "#pos <fileid>:<offset>" at start and after each
        batch so the caller can store where it is. <fileid> is the NTFS file identity as
        <volserial>-<indexhigh><indexlow> (hex). "end" starts at the current end of the file (0 if it
        does not exist yet). A different file id, or a size below the offset, warns on stderr and
        restarts the current file at 0. Bad -From: exit 2.
        Following a clear (F-014): when the file id differs from the one being read, the archive in
        archive\bus-*.jsonl whose file id equals the old id is read from the stored offset to its end
        (complete lines only; an unfinished last line is skipped with a warning), then any later
        archives from 0, then the live file from 0 with a "#pos <newid>:0". With no such archive it
        warns and restarts at 0. The same applies to a -From whose id has since been archived.

    clear -Path <bus file>
        Takes the bus mutex (same wait and exit 3 as append), moves the bus file to
        archive\bus-<UTC yyyyMMddTHHmmssfffZ>.jsonl beside it, starts an empty bus file, and prints the
        archive path. A missing bus file is just created (nothing printed). Exit 1 I/O, 2 bad input,
        3 mutex timeout (nothing changed).

    last -Path <bus file> -Count <n>
        Read-only, takes no lock (readers never lock, ADR-006). Reads backwards from the end of the
        file in 64 KiB chunks, so a log of any size costs only its last lines, and prints the last
        <n> complete lines verbatim (UTF-8, LF-terminated), oldest first. An unfinished final line is
        never printed. A missing file prints nothing and exits 0. A -Count that is not a positive
        integer: exit 2.

.EXAMPLE
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File bus.ps1 append -Path C:\x\bus.jsonl -LineBase64 eyJhIjoxfQ==
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Verb,
    [string]$Path,
    [string]$LineBase64,
    [string]$From,
    [string]$Count
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:MutexName = 'Local\ClaudeSessionHubBus'
$script:MutexWaitMs = 2000

function Write-BusError {
    param([string]$Message)
    [Console]::Error.WriteLine("bus.ps1: $Message")
}

function Invoke-BusAppend {
    param([string]$Path, [string]$LineBase64)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        Write-BusError 'append: -Path is required.'
        return 2
    }
    if ([string]::IsNullOrEmpty($LineBase64)) {
        Write-BusError 'append: -LineBase64 is required and must not be empty.'
        return 2
    }

    try {
        $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
        $lineBytes = [Convert]::FromBase64String($LineBase64)
        $line = $strictUtf8.GetString($lineBytes)
    }
    catch {
        Write-BusError 'append: -LineBase64 is not valid base64 of UTF-8 text.'
        return 2
    }
    if ($line.Length -eq 0) {
        Write-BusError 'append: the decoded line is empty.'
        return 2
    }
    if ($line.IndexOf("`n") -ge 0 -or $line.IndexOf("`r") -ge 0) {
        Write-BusError 'append: the decoded line contains a newline; one JSON line only.'
        return 2
    }

    # One buffer, one Write call: the line's bytes plus "\n".
    $payload = New-Object byte[] ($lineBytes.Length + 1)
    [Array]::Copy($lineBytes, $payload, $lineBytes.Length)
    $payload[$lineBytes.Length] = 10

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $mutex = New-Object System.Threading.Mutex($false, $script:MutexName)
    $acquired = $false
    try {
        try {
            $acquired = $mutex.WaitOne($script:MutexWaitMs)
        }
        catch {
            $ex = $_.Exception
            if ($ex -is [System.Threading.AbandonedMutexException] -or
                $ex.InnerException -is [System.Threading.AbandonedMutexException]) {
                # The previous holder died; we own the mutex now.
                $acquired = $true
            }
            else {
                throw
            }
        }
        if (-not $acquired) {
            Write-BusError "append: timed out after $($script:MutexWaitMs) ms waiting for mutex $($script:MutexName); nothing written."
            return 3
        }

        $dir = [System.IO.Path]::GetDirectoryName($fullPath)
        if ($dir -and -not (Test-Path -LiteralPath $dir)) {
            [void](New-Item -ItemType Directory -Path $dir -Force)
        }
        $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
        $stream = New-Object System.IO.FileStream($fullPath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, $share)
        try {
            $stream.Write($payload, 0, $payload.Length)
            $stream.Flush($true)
        }
        finally {
            $stream.Dispose()
        }
        return 0
    }
    catch {
        Write-BusError "append: $($_.Exception.Message)"
        return 1
    }
    finally {
        if ($acquired) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Initialize-BusNative {
    if ('BusNative' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class BusNative
{
    [StructLayout(LayoutKind.Sequential)]
    struct FILETIME { public uint Low; public uint High; }

    [StructLayout(LayoutKind.Sequential)]
    struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public FILETIME CreationTime;
        public FILETIME LastAccessTime;
        public FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle, out BY_HANDLE_FILE_INFORMATION info);

    // NTFS file identity as one token without ':' : <volserial>-<indexhigh><indexlow>, hex.
    public static string FileId(SafeFileHandle handle)
    {
        BY_HANDLE_FILE_INFORMATION i;
        if (!GetFileInformationByHandle(handle, out i))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return string.Format("{0:x8}-{1:x8}{2:x8}", i.VolumeSerialNumber, i.FileIndexHigh, i.FileIndexLow);
    }

    // Index of the last LF in buffer[0..count), or -1.
    public static int LastLf(byte[] buffer, int count)
    {
        for (int k = count - 1; k >= 0; k--) { if (buffer[k] == 10) return k; }
        return -1;
    }

    public static int CountLf(byte[] buffer, int count)
    {
        int n = 0;
        for (int k = 0; k < count; k++) { if (buffer[k] == 10) n++; }
        return n;
    }
}
'@
}

function Invoke-BusClear {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        Write-BusError 'clear: -Path is required.'
        return 2
    }

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $mutex = New-Object System.Threading.Mutex($false, $script:MutexName)
    $acquired = $false
    try {
        try {
            $acquired = $mutex.WaitOne($script:MutexWaitMs)
        }
        catch {
            $ex = $_.Exception
            if ($ex -is [System.Threading.AbandonedMutexException] -or
                $ex.InnerException -is [System.Threading.AbandonedMutexException]) {
                $acquired = $true
            }
            else {
                throw
            }
        }
        if (-not $acquired) {
            Write-BusError "clear: timed out after $($script:MutexWaitMs) ms waiting for mutex $($script:MutexName); nothing changed."
            return 3
        }

        $dir = [System.IO.Path]::GetDirectoryName($fullPath)
        if ($dir -and -not (Test-Path -LiteralPath $dir)) {
            [void](New-Item -ItemType Directory -Path $dir -Force)
        }

        $archived = $null
        if ([System.IO.File]::Exists($fullPath)) {
            $archiveDir = Join-Path $dir 'archive'
            if (-not (Test-Path -LiteralPath $archiveDir)) {
                [void](New-Item -ItemType Directory -Path $archiveDir -Force)
            }
            # Names sort by time, so a taken name moves on by a millisecond rather than gaining a suffix.
            $stamp = [DateTime]::UtcNow
            do {
                $archived = Join-Path $archiveDir ('bus-' + $stamp.ToString('yyyyMMdd\THHmmssfff\Z') + '.jsonl')
                $stamp = $stamp.AddMilliseconds(1)
            } while ([System.IO.File]::Exists($archived))
            [System.IO.File]::Move($fullPath, $archived)
        }

        $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
        $stream = New-Object System.IO.FileStream($fullPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, $share)
        $stream.Dispose()

        if ($archived) { [Console]::Out.WriteLine($archived); [Console]::Out.Flush() }
        return 0
    }
    catch {
        Write-BusError "clear: $($_.Exception.Message)"
        return 1
    }
    finally {
        if ($acquired) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

# Prints the complete lines of $Stream from $Offset to its current end; returns the new offset.
# An unfinished final line is left unread (the caller decides what that means).
function Read-BusLines {
    param($Stream, [long]$Offset, $Writer, $Utf8)

    $length = $Stream.Length
    while ($Offset -lt $length) {
        $want = [int][Math]::Min([long]$script:ReadBuffer.Length, $length - $Offset)
        [void]$Stream.Seek($Offset, [System.IO.SeekOrigin]::Begin)
        $got = 0
        while ($got -lt $want) {
            $n = $Stream.Read($script:ReadBuffer, $got, $want - $got)
            if ($n -le 0) { break }
            $got += $n
        }
        $lastLf = [BusNative]::LastLf($script:ReadBuffer, $got)
        if ($lastLf -lt 0) {
            if ($got -eq $script:ReadBuffer.Length -and $got -lt ($length - $Offset)) {
                # A single line longer than the buffer: grow it and re-read.
                $script:ReadBuffer = New-Object byte[] ($script:ReadBuffer.Length * 2)
                continue
            }
            break   # unfinished line
        }
        $Writer.Write($Utf8.GetString($script:ReadBuffer, 0, $lastLf + 1))
        $Offset += $lastLf + 1
    }
    return [long]$Offset
}

# After a clear: finds the archive whose file id is $OldId (a move keeps the id), reads it from
# $OldOffset to its end, then any archive made after it (several clears between two passes) from 0.
# $CurrentId is the live file, which is read by the caller and so is never drained here.
# Returns $false when no archive carries $OldId (nothing is printed then).
function Read-BusArchives {
    param([string]$FullPath, [string]$OldId, [long]$OldOffset, [string]$CurrentId, $Writer, $Utf8)

    $archiveDir = Join-Path ([System.IO.Path]::GetDirectoryName($FullPath)) 'archive'
    if (-not (Test-Path -LiteralPath $archiveDir)) { return $false }

    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $files = [System.IO.Directory]::GetFiles($archiveDir, 'bus-*.jsonl')
    [Array]::Sort($files, [System.StringComparer]::Ordinal)

    $start = -1
    for ($i = $files.Length - 1; $i -ge 0; $i--) {
        $fs = $null
        try {
            $fs = New-Object System.IO.FileStream($files[$i], [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share, 1)
            if ([BusNative]::FileId($fs.SafeFileHandle) -eq $OldId) { $start = $i }
        }
        catch [System.IO.IOException] { }
        finally { if ($null -ne $fs) { $fs.Dispose() } }
        if ($start -ge 0) { break }
    }
    if ($start -lt 0) { return $false }

    for ($i = $start; $i -lt $files.Length; $i++) {
        $fs = New-Object System.IO.FileStream($files[$i], [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share, 1)
        try {
            if ($i -gt $start -and [BusNative]::FileId($fs.SafeFileHandle) -eq $CurrentId) { continue }
            $from = if ($i -eq $start) { $OldOffset } else { 0L }
            $end = Read-BusLines $fs $from $Writer $Utf8
            if ($end -lt $fs.Length) {
                Write-BusError "tail: archive $($files[$i]) ends in an unfinished line ($($fs.Length - $end) bytes); skipped."
            }
        }
        finally {
            $fs.Dispose()
        }
    }
    return $true
}

function Invoke-BusTail {
    param([string]$Path, [string]$From)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        Write-BusError 'tail: -Path is required.'
        return 2
    }
    if ([string]::IsNullOrWhiteSpace($From)) {
        Write-BusError "tail: -From is required (<fileid>:<offset> or 'end')."
        return 2
    }

    $fromEnd = $false
    $fromId = $null
    $fromOffset = 0L
    if ($From -ceq 'end') {
        $fromEnd = $true
    }
    else {
        $colon = $From.LastIndexOf(':')
        $parsed = 0L
        $numberOk = $false
        if ($colon -gt 0) {
            $numberOk = [long]::TryParse($From.Substring($colon + 1), [System.Globalization.NumberStyles]::None,
                [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)
        }
        if ($colon -lt 1 -or -not $numberOk -or $From.Substring(0, $colon) -notmatch '^[0-9A-Fa-f]+-[0-9A-Fa-f]+$') {
            Write-BusError "tail: bad -From '$From'; expected <fileid>:<offset> (fileid like 0123abcd-00010000000000ff, offset a non-negative integer) or 'end'."
            return 2
        }
        $fromId = $From.Substring(0, $colon)
        $fromOffset = $parsed
    }

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    Initialize-BusNative
    try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
    $writer = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding($false)), 65536)
    $writer.NewLine = "`n"
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $utf8 = New-Object System.Text.UTF8Encoding($false)

    $id = $null
    $offset = 0L
    $started = $false
    $missedAtStart = $false
    $script:ReadBuffer = New-Object byte[] 1048576

    try {
        while ($true) {
            # Open per pass and close again: never holds the file, so appends and a rename are not blocked.
            $fs = $null
            try {
                $fs = New-Object System.IO.FileStream($fullPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share, 1)
            }
            catch [System.IO.IOException] {
                $fs = $null
                # Only an absent file means "created after we started"; a sharing violation just retries.
                if (-not $started -and -not [System.IO.File]::Exists($fullPath)) { $missedAtStart = $true }
            }

            if ($null -ne $fs) {
                try {
                    $actualId = [BusNative]::FileId($fs.SafeFileHandle)
                    $length = $fs.Length
                    $emitPos = $false

                    if (-not $started) {
                        $started = $true
                        $emitPos = $true
                        $id = $actualId
                        if ($fromEnd) {
                            # A file that did not exist when we started is read from its first byte.
                            $offset = if ($missedAtStart) { 0L } else { $length }
                        }
                        elseif ($actualId -ne $fromId) {
                            # A restored position can point at a file that a clear has since archived.
                            if (-not (Read-BusArchives $fullPath $fromId $fromOffset $actualId $writer $utf8)) {
                                Write-BusError "tail: file id is $actualId, expected $fromId; the file was replaced. Restarting at offset 0."
                            }
                        }
                        elseif ($length -lt $fromOffset) {
                            Write-BusError "tail: file is $length bytes, below offset $fromOffset; the file was cleared. Restarting at offset 0."
                        }
                        else {
                            $offset = $fromOffset
                        }
                    }
                    elseif ($actualId -ne $id -or $length -lt $offset) {
                        # F-014 / ADR-006: a clear moves the bus into archive\; its unread tail is read to
                        # its end before the new file is read from 0.
                        $followed = $false
                        if ($actualId -ne $id) {
                            $followed = Read-BusArchives $fullPath $id $offset $actualId $writer $utf8
                        }
                        if (-not $followed) {
                            Write-BusError "tail: file id or size changed (id $id -> $actualId, size $length, offset $offset). Restarting at offset 0."
                        }
                        $id = $actualId
                        $offset = 0L
                        $emitPos = $true
                    }

                    # The starting (or restarted) position is reported before anything is read.
                    if ($emitPos) { $writer.Write("#pos ${id}:$offset`n"); $writer.Flush() }

                    $startOffset = $offset
                    $offset = Read-BusLines $fs $offset $writer $utf8
                    if ($offset -ne $startOffset) { $writer.Write("#pos ${id}:$offset`n") }
                    $writer.Flush()
                }
                finally {
                    $fs.Dispose()
                }
            }
            Start-Sleep -Milliseconds 1000
        }
    }
    catch {
        Write-BusError "tail: $($_.Exception.Message)"
        return 1
    }
}

function Invoke-BusLast {
    param([string]$Path, [string]$Count)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        Write-BusError 'last: -Path is required.'
        return 2
    }
    $want = 0
    if (-not [int]::TryParse($Count, [System.Globalization.NumberStyles]::None,
            [System.Globalization.CultureInfo]::InvariantCulture, [ref]$want) -or $want -lt 1) {
        Write-BusError 'last: -Count is required and must be a positive integer.'
        return 2
    }

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not [System.IO.File]::Exists($fullPath)) { return 0 }

    Initialize-BusNative
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $chunkSize = 65536
    try {
        $fs = New-Object System.IO.FileStream($fullPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share, 1)
        try {
            $pos = $fs.Length
            $chunks = New-Object 'System.Collections.Generic.List[byte[]]'
            $lfs = 0
            # want + 1 line ends: the first line of a mid-file slice may be cut, and is dropped.
            while ($pos -gt 0 -and $lfs -lt ($want + 1)) {
                $size = [int][Math]::Min([long]$chunkSize, $pos)
                $pos -= $size
                [void]$fs.Seek($pos, [System.IO.SeekOrigin]::Begin)
                $buf = New-Object byte[] $size
                $got = 0
                while ($got -lt $size) {
                    $n = $fs.Read($buf, $got, $size - $got)
                    if ($n -le 0) { break }
                    $got += $n
                }
                $chunks.Insert(0, $buf)
                $lfs += [BusNative]::CountLf($buf, $got)
            }
        }
        finally {
            $fs.Dispose()
        }

        $total = 0
        foreach ($c in $chunks) { $total += $c.Length }
        $all = New-Object byte[] $total
        $at = 0
        foreach ($c in $chunks) {
            [Buffer]::BlockCopy($c, 0, $all, $at, $c.Length)
            $at += $c.Length
        }

        $lastLf = [BusNative]::LastLf($all, $all.Length)
        if ($lastLf -lt 0) { return 0 }

        $parts = $utf8.GetString($all, 0, $lastLf + 1).Split([char]10)
        $lineCount = $parts.Length - 1
        $first = if ($pos -gt 0) { 1 } else { 0 }
        $first = [Math]::Max($first, $lineCount - $want)

        try { [Console]::OutputEncoding = $utf8 } catch { }
        $writer = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8, 65536)
        $writer.NewLine = "`n"
        for ($i = $first; $i -lt $lineCount; $i++) { $writer.Write($parts[$i] + "`n") }
        $writer.Flush()
        return 0
    }
    catch {
        Write-BusError "last: $($_.Exception.Message)"
        return 1
    }
}

$verbs = @{
    'append' = { Invoke-BusAppend -Path $Path -LineBase64 $LineBase64 }
    'clear'  = { Invoke-BusClear -Path $Path }
    'tail'   = { Invoke-BusTail -Path $Path -From $From }
    'last'   = { Invoke-BusLast -Path $Path -Count $Count }
}

if ([string]::IsNullOrEmpty($Verb) -or -not $verbs.ContainsKey($Verb)) {
    Write-BusError ("unknown or missing verb '$Verb'. Known verbs: " + (($verbs.Keys | Sort-Object) -join ', '))
    exit 2
}

$exitCode = & $verbs[$Verb]
exit ([int]$exitCode)
