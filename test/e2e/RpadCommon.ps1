# Shared helpers for Run-RpadTests.ps1 and Run-RpadReview.ps1 (dot-sourced; do not run alone)

$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
$Fx   = Join-Path $Root 'fixtures'
$Work = Join-Path $env:TEMP 'rpad-tests-work'
$SB   = Join-Path $Work 'sb'
$OutDir = Join-Path $Root 'results'
$Started = Get-Date

# ---------------------------------------------------------------- setup
if (-not $Rpad) {
  $c = Get-Command rpad.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { $Rpad = $c.Source }
}
if (-not $Rpad -or -not (Test-Path -LiteralPath $Rpad)) {
  Write-Error 'rpad.exe not found. Pass -Rpad C:\path\to\rpad.exe'; exit 2
}
$Rpad = (Resolve-Path -LiteralPath $Rpad).Path
$ProcName = [IO.Path]::GetFileNameWithoutExtension($Rpad)
if (-not (Test-Path -LiteralPath $Fx)) { Write-Error "fixtures folder missing: $Fx"; exit 2 }
New-Item -ItemType Directory -Force -Path $Work, $OutDir | Out-Null

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RpadNative {
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
  [StructLayout(LayoutKind.Sequential)]
  public struct COPYDATASTRUCT { public IntPtr dwData; public int cbData; public IntPtr lpData; }
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", SetLastError=true)]
  public static extern IntPtr SendCopyData(IntPtr h, uint msg, IntPtr w, ref COPYDATASTRUCT l, uint flags, uint timeout, out IntPtr result);
}
'@

$EnvKeys = 'APPDATA','LOCALAPPDATA','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','PATH'
$OrigEnv = @{}
foreach ($k in $EnvKeys) { $OrigEnv[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }

# ---------------------------------------------------------------- tiny helpers
function Pass($d = 'ok')   { [pscustomobject]@{ S = 'PASS';   D = $d } }
function Fail($d)          { [pscustomobject]@{ S = 'FAIL';   D = $d } }
function Review($d)        { [pscustomobject]@{ S = 'REVIEW'; D = $d } }
function Skip($d)          { [pscustomobject]@{ S = 'SKIP';   D = $d } }
function Verdict($bad, $note = 'ok') { if (@($bad).Count) { Fail (@($bad) -join '; ') } else { Pass $note } }
function Q($p) { '"' + $p + '"' }
function F($rel) { Join-Path $SB $rel }
function Short($s, $n = 160) { if ($null -eq $s) { return '' }; $s = ($s -replace '\s+', ' ').Trim(); if ($s.Length -gt $n) { $s.Substring(0, $n) + '...' } else { $s } }

function Test-CrashCode($c) {
  if ($null -eq $c) { return $false }
  $u = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$c), 0)
  return ($u -ge 3221225472)     # 0xC0000000 and up = NTSTATUS error / crash
}

function Get-Hash($p) { if (Test-Path -LiteralPath $p -PathType Leaf) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash } else { 'MISSING' } }

function Read-Shared($p) {
  try {
    $fs = [IO.File]::Open($p, 'Open', 'Read', 'ReadWrite,Delete')
    $sr = New-Object IO.StreamReader($fs)
    $t = $sr.ReadToEnd(); $sr.Close(); return $t
  } catch { return '' }
}

function Remove-Tree($p) {
  if (-not (Test-Path -LiteralPath $p)) { return }
  & cmd.exe /c "rmdir /s /q `"$p`"" 2>$null | Out-Null
  if (Test-Path -LiteralPath $p) {
    try { [IO.Directory]::Delete('\\?\' + $p, $true) } catch { }
  }
}

function Stop-Rpad {
  Get-Process -Name $ProcName -ErrorAction SilentlyContinue | ForEach-Object {
    try { $_.Handle | Out-Null; [void][RpadNative]::NtResumeProcess($_.Handle) } catch { }
  }
  Get-Process -Name $ProcName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ((Get-Process -Name $ProcName -ErrorAction SilentlyContinue) -and $sw.Elapsed.TotalSeconds -lt 8) { Start-Sleep -Milliseconds 100 }
}

$script:AppN = 0
function Reset-Env {
  Stop-Rpad
  # every test gets its own empty app data, so notes from earlier tests do not come back as extra tabs
  $script:AppN++
  foreach ($k in 'APPDATA', 'LOCALAPPDATA') {
    $d = Join-Path $Work ("appdata\{0}_{1}" -f $script:AppN, $k); New-Item -ItemType Directory -Force $d | Out-Null
    $OrigEnv[$k] = $d
  }
  foreach ($k in $EnvKeys) { [Environment]::SetEnvironmentVariable($k, $OrigEnv[$k], 'Process') }
  Set-Location $Work
  Remove-Tree $SB
  Copy-Item -LiteralPath $Fx -Destination $SB -Recurse -Force
  # Windows may keep file-attribute / lock state from earlier tests; start clean
  Get-ChildItem -LiteralPath $SB -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Attributes = 'Normal' }
}

# ---------------------------------------------------------------- launching rPad
function Read-OutFile($p) { if (Test-Path -LiteralPath $p) { Read-Shared $p } else { '' } }

function Invoke-Rpad {
  param([string]$A = '', [int]$Wait = $Timeout, [string]$Cwd, [string]$Stdin, [string]$Exe)
  $id  = [guid]::NewGuid().ToString('N')
  $so  = Join-Path $Work "o_$id.txt"
  $se  = Join-Path $Work "e_$id.txt"
  $p = @{ FilePath = $(if ($Exe) { $Exe } else { $Rpad }); PassThru = $true; RedirectStandardOutput = $so; RedirectStandardError = $se }
  if ($A)     { $p.ArgumentList = $A }          # one raw string = we control quoting exactly
  if ($Cwd)   { $p.WorkingDirectory = $Cwd }
  if ($Stdin) { $p.RedirectStandardInput = $Stdin }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $proc = Start-Process @p
  $null = $proc.Handle     # keep the handle: without it ExitCode can be empty
  $exited = $proc.WaitForExit($Wait * 1000)
  $ms = $sw.ElapsedMilliseconds
  $code = $null
  if ($exited) { $code = $proc.ExitCode }
  [pscustomobject]@{ Proc = $proc; Exited = $exited; ExitCode = $code; Ms = $ms; Out = (Read-OutFile $so); Err = (Read-OutFile $se) }
}

function Get-Windows {
  $pids = @(Get-Process -Name $ProcName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if ($pids.Count -eq 0) { return }
  $kids = [Windows.Automation.AutomationElement]::RootElement.FindAll('Children', [Windows.Automation.Condition]::TrueCondition)
  foreach ($k in $kids) { try { if ($pids -contains $k.Current.ProcessId) { $k } } catch { } }
}

function Wait-Window([int]$Sec = 5) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $Sec) {
    $w = @(Get-Windows); if ($w.Count -gt 0) { return $w }
    Start-Sleep -Milliseconds 150
  }
  return @()
}

function Get-Tabs {
  $names = @()
  $cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::TabItem)
  foreach ($w in @(Get-Windows)) {
    try { foreach ($t in $w.FindAll('Descendants', $cond)) { $names += $t.Current.Name } } catch { }
  }
  $names
}

function Find-Editor {
  foreach ($w in @(Get-Windows)) {
    foreach ($ct in @([Windows.Automation.ControlType]::Document, [Windows.Automation.ControlType]::Edit)) {
      $c = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct)
      try { $e = $w.FindFirst('Descendants', $c) } catch { $e = $null }
      if ($e) { return $e }
    }
  }
  $null
}

function Get-EditorText {      # $null = UI Automation cannot see the text (then check by hand)
  $e = Find-Editor; if (-not $e) { return $null }
  $p = $null
  try {
    if ($e.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$p))  { return $p.DocumentRange.GetText(20000000) }
    if ($e.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { return $p.Current.Value }
  } catch { }
  $null
}

function Get-Caret {           # text of the caret line + text between line start and caret
  $e = Find-Editor; if (-not $e) { return $null }
  $p = $null
  try {
    if (-not $e.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$p)) { return $null }
    $sel = $p.GetSelection(); if ($sel.Count -lt 1) { return $null }
    $r = $sel[0]
    $line = $r.Clone(); $line.ExpandToEnclosingUnit([Windows.Automation.Text.TextUnit]::Line)
    $pre = $line.Clone(); $pre.MoveEndpointByRange('End', $r, 'Start')
    [pscustomobject]@{ Line = $line.GetText(500); Prefix = $pre.GetText(500) }
  } catch { $null }
}

function Select-Tab($name) {
  $cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::TabItem)
  foreach ($w in @(Get-Windows)) {
    foreach ($t in $w.FindAll('Descendants', $cond)) {
      if ($t.Current.Name -like "*$name*") {
        $p = $null
        if ($t.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); Start-Sleep -Milliseconds 400; return $true }
      }
    }
  }
  $false
}

function Test-Frozen([int]$Sec = 3) {
  $bad = 0; $end = (Get-Date).AddSeconds($Sec)
  while ((Get-Date) -lt $end) {
    foreach ($x in @(Get-Process -Name $ProcName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })) {
      $x.Refresh(); if (-not $x.Responding) { $bad++ }
    }
    Start-Sleep -Milliseconds 400
  }
  return ($bad -ge 3)
}

function Get-Main { Get-Process -Name $ProcName -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1 }

# One launch + everything we can see afterwards.
function Observe {
  param([string]$A = '', [string]$Cwd, [switch]$Keep, [switch]$NoWin, [string]$Stdin, [int]$Settle = 700)
  if (-not $Keep) { Stop-Rpad }
  $before = @(Get-Process -Name $ProcName -ErrorAction SilentlyContinue).Count
  # the first start IS the app and never exits: do not wait the full timeout for it
  $r = Invoke-Rpad -A $A -Cwd $Cwd -Stdin $Stdin -Wait $(if ($before -eq 0) { 3 } else { $Timeout })
  if (-not $NoWin) { [void](Wait-Window 4) }
  Start-Sleep -Milliseconds $Settle
  $wins  = @(Get-Windows)
  $tabs  = @(Get-Tabs)
  $procs = @(Get-Process -Name $ProcName -ErrorAction SilentlyContinue).Count
  $frozen = $false; if ($wins.Count -gt 0) { $frozen = Test-Frozen 2 }
  $o = [pscustomobject]@{
    A = $A; Exited = $r.Exited; ExitCode = $r.ExitCode; Ms = $r.Ms; Out = $r.Out; Err = $r.Err
    Crash = (Test-CrashCode $r.ExitCode)
    Hung = ($before -gt 0 -and -not $r.Exited)         # a 2nd start must hand over and exit
    Frozen = $frozen; Wins = $wins.Count; Tabs = $tabs; Procs = $procs; Before = $before
  }
  $o | Add-Member -NotePropertyName Sum -NotePropertyValue ("[{0}] exit={1} wins={2} tabs=<{3}>{4}" -f (Short $A 60), $(if ($o.Exited) { $o.ExitCode } else { 'running' }), $o.Wins, (Short ($o.Tabs -join ' | ') 90), $(if ($o.Err) { ' err=' + (Short $o.Err 60) } else { '' }))
  $o
}

function Matrix-Verdict($obs) {
  $bad = @(); $lines = @()
  foreach ($o in $obs) {
    if ($o.Crash)  { $bad += "CRASH exit=$($o.ExitCode) on [$($o.A)]" }
    if ($o.Hung)   { $bad += "HANG: 2nd start did not exit on [$($o.A)]" }
    if ($o.Frozen) { $bad += "UI FROZEN after [$($o.A)]" }
    $lines += $o.Sum
  }
  if ($bad.Count) { Fail (($bad + $lines) -join ' || ') } else { Review ('observed (judge against your spec): ' + ($lines -join ' || ')) }
}

function Get-Snap($dir) {
  Get-ChildItem -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.PSIsContainer) { 'D|' + $_.FullName.Substring($dir.Length) }
    else { 'F|{0}|{1}|{2}' -f $_.FullName.Substring($dir.Length), $_.Length, $_.LastWriteTimeUtc.Ticks }
  } | Sort-Object
}
function Diff-Snap($a, $b) { @(Compare-Object @($a) @($b) | ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" }) }

function Find-Leak([string]$Marker, [datetime]$Since) {
  $hits = @()
  foreach ($d in @($env:APPDATA, $env:LOCALAPPDATA, $env:TEMP, $env:USERPROFILE)) {
    if (-not $d -or -not (Test-Path $d)) { continue }
    Get-ChildItem -LiteralPath $d -Recurse -Force -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -ge $Since -and $_.Length -lt 20MB -and $_.FullName -notlike "$Work*" -and $_.FullName -notlike '*\Microsoft\Windows\*' } |
      ForEach-Object { try { if (Select-String -LiteralPath $_.FullName -Pattern $Marker -SimpleMatch -Quiet -ErrorAction Stop) { $hits += $_.FullName } } catch { } }
  }
  $hits
}

function Start-Many($cmds, $cwd) {
  $ps = @()
  foreach ($c in $cmds) { $ps += Start-Process -FilePath $Rpad -ArgumentList $c -WorkingDirectory $cwd -PassThru }
  $ps
}
function Wait-Many($ps, [int]$Sec) {
  $end = (Get-Date).AddSeconds($Sec)
  foreach ($p in $ps) { $left = [int](($end - (Get-Date)).TotalMilliseconds); if ($left -lt 0) { $left = 0 }; [void]$p.WaitForExit($left) }
  @($ps | Where-Object { -not $_.HasExited })
}

function Focus-Rpad {
  $m = Get-Main; if (-not $m) { return $false }
  try { (New-Object -ComObject WScript.Shell).AppActivate($m.Id) | Out-Null } catch { }
  Start-Sleep -Milliseconds 500; $true
}
function Send-Keys([string]$k) { [Windows.Forms.SendKeys]::SendWait($k); Start-Sleep -Milliseconds 400 }

function New-NumberedFiles([string]$dir, [int]$n, [string]$prefix = 'f') {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  1..$n | ForEach-Object { [IO.File]::WriteAllText((Join-Path $dir ("$prefix$_.txt")), "content-of-$prefix$_`r`nTOKEN-$prefix$_`r`n") }
}

function New-BigFile([string]$path, [long]$bytes, [string]$kind = 'lines') {
  $fs = [IO.File]::Create($path)
  try {
    if ($kind -eq 'oneline') { $chunk = [Text.Encoding]::ASCII.GetBytes(('x' * 65536)) }
    else { $chunk = [Text.Encoding]::ASCII.GetBytes((1..1024 | ForEach-Object { 'line of text number ' + $_ + "`r`n" }) -join '') }
    $written = 0L
    while ($written -lt $bytes) { $fs.Write($chunk, 0, $chunk.Length); $written += $chunk.Length }
  } finally { $fs.Close() }
}

# ---------------------------------------------------------------- test runner
$script:Rows = New-Object System.Collections.ArrayList
function Test-Case {
  param([string]$Id, [string]$Title, [string]$Pri, [scriptblock]$Body, [switch]$Slow, [switch]$UI)
  $Only = @($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ })   # -File passes "HV,OF" as one string
  if ($Only.Count -gt 0) { $m = $false; foreach ($o in $Only) { if ($Id -like "$o*") { $m = $true } }; if (-not $m) { return } }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  if ($Slow -and -not $IncludeSlow) { $r = Skip 'slow test: add -IncludeSlow' }
  elseif ($UI -and -not $IncludeUI) { $r = Skip 'types into the window: add -IncludeUI (do not touch keyboard/mouse)' }
  else {
    Reset-Env
    try { $r = @(& $Body) | Select-Object -Last 1 } catch { $r = Fail ('script error: ' + $_.Exception.Message) }
    if (-not $r -or -not ($r.PSObject.Properties.Name -contains 'S')) { $r = Review 'test produced no verdict' }
    Stop-Rpad
  }
  $row = [pscustomobject]@{ Id = $Id; Pri = $Pri; Status = $r.S; Secs = [math]::Round($sw.Elapsed.TotalSeconds, 1); Title = $Title; Detail = $r.D }
  [void]$script:Rows.Add($row)
  $col = @{ PASS = 'Green'; FAIL = 'Red'; REVIEW = 'Yellow'; SKIP = 'DarkGray' }[$r.S]
  Write-Host ("{0,-7} {1,-6} {2,-3} {3}" -f $r.S, $Id, $Pri, $Title) -ForegroundColor $col
  if ($r.S -ne 'PASS' -and $r.S -ne 'SKIP') { Write-Host ("        " + (Short $r.D 300)) -ForegroundColor DarkGray }
}


function Complete-Run {
###############################################################################
# REPORT
###############################################################################
Stop-Rpad
Set-Location $Root
$stamp = $Started.ToString('yyyyMMdd-HHmmss')
$csv = Join-Path $OutDir "results-$stamp.csv"; $md = Join-Path $OutDir "report-$stamp.md"
$script:Rows | Export-Csv -LiteralPath $csv -NoTypeInformation -Encoding UTF8

$sum = $script:Rows | Group-Object Status | ForEach-Object { "$($_.Name)=$($_.Count)" }
$lines = @("# rPad test run $stamp", '', "exe: ``$Rpad``  ", "summary: $($sum -join '  ')", '', '| Status | ID | Pri | Title | Detail |', '|---|---|---|---|---|')
foreach ($r in ($script:Rows | Sort-Object @{ e = { @{ FAIL = 0; REVIEW = 1; PASS = 2; SKIP = 3 }[$_.Status] } }, Id)) {
  $lines += "| $($r.Status) | $($r.Id) | $($r.Pri) | $($r.Title -replace '\|','/') | $(((Short $r.Detail 600)) -replace '\|','/') |"
}
Set-Content -LiteralPath $md -Value $lines -Encoding UTF8

Write-Host ''
Write-Host "Summary: $($sum -join '  ')" -ForegroundColor Cyan
Write-Host "Report:  $md"
Write-Host "CSV:     $csv"
if (@($script:Rows | Where-Object Status -eq 'FAIL').Count) { exit 1 } else { exit 0 }

}
