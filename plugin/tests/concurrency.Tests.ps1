# Pester 5+ wrapper for the concurrency proof (F-017, NFR-003). One iteration keeps the normal suite
# fast; the full 10-iteration proof is the script run directly:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File plugin/tests/stress/concurrency.ps1
# It takes the bus mutex: run serially and not while a real Session Hub runs.

BeforeAll {
    $script:Stress = (Resolve-Path (Join-Path $PSScriptRoot 'stress\concurrency.ps1')).Path
}

Describe 'bus concurrency proof' {
    It 'F-017 5 writers x 200 lines, 3 listeners and a mid-run clear: every line once, in order, none torn (1 iteration)' {
        $out = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script:Stress -Iterations 1 2>&1 | Out-String
        $LASTEXITCODE | Should -Be 0 -Because $out
        $out | Should -Match 'Iteration 1/1: PASS'
    }
}
