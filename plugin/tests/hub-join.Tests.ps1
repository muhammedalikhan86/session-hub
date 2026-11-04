# F-005 criterion 4: a worker listening from before its join line receives a Hub order sent the instant
# the Hub reads that line. Real bus.ps1, temp folder only. Needs node 22.18+ (runs tests/e2e-join.mjs);
# skipped with a visible reason if node is absent. Takes the bus mutex: run serially.

BeforeDiscovery {
    $script:NoNode = -not (Get-Command node -ErrorAction SilentlyContinue)
}

BeforeAll {
    . (Join-Path $PSScriptRoot 'helpers.ps1')
}

Describe 'hub-join listener ordering' {
    BeforeEach { $script:dir = New-TempBusDir }
    AfterEach { Remove-Item -LiteralPath $script:dir -Recurse -Force -ErrorAction SilentlyContinue }

    It 'TC-F005-4 the worker receives an order the Hub sends the instant it reads the join line' -Skip:$script:NoNode {
        $bus = Join-Path $script:dir 'hub\bus.jsonl'
        $out = & node (Join-Path $PSScriptRoot 'e2e-join.mjs') $script:BusScript $bus 2>&1
        $LASTEXITCODE | Should -Be 0 -Because ($out | Out-String)
        $summary = ($out | Select-Object -Last 1) | ConvertFrom-Json
        $summary.ok | Should -BeTrue
        @($summary.problems).Count | Should -Be 0
    }
}

# The PowerShell the plugin runs for ensureBusFile / removeFile, read from hooks/bus-scripts.ts (not
# copied), run on Windows PowerShell 5.1 the way bus-client.ts runs them: path in SESSION_HUB_PATH.
Describe 'hub-join file helpers' {
    BeforeDiscovery {
        $script:NoNode2 = -not (Get-Command node -ErrorAction SilentlyContinue)
    }

    BeforeAll {
        $src = (Resolve-Path (Join-Path $PSScriptRoot '..\hooks\bus-scripts.ts')).Path
        $url = ([Uri]$src).AbsoluteUri
        $json = & node -e "import('$url').then(m => console.log(JSON.stringify(m)))"
        $script:Scripts = $json | ConvertFrom-Json

        function script:Invoke-Script([string]$Script, [string]$Path) {
            $env:SESSION_HUB_PATH = $Path
            try {
                $out = & powershell.exe -NoProfile -NonInteractive -Command $Script 2>&1
                [pscustomobject]@{ Exit = $LASTEXITCODE; Out = ($out | Out-String) }
            }
            finally { Remove-Item Env:\SESSION_HUB_PATH -ErrorAction SilentlyContinue }
        }
    }
    BeforeEach { $script:dir = Join-Path ([IO.Path]::GetTempPath()) ('hub-join-' + [guid]::NewGuid().ToString('N')) }
    AfterEach { Remove-Item -LiteralPath $script:dir -Recurse -Force -ErrorAction SilentlyContinue }

    It 'ensureBusFile creates a missing file and its folder' -Skip:$script:NoNode2 {
        $bus = Join-Path $script:dir 'hub\bus.jsonl'
        $r = Invoke-Script $script:Scripts.ENSURE_BUS_SCRIPT $bus
        $r.Exit | Should -Be 0 -Because $r.Out
        Test-Path -LiteralPath $bus | Should -BeTrue
        (Get-Item -LiteralPath $bus).Length | Should -Be 0
    }

    It 'ensureBusFile leaves existing content untouched' -Skip:$script:NoNode2 {
        $bus = Join-Path $script:dir 'bus.jsonl'
        [void](New-Item -ItemType Directory -Path $script:dir)
        [IO.File]::WriteAllText($bus, 'abc')
        $r = Invoke-Script $script:Scripts.ENSURE_BUS_SCRIPT $bus
        $r.Exit | Should -Be 0 -Because $r.Out
        [IO.File]::ReadAllText($bus) | Should -Be 'abc'
    }

    It 'removeFile deletes the file, and a missing file is not an error' -Skip:$script:NoNode2 {
        $f = Join-Path $script:dir 'presence.json'
        [void](New-Item -ItemType Directory -Path $script:dir)
        [IO.File]::WriteAllText($f, '{}')
        (Invoke-Script $script:Scripts.REMOVE_FILE_SCRIPT $f).Exit | Should -Be 0
        Test-Path -LiteralPath $f | Should -BeFalse
        (Invoke-Script $script:Scripts.REMOVE_FILE_SCRIPT $f).Exit | Should -Be 0
    }
}
