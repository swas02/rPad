#requires -Version 5.1
<#
.SYNOPSIS
  rPad review tests: these only OBSERVE. The spec does not say what must happen,
  so every result is REVIEW (read it and decide) unless rPad crashes, hangs or freezes (FAIL).
  Pass/fail checks are in Run-RpadTests.ps1.

.EXAMPLE
  .\Run-RpadReview.ps1 -Rpad C:\tools\rpad\rpad.exe
#>
[CmdletBinding()]
param(
  [string]$Rpad,
  [string[]]$Only = @(),        # run only IDs starting with these, e.g. -Only HV,LC-03
  [switch]$IncludeSlow,         # 100 MB+ files, 100k-file folders, 1000 args, unreachable UNC
  [switch]$IncludeUI,           # tests that type into the window with SendKeys (hands off keyboard!)
  [int]$Timeout = 15            # seconds a "second start" may take before it counts as a hang
)
. (Join-Path $PSScriptRoot 'RpadCommon.ps1')
Write-Host "WARNING: this kills every $ProcName process between tests. Close real rPad work first." -ForegroundColor Cyan

Write-Host 'Review checks: read each result and decide.' -ForegroundColor Cyan

###############################################################################
# 1. HELP / VERSION
###############################################################################
Test-Case 'HV-04' 'Unknown options and bad combinations' 'P2' {
  $obs = foreach ($a in '--bogus', '-x', '-N', '--NEW', '--Version', '-v', '-H', '-?', '/?', '/h', '-V -h', '-V hello.txt', '-n -V', '-h -n', '--version=1', '--ver', '-nV', '-Vh', '---new', '-nn', '--', '-- --new') {
    Observe $a -Cwd $SB
  }
  Matrix-Verdict $obs
}

Test-Case 'HV-05' 'No arguments' 'P2' {
  $o1 = Observe '' -Cwd $SB
  $o2 = Observe '' -Cwd $SB -Keep
  Matrix-Verdict @($o1, $o2)
}

Test-Case 'HV-06' 'Empty / blank / control-character arguments' 'P2' {
  $cr = [char]13; $lf = [char]10; $tab = [char]9
  $obs = foreach ($a in '""', '" "', '"   "', "`"$tab`"", "`"$lf`"", "`"$cr$lf`"", '"" ""', '"" hello.txt', 'hello.txt ""', "`"hello.txt$lf`"", "`"$([char]7)`"") { Observe $a -Cwd $SB }
  Matrix-Verdict $obs
}

###############################################################################
# 2. OPEN FILE
###############################################################################
Test-Case 'OF-05' 'Missing file' 'P1' {
  $p = F 'nope.txt'
  $o = Observe (Q $p)
  $created = Test-Path -LiteralPath $p
  if ($created) { return (Fail 'rPad created an empty file on disk just from opening a missing path (nothing was saved)') }
  if ($o.Crash) { return (Fail 'crash') }
  Review "UNSPECIFIED (Q3). exit=$($o.ExitCode) wins=$($o.Wins) tabs=<$($o.Tabs -join ',')> err='$(Short $o.Err)'. Good: clear error OR empty named tab; never silent."
}

Test-Case 'OF-09' 'File locked by another program (exclusive)' 'P1' {
  $p = F 'hello.txt'
  $fs = [IO.File]::Open($p, 'Open', 'ReadWrite', 'None')
  try { $o = Observe (Q $p) } finally { $fs.Close() }
  $bad = @(); if ($o.Crash) { $bad += 'crash' }; if ($o.Hung) { $bad += 'hang' }
  $txt = Get-EditorText
  if ($bad.Count) { return (Fail ($bad -join '; ')) }
  Review "UNSPECIFIED. Good: clear 'cannot read file' error. Bad: silent empty tab that looks like an empty file. wins=$($o.Wins) tabs=<$($o.Tabs -join ',')> editor='$(Short $txt 40)' err='$(Short $o.Err)'"
}

Test-Case 'OF-11' 'File deleted while open, then reopened' 'P1' {
  $p = F 'hello.txt'
  $o = Observe (Q $p)
  Remove-Item -LiteralPath $p -Force
  Start-Sleep -Milliseconds 800
  $x = Observe (Q $p) -Keep
  $alive = [bool](Get-Main)
  $bad = @(); if (-not $alive) { $bad += 'rPad died' }; if ($x.Hung) { $bad += 'hang' }
  if ($bad.Count) { return (Fail ($bad -join '; ')) }
  Review "UNSPECIFIED (Q16). After delete + reopen: exists=$(Test-Path -LiteralPath $p) tabs=<$($x.Tabs -join ',')> exit=$($x.ExitCode). Good: tell the user; never silently recreate a file nobody saved."
}

Test-Case 'OF-13' 'Binary and non-text files do not hang or get damaged' 'P2' {
  $files = @((F 'bin\binary.bin'), (F 'bin\all_bytes.bin'), (F 'bin\nul_middle.txt'), (F 'bin\nul_flood_1mb.txt'), (F 'bin\ctrl_z.txt'), (F 'bin\fake.png'), (F 'bin\fake_exe.txt'), "$env:windir\System32\notepad.exe")
  $bad = @(); $notes = @()
  foreach ($p in $files) {
    $h = Get-Hash $p
    $o = Observe (Q $p)
    if ($o.Crash) { $bad += "$([IO.Path]::GetFileName($p)) crash" }
    if ($o.Frozen) { $bad += "$([IO.Path]::GetFileName($p)) UI frozen" }
    if ((Get-Hash $p) -ne $h) { $bad += "$([IO.Path]::GetFileName($p)) modified by opening" }
    $notes += "$([IO.Path]::GetFileName($p)) wins=$($o.Wins) ms=$($o.Ms)"
  }
  if ($bad.Count) { Fail ($bad -join '; ') } else { Review ("UNSPECIFIED (Q13): " + ($notes -join ' | ')) }
}

###############################################################################
# 3. FILE NAMES AND PATHS
###############################################################################
Test-Case 'FN-01' 'Spaces: quoted opens one file, unquoted gives separate args' 'P1' {
  $p = F 'names\has space.txt'
  $o1 = Observe (Q $p)
  $ok = @($o1.Tabs | Where-Object { $_ -like '*has space*' }).Count
  $o2 = Observe ($p) -Keep    # unquoted: Windows splits into several args
  $bad = @(); if ($ok -ne 1) { $bad += "quoted path: <$($o1.Tabs -join ',')>" }
  if ($o2.Crash) { $bad += 'crash on unquoted' }
  if ($bad.Count) { Fail ($bad -join '; ') } else { Review "unquoted gave: <$($o2.Tabs -join ',')> (each piece is a separate argument, errors are fine, a wrong file opened is not)" }
}

Test-Case 'FN-02' 'Trailing backslash before the closing quote' 'P1' {
  $dir = F 'tree'
  $a = Observe ('"' + $dir + '\"') -Cwd $Work
  $b = Observe ('"' + $dir + '\" "' + (F 'hello.txt') + '"') -Cwd $Work
  Matrix-Verdict @($a, $b)
}

Test-Case 'FN-06' 'Path longer than 260 characters' 'P1' {
  $p = $SB; 1..6 | ForEach-Object { $p = Join-Path $p ('d' * 50 + $_) }
  [IO.Directory]::CreateDirectory('\\?\' + $p) | Out-Null
  $f = Join-Path $p 'long.txt'; [IO.File]::WriteAllText('\\?\' + $f, "LONGPATH-OK`r`n")
  $o1 = Observe (Q $f); $t1 = Get-EditorText
  $o2 = Observe (Q ('\\?\' + $f)); $t2 = Get-EditorText
  $r = Matrix-Verdict @($o1, $o2)
  if ($r.S -eq 'REVIEW') { Review ("path length=$($f.Length). content seen: plain='$(Short $t1 20)' prefixed='$(Short $t2 20)'. " + $r.D) } else { $r }
}

Test-Case 'FN-07' 'Huge argument and huge argument count' 'P3' {
  $obs = @()
  $obs += Observe ('"' + (F ('x' * 30000)) + '"') -Cwd $SB
  $obs += Observe ('"' + ('a' * 259) + '"') -Cwd $SB
  $obs += Observe ((1..300 | ForEach-Object { Q (F 'hello.txt') }) -join ' ') -Cwd $SB
  Matrix-Verdict $obs
}

Test-Case 'FN-11' 'Odd path forms' 'P3' {
  $d = (Split-Path $SB -Qualifier)
  $obs = foreach ($a in ($d + 'hello.txt'), ('\' + ($SB.Substring(2)) + '\hello.txt'), (($SB -replace '\\', '/') + '/hello.txt'), ($SB + '\\hello.txt'), ($SB + '\\\hello.txt'), ('"' + $SB + '\.\.\.\hello.txt"'), ('file:///' + ($SB -replace '\\', '/') + '/hello.txt'), 'http://example.com/a.txt', 'ftp://example.com/a.txt', ('"' + (F 'hello.txt') + '?x=1"'), ('"' + (F 'hello.txt') + '#5"'), ('"' + (F 'hello.txt') + '*"'), ('"' + (F 'hello.txt') + '|x"'), ('"' + (F 'hello.txt') + '<"')) { Observe $a -Cwd $Work }
  Matrix-Verdict $obs
}

Test-Case 'FN-12' 'Windows device names must not hang rPad' 'P1' {
  $pipeName = 'rpad_test_' + [guid]::NewGuid().ToString('N')
  $srv = New-Object IO.Pipes.NamedPipeServerStream($pipeName, 'InOut', 1, 'Byte', 'Asynchronous')   # never sends, never closes
  $fifo = F 'devices'; New-Item -ItemType Directory -Force $fifo | Out-Null
  try {
    $obs = foreach ($a in 'CON', 'NUL', 'COM1', 'PRN', 'AUX', 'LPT1', 'CONIN$', 'CONOUT$', '\\.\CON', '\\.\NUL', ("\\.\pipe\" + $pipeName), ('"' + (F 'hello.txt') + '\CON"'), ('"' + (F 'hello.txt') + '\NUL"')) {
      Observe $a -Cwd $SB
    }
  } finally { $srv.Dispose() }
  Matrix-Verdict $obs
}

Test-Case 'FN-13' 'Reserved name files created with \\?\ (cannot exist in a zip)' 'P2' {
  $d = F 'reserved'; New-Item -ItemType Directory -Force $d | Out-Null
  $made = @()
  foreach ($n in 'CON', 'aux.txt', 'NUL.txt', 'COM1', 'trailingdot.', 'trailingspace ') {
    try { [IO.File]::WriteAllText('\\?\' + $d + '\' + $n, "RESERVED-CONTENT`r`n"); $made += $n } catch { }
  }
  if (-not $made.Count) { return (Skip 'could not create any') }
  $obs = @(); foreach ($n in $made) { $obs += Observe (Q ('\\?\' + $d + '\' + $n)) -Cwd $SB; $obs += Observe (Q ($d + '\' + $n)) -Cwd $SB }
  $obs += Observe (Q $d) -Cwd $SB     # folder listing containing those names
  Matrix-Verdict $obs
}

Test-Case 'FN-14' 'Trailing dot / space: tab title and real file agree' 'P3' {
  $obs = foreach ($a in ('"' + (F 'hello.txt') + '."'), ('"' + (F 'hello.txt') + ' "'), ('"' + (F 'hello.txt') + '. . ."'), ('"' + $SB + '\ hello.txt"')) { Observe $a }
  Matrix-Verdict $obs
}

Test-Case 'FN-15' 'Alternate data streams' 'P2' {
  $p = F 'hello.txt'
  Set-Content -LiteralPath $p -Stream secret -Value 'ADS-CONTENT'
  $obs = foreach ($a in ((Q ($p + ':secret'))), ((Q ($p + ':secret:$DATA'))), (Q ($p + '::$DATA')), (Q ($p + ':nostream'))) { Observe $a -Cwd $SB }
  Matrix-Verdict $obs
}

Test-Case 'FN-16' 'Symlink, hardlink, junction' 'P2' {
  $t = F 'hello.txt'; $d = F 'links'; New-Item -ItemType Directory -Force $d | Out-Null
  $made = @{}
  try { New-Item -ItemType SymbolicLink -Path "$d\sym.txt" -Target $t -ErrorAction Stop | Out-Null; $made['sym'] = "$d\sym.txt" } catch { }
  & cmd.exe /c "mklink /H `"$d\hard.txt`" `"$t`"" 2>$null | Out-Null; if (Test-Path "$d\hard.txt") { $made['hard'] = "$d\hard.txt" }
  & cmd.exe /c "mklink /J `"$d\junc`" `"$SB`"" 2>$null | Out-Null; if (Test-Path "$d\junc\hello.txt") { $made['junc'] = "$d\junc\hello.txt" }
  if (-not $made.Count) { return (Skip 'cannot create links (need developer mode)') }
  $obs = @(); $first = Observe (Q $t)
  foreach ($k in $made.Keys) { $obs += Observe (Q $made[$k]) -Keep }
  $r = Matrix-Verdict $obs
  foreach ($j in "$d\junc") { if (Test-Path $j) { & cmd.exe /c "rmdir `"$j`"" | Out-Null } }
  if ($r.S -eq 'REVIEW') { Review ("UNSPECIFIED (Q19): after opening target + links tabs=<$($obs[-1].Tabs -join ',')>; links to the same file should reuse the tab. " + $r.D) } else { $r }
}

Test-Case 'FN-17' 'Shortcut (.lnk) and .url files are not executed' 'P2' {
  $marker = Join-Path $Work 'lnk_executed.txt'; Remove-Item $marker -ErrorAction SilentlyContinue
  $cmd = F 'runme.cmd'; Set-Content -LiteralPath $cmd -Value "@echo executed> `"$marker`""
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((F 'link.lnk')); $lnk.TargetPath = $cmd; $lnk.Save()
  Set-Content -LiteralPath (F 'site.url') -Value "[InternetShortcut]`r`nURL=file:///$($cmd -replace '\\','/')"
  $obs = @((Observe (Q (F 'link.lnk'))), (Observe (Q (F 'site.url'))), (Observe (Q $cmd)))
  Start-Sleep 2
  if (Test-Path $marker) { return (Fail 'opening a .lnk/.url/.cmd RAN the program') }
  $r = Matrix-Verdict $obs
  if ($r.S -eq 'REVIEW') { Review ("UNSPECIFIED (Q14): .lnk shows its own bytes or its target? " + $r.D) } else { $r }
}

Test-Case 'FN-19' 'Wildcards: rPad must not guess' 'P3' {
  $o = Observe '*.txt' -Cwd $SB
  $o2 = Observe '"*.txt"' -Cwd $SB
  $o3 = Observe 'hello.tx?' -Cwd $SB
  $r = Matrix-Verdict @($o, $o2, $o3)
  if ($r.S -eq 'REVIEW') { Review ("UNSPECIFIED (Q18). cmd.exe passes '*.txt' literally; PowerShell expands it. If rPad expands itself it may open hundreds of files. " + $r.D) } else { $r }
}

###############################################################################
# 4. LINE AND COLUMN
###############################################################################
Test-Case 'LC-03' 'Line numbers: 1, last, one past, zero, negative, huge' 'P1' {
  $obs = foreach ($s in 1, 100, 101, 0, -1, 2147483647, 2147483648, 4294967296, 99999999999999999999) {
    $o = Observe (Q ((F 'lines100.txt') + ':' + $s)) -Cwd $SB
    $c = Get-Caret; $o | Add-Member -NotePropertyName Sum -NotePropertyValue ($o.Sum + " caret='" + (Short $(if ($c) { $c.Line } else { '?' }) 22) + "'") -Force; $o
  }
  Matrix-Verdict $obs
}

Test-Case 'LC-04' 'Columns: 0, past end of line, negative, huge' 'P1' {
  $obs = foreach ($s in '42:0', '42:1', '42:9999', '42:-3', '42:2147483648', '42:99999999999999999999', '1:1', '100:9999') {
    Observe (Q ((F 'lines100.txt') + ':' + $s)) -Cwd $SB
  }
  Matrix-Verdict $obs
}

Test-Case 'LC-05' 'Malformed line/column syntax' 'P1' {
  $p = F 'lines100.txt'
  $obs = foreach ($s in ':', '::', ':abc', ':1.5', ':+5', ': 5', ':0x10', ':1e3', ':5:', ':5:3:9', ":$([char]0xFF15)", ":$([char]0x0663)", ':00042', ':5-10', ':5,3', ':5;3', '::5', ':5:abc', ':abc:5', ':-', ':%41') {
    Observe (Q ($p + $s)) -Cwd $SB
  }
  Matrix-Verdict $obs
}

Test-Case 'LC-07' 'File called "12" or "notes" and line suffix ambiguity' 'P2' {
  $d = F 'numeric'
  $obs = @((Observe '12' -Cwd $d), (Observe '12:3' -Cwd $d), (Observe 'notes:5' -Cwd $d), (Observe '7:1:1' -Cwd $d), (Observe '12:12' -Cwd $d))
  Set-Content -LiteralPath (Join-Path $d 'a.txt') -Stream '5' -Value 'ADS-FIVE'
  $obs += Observe 'a.txt:5' -Cwd $d
  $c = Get-Caret
  $r = Matrix-Verdict $obs
  if ($r.S -eq 'REVIEW') { Review ("UNSPECIFIED (Q4): 'a.txt:5' when stream '5' exists -> line 5 of a.txt or the stream? caret='$(if($c){Short $c.Line 20})'. " + $r.D) } else { $r }
}

Test-Case 'LC-08' 'Line/col on missing file, folder, -n, stdin' 'P2' {
  $obs = foreach ($a in ('"' + (F 'nope.txt') + ':5"'), ('"' + (F 'tree') + ':5"'), '-n:5', '-:5', '--new:3', '-n 5', '-n :5', (Q ((F 'empty.txt') + ':5:5'))) { Observe $a -Cwd $SB }
  Matrix-Verdict $obs
}

Test-Case 'LC-12' 'Several line targets in one command (incl. same file twice)' 'P2' {
  $p = F 'lines100.txt'; $q = F 'hello.txt'
  $o = Observe ((Q ($p + ':3')) + ' ' + (Q ($q + ':1')) + ' ' + (Q ($p + ':50')))
  Matrix-Verdict @($o)
}

###############################################################################
# 5. NEW NOTE  (-n / --new)
###############################################################################
Test-Case 'NW-04' '-n combined with files, options, stdin' 'P2' {
  $h = Q (F 'hello.txt')
  $obs = foreach ($a in "-n $h", "$h -n", "--new $h", "-n -n", "-n --new", "-n -n -n", "-n -", "- -n", "-n $h -n $h", "-n -V", "-V -n", "-n -h") { Observe $a -Cwd $SB }
  Matrix-Verdict $obs
}

###############################################################################
# 6. STDIN  (rpad -)
###############################################################################
Test-Case 'ST-02' 'Empty stdin' 'P2' {
  $o = Observe '-' -Stdin (F 'empty.txt') -Cwd $SB
  Matrix-Verdict @($o)
}

Test-Case 'ST-03' 'stdin with odd content: UTF-16, invalid UTF-8, NULs, Ctrl-Z, CR only' 'P2' {
  $obs = foreach ($n in 'enc\utf16le.txt', 'enc\invalid_utf8.txt', 'bin\nul_middle.txt', 'bin\ctrl_z.txt', 'enc\cr.txt', 'bin\binary.bin', 'enc\utf8_bom.txt') {
    $o = Observe '-' -Stdin (F $n) -Cwd $SB; $t = Get-EditorText
    $o | Add-Member -NotePropertyName Sum -NotePropertyValue ("[stdin $n] exit=$($o.ExitCode) wins=$($o.Wins) text='" + (Short $t 20) + "'") -Force; $o
  }
  Matrix-Verdict $obs
}

Test-Case 'ST-04' '5 MB single line from stdin' 'P2' {
  $o = Observe '-' -Stdin (F 'hostile\long_line_5mb.txt') -Cwd $SB
  Matrix-Verdict @($o)
}

Test-Case 'ST-06' 'rpad - with stdin closed / redirected from nothing' 'P2' {
  $obs = @()
  $obs += Observe '-' -Stdin (F 'empty.txt') -Cwd $SB
  $psi = New-Object Diagnostics.ProcessStartInfo $Rpad, '-'; $psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true
  $p = [Diagnostics.Process]::Start($psi); $p.StandardInput.Close(); $ex = $p.WaitForExit(8000)
  $note = "stdin closed at once: exited=$ex"
  if (-not $ex) { Stop-Rpad }
  $r = Matrix-Verdict $obs; if ($r.S -eq 'REVIEW') { Review ("$note. " + $r.D) } else { $r }
}

Test-Case 'ST-08' '"-" mixed with files and repeated' 'P2' {
  $h = Q (F 'hello.txt')
  $obs = foreach ($a in "- $h", "$h -", "- -", "- - -", "-n -", "-:3", '"-"') { Observe $a -Stdin (F 'enc\lf.txt') -Cwd $SB }
  Matrix-Verdict $obs
}

###############################################################################
# 7. FOLDERS
###############################################################################
Test-Case 'FD-02' 'Folder forms: ., .., trailing slash, forward slash, duplicates' 'P2' {
  $d = F 'tree'
  $obs = foreach ($a in '.', '..', ('"' + $d + '\"'), ('"' + ($d -replace '\\', '/') + '/"'), ('"' + $d + '\\"'), (Q $d), ((Q $d) + ' ' + (Q $d)), ((Q $d) + ' ' + (Q (F 'tree\sub1'))), ((Q (F 'tree\a.txt')) + ' ' + (Q $d))) { Observe $a -Cwd $d }
  Matrix-Verdict $obs
}

Test-Case 'FD-06' 'Deeply nested folder (150 levels)' 'P2' {
  $p = F 'deep'; 1..150 | ForEach-Object { $p = Join-Path $p 'n' }
  [IO.Directory]::CreateDirectory('\\?\' + $p) | Out-Null; [IO.File]::WriteAllText('\\?\' + $p + '\leaf.txt', 'leaf')
  $o = Observe (Q (F 'deep')) -Settle 2500
  Matrix-Verdict @($o)
}

Test-Case 'FD-07' 'Folder with unreadable sub-folder and locked file' 'P2' {
  $d = F 'perm'; New-Item -ItemType Directory "$d\locked_dir", "$d\ok" | Out-Null
  [IO.File]::WriteAllText("$d\locked_dir\x.txt", 'x'); [IO.File]::WriteAllText("$d\ok\y.txt", 'y'); [IO.File]::WriteAllText("$d\held.txt", 'held')
  & icacls "$d\locked_dir" /deny "${env:USERNAME}:(OI)(CI)(RX)" 2>$null | Out-Null
  $fs = [IO.File]::Open("$d\held.txt", 'Open', 'ReadWrite', 'None')
  try { $o = Observe (Q $d) -Settle 1500 } finally { $fs.Close(); & icacls "$d\locked_dir" /remove:d $env:USERNAME 2>$null | Out-Null }
  Matrix-Verdict @($o)
}

Test-Case 'FD-08' 'System and huge folders: C:\, Windows, Users, profile' 'P1' {
  $obs = foreach ($a in 'C:\', 'C:\Windows', 'C:\Windows\System32', 'C:\Users', ('"' + $env:USERPROFILE + '"'), 'C:\$Recycle.Bin', '"C:\System Volume Information"', '"C:\Program Files"') {
    $o = Observe $a -Settle 4000
    $m = Get-Main; $mem = if ($m) { [int]($m.WorkingSet64 / 1MB) } else { 0 }
    if ($mem -gt 2500) { $o | Add-Member -NotePropertyName Frozen -NotePropertyValue $true -Force }
    $o | Add-Member -NotePropertyName Sum -NotePropertyValue ($o.Sum + " mem=${mem}MB") -Force; $o
  }
  Matrix-Verdict $obs
}

###############################################################################
# 11. SECURITY / FILES NOBODY NAMED
###############################################################################
Test-Case 'SC-02' 'Protected files give a clear error, not a crash or partial content' 'P1' {
  $obs = foreach ($a in '"C:\Windows\System32\config\SAM"', '"C:\pagefile.sys"', '"C:\hiberfil.sys"', '"C:\System Volume Information\x.txt"', '"C:\Windows\System32\drivers\etc\hosts"', '"C:\Windows\System32\LogFiles\WMI\RtBackup\EtwRTEventLog-Application.etl"') { Observe $a }
  Matrix-Verdict $obs
}

Test-Case 'SC-04' 'Hostile text content: ANSI, bidi, zero-width, format strings' 'P2' {
  $obs = foreach ($n in 'ansi_escapes.txt', 'bidi_content.txt', 'zero_width.txt', 'format_strings.txt', 'path_like_content.txt', 'html_script.txt', 'many_tabs_chars.txt') { Observe (Q (F "hostile\$n")) }
  Matrix-Verdict $obs
}

Test-Case 'SC-05' 'Heavy text content: 200k combining marks, 200k blank lines, 5 MB line' 'P2' {
  $obs = foreach ($n in 'combining_flood.txt', 'blank_lines_200k.txt', 'long_line_5mb.txt') {
    $sw = [Diagnostics.Stopwatch]::StartNew(); $o = Observe (Q (F "hostile\$n")) -Settle 1500
    $o | Add-Member -NotePropertyName Sum -NotePropertyValue ($o.Sum + " t=$([math]::Round($sw.Elapsed.TotalSeconds,1))s") -Force; $o
  }
  Matrix-Verdict $obs
}

Test-Case 'SC-06' 'Right-to-left override in a file NAME (tab-title spoofing)' 'P2' {
  $n = Get-ChildItem -LiteralPath (F 'names') | Where-Object { $_.Name -like "evil*" } | Select-Object -First 1
  if (-not $n) { return (Skip 'zip extractor dropped the name') }
  $o = Observe (Q $n.FullName)
  $res = Matrix-Verdict @($o)
  if ($res.S -eq 'REVIEW') { Review ("UNSPECIFIED (Q26): the real name contains U+202E. Check by eye: does the tab show 'evilgnp.exe' reversed (looks like evil exe.png)? Good: show the control char escaped. Tab=<$($o.Tabs -join ',')>") } else { $res }
}

Test-Case 'SC-07' 'UNC / remote paths named by the user: no credential prompt freeze' 'P2' -Slow {
  $o1 = Observe '"\\192.0.2.1\x\y.txt"' -Settle 500
  $o2 = Observe '"\\localhost\C$\Windows\win.ini"' -Settle 500 -Keep
  Matrix-Verdict @($o1, $o2)
}

Test-Case 'SC-09' '1,000 files in one command (needs short names; may exceed 32 KB)' 'P3' -Slow {
  $d = F 'f1000'; New-NumberedFiles $d 1000
  $o = Observe ((1..1000 | ForEach-Object { "f$_.txt" }) -join ' ') -Cwd $d -Settle 4000
  Matrix-Verdict @($o)
}

function Enc-Info($name) {
  switch -Wildcard ($name) {
    'utf8_bom*'  { @{ Bom = [byte[]](0xEF, 0xBB, 0xBF); Enc = New-Object Text.UTF8Encoding($false) } }
    'utf8_nobom*'{ @{ Bom = [byte[]]@(); Enc = New-Object Text.UTF8Encoding($false) } }
    'utf16le*'   { @{ Bom = [byte[]](0xFF, 0xFE); Enc = [Text.Encoding]::Unicode } }
    'utf16be*'   { @{ Bom = [byte[]](0xFE, 0xFF); Enc = [Text.Encoding]::BigEndianUnicode } }
    'cp1252*'    { @{ Bom = [byte[]]@(); Enc = [Text.Encoding]::GetEncoding(1252) } }
    default      { @{ Bom = [byte[]]@(); Enc = New-Object Text.UTF8Encoding($false) } }
  }
}

###############################################################################
# 13. SPEED
###############################################################################
Test-Case 'SP-04' '100 MB file on ONE line' 'P3' -Slow {
  $f = Join-Path $Work 'oneline100.txt'; if (-not (Test-Path $f)) { New-BigFile $f 100MB 'oneline' }
  $o = Observe (Q $f) -Settle 3000; Matrix-Verdict @($o)
}

Complete-Run

