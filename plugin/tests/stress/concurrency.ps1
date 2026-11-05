<#
.SYNOPSIS
    Concurrency proof for the Session Hub bus (F-017, NFR-003, ADR-006).

.DESCRIPTION
    Per iteration, in a fresh temp bus dir: starts -Listeners real `bus.ps1 tail` processes, then
    -Writers separate powershell.exe 5.1 processes that each call `bus.ps1 append` -Lines times
    (real mutex, real file), released together by a go-file. One `bus.ps1 clear` runs once about half
    the lines are on disk. Afterwards every listener must have printed every line exactly once, in
    file order (archive lines, then live-file lines), none torn, none lost around the clear.

    Runs under Windows PowerShell 5.1 and pwsh. Takes the bus mutex: do not run next to a real hub.
    Exit 0 when every iteration passes, 1 otherwise.

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File plugin/tests/stress/concurrency.ps1
#>
[CmdletBinding()]
param(
    [int]$Iterations = 10,
    [int]$Writers = 5,
    [int]$Lines = 200,
    [int]$Listeners = 3,
    [int]$TimeoutSec = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\helpers.ps1')

$utf8 = New-Object System.Text.UTF8Encoding($false)

function Get-ExpectedPad {
    param([int]$W, [int]$S)
    # Varying length, plus a 2-byte and a 4-byte UTF-8 character, so a torn read shows.
    ('x' * (40 + (($S * 7 + $W * 13) % 200))) + [string][char]0xE9 + [char]::ConvertFromUtf32(0x1F600) + "end$W-$S"
}

function Start-StressWriter {
    param([int]$W, [string]$Bus, [string]$Dir, [int]$Count)
    $code = @"
`$ErrorActionPreference = 'Stop'
`$f = 0
`$sfx = [string][char]0xE9 + [char]::ConvertFromUtf32(0x1F600)
New-Item -ItemType File -Path '$Dir\ready-$W' | Out-Null
while (-not (Test-Path -LiteralPath '$Dir\go')) { Start-Sleep -Milliseconds 2 }
for (`$s = 1; `$s -le $Count; `$s++) {
    `$pad = ('x' * (40 + ((`$s * 7 + $W * 13) % 200))) + `$sfx + "end$W-`$s"
    `$j = '{"w":$W,"s":' + `$s + ',"pad":"' + `$pad + '"}'
    `$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$j))
    & '$script:BusScript' append -Path '$Bus' -LineBase64 `$b
    if (`$LASTEXITCODE -ne 0) { `$f++ }
}
exit `$f
"@
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    $p = Start-Ps51 "-EncodedCommand $enc"
    [pscustomobject]@{ Process = $p; Out = $p.StandardOutput.ReadToEndAsync(); Err = $p.StandardError.ReadToEndAsync() }
}

function Get-FileLineCount {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    $fs = New-Object System.IO.FileStream($Path, 'Open', 'Read', 'ReadWrite,Delete')
    try {
        $buf = New-Object byte[] ([int]$fs.Length)
        $got = 0
        while ($got -lt $buf.Length) { $n = $fs.Read($buf, $got, $buf.Length - $got); if ($n -le 0) { break }; $got += $n }
        $c = 0
        for ($i = 0; $i -lt $got; $i++) { if ($buf[$i] -eq 10) { $c++ } }
        $c
    }
    finally { $fs.Dispose() }
}

function Read-WholeLines {
    # Returns the lines of a file; notes a problem when it is not made of complete LF lines.
    param([string]$Path, $Problems)
    $text = [IO.File]::ReadAllText($Path, $utf8)
    if ($text.Length -eq 0) { return @() }
    if (-not $text.EndsWith("`n")) { $Problems.Add("$Path does not end in LF (half-written line)") }
    if ($text.Contains("`r")) { $Problems.Add("$Path contains CR") }
    $parts = $text.Split([char]10)
    @($parts[0..($parts.Length - 2)])
}

function Invoke-Iteration {
    param([int]$Index)
    $total = $Writers * $Lines
    $problems = New-Object 'System.Collections.Generic.List[string]'
    $dir = New-TempBusDir
    $bus = Join-Path $dir 'hub\bus.jsonl'
    $tails = @()
    $writerProcs = @()
    try {
        [void](New-Item -ItemType Directory -Path (Split-Path -Parent $bus))
        [IO.File]::WriteAllBytes($bus, [byte[]]@())

        for ($k = 0; $k -lt $Listeners; $k++) { $tails += Start-BusTail -Path $bus -From 'end' }
        $deadline = [Diagnostics.Stopwatch]::StartNew()
        foreach ($t in $tails) {
            if (-not (Wait-BusTail $t { param($x) @(Get-BusTailPosLines $x).Count -ge 1 } 30000)) { throw 'a listener never reported #pos' }
        }

        for ($w = 1; $w -le $Writers; $w++) { $writerProcs += Start-StressWriter $w $bus $dir $Lines }
        $ready = $false
        while ($deadline.Elapsed.TotalSeconds -lt $TimeoutSec) {
            if (@(Get-ChildItem -LiteralPath $dir -Filter 'ready-*').Count -ge $Writers) { $ready = $true; break }
            Start-Sleep -Milliseconds 50
        }
        if (-not $ready) { throw 'writers did not all become ready' }
        [void](New-Item -ItemType File -Path (Join-Path $dir 'go'))

        # Keep draining listener stdout. powershell.exe takes ~0.5 s to start, so the clear is launched at a quarter to land near half way.
        $cleared = $false
        $clearProc = $null
        $clearErr = $null
        while (@($writerProcs | Where-Object { -not $_.Process.HasExited }).Count -gt 0) {
            foreach ($t in $tails) { Update-BusTail $t }
            if (-not $cleared -and (Get-FileLineCount $bus) -ge [int]($total / 4)) {
                $cleared = $true
                $clearProc = Start-Ps51 "-File `"$script:BusScript`" clear -Path `"$bus`""
                $null = $clearProc.StandardOutput.ReadToEndAsync()
                $clearErr = $clearProc.StandardError.ReadToEndAsync()
            }
            if ($deadline.Elapsed.TotalSeconds -gt $TimeoutSec) { throw 'timed out waiting for writers' }
            Start-Sleep -Milliseconds 20
        }
        if (-not $cleared) { $problems.Add('writers finished before the clear could fire (no mid-run clear)') }
        else {
            [void]$clearProc.WaitForExit(30000)
            if ($clearProc.ExitCode -ne 0) { $problems.Add("clear exited $($clearProc.ExitCode): $($clearErr.Result)") }
        }
        for ($w = 0; $w -lt $writerProcs.Count; $w++) {
            $wp = $writerProcs[$w]
            if ($wp.Process.ExitCode -ne 0) { $problems.Add("writer $($w + 1) exit $($wp.Process.ExitCode) (failed appends); stderr: $($wp.Err.Result) stdout: $($wp.Out.Result)") }
        }

        # Truth from the files: archive(s) in name order, then the live file.
        $expected = New-Object 'System.Collections.Generic.List[string]'
        $archiveDir = Join-Path (Split-Path -Parent $bus) 'archive'
        $archives = @()
        if (Test-Path -LiteralPath $archiveDir) { $archives = @(Get-ChildItem -LiteralPath $archiveDir -Filter 'bus-*.jsonl' | Sort-Object Name) }
        if ($archives.Count -ne 1) { $problems.Add("expected 1 archive, found $($archives.Count)") }
        $archiveLines = 0
        foreach ($a in $archives) {
            $l = @(Read-WholeLines $a.FullName $problems)
            $archiveLines += $l.Count
            if ($l.Count -gt 0) { $expected.AddRange([string[]]$l) }
        }
        $live = @(Read-WholeLines $bus $problems)
        if ($live.Count -gt 0) { $expected.AddRange([string[]]$live) }
        if ($archiveLines -eq 0 -or $live.Count -eq 0) { $problems.Add("clear was not mid-run (archive $archiveLines lines, live $($live.Count))") }
        if ($expected.Count -ne $total) { $problems.Add("files hold $($expected.Count) lines, expected $total") }
        $script:LastArchiveLines = $archiveLines

        # Each file line: valid JSON, unique (w,s), correct pad, per-writer seq increasing.
        $seen = @{}
        $lastSeq = @{}
        foreach ($line in $expected) {
            try { $o = $line | ConvertFrom-Json } catch { $problems.Add("file line not JSON (torn): $line"); continue }
            $key = "$($o.w):$($o.s)"
            if ($seen.ContainsKey($key)) { $problems.Add("file duplicate $key") }
            $seen[$key] = $true
            if ($o.pad -ne (Get-ExpectedPad $o.w $o.s)) { $problems.Add("file line $key has a corrupt pad") }
            if ($lastSeq.ContainsKey([int]$o.w) -and $o.s -le $lastSeq[[int]$o.w]) { $problems.Add("file writer $($o.w) seq $($o.s) not after $($lastSeq[[int]$o.w])") }
            $lastSeq[[int]$o.w] = $o.s
        }
        for ($w = 1; $w -le $Writers; $w++) { for ($s = 1; $s -le $Lines; $s++) { if (-not $seen.ContainsKey("${w}:$s")) { $problems.Add("file missing ${w}:$s") } } }

        # Listeners: wait for all lines, then a grace period (> 2 polls) to catch duplicates.
        foreach ($t in $tails) {
            $ok = Wait-BusTail $t { param($x) @(Get-BusTailBusLines $x).Count -ge $total } ($TimeoutSec * 1000)
            if (-not $ok) { $problems.Add("listener timed out with $(@(Get-BusTailBusLines $t).Count)/$total lines") }
        }
        $graceEnd = [DateTime]::UtcNow.AddMilliseconds(2500)
        while ([DateTime]::UtcNow -lt $graceEnd) {
            foreach ($t in $tails) { Update-BusTail $t }
            Start-Sleep -Milliseconds 25
        }
        foreach ($t in $tails) { Update-BusTail $t }

        for ($k = 0; $k -lt $tails.Count; $k++) {
            $got = @(Get-BusTailBusLines $tails[$k])
            $tag = "listener $($k + 1)"
            $before = $problems.Count
            if ($got.Count -ne $total) { $problems.Add("$tag printed $($got.Count) data lines, expected $total") }
            $lseen = @{}
            $lLast = @{}
            foreach ($line in $got) {
                try { $o = $line | ConvertFrom-Json } catch { $problems.Add("$tag torn/non-JSON line: $line"); continue }
                $key = "$($o.w):$($o.s)"
                if ($lseen.ContainsKey($key)) { $problems.Add("$tag duplicate $key") }
                $lseen[$key] = $true
                if ($lLast.ContainsKey([int]$o.w) -and $o.s -le $lLast[[int]$o.w]) { $problems.Add("$tag writer $($o.w) seq $($o.s) after $($lLast[[int]$o.w])") }
                $lLast[[int]$o.w] = $o.s
            }
            for ($w = 1; $w -le $Writers; $w++) { for ($s = 1; $s -le $Lines; $s++) { if (-not $lseen.ContainsKey("${w}:$s")) { $problems.Add("$tag missing ${w}:$s") } } }
            $n = [Math]::Min($got.Count, $expected.Count)
            for ($i = 0; $i -lt $n; $i++) {
                if ($got[$i] -cne $expected[$i]) { $problems.Add("$tag differs from file order at line $($i + 1)"); break }
            }
            if ($problems.Count -gt $before) {
                $p = $tails[$k].Process
                try { if (-not $p.HasExited) { $p.Kill() } } catch { }
                try { [void]$p.WaitForExit(5000) } catch { }
                $err = $tails[$k].StdErr.Result
                if ($err) { $problems.Add("$tag stderr: $err") }
            }
        }
    }
    catch {
        $problems.Add("harness error: $($_.Exception.Message)")
    }
    finally {
        foreach ($t in $tails) { Stop-BusTail $t }
        foreach ($wp in $writerProcs) { try { if (-not $wp.Process.HasExited) { $wp.Process.Kill() } } catch { } }
        Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
    , $problems
}

$script:LastArchiveLines = 0
$failed = 0
$all = [Diagnostics.Stopwatch]::StartNew()
for ($i = 1; $i -le $Iterations; $i++) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $problems = Invoke-Iteration $i
    $sw.Stop()
    $secs = [Math]::Round($sw.Elapsed.TotalSeconds, 1)
    if ($problems.Count -eq 0) {
        Write-Output ("Iteration {0}/{1}: PASS ({2} writers x {3} lines, {4} listeners, clear at {5} lines, {6}s)" -f $i, $Iterations, $Writers, $Lines, $Listeners, $script:LastArchiveLines, $secs)
    }
    else {
        $failed++
        Write-Output ("Iteration {0}/{1}: FAIL ({2} problems, {3}s)" -f $i, $Iterations, $problems.Count, $secs)
        foreach ($p in ($problems | Select-Object -First 15)) { Write-Output "    $p" }
    }
}
$all.Stop()
Write-Output ("Summary: {0}/{1} iterations passed, total {2}s" -f ($Iterations - $failed), $Iterations, [Math]::Round($all.Elapsed.TotalSeconds, 1))
if ($failed -gt 0) { exit 1 }
exit 0
