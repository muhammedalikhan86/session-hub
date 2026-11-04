# TC-040: message.ts -> bus.ps1 append -> bus.ps1 tail -> parseLine, in a temp folder only.
# Needs node 22.18+ (native TypeScript type stripping). Skipped with a visible reason if node is absent.
# Takes the bus mutex (append): run serially, like bus.append.Tests.ps1.

BeforeDiscovery {
    $script:NoNode = -not (Get-Command node -ErrorAction SilentlyContinue)
}

BeforeAll {
    . (Join-Path $PSScriptRoot 'helpers.ps1')
}

Describe 'message.ts to bus.ps1 round trip' {
    BeforeEach { $script:dir = New-TempBusDir }
    AfterEach { Remove-Item -LiteralPath $script:dir -Recurse -Force -ErrorAction SilentlyContinue }

    It 'TC-040 plain, multi-line, non-ASCII, 5000-char, #pos-looking and quoted bodies round-trip' -Skip:$script:NoNode {
        $bus = Join-Path $script:dir 'hub\bus.jsonl'
        $out = & node (Join-Path $PSScriptRoot 'e2e-roundtrip.mjs') $script:BusScript $bus 2>&1
        $LASTEXITCODE | Should -Be 0 -Because ($out | Out-String)
        $summary = ($out | Select-Object -Last 1) | ConvertFrom-Json
        $summary.ok | Should -BeTrue
        $summary.sent | Should -Be 6
        $summary.received | Should -Be 6
        @($summary.problems).Count | Should -Be 0
    }
}
