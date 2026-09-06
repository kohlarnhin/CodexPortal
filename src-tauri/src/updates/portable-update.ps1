$ErrorActionPreference = 'Stop'
$target = $env:CODEX_PORTAL_UPDATE_TARGET
$staged = $env:CODEX_PORTAL_UPDATE_STAGED
$backup = $env:CODEX_PORTAL_UPDATE_BACKUP
$work = $env:CODEX_PORTAL_UPDATE_WORK
$expectedHash = $env:CODEX_PORTAL_UPDATE_HASH
$backupMade = $false
$replacementMade = $false
$parentExited = $false
$finished = $false

function Move-WithRetry([string]$source, [string]$destination) {
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        try {
            [System.IO.File]::Move($source, $destination)
            return
        } catch {
            if ($attempt -eq 99) { throw }
            Start-Sleep -Milliseconds 200
        }
    }
}

try {
    # Acquire the exact parent process before signalling readiness; avoid PID reuse.
    $parent = [System.Diagnostics.Process]::GetProcessById([int]$env:CODEX_PORTAL_UPDATE_PARENT)
    $null = $parent.Handle
    $actualHash = (Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash
    if ($actualHash -ne $expectedHash) { throw 'The downloaded executable changed after verification.' }
    [System.IO.File]::WriteAllText((Join-Path $work 'ready'), 'ready')
    if (-not $parent.WaitForExit(30000)) { throw 'The application did not exit in time.' }
    $parentExited = $true
    $parent.Dispose()

    Move-WithRetry $target $backup
    $backupMade = $true
    Move-WithRetry $staged $target
    $replacementMade = $true
    Start-Process -FilePath $target -WorkingDirectory ([System.IO.Path]::GetDirectoryName($target)) -ErrorAction Stop
    $finished = $true
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
} catch {
    $failure = $_.Exception.Message
    if ($backupMade) {
        try {
            if ($replacementMade) { Move-WithRetry $target $staged }
            Move-WithRetry $backup $target
            Start-Process -FilePath $target -WorkingDirectory ([System.IO.Path]::GetDirectoryName($target)) -ErrorAction Stop
            $failure += "`nThe previous version has been restored."
        } catch {
            $failure += "`nRecovery failed. The previous executable is preserved at: $backup"
        }
    } elseif ($parentExited) {
        try {
            Start-Process -FilePath $target -WorkingDirectory ([System.IO.Path]::GetDirectoryName($target)) -ErrorAction Stop
        } catch {
            $failure += "`nPlease reopen the previous executable: $target"
        }
    }
    [System.IO.File]::WriteAllText((Join-Path $work 'error.txt'), $failure)
    # Display a failure after the old process has exited, when its UI is unavailable.
    if ($parentExited) {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            $null = [System.Windows.Forms.MessageBox]::Show($failure, 'Codex Portal update', 'OK', 'Error')
        } catch {}
    }
} finally {
    Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue
    if ($finished) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}
