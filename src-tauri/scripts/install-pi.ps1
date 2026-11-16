$ErrorActionPreference = 'Stop'
try {
    Write-Host 'Installing Pi using the official installer at https://pi.dev/install.ps1'
    Invoke-RestMethod 'https://pi.dev/install.ps1' | Invoke-Expression
} catch {
    Write-Host "Pi installation failed: $_" -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}
