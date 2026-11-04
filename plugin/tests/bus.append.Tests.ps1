# Pester 5+ tests for `bus.ps1 append` (TC-010 .. TC-014 plus rejection cases).
# NOTE: the named mutex Local\ClaudeSessionHubBus is global to the logon session. Run these tests
# serially (never in parallel with each other) and not while a real Session Hub is running.

BeforeAll {
    . (Join-Path $PSScriptRoot 'helpers.ps1')
}

Describe 'bus.ps1 append' {
    BeforeEach {
        $script:dir = New-TempBusDir
        $script:bus = Join-Path $script:dir 'hub\bus.jsonl'
    }
    AfterEach {
        Remove-Item -LiteralPath $script:dir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'TC-010 creates the missing folder and file; file is exactly the line plus LF' {
        $line = '{"id":"a1","body":"hello"}'
        $r = Invoke-BusAppendProcess -Path $script:bus -LineBase64 (ConvertTo-Base64Utf8 $line)
        $r.ExitCode | Should -Be 0
        $r.StdOut | Should -Be ''
        $expected = (New-Object System.Text.UTF8Encoding($false)).GetBytes($line + "`n")
        $actual = [IO.File]::ReadAllBytes($script:bus)
        [Convert]::ToBase64String($actual) | Should -Be ([Convert]::ToBase64String($expected))
    }

    It 'TC-011 10 processes x 100 appends give 1000 valid, unique, complete lines' {
        $procs = @(1..10 | ForEach-Object { Start-AppendLoop -Path $script:bus -Proc $_ -Count 100 })
        foreach ($p in $procs) {
            [void]$p.StandardOutput.ReadToEndAsync()
            [void]$p.StandardError.ReadToEndAsync()
        }
        foreach ($p in $procs) { $p.WaitForExit() }
        @($procs | Where-Object { $_.ExitCode -ne 0 }).Count | Should -Be 0

        $lines = @(Get-Content -LiteralPath $script:bus -Encoding UTF8)
        $lines.Count | Should -Be 1000
        $ids = @(foreach ($l in $lines) { ($l | ConvertFrom-Json).id })
        @($ids | Sort-Object -Unique).Count | Should -Be 1000
        $expectedIds = @(foreach ($p in 1..10) { foreach ($n in 1..100) { "p$p-$n" } })
        @(Compare-Object $expectedIds $ids).Count | Should -Be 0
    }

    It 'TC-012 succeeds after the mutex holder was killed (abandoned mutex)' {
        $holder = Start-MutexHolder -Seconds 60
        $holder.Kill()
        $holder.WaitForExit()
        $line = '{"id":"after-abandon"}'
        $r = Invoke-BusAppendProcess -Path $script:bus -LineBase64 (ConvertTo-Base64Utf8 $line)
        $r.ExitCode | Should -Be 0
        (Get-Content -LiteralPath $script:bus -Raw) | Should -Be ($line + "`n")
    }

    It 'TC-013 times out while the mutex is held; non-zero exit, file unchanged' {
        $r0 = Invoke-BusAppendProcess -Path $script:bus -LineBase64 (ConvertTo-Base64Utf8 '{"id":"seed"}')
        $r0.ExitCode | Should -Be 0
        $before = [IO.File]::ReadAllBytes($script:bus)

        $holder = Start-MutexHolder -Seconds 5
        try {
            $r = Invoke-BusAppendProcess -Path $script:bus -LineBase64 (ConvertTo-Base64Utf8 '{"id":"blocked"}')
        }
        finally {
            try { $holder.Kill() } catch { }
            $holder.WaitForExit()
        }
        $r.ExitCode | Should -Not -Be 0
        $r.StdErr | Should -Match 'timed out'
        $r.ElapsedMs | Should -BeLessThan 4500
        $after = [IO.File]::ReadAllBytes($script:bus)
        [Convert]::ToBase64String($after) | Should -Be ([Convert]::ToBase64String($before))
    }

    It 'TC-014 non-ASCII body round-trips byte-exact as UTF-8' {
        $line = '{"id":"u1","body":"caf' + [char]0x00E9 + ' ' + [char]::ConvertFromUtf32(0x1F600) + ' na' + [char]0x00EF + 've"}'
        $r = Invoke-BusAppendProcess -Path $script:bus -LineBase64 (ConvertTo-Base64Utf8 $line)
        $r.ExitCode | Should -Be 0
        $expected = (New-Object System.Text.UTF8Encoding($false)).GetBytes($line + "`n")
        $actual = [IO.File]::ReadAllBytes($script:bus)
        $actual.Length | Should -Be $expected.Length
        [Convert]::ToBase64String($actual) | Should -Be ([Convert]::ToBase64String($expected))
        $actual[0] | Should -Be ([byte][char]'{')
    }

    It 'rejects empty input' {
        $r = Invoke-BusAppendProcess -Path $script:bus -LineBase64 ''
        $r.ExitCode | Should -Be 2
        $r.StdErr | Should -Not -BeNullOrEmpty
        Test-Path -LiteralPath $script:bus | Should -BeFalse
    }

    It 'rejects a line containing LF' {
        $r = Invoke-BusAppendProcess -Path $script:bus -LineBase64 (ConvertTo-Base64Utf8 "{`"a`":1}`n{`"b`":2}")
        $r.ExitCode | Should -Be 2
        $r.StdErr | Should -Not -BeNullOrEmpty
        Test-Path -LiteralPath $script:bus | Should -BeFalse
    }

    It 'rejects a line containing CR' {
        $r = Invoke-BusAppendProcess -Path $script:bus -LineBase64 (ConvertTo-Base64Utf8 "{`"a`":1}`r")
        $r.ExitCode | Should -Be 2
        Test-Path -LiteralPath $script:bus | Should -BeFalse
    }
}
