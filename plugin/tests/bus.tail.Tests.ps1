# Pester 5+ tests for `bus.ps1 tail` (TC-020 .. TC-024 plus #pos, bad -From and file-id handling).
# The tail takes no mutex, so these do not conflict with a running Session Hub.

BeforeAll {
    . (Join-Path $PSScriptRoot 'helpers.ps1')
    $script:Started = { param($t) (Get-BusTailPosLines $t).Count -ge 1 }
}

Describe 'bus.ps1 tail' {
    BeforeEach {
        $script:dir = New-TempBusDir
        $script:bus = Join-Path $script:dir 'hub\bus.jsonl'
        $script:tail = $null
    }
    AfterEach {
        Stop-BusTail $script:tail
        Remove-Item -LiteralPath $script:dir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'TC-020 prints a newly appended line within 2 s' {
        Add-BusRaw $script:bus "{`"id`":`"seed`"}`n"
        $script:tail = Start-BusTail -Path $script:bus -From 'end'
        (Wait-BusTail $script:tail $script:Started 30000) | Should -BeTrue

        $sw = [Diagnostics.Stopwatch]::StartNew()
        Add-BusRaw $script:bus "{`"id`":`"new1`"}`n"
        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 1 } 5000) | Should -BeTrue
        $sw.ElapsedMilliseconds | Should -BeLessThan 2000
        @(Get-BusTailBusLines $script:tail) | Should -Be @('{"id":"new1"}')
    }

    It 'TC-021 holds back a half line for 3 s, then prints it once whole' {
        Add-BusRaw $script:bus "{`"id`":`"seed`"}`n"
        $script:tail = Start-BusTail -Path $script:bus -From 'end'
        (Wait-BusTail $script:tail $script:Started 30000) | Should -BeTrue
        $posBefore = @(Get-BusTailPosLines $script:tail)[-1]

        Add-BusRaw $script:bus '{"id":"half","body":"caf'
        Add-BusRaw $script:bus ([string][char]0x00E9)
        [void](Wait-BusTail $script:tail { param($t) $false } 3000)
        (Get-BusTailBusLines $script:tail).Count | Should -Be 0
        @(Get-BusTailPosLines $script:tail)[-1] | Should -Be $posBefore

        Add-BusRaw $script:bus "`"}`n"
        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 1 } 5000) | Should -BeTrue
        [void](Wait-BusTail $script:tail { param($t) $false } 2500)
        $got = @(Get-BusTailBusLines $script:tail)
        $got.Count | Should -Be 1
        $got[0] | Should -Be ('{"id":"half","body":"caf' + [char]0x00E9 + '"}')
    }

    It 'TC-022 starts from an offset: lines 4 and 5 only' {
        $lines = 1..5 | ForEach-Object { "{`"id`":`"l$_`"}" }
        Add-BusRaw $script:bus (($lines -join "`n") + "`n")
        $enc = New-Object System.Text.UTF8Encoding($false)
        $offset = $enc.GetByteCount((($lines[0..2] -join "`n") + "`n"))
        $id = Get-TestFileId $script:bus

        $script:tail = Start-BusTail -Path $script:bus -From "${id}:$offset"
        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 2 } 30000) | Should -BeTrue
        [void](Wait-BusTail $script:tail { param($t) $false } 1500)
        @(Get-BusTailBusLines $script:tail) | Should -Be @($lines[3], $lines[4])
    }

    It 'TC-023 tails a 50 MB file from its end with small memory' {
        $enc = New-Object System.Text.UTF8Encoding($false)
        $block = $enc.GetBytes(((1..1000 | ForEach-Object { '{"id":"fill","pad":"' + ('x' * 60) + '"}' }) -join "`n") + "`n")
        New-Item -ItemType Directory -Path (Split-Path -Parent $script:bus) -Force | Out-Null
        $fs = [IO.File]::Create($script:bus)
        try { while ($fs.Length -lt 50MB) { $fs.Write($block, 0, $block.Length) } } finally { $fs.Dispose() }

        $script:tail = Start-BusTail -Path $script:bus -From 'end'
        (Wait-BusTail $script:tail $script:Started 30000) | Should -BeTrue
        @(Get-BusTailPosLines $script:tail)[0] | Should -Be ('#pos ' + (Get-TestFileId $script:bus) + ':' + (Get-Item $script:bus).Length)

        $sw = [Diagnostics.Stopwatch]::StartNew()
        Add-BusRaw $script:bus "{`"id`":`"tail50`"}`n"
        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 1 } 5000) | Should -BeTrue
        $sw.ElapsedMilliseconds | Should -BeLessThan 2000
        @(Get-BusTailBusLines $script:tail) | Should -Be @('{"id":"tail50"}')

        $script:tail.Process.Refresh()
        $script:tail.Process.WorkingSet64 | Should -BeLessThan (200MB)
    }

    It 'TC-024 prints a burst of 500 appended lines once each, in order' {
        Add-BusRaw $script:bus "{`"id`":`"seed`"}`n"
        $script:tail = Start-BusTail -Path $script:bus -From 'end'
        (Wait-BusTail $script:tail $script:Started 30000) | Should -BeTrue

        foreach ($n in 1..500) { Add-BusRaw $script:bus "{`"id`":`"b$n`"}`n" }
        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 500 } 15000) | Should -BeTrue
        [void](Wait-BusTail $script:tail { param($t) $false } 2500)
        $got = @(Get-BusTailBusLines $script:tail)
        $got.Count | Should -Be 500
        $expected = @(1..500 | ForEach-Object { "{`"id`":`"b$_`"}" })
        ($got -join "`n") | Should -Be ($expected -join "`n")
    }

    It 'prints #pos at start and after each batch with the right offset' {
        Add-BusRaw $script:bus "{`"id`":`"seed`"}`n"
        $id = Get-TestFileId $script:bus
        $len0 = (Get-Item $script:bus).Length
        $script:tail = Start-BusTail -Path $script:bus -From "${id}:$len0"
        (Wait-BusTail $script:tail $script:Started 30000) | Should -BeTrue
        @(Get-BusTailPosLines $script:tail)[0] | Should -Be "#pos ${id}:$len0"

        Add-BusRaw $script:bus "{`"id`":`"a`"}`n"
        $len1 = (Get-Item $script:bus).Length
        (Wait-BusTail $script:tail { param($t) (Get-BusTailPosLines $t).Count -ge 2 } 5000) | Should -BeTrue
        @(Get-BusTailPosLines $script:tail)[-1] | Should -Be "#pos ${id}:$len1"
    }

    It '-From end on a missing file waits, then reads the file from 0 once it exists' {
        $script:tail = Start-BusTail -Path $script:bus -From 'end'
        [void](Wait-BusTail $script:tail { param($t) $false } 2500)
        $script:tail.Process.HasExited | Should -BeFalse
        (Get-BusTailPosLines $script:tail).Count | Should -Be 0

        Add-BusRaw $script:bus "{`"id`":`"first`"}`n"
        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 1 } 5000) | Should -BeTrue
        @(Get-BusTailBusLines $script:tail) | Should -Be @('{"id":"first"}')
    }

    It '-From end on an existing file that is briefly locked still starts at its end, not at 0' {
        Add-BusRaw $script:bus "{`"id`":`"old`"}`n"
        $lock = [IO.File]::Open($script:bus, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        try {
            $script:tail = Start-BusTail -Path $script:bus -From 'end'
            [void](Wait-BusTail $script:tail { param($t) $false } 6000)
            (Get-BusTailPosLines $script:tail).Count | Should -Be 0
        }
        finally { $lock.Dispose() }

        (Wait-BusTail $script:tail $script:Started 30000) | Should -BeTrue
        Add-BusRaw $script:bus "{`"id`":`"new`"}`n"
        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 1 } 5000) | Should -BeTrue
        [void](Wait-BusTail $script:tail { param($t) $false } 1500)
        @(Get-BusTailBusLines $script:tail) | Should -Be @('{"id":"new"}')
    }

    It 'rejects a bad -From (<From>) with exit 2 and a stderr message' -TestCases @(
        @{ From = 'garbage' }
        @{ From = 'abc-def:xyz' }
        @{ From = 'abc-def:-1' }
        @{ From = 'nodash:5' }
        @{ From = ':5' }
    ) {
        param($From)
        $p = Start-Ps51 "-File `"$script:BusScript`" tail -Path `"$script:bus`" -From `"$From`""
        $out = $p.StandardOutput.ReadToEndAsync()
        $err = $p.StandardError.ReadToEndAsync()
        [void]$p.WaitForExit(20000)
        if (-not $p.HasExited) { $p.Kill(); throw 'tail did not exit on a bad -From' }
        $p.ExitCode | Should -Be 2
        $err.Result | Should -Match 'bad -From'
        $out.Result | Should -Be ''
    }

    It 'a different file id warns on stderr and restarts the file at offset 0' {
        Add-BusRaw $script:bus "{`"id`":`"one`"}`n{`"id`":`"two`"}`n"
        $id = Get-TestFileId $script:bus
        $script:tail = Start-BusTail -Path $script:bus -From 'deadbeef-0000000000000001:10'
        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 2 } 30000) | Should -BeTrue
        @(Get-BusTailBusLines $script:tail) | Should -Be @('{"id":"one"}', '{"id":"two"}')
        @(Get-BusTailPosLines $script:tail)[0] | Should -Be "#pos ${id}:0"
        Stop-BusTail $script:tail
        $script:tail.StdErr.Result | Should -Match 'Restarting at offset 0'
    }

    It 'a size below the offset warns on stderr and restarts at offset 0' {
        Add-BusRaw $script:bus "{`"id`":`"one`"}`n"
        $id = Get-TestFileId $script:bus
        $script:tail = Start-BusTail -Path $script:bus -From "${id}:9999"
        (Wait-BusTail $script:tail { param($t) (Get-BusTailBusLines $t).Count -ge 1 } 30000) | Should -BeTrue
        @(Get-BusTailBusLines $script:tail) | Should -Be @('{"id":"one"}')
        Stop-BusTail $script:tail
        $script:tail.StdErr.Result | Should -Match 'Restarting at offset 0'
    }
}
