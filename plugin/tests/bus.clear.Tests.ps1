# Pester 5+ tests for `bus.ps1 clear` and for `tail` following a clear (F-014, FR-014, ADR-006).
# clear takes the bus mutex: run serially and not while a real Session Hub runs.

BeforeAll {
    . (Join-Path $PSScriptRoot 'helpers.ps1')
    $script:Started = { param($t) (Get-BusTailPosLines $t).Count -ge 1 }

    function Invoke-BusClearProcess {
        param([Parameter(Mandatory)][string]$Path)
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $p = Start-Ps51 "-File `"$script:BusScript`" clear -Path `"$Path`""
        $out = $p.StandardOutput.ReadToEndAsync()
        $err = $p.StandardError.ReadToEndAsync()
        $p.WaitForExit()
        $sw.Stop()
        [pscustomobject]@{ ExitCode = $p.ExitCode; StdOut = $out.Result; StdErr = $err.Result; ElapsedMs = $sw.ElapsedMilliseconds }
    }
}

Describe 'bus.ps1 clear' {
    BeforeEach {
        $script:dir = New-TempBusDir
        $script:bus = Join-Path $script:dir 'hub\bus.jsonl'
        $script:tail = $null
    }
    AfterEach {
        Stop-BusTail $script:tail
        Remove-Item -LiteralPath $script:dir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'F-014 moves the bus to archive\bus-(UTC timestamp).jsonl with the same content and starts an empty bus' {
        $text = "{`"id`":`"a`"}`n{`"id`":`"b`"}`n"
        Add-BusRaw $script:bus $text
        $oldId = Get-TestFileId $script:bus

        $r = Invoke-BusClearProcess $script:bus
        $r.ExitCode | Should -Be 0
        $r.StdErr | Should -BeNullOrEmpty

        $archives = @(Get-ChildItem -LiteralPath (Join-Path $script:dir 'hub\archive') -Filter 'bus-*.jsonl')
        $archives.Count | Should -Be 1
        $archives[0].Name | Should -Match '^bus-\d{8}T\d{9}Z\.jsonl$'
        $r.StdOut.Trim() | Should -Be $archives[0].FullName
        [IO.File]::ReadAllText($archives[0].FullName) | Should -Be $text
        Get-TestFileId $archives[0].FullName | Should -Be $oldId
        (Test-Path -LiteralPath $script:bus) | Should -BeTrue
        (Get-Item -LiteralPath $script:bus).Length | Should -Be 0
        Get-TestFileId $script:bus | Should -Not -Be $oldId
    }

    It 'F-014 two clears in a row make two distinct archives' {
        Add-BusRaw $script:bus "{`"id`":`"a`"}`n"
        (Invoke-BusClearProcess $script:bus).ExitCode | Should -Be 0
        Add-BusRaw $script:bus "{`"id`":`"b`"}`n"
        (Invoke-BusClearProcess $script:bus).ExitCode | Should -Be 0
        @(Get-ChildItem -LiteralPath (Join-Path $script:dir 'hub\archive') -Filter 'bus-*.jsonl').Count | Should -Be 2
    }

    It 'F-014 a missing bus file is just created: nothing printed, no archive, exit 0' {
        $r = Invoke-BusClearProcess $script:bus
        $r.ExitCode | Should -Be 0
        $r.StdOut | Should -BeNullOrEmpty
        (Get-Item -LiteralPath $script:bus).Length | Should -Be 0
        (Test-Path -LiteralPath (Join-Path $script:dir 'hub\archive')) | Should -BeFalse
    }

    It 'F-014 a missing -Path is exit 2' {
        $p = Start-Ps51 "-File `"$script:BusScript`" clear"
        $null = $p.StandardOutput.ReadToEnd()
        $p.WaitForExit()
        $p.ExitCode | Should -Be 2
    }

    It 'F-014 waits for the mutex: exit 3 after about 2 s, and nothing moved' {
        $text = "{`"id`":`"a`"}`n"
        Add-BusRaw $script:bus $text
        $holder = Start-MutexHolder 30
        try {
            $r = Invoke-BusClearProcess $script:bus
            $r.ExitCode | Should -Be 3
            $r.ElapsedMs | Should -BeGreaterThan 1500
            [IO.File]::ReadAllText($script:bus) | Should -Be $text
            (Test-Path -LiteralPath (Join-Path $script:dir 'hub\archive')) | Should -BeFalse
        }
        finally {
            try { $holder.Kill() } catch { }
            $holder.WaitForExit()
        }
    }

    It 'F-014 moves the file while a reader holds it open with ReadWrite|Delete' {
        Add-BusRaw $script:bus "{`"id`":`"a`"}`n"
        $fs = New-Object System.IO.FileStream($script:bus, 'Open', 'Read', 'ReadWrite,Delete')
        try {
            (Invoke-BusClearProcess $script:bus).ExitCode | Should -Be 0
        }
        finally { $fs.Dispose() }
        @(Get-ChildItem -LiteralPath (Join-Path $script:dir 'hub\archive') -Filter 'bus-*.jsonl').Count | Should -Be 1
    }
}

Describe 'bus.ps1 tail follows a clear' {
    BeforeEach {
        $script:dir = New-TempBusDir
        $script:bus = Join-Path $script:dir 'hub\bus.jsonl'
        $script:tail = $null
    }
    AfterEach {
        Stop-BusTail $script:tail
        Remove-Item -LiteralPath $script:dir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'F-014 prints every line exactly once and in order across a clear, then #pos on the new file' {
        Add-BusRaw $script:bus "{`"id`":`"seed`"}`n"
        $script:tail = Start-BusTail -Path $script:bus -From 'end'
        (Wait-BusTail $script:tail $script:Started 30000) | Should -BeTrue

        Add-BusRaw $script:bus "{`"id`":`"l1`"}`n{`"id`":`"l2`"}`n"
        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 2 } 5000) | Should -BeTrue

        # Written and cleared inside one poll, so the tail has not read them when the file moves.
        Add-BusRaw $script:bus "{`"id`":`"l3`"}`n{`"id`":`"l4`"}`n"
        (Invoke-BusClearProcess $script:bus).ExitCode | Should -Be 0
        Add-BusRaw $script:bus "{`"id`":`"n1`"}`n{`"id`":`"n2`"}`n"
        $newId = Get-TestFileId $script:bus

        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 6 } 10000) | Should -BeTrue
        [void](Wait-BusTail $script:tail { param($t) $false } 2500)
        @(Get-BusTailBusLines $script:tail) | Should -Be @(
            '{"id":"l1"}', '{"id":"l2"}', '{"id":"l3"}', '{"id":"l4"}', '{"id":"n1"}', '{"id":"n2"}')
        $enc = New-Object System.Text.UTF8Encoding($false)
        @(Get-BusTailPosLines $script:tail)[-1] | Should -Be ('#pos ' + $newId + ':' + $enc.GetByteCount("{`"id`":`"n1`"}`n{`"id`":`"n2`"}`n"))
        Stop-BusTail $script:tail
        $script:tail.StdErr.Result | Should -Not -Match 'Restarting'
    }

    It 'F-014 two clears between two passes: every archive is read, in order' {
        Add-BusRaw $script:bus "{`"id`":`"seed`"}`n"
        $script:tail = Start-BusTail -Path $script:bus -From 'end'
        (Wait-BusTail $script:tail $script:Started 30000) | Should -BeTrue

        Add-BusRaw $script:bus "{`"id`":`"a1`"}`n"
        (Invoke-BusClearProcess $script:bus).ExitCode | Should -Be 0
        Add-BusRaw $script:bus "{`"id`":`"b1`"}`n"
        (Invoke-BusClearProcess $script:bus).ExitCode | Should -Be 0
        Add-BusRaw $script:bus "{`"id`":`"c1`"}`n"

        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 3 } 10000) | Should -BeTrue
        [void](Wait-BusTail $script:tail { param($t) $false } 2500)
        @(Get-BusTailBusLines $script:tail) | Should -Be @('{"id":"a1"}', '{"id":"b1"}', '{"id":"c1"}')
    }

    It 'F-014 an unfinished last line in the archive is skipped with a warning on stderr' {
        Add-BusRaw $script:bus "{`"id`":`"seed`"}`n"
        $script:tail = Start-BusTail -Path $script:bus -From 'end'
        (Wait-BusTail $script:tail $script:Started 30000) | Should -BeTrue

        Add-BusRaw $script:bus "{`"id`":`"whole`"}`n{`"id`":`"torn"
        (Invoke-BusClearProcess $script:bus).ExitCode | Should -Be 0
        Add-BusRaw $script:bus "{`"id`":`"n1`"}`n"

        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 2 } 10000) | Should -BeTrue
        [void](Wait-BusTail $script:tail { param($t) $false } 2500)
        @(Get-BusTailBusLines $script:tail) | Should -Be @('{"id":"whole"}', '{"id":"n1"}')
        Stop-BusTail $script:tail
        $script:tail.StdErr.Result | Should -Match 'unfinished line'
    }

    It 'F-014 restart from an archived position prints the rest of the archive, then the new file' {
        $lines = 1..4 | ForEach-Object { "{`"id`":`"o$_`"}" }
        Add-BusRaw $script:bus (($lines -join "`n") + "`n")
        $oldId = Get-TestFileId $script:bus
        $enc = New-Object System.Text.UTF8Encoding($false)
        $offset = $enc.GetByteCount((($lines[0..1] -join "`n") + "`n"))

        (Invoke-BusClearProcess $script:bus).ExitCode | Should -Be 0
        Add-BusRaw $script:bus "{`"id`":`"n1`"}`n"
        $newId = Get-TestFileId $script:bus

        $script:tail = Start-BusTail -Path $script:bus -From "${oldId}:$offset"
        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 3 } 30000) | Should -BeTrue
        [void](Wait-BusTail $script:tail { param($t) $false } 2000)
        @(Get-BusTailBusLines $script:tail) | Should -Be @($lines[2], $lines[3], '{"id":"n1"}')
        @(Get-BusTailPosLines $script:tail)[0] | Should -Be ('#pos ' + $newId + ':0')
        @(Get-BusTailPosLines $script:tail)[-1] | Should -Be ('#pos ' + $newId + ':' + $enc.GetByteCount("{`"id`":`"n1`"}`n"))
    }

    It 'F-014 with no archive for the old id it warns and restarts at 0 (as before)' {
        Add-BusRaw $script:bus "{`"id`":`"x`"}`n"
        $script:tail = Start-BusTail -Path $script:bus -From '00000001-0000000000000001:5'
        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 1 } 30000) | Should -BeTrue
        @(Get-BusTailBusLines $script:tail) | Should -Be @('{"id":"x"}')
        Stop-BusTail $script:tail
        $script:tail.StdErr.Result | Should -Match 'Restarting at offset 0'
    }
}
