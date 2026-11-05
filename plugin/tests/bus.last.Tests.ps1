# Pester 5+ tests for `bus.ps1 last` (F-013). Read-only, takes no mutex.

BeforeAll {
    . (Join-Path $PSScriptRoot 'helpers.ps1')

    function script:Invoke-BusLast {
        param([string]$Path, [string]$Count)
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = 'powershell.exe'
        $psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script:BusScript`" last -Path `"$Path`" -Count `"$Count`""
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
        $psi.CreateNoWindow = $true
        $p = [System.Diagnostics.Process]::Start($psi)
        $out = $p.StandardOutput.ReadToEndAsync()
        $err = $p.StandardError.ReadToEndAsync()
        $p.WaitForExit()
        [pscustomobject]@{
            ExitCode = $p.ExitCode
            StdOut   = $out.Result
            Lines    = @($out.Result -split "`n" | Where-Object { $_ -ne '' })
            StdErr   = $err.Result
        }
    }
}

Describe 'bus.ps1 last' {
    BeforeEach {
        $script:dir = New-TempBusDir
        $script:bus = Join-Path $script:dir 'hub\bus.jsonl'
    }
    AfterEach {
        Remove-Item -LiteralPath $script:dir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'prints the last N of more than N lines, oldest first' {
        Add-BusRaw $script:bus ((1..10 | ForEach-Object { "{`"id`":`"l$_`"}" }) -join "`n")
        Add-BusRaw $script:bus "`n"
        $r = Invoke-BusLast $script:bus 3
        $r.ExitCode | Should -Be 0
        $r.Lines | Should -Be @('{"id":"l8"}', '{"id":"l9"}', '{"id":"l10"}')
    }

    It 'prints every line when there are fewer than N' {
        Add-BusRaw $script:bus "{`"id`":`"a`"}`n{`"id`":`"b`"}`n"
        $r = Invoke-BusLast $script:bus 50
        $r.ExitCode | Should -Be 0
        $r.Lines | Should -Be @('{"id":"a"}', '{"id":"b"}')
    }

    It 'exits 0 with nothing for a missing file and for an empty one' {
        $r = Invoke-BusLast (Join-Path $script:dir 'nope\bus.jsonl') 5
        $r.ExitCode | Should -Be 0
        $r.StdOut | Should -Be ''

        [void](New-Item -ItemType Directory -Path (Split-Path -Parent $script:bus) -Force)
        [IO.File]::WriteAllBytes($script:bus, [byte[]]@())
        (Invoke-BusLast $script:bus 5).StdOut | Should -Be ''
    }

    It 'never prints a final unfinished line' {
        Add-BusRaw $script:bus "{`"id`":`"a`"}`n{`"id`":`"b`"}`n{`"id`":`"half"
        $r = Invoke-BusLast $script:bus 5
        $r.Lines | Should -Be @('{"id":"a"}', '{"id":"b"}')
    }

    It 'reads only the tail of a big file, and a line cut by a chunk edge is never printed' {
        $pad = 'x' * 1000
        $sb = New-Object System.Text.StringBuilder
        for ($i = 1; $i -le 20000; $i++) { [void]$sb.Append("{`"id`":`"l$i`",`"b`":`"$pad`"}`n") }
        Add-BusRaw $script:bus $sb.ToString()
        (Get-Item $script:bus).Length | Should -BeGreaterThan 20000000

        $sw = [Diagnostics.Stopwatch]::StartNew()
        $r = Invoke-BusLast $script:bus 4
        $sw.Stop()
        $r.ExitCode | Should -Be 0
        $r.Lines.Count | Should -Be 4
        $r.Lines[0] | Should -BeLike '{"id":"l19997",*'
        $r.Lines[3] | Should -BeLike '{"id":"l20000",*'
        $r.Lines | ForEach-Object { $_ | Should -BeLike '{"id":"l*"}' }
        $sw.ElapsedMilliseconds | Should -BeLessThan 15000
    }

    It 'keeps non-ASCII text intact' {
        $word = 'caf' + [char]0x00E9 + ' ' + [char]0x2192
        Add-BusRaw $script:bus "{`"b`":`"$word`"}`n"
        (Invoke-BusLast $script:bus 1).Lines | Should -Be @("{`"b`":`"$word`"}")
    }

    It 'exits 2 for a missing or non-positive -Count' {
        Add-BusRaw $script:bus "{}`n"
        foreach ($bad in @('', '0', '-1', 'abc')) {
            $r = Invoke-BusLast $script:bus $bad
            $r.ExitCode | Should -Be 2
            $r.StdErr | Should -BeLike '*-Count*'
        }
    }
}
