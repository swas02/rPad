#requires -Version 5.1
<#
.SYNOPSIS
  Black-box "break it" suite for rPad (Windows plain-text notepad). See README.md.

.EXAMPLE
  .\Run-RpadTests.ps1 -Rpad C:\tools\rpad\rpad.exe
  .\Run-RpadTests.ps1 -Only LC,SI -IncludeUI
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

Write-Host 'Checks with a clear pass or fail.' -ForegroundColor Cyan

###############################################################################
# 1. HELP / VERSION
###############################################################################
Test-Case 'HV-01' '-V and --version print and exit, no window' 'P1' {
  $bad = @(); $notes = @(); $outs = @()
  foreach ($f in '-V', '--version') {
    $o = Observe $f -NoWin
    if ($o.Crash) { $bad += "$f crashed ($($o.ExitCode))" }
    if (-not $o.Exited) { $bad += "$f did not exit" }
    elseif ($o.ExitCode -ne 0) { $bad += "$f exit code $($o.ExitCode)" }
    if ($o.Wins -gt 0) { $bad += "$f opened a window" }
    $outs += $o.Out.Trim()
    if (-not $o.Out.Trim()) { $notes += "$f printed nothing on stdout (Q7)" }
  }
  if ($outs[0] -ne $outs[1]) { $bad += "-V and --version differ: '$($outs[0])' vs '$($outs[1])'" }
  if ($bad.Count) { Fail ($bad -join '; ') } elseif ($notes.Count) { Review ($notes -join '; ') } else { Pass "version='$($outs[0])'" }
}

Test-Case 'HV-02' '-h and --help print usage and exit, no window' 'P1' {
  $bad = @(); $notes = @()
  foreach ($f in '-h', '--help') {
    $o = Observe $f -NoWin
    if ($o.Crash) { $bad += "$f crashed" }
    if (-not $o.Exited) { $bad += "$f did not exit" }
    elseif ($o.ExitCode -ne 0) { $bad += "$f exit code $($o.ExitCode)" }
    if ($o.Wins -gt 0) { $bad += "$f opened a window" }
    $t = $o.Out + $o.Err
    if (-not $t.Trim()) { $notes += "$f printed nothing (Q7)" }
    else { foreach ($tok in '-n', '--new', '-V', '--version', '-h', '--help', ':') { if ($t -notlike "*$tok*") { $bad += "$f output lacks '$tok'" } } }
  }
  if ($bad.Count) { Fail ($bad -join '; ') } elseif ($notes.Count) { Review ($notes -join '; ') } else { Pass }
}

Test-Case 'HV-03' '-V / -h leave a running window untouched' 'P2' {
  $a = Observe 'hello.txt' -Cwd $SB
  if ($a.Wins -lt 1) { return (Skip 'no window appeared') }
  $t0 = @(Get-Tabs)
  $o1 = Observe '-V' -Keep -NoWin; $o2 = Observe '-h' -Keep -NoWin
  $t1 = @(Get-Tabs)
  $bad = @()
  if (($t0 -join '|') -ne ($t1 -join '|')) { $bad += "tabs changed: <$($t0 -join ',')> -> <$($t1 -join ',')>" }
  if (@(Get-Process -Name $ProcName -ErrorAction SilentlyContinue).Count -ne 1) { $bad += 'process count is not 1' }
  if ($o1.Crash -or $o2.Crash) { $bad += 'crash' }
  Verdict $bad
}

###############################################################################
# 2. OPEN FILE
###############################################################################
Test-Case 'OF-01' 'Open one file: right tab, file untouched' 'P1' {
  $p = F 'hello.txt'; $h = Get-Hash $p; $t = (Get-Item -LiteralPath $p).LastWriteTimeUtc
  $o = Observe (Q $p)
  $txt = Get-EditorText
  Stop-Rpad
  $bad = @()
  if ($o.Wins -lt 1) { $bad += 'no window' }
  if (@($o.Tabs | Where-Object { $_ -like '*hello.txt*' }).Count -ne 1) { $bad += "tabs: <$($o.Tabs -join ',')>" }
  if ($null -ne $txt -and $txt -notlike '*hello rPad*') { $bad += "editor text wrong: '$(Short $txt 50)'" }
  if ((Get-Hash $p) -ne $h) { $bad += 'file content changed by merely opening it' }
  if ((Get-Item -LiteralPath $p).LastWriteTimeUtc -ne $t) { $bad += 'file timestamp changed by merely opening it' }
  if ($o.Crash) { $bad += 'crash' }
  Verdict $bad
}

Test-Case 'OF-02' 'Open several files: all tabs, right order' 'P1' {
  $o = Observe ((Q (F 'hello.txt')) + ' ' + (Q (F 'lines100.txt')) + ' ' + (Q (F 'empty.txt')))
  $bad = @()
  if ($o.Tabs.Count -eq 0) { return (Review 'UI Automation cannot see tabs; check by hand: 3 tabs, order hello, lines100, empty') }
  if ($o.Tabs.Count -ne 3) { $bad += "expected 3 tabs, got $($o.Tabs.Count): $($o.Tabs -join ',')" }
  elseif (($o.Tabs -join '|') -notmatch 'hello.*lines100.*empty') { $bad += "order differs: $($o.Tabs -join ',')" }
  Verdict $bad "tabs: $($o.Tabs -join ',')  (which one is active is UNSPECIFIED, Q15)"
}

Test-Case 'OF-03' 'Same file twice in one command' 'P2' {
  $o = Observe ((Q (F 'hello.txt')) + ' ' + (Q (F 'hello.txt')))
  if ($o.Tabs.Count -eq 0) { return (Review 'tabs not visible to UIA') }
  if ($o.Tabs.Count -gt 1) { Fail "two tabs for one file (two buffers = one save overwrites the other): $($o.Tabs -join ',')" } else { Pass }
}

Test-Case 'OF-04' 'Same file, different spellings -> one tab' 'P1' {
  $p = F 'hello.txt'
  $dir = Split-Path $p
  $short = $null; try { $short = (New-Object -ComObject Scripting.FileSystemObject).GetFile($p).ShortPath } catch { }
  $variants = @($p, $p.ToUpper(), $p.ToLower(), ($dir + '\.\hello.txt'), ($dir + '\tree\..\hello.txt'), ($p -replace '\\', '/'), ('\\?\' + $p), ('\\localhost\' + $p.Substring(0, 1) + '$' + $p.Substring(2)), $short) | Where-Object { $_ }
  $o = Observe (Q $variants[0])
  if (-not $o.Wins) { return (Skip 'no window') }
  $bad = @(); $notes = @()
  foreach ($v in $variants[1..($variants.Count - 1)]) {
    $x = Observe (Q $v) -Keep
    $n = @($x.Tabs).Count
    if ($n -ne 1) { $bad += "[$v] -> $n tabs" } else { $notes += 'ok' }
  }
  Verdict $bad ("all " + $variants.Count + " spellings map to one tab")
}

Test-Case 'OF-06' 'Missing file mixed with good files' 'P2' {
  $o = Observe ((Q (F 'hello.txt')) + ' ' + (Q (F 'nope.txt')) + ' ' + (Q (F 'lines100.txt')))
  $bad = @()
  if (@($o.Tabs | Where-Object { $_ -like '*hello*' }).Count -lt 1) { $bad += 'hello.txt not opened' }
  if (@($o.Tabs | Where-Object { $_ -like '*lines100*' }).Count -lt 1) { $bad += 'lines100.txt (after the bad arg) not opened' }
  if ($o.Crash) { $bad += 'crash' }
  Verdict $bad "tabs: <$($o.Tabs -join ',')>"
}

Test-Case 'OF-07' 'Empty file, 0 bytes' 'P2' {
  $p = F 'empty.txt'
  $o = Observe (Q $p)
  $bad = @(); if ($o.Wins -lt 1) { $bad += 'no window' }; if ($o.Crash) { $bad += 'crash' }
  if ((Get-Item -LiteralPath $p).Length -ne 0) { $bad += 'empty file got bytes without any edit' }
  Verdict $bad
}

Test-Case 'OF-08' 'Read-only file opens and stays untouched' 'P2' {
  $p = F 'hello.txt'; (Get-Item -LiteralPath $p).IsReadOnly = $true; $h = Get-Hash $p
  $o = Observe (Q $p)
  $bad = @(); if ($o.Wins -lt 1) { $bad += 'did not open' }; if ((Get-Hash $p) -ne $h) { $bad += 'changed' }
  (Get-Item -LiteralPath $p).IsReadOnly = $false
  Verdict $bad
}

Test-Case 'OF-10' 'File locked with share-read: must open' 'P2' {
  $p = F 'hello.txt'
  $fs = [IO.File]::Open($p, 'Open', 'Read', 'Read')
  try { $o = Observe (Q $p) } finally { $fs.Close() }
  $txt = Get-EditorText
  $bad = @(); if ($o.Crash) { $bad += 'crash' }
  if ($o.Wins -lt 1) { $bad += 'no window' }
  if ($null -ne $txt -and $txt -notlike '*hello rPad*') { $bad += 'file shared for reading did not load' }
  Verdict $bad
}

Test-Case 'OF-12' 'Encodings and line endings load correctly' 'P1' {
  $expect = @{ 'utf8_bom.txt' = 'Gr'; 'utf8_nobom.txt' = 'Gr' }   # rPad opens UTF-8 only; UTF-16 and cp1252 are refused with a message (see Q13)
  $bad = @(); $notes = @()
  foreach ($n in 'utf8_bom.txt', 'utf8_nobom.txt', 'utf16le.txt', 'utf16be.txt', 'cp1252.txt', 'invalid_utf8.txt', 'crlf.txt', 'lf.txt', 'cr.txt', 'mixed_eol.txt', 'bom_only.txt', 'utf16_odd_length.txt', 'bom_in_middle.txt', 'utf16_lone_surrogate.txt', 'utf8_overlong_and_cesu.bin') {
    $p = F "enc\$n"; $h = Get-Hash $p
    $o = Observe (Q $p)
    $txt = Get-EditorText
    if ($o.Crash) { $bad += "$n crash" }
    if ($o.Wins -lt 1) { $bad += "$n no window" }
    if ((Get-Hash $p) -ne $h) { $bad += "$n modified by opening" }
    if ($null -ne $txt) {
      if ($expect.ContainsKey($n)) {
        if ($txt -notlike '*Gr*e*') { $bad += "$n text wrong: '$(Short $txt 40)'" }
        if ($n -ne 'cp1252.txt' -and $txt -notlike "*$([char]0x00fc)*") { $bad += "$n lost the u-umlaut: '$(Short $txt 40)'" }
        if ($n -like 'utf8*' -and $txt -like "*$([char]0xfffd)*") { $bad += "$n shows replacement chars" }
        if ($n -like 'utf16*' -and $txt -like "*$([char]0)*") { $bad += "$n shows NULs (UTF-16 not detected)" }
      }
      $notes += "$n=>'$(Short $txt 24)'"
    }
  }
  if ($bad.Count) { Fail ($bad -join '; ') } else { Review ("no crash, files unmodified. Invalid/odd encodings are UNSPECIFIED (Q13): " + ($notes -join ' | ')) }
}

Test-Case 'OF-14' 'Open then quit without edits does not rewrite file' 'P2' {
  $p = F 'lines100.txt'; $h = Get-Hash $p; $t = (Get-Item -LiteralPath $p).LastWriteTimeUtc
  $o = Observe (Q $p)
  $m = Get-Main; if ($m) { [void]$m.CloseMainWindow(); Start-Sleep 2 }
  Stop-Rpad
  $bad = @(); if ((Get-Hash $p) -ne $h) { $bad += 'content changed' }
  if ((Get-Item -LiteralPath $p).LastWriteTimeUtc -ne $t) { $bad += 'timestamp changed (file was re-saved)' }
  Verdict $bad
}

###############################################################################
# 3. FILE NAMES AND PATHS
###############################################################################
Test-Case 'FN-03' 'Unicode names: title and content match the right file' 'P1' {
  $bad = @(); $notes = @()
  foreach ($n in ([IO.Directory]::GetFiles((F 'names')) | ForEach-Object { [IO.Path]::GetFileName($_) } | Where-Object { $_ -match '[^\x00-\x7f]' })) {
    $p = F "names\$n"
    $o = Observe (Q $p)
    $txt = Get-EditorText
    if ($o.Crash) { $bad += "[$n] crash" }
    if ($o.Wins -lt 1) { $bad += "[$n] no window" }
    if (@($o.Tabs).Count -ge 1 -and (($o.Tabs -join '') -match '[?\ufffd]')) { $bad += "[$n] mangled tab title: $($o.Tabs -join ',')" }
    if ($null -ne $txt -and $txt -notlike '*MARKER-NAMES*') { $bad += "[$n] wrong or empty content" }
  }
  Verdict $bad
}

Test-Case 'FN-04' 'NFC vs NFD names open the right file' 'P2' {
  $nfc = Get-ChildItem -LiteralPath (F 'names') | Where-Object { $_.Name -like 'nfc_*' }
  $nfd = Get-ChildItem -LiteralPath (F 'names') | Where-Object { $_.Name -like 'nfd_*' }
  if (-not $nfc -or -not $nfd) { return (Skip 'zip extractor merged the two names') }
  $o1 = Observe (Q $nfc.FullName); $t1 = Get-EditorText
  $o2 = Observe (Q $nfd.FullName); $t2 = Get-EditorText
  $bad = @()
  if ($null -ne $t1 -and $t1 -notlike '*nfc_*') { $bad += "NFC file shows: '$(Short $t1 40)'" }
  if ($null -ne $t2 -and $t2 -notlike '*nfd_*') { $bad += "NFD file shows: '$(Short $t2 40)'" }
  Verdict $bad
}

Test-Case 'FN-05' 'Shell metacharacters in names: nothing is executed or expanded' 'P1' {
  $d = Join-Path $SB 'inject'; New-Item -ItemType Directory -Force $d | Out-Null
  $names = @('a&md pwned_amp.txt', 'a%TEMP%b.txt', 'a%USERNAME%.txt', 'a^&md pwned_caret.txt', 'a$(md pwned_ps).txt', 'a`md.txt', "a'md pwned_apos.txt", 'a!USERNAME!.txt', 'a;md pwned_semi.txt', 'a,b.txt', 'a=b.txt')
  foreach ($n in $names) { [IO.File]::WriteAllText((Join-Path $d $n), "INJECT-FILE`r`n") }
  $bad = @(); $notes = @()
  foreach ($n in $names) {
    $o = Observe (Q (Join-Path $d $n))
    $x = Observe (Q (Join-Path $d $n)) -Keep       # again, now as a second start (forwarded to the first window)
    if ($o.Crash -or $x.Crash) { $bad += "[$n] crash" }
    if (@($x.Tabs | Where-Object { $_ -like '*a*' }).Count -lt 1) { $bad += "[$n] no tab" }
  }
  foreach ($m in 'pwned_amp.txt', 'pwned_caret.txt', 'pwned_ps', 'pwned_apos.txt', 'pwned_semi.txt') {
    if (Get-ChildItem -LiteralPath $Work, $d, $SB -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $m -and $_.PSIsContainer }) { $bad += "COMMAND INJECTION: '$m' directory was created" }
  }
  Verdict $bad
}

Test-Case 'FN-08' 'Relative paths use the CALLER folder' 'P1' {
  $o = Observe 'hello.txt' -Cwd $SB
  $o2 = Observe '.\sub\..\hello.txt' -Cwd $SB
  $o3 = Observe '..\hello.txt' -Cwd (F 'tree')
  $bad = @(); foreach ($x in $o, $o2, $o3) { if (@($x.Tabs | Where-Object { $_ -like '*hello*' }).Count -ne 1) { $bad += "[$($x.A)] tabs <$($x.Tabs -join ',')>" } }
  Verdict $bad
}

Test-Case 'FN-09' 'Relative path with window already running from ANOTHER folder' 'P1' {
  # Classic bug: the running window resolves relative paths against its own folder.
  $x = F 'same_name\x'; $y = F 'same_name\y'
  $a = Observe 'a.txt' -Cwd $x
  $b = Observe 'a.txt' -Cwd $y -Keep
  $bad = @()
  if ($b.Tabs.Count -eq 0) { return (Review 'tabs not visible to UIA. By hand: two tabs, second must show Y-MARKER') }
  if ($b.Tabs.Count -ne 2) { $bad += "expected 2 tabs (x\a.txt and y\a.txt), got $($b.Tabs.Count): $($b.Tabs -join ',')  -> second start resolved 'a.txt' wrongly" }
  else { $null = Select-Tab 'a.txt'; $t = Get-EditorText; if ($null -ne $t -and $t -notlike '*MARKER*') { $bad += 'could not read content' } }
  $c = Observe 'a.txt' -Cwd $y -Keep
  $txt = Get-EditorText
  if ($null -ne $txt -and $txt -notlike '*Y-MARKER*') { $bad += "re-opening y\a.txt shows: '$(Short $txt 30)' (expected Y-MARKER) => wrong file" }
  Verdict $bad
}

Test-Case 'FN-10' 'Same relative name in two folders are different tabs; case-only difference is one file' 'P2' {
  $a = Observe (Q (F 'same_name\x\a.txt'))
  $b = Observe (Q (F 'same_name\y\a.txt')) -Keep
  $c = Observe (Q (F 'same_name\x\A.TXT')) -Keep
  $bad = @(); if ($c.Tabs.Count -ne 2 -and $c.Tabs.Count -ne 0) { $bad += "expected 2 tabs, got $($c.Tabs.Count): $($c.Tabs -join ',')" }
  Verdict $bad
}

Test-Case 'FN-18' 'File names that look like options' 'P1' {
  $d = F 'optlike'
  $bad = @(); $notes = @()
  foreach ($n in '-n', '--new', '-', '-V', '--version', '-h', '--help', '-nn') {
    $o = Observe ('".\' + $n + '"') -Cwd $d
    $txt = Get-EditorText
    if ($o.Exited -and $o.Out -and $n -in '-V', '--version', '-h', '--help') { $bad += ".\$n printed version/help instead of opening the file" }
    if ($o.Crash) { $bad += ".\$n crash" }
    if ($o.Wins -gt 0 -and $null -ne $txt -and $txt -notlike "*FILE named $n*") { $bad += ".\$n opened wrong content: '$(Short $txt 40)'" }
    if ($o.Wins -gt 0 -and @($o.Tabs | Where-Object { $_ -like "*$n*" }).Count -eq 0 -and $o.Tabs.Count -gt 0) { $bad += ".\$n tab titles <$($o.Tabs -join ',')>" }
  }
  $o2 = Observe '-- -n' -Cwd $d; $o3 = Observe '-- --new' -Cwd $d
  if ($bad.Count) { Fail ($bad -join '; ') } else { Review "'.\-n' style works. '--' support is UNSPECIFIED (Q11): [-- -n] => $($o2.Sum) ; [-- --new] => $($o3.Sum)" }
}

Test-Case 'FN-20' 'Environment-variable text in a path is not expanded' 'P2' {
  $d = Join-Path $SB '%TEMP%'; New-Item -ItemType Directory -Force $d | Out-Null
  [IO.File]::WriteAllText((Join-Path $d 'in_percent_dir.txt'), "PERCENT-DIR`r`n")
  $o = Observe (Q (Join-Path $d 'in_percent_dir.txt')); $t = Get-EditorText
  $bad = @(); if ($null -ne $t -and $t -notlike '*PERCENT-DIR*') { $bad += "wrong file: '$(Short $t 30)'" }
  if (@($o.Tabs | Where-Object { $_ -like '*in_percent_dir*' }).Count -ne 1 -and $o.Tabs.Count) { $bad += "tabs <$($o.Tabs -join ',')>" }
  $o2 = Observe '%USERPROFILE%\x.txt' -Cwd $SB -Keep
  Verdict $bad
}

Test-Case 'FN-21' 'Network paths: unreachable server keeps UI alive' 'P2' -Slow {
  $a = Observe (Q (F 'hello.txt'))
  $b = Observe '"\\192.0.2.1\share\a.txt"' -Keep -Settle 500
  $c = Observe (Q (F 'lines100.txt')) -Keep
  $bad = @()
  if ($b.Crash) { $bad += 'crash on unreachable UNC' }
  if (@($c.Tabs | Where-Object { $_ -like '*lines100*' }).Count -ne 1) { $bad += 'rPad stuck while waiting for the network: next file did not open' }
  Verdict $bad "time for unreachable UNC start: $($b.Ms) ms"
}

###############################################################################
# 4. LINE AND COLUMN
###############################################################################
Test-Case 'LC-01' 'file:line goes to that line' 'P1' {
  $o = Observe (Q ((F 'lines100.txt') + ':42')) -Cwd $SB
  $c = Get-Caret
  if (-not $c) { return (Review 'caret not visible to UIA. By hand: cursor on line 042 and scrolled into view') }
  if ($c.Line -like '*line 042*') { Pass } else { Fail "caret line is '$(Short $c.Line 40)' expected 'line 042'" }
}

Test-Case 'LC-02' 'file:line:col' 'P1' {
  $o = Observe (Q ((F 'lines100.txt') + ':42:7')) -Cwd $SB
  $c = Get-Caret
  if (-not $c) { return (Review 'caret not visible to UIA. By hand: line 42, column 7 (1-based: 6 chars to the left)') }
  $bad = @(); if ($c.Line -notlike '*line 042*') { $bad += "line is '$(Short $c.Line 30)'" }
  if ($c.Prefix.TrimEnd("`r", "`n").Length -ne 6) { $bad += "chars before caret = $($c.Prefix.TrimEnd("`r","`n").Length), expected 6 (column 7, 1-based) [Q9: is column 0- or 1-based?]" }
  Verdict $bad
}

Test-Case 'LC-06' 'Drive-letter colon is not a line separator' 'P1' {
  $p = F 'lines100.txt'
  $o1 = Observe (Q $p); $o2 = Observe (Q ('\\?\' + $p)) -Keep
  $o3 = Observe 'C:hello.txt' -Cwd $SB -Keep
  $o4 = Observe 'lines100.txt:3' -Cwd $SB
  $c = Get-Caret
  $bad = @()
  if (@($o1.Tabs).Count -eq 0 -and $o1.Wins -gt 0) { return (Review 'tabs not visible') }
  if (@($o1.Tabs | Where-Object { $_ -like '*lines100*' }).Count -ne 1) { $bad += "plain absolute path failed: <$($o1.Tabs -join ',')>" }
  if ($c -and $c.Line -notlike '*line 003*') { $bad += "relative file:3 caret on '$(Short $c.Line 30)'" }
  Verdict $bad
}

Test-Case 'LC-09' 'Line targets work with every line ending style and no final newline' 'P2' {
  $bad = @()
  foreach ($n in 'enc\crlf.txt', 'enc\lf.txt', 'enc\cr.txt', 'enc\mixed_eol.txt', 'nolastnl.txt') {
    $o = Observe (Q ((F $n) + ':3')) -Cwd $SB
    $c = Get-Caret
    if ($c) {
      $want = switch -Wildcard ($n) { 'nolastnl.txt' { 'third' } 'enc\mixed_eol.txt' { 'c' } default { 'c' } }
      if ($c.Line -notlike "*$want*") { $bad += "$n :3 -> caret on '$(Short $c.Line 20)', expected '$want'" }
    }
    if ($o.Crash) { $bad += "$n crash" }
  }
  Verdict $bad
}

Test-Case 'LC-10' 'Column counts characters, not bytes (CJK, accents, emoji, tabs)' 'P2' {
  $p = F 'tabs_unicode.txt'
  $res = @()
  foreach ($s in '2:4', '3:4', '4:3', '5:3', '6:4') {
    $o = Observe (Q ($p + ':' + $s)) -Cwd $SB; $c = Get-Caret
    $res += "$s => before-caret='$(if ($c) { Short $c.Prefix.TrimEnd("`r","`n") 20 } else { '?' })'"
    if ($o.Crash) { return (Fail "crash on $s") }
  }
  Review ("UNSPECIFIED (Q9). Expected for characters: 2:4 => 3 CJK chars before caret, 3:4 => 3 accents, 4:3 => 2 emoji, 5:3 => 'TAB' text (tab-width?), 6:4 => 3 letters+marks. Got: " + ($res -join ' | '))
}

Test-Case 'LC-11' 'Same file again with a new line number moves the caret' 'P2' {
  $p = F 'lines100.txt'
  $a = Observe (Q ($p + ':10')) -Cwd $SB
  $b = Observe (Q ($p + ':80')) -Cwd $SB -Keep
  $c = Get-Caret
  $bad = @()
  if ($b.Tabs.Count -gt 1) { $bad += "duplicate tab: <$($b.Tabs -join ',')>" }
  if ($c -and $c.Line -notlike '*line 080*') { $bad += "caret on '$(Short $c.Line 25)' expected line 080" }
  Verdict $bad
}

Test-Case 'LC-13' 'Jump to line in a huge file is fast' 'P3' -Slow {
  $big = Join-Path $Work 'big_1m_lines.txt'
  if (-not (Test-Path $big)) { New-BigFile $big 40MB }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $o = Observe (Q ($big + ':900000')) -Settle 200
  $o | Add-Member -NotePropertyName T -NotePropertyValue $sw.Elapsed.TotalSeconds
  if ($o.Crash -or $o.Frozen) { Fail "crash/freeze ($($o.T) s)" } else { Review "UNSPECIFIED: total $([math]::Round($o.T,1)) s to open+jump. Should not freeze the window." }
}

###############################################################################
# 5. NEW NOTE  (-n / --new)
###############################################################################
Test-Case 'NW-01' '-n with no window: one empty untitled tab, nothing on disk' 'P1' {
  $snap = Get-Snap $SB
  $o = Observe '-n' -Cwd $SB
  $txt = Get-EditorText
  $bad = @(); if ($o.Wins -lt 1) { $bad += 'no window' }; if ($o.Crash) { $bad += 'crash' }
  if ($null -ne $txt -and $txt.Trim().Length -gt 0) { $bad += "new note is not empty: '$(Short $txt 30)'" }
  $d = Diff-Snap $snap (Get-Snap $SB); if ($d.Count) { $bad += "files appeared on disk: $($d -join ', ')" }
  Verdict $bad "tabs=<$($o.Tabs -join ',')>"
}

Test-Case 'NW-02' '--new equals -n; both add a tab to a running window' 'P1' {
  $a = Observe '-n' -Cwd $SB
  $b = Observe '--new' -Cwd $SB -Keep
  $c = Observe 'hello.txt' -Cwd $SB -Keep
  $d = Observe '-n' -Cwd $SB -Keep
  if ($d.Tabs.Count -eq 0) { return (Review 'tabs not visible') }
  $bad = @(); if ($d.Tabs.Count -ne 4) { $bad += "expected 4 tabs, got $($d.Tabs.Count): $($d.Tabs -join ',') (UNSPECIFIED Q8: should -n always create a new tab?)" }
  if ($d.Wins -ne 1) { $bad += "$($d.Wins) windows" }
  Verdict $bad
}

Test-Case 'NW-03' '-n twice: untitled tabs have distinct names, no content mixing' 'P2' {
  $null = Observe '-n' -Cwd $SB; $o = Observe '-n' -Cwd $SB -Keep
  if ($o.Tabs.Count -ge 2 -and ($o.Tabs | Select-Object -Unique).Count -lt $o.Tabs.Count) { Review "UNSPECIFIED: duplicate tab names <$($o.Tabs -join ',')> make tabs impossible to tell apart" } else { Pass "tabs=<$($o.Tabs -join ',')>" }
}

Test-Case 'NW-05' '50 quick -n calls' 'P2' {
  $null = Observe '-n' -Cwd $SB
  $sw = [Diagnostics.Stopwatch]::StartNew(); $slow = 0; $codes = @()
  1..50 | ForEach-Object { $r = Invoke-Rpad -A '-n' -Cwd $SB; if (-not $r.Exited) { $slow++ }; $codes += $r.ExitCode }
  Start-Sleep 1
  $tabs = @(Get-Tabs); $bad = @()
  if ($slow) { $bad += "$slow second-starts did not exit" }
  if (@(Get-Process -Name $ProcName -ErrorAction SilentlyContinue).Count -ne 1) { $bad += 'more than one process' }
  if (($codes | Where-Object { $_ -ne 0 -and $null -ne $_ }).Count) { $bad += "non-zero exit codes: $($codes | Sort-Object -Unique)" }
  if ($tabs.Count -and $tabs.Count -ne 51) { $bad += "tabs=$($tabs.Count), expected 51 (UNSPECIFIED, Q8)" }
  Verdict $bad "took $([math]::Round($sw.Elapsed.TotalSeconds,1)) s"
}

###############################################################################
# 6. STDIN  (rpad -)
###############################################################################
Test-Case 'ST-01' 'Small text from stdin appears in a new tab' 'P1' {
  $o = Observe '-' -Stdin (F 'hello.txt') -Cwd $SB
  $t = Get-EditorText
  $bad = @(); if ($o.Wins -lt 1) { $bad += 'no window' }; if ($o.Crash) { $bad += 'crash' }
  if ($null -ne $t -and $t -notlike '*hello rPad*') { $bad += "content: '$(Short $t 40)'" }
  Verdict $bad "tabs=<$($o.Tabs -join ',')>"
}

Test-Case 'ST-05' 'stdin that never ends: window stays usable, other starts still work' 'P1' {
  $psi = New-Object Diagnostics.ProcessStartInfo $Rpad, '-'
  $psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true; $psi.WorkingDirectory = $SB
  $p = [Diagnostics.Process]::Start($psi)
  $p.StandardInput.Write('partial line without newline'); $p.StandardInput.Flush()
  Start-Sleep 3
  $wins = @(Get-Windows); $note = "after 3 s with open stdin: windows=$($wins.Count), process alive=$(-not $p.HasExited)"
  $x = Observe 'hello.txt' -Cwd $SB -Keep
  $bad = @()
  if ($x.Hung) { $bad += 'a second start blocks while another start is still reading stdin' }
  if ($wins.Count -gt 0 -and (Test-Frozen 2)) { $bad += 'window frozen while waiting for stdin' }
  $p.StandardInput.Write(" rest`r`n"); $p.StandardInput.Close()
  Start-Sleep 2
  $t = Get-EditorText
  if ($bad.Count) { Fail (($bad + $note) -join '; ') } else { Review "UNSPECIFIED (Q2): $note; second start tabs=<$($x.Tabs -join ',')>; after EOF editor='$(Short $t 40)'. Good: either show text as it arrives, or never block other starts." }
}

Test-Case 'ST-07' 'Plain "rpad file" ignores redirected stdin' 'P1' {
  $o = Observe (Q (F 'hello.txt')) -Stdin (F 'lines100.txt') -Cwd $SB
  $t = Get-EditorText
  $bad = @()
  if ($null -ne $t -and $t -like '*line 050*') { $bad += 'rPad read stdin although "-" was not given' }
  if (@($o.Tabs).Count -gt 1) { $bad += "extra tab from stdin: <$($o.Tabs -join ',')>" }
  Verdict $bad
}

Test-Case 'ST-09' 'stdin content is not leaked to disk' 'P1' {
  $marker = 'STDIN-SECRET-' + [guid]::NewGuid().ToString('N')
  $in = Join-Path $Work 'stdin_secret.txt'; [IO.File]::WriteAllText($in, "$marker`r`n")
  $since = Get-Date
  $o = Observe '-' -Stdin $in -Cwd $SB
  Start-Sleep 2; Stop-Rpad; Start-Sleep 1
  $hits = @(Find-Leak $marker $since | Where-Object { $_ -ne $in })
  if ($hits.Count) { Review "UNSPECIFIED (Q12): stdin text was written to disk (session restore / temp file?): $($hits -join ', '). Is that intended and documented?" } else { Pass 'marker not found on disk' }
}

Test-Case 'ST-10' 'Unicode through real shells: chcp 65001 and 437, type | rpad -' 'P2' {
  $res = @()
  foreach ($cp in 65001, 437, 1252) {
    Stop-Rpad
    $src = F 'enc\utf8_nobom.txt'
    $cmdline = '/c chcp ' + $cp + ' >nul & type "' + $src + '" | "' + $Rpad + '" -'
    $p = Start-Process cmd.exe -ArgumentList $cmdline -PassThru -WindowStyle Hidden
    [void](Wait-Window 6); Start-Sleep 1
    $t = Get-EditorText
    $res += "cp$cp => '$(Short $t 30)'"
    [void]$p.WaitForExit(2000)
  }
  Review ("UNSPECIFIED: which encoding does stdin use? An exact copy of the bytes with UTF-8 detection is the least surprising. " + ($res -join ' | '))
}

Test-Case 'ST-11' '50 MB through stdin' 'P2' -Slow {
  $big = Join-Path $Work 'stdin50.txt'; if (-not (Test-Path $big)) { New-BigFile $big 50MB }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $o = Observe '-' -Stdin $big -Cwd $SB -Settle 200
  $m = Get-Main; $mem = if ($m) { [int]($m.WorkingSet64 / 1MB) } else { 0 }
  $bad = @(); if ($o.Crash) { $bad += 'crash' }; if ($o.Frozen) { $bad += 'frozen' }; if ($mem -gt 2000) { $bad += "memory $mem MB for a 50 MB input" }
  Verdict $bad "t=$([math]::Round($sw.Elapsed.TotalSeconds,1)) s mem=$mem MB"
}

###############################################################################
# 7. FOLDERS
###############################################################################
Test-Case 'FD-01' 'Open a small folder; files are not modified, nothing is added' 'P1' {
  $d = F 'tree'; $snap = Get-Snap $d
  $o = Observe (Q $d)
  Stop-Rpad
  $diff = Diff-Snap $snap (Get-Snap $d)
  if ($o.Crash) { return (Fail 'crash') }
  if ($diff.Count) { return (Review "UNSPECIFIED (Q12): rPad changed the folder: $($diff -join ', ')") }
  Review "UNSPECIFIED (Q17): what is shown for a folder? wins=$($o.Wins) tabs=<$($o.Tabs -join ',')>. Folder untouched."
}

Test-Case 'FD-03' 'Folder with 5,000 files stays responsive' 'P2' {
  $d = F 'many5k'; New-NumberedFiles $d 5000
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $o = Observe (Q $d) -Settle 500
  $m = Get-Main; $mem = if ($m) { [int]($m.WorkingSet64 / 1MB) } else { 0 }
  $bad = @(); if ($o.Crash) { $bad += 'crash' }; if ($o.Frozen) { $bad += 'UI frozen' }; if ($mem -gt 1500) { $bad += "memory $mem MB" }
  Verdict $bad "t=$([math]::Round($sw.Elapsed.TotalSeconds,1)) s mem=$mem MB"
}

Test-Case 'FD-04' 'Folder with 100,000 files' 'P3' -Slow {
  $d = Join-Path $Work 'many100k'
  if (-not (Test-Path $d)) { New-Item -ItemType Directory $d | Out-Null; 1..100000 | ForEach-Object { [IO.File]::WriteAllBytes("$d\f$_.txt", [byte[]]@()) } }
  $o = Observe (Q $d) -Settle 3000
  $m = Get-Main; $mem = if ($m) { [int]($m.WorkingSet64 / 1MB) } else { 0 }
  $bad = @(); if ($o.Crash) { $bad += 'crash' }; if ($o.Frozen) { $bad += 'UI frozen' }
  Verdict $bad "mem=$mem MB"
}

Test-Case 'FD-05' 'Junction loop must not cause endless scan' 'P1' {
  $d = F 'loop'; New-Item -ItemType Directory $d | Out-Null
  [IO.File]::WriteAllText("$d\x.txt", 'x')
  & cmd.exe /c "mklink /J `"$d\sub`" `"$d`"" 2>$null | Out-Null
  & cmd.exe /c "mklink /J `"$d\up`" `"$SB`"" 2>$null | Out-Null
  if (-not (Test-Path "$d\sub")) { return (Skip 'cannot create junction') }
  try {
    $o = Observe (Q $d) -Settle 6000
    $m = Get-Main; $mem = if ($m) { [int]($m.WorkingSet64 / 1MB) } else { 0 }
    $cpu = if ($m) { $m.TotalProcessorTime.TotalSeconds } else { 0 }
    $bad = @(); if ($o.Crash) { $bad += 'crash' }; if ($o.Frozen) { $bad += 'UI frozen (endless scan?)' }
    if ($mem -gt 1500) { $bad += "memory $mem MB (endless scan?)" }
    Verdict $bad "mem=$mem MB cpu=$([math]::Round($cpu,1)) s"
  } finally { Stop-Rpad; & cmd.exe /c "rmdir `"$d\sub`"" | Out-Null; & cmd.exe /c "rmdir `"$d\up`"" | Out-Null }
}

Test-Case 'FD-09' 'Folder changes while open (1,500 creates + deletes)' 'P2' {
  $d = F 'churn'; New-Item -ItemType Directory $d | Out-Null
  $o = Observe (Q $d)
  1..1500 | ForEach-Object { [IO.File]::WriteAllText("$d\c$_.txt", 'x') }
  Get-ChildItem $d | Rename-Item -NewName { $_.Name + '.r' } -ErrorAction SilentlyContinue
  Remove-Item "$d\*" -Force -ErrorAction SilentlyContinue
  Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue      # folder itself deleted while open
  Start-Sleep 2
  $m = Get-Main; $bad = @()
  if (-not $m) { $bad += 'rPad died' } elseif (Test-Frozen 3) { $bad += 'rPad frozen' }
  $x = Observe (Q (F 'hello.txt')) -Keep; if ($x.Hung) { $bad += 'later start hangs' }
  Verdict $bad
}

Test-Case 'FD-10' 'File inside an already open folder: no duplicate' 'P2' {
  $null = Observe (Q (F 'tree'))
  $b = Observe (Q (F 'tree\a.txt')) -Keep; $c = Observe (Q (F 'tree\a.txt')) -Keep
  $bad = @(); if (@($c.Tabs | Where-Object { $_ -like '*a.txt*' }).Count -gt 1) { $bad += "duplicate: <$($c.Tabs -join ',')>" }
  Verdict $bad
}

Test-Case 'FD-11' 'Folder opening never rewrites files' 'P1' {
  $before = @{}; Get-ChildItem -LiteralPath (F 'tree') -Recurse -File | ForEach-Object { $before[$_.FullName] = Get-Hash $_.FullName }
  $o = Observe (Q (F 'tree')); Start-Sleep 2; Stop-Rpad
  $bad = @(); foreach ($k in $before.Keys) { if ((Get-Hash $k) -ne $before[$k]) { $bad += "changed: $k" } }
  Verdict $bad
}

###############################################################################
# 8. SECOND START / CONCURRENCY / REPEATED CALLS
###############################################################################
Test-Case 'SI-01' 'Second start hands over: one process, one window' 'P1' {
  $a = Observe (Q (F 'hello.txt'))
  $b = Observe (Q (F 'lines100.txt')) -Keep
  $bad = @()
  if (-not $b.Exited) { $bad += 'second start did not exit' }
  elseif ($b.ExitCode -ne 0) { $bad += "second start exit code $($b.ExitCode)" }
  if ($b.Procs -ne 1) { $bad += "$($b.Procs) rpad processes" }
  if ($b.Wins -ne 1) { $bad += "$($b.Wins) windows" }
  if ($b.Tabs.Count -and $b.Tabs.Count -ne 2) { $bad += "tabs <$($b.Tabs -join ',')>" }
  if ($b.Ms -gt 3000) { $bad += "second start took $($b.Ms) ms" }
  Verdict $bad "second start $($b.Ms) ms"
}

Test-Case 'SI-02' '40 sequential second starts, each a different file' 'P1' {
  $d = F 'seq'; New-NumberedFiles $d 40
  $null = Observe (Q "$d\f1.txt")
  $slow = 0; $bad = @(); $times = @()
  2..40 | ForEach-Object { $r = Invoke-Rpad -A (Q "$d\f$_.txt") -Cwd $d; $times += $r.Ms; if (-not $r.Exited) { $slow++ } elseif ($r.ExitCode -ne 0) { $bad += "f$_ exit $($r.ExitCode)" } }
  Start-Sleep 1
  $tabs = @(Get-Tabs)
  if ($slow) { $bad += "$slow starts did not exit" }
  if ($tabs.Count -and $tabs.Count -ne 40) { $bad += "tabs=$($tabs.Count) expected 40" }
  foreach ($i in 1..40) { if ($tabs.Count -and -not ($tabs -like "*f$i.txt*")) { $bad += "missing tab f$i.txt"; break } }
  if (@(Get-Process -Name $ProcName -ErrorAction SilentlyContinue).Count -ne 1) { $bad += 'process count != 1' }
  $med = ($times | Sort-Object)[[int]($times.Count / 2)]
  Verdict $bad "median second start $med ms"
}

Test-Case 'SI-03' '30 simultaneous second starts' 'P1' {
  $d = F 'par'; New-NumberedFiles $d 31
  $null = Observe (Q "$d\f1.txt")
  $ps = Start-Many (2..31 | ForEach-Object { Q "$d\f$_.txt" }) $d
  $still = Wait-Many $ps 25
  Start-Sleep 2
  $tabs = @(Get-Tabs); $bad = @()
  if ($still.Count) { $bad += "$($still.Count) callers still running after 25 s" }
  if ($tabs.Count -and $tabs.Count -ne 31) { $bad += "tabs=$($tabs.Count), expected 31 (lost or duplicated files)" }
  foreach ($i in 1..31) { if ($tabs.Count -and -not ($tabs -like "*f$i.txt*")) { $bad += "missing f$i.txt" } }
  if (@(Get-Process -Name $ProcName -ErrorAction SilentlyContinue).Count -ne 1) { $bad += 'process count != 1' }
  if (@(Get-Windows).Count -ne 1) { $bad += "windows=$(@(Get-Windows).Count)" }
  Verdict $bad
}

Test-Case 'SI-04' 'RACE: 10 simultaneous FIRST starts (no window yet), 5 rounds' 'P1' {
  $d = F 'race'; New-NumberedFiles $d 10
  $bad = @()
  foreach ($round in 1..5) {
    Stop-Rpad
    $ps = Start-Many (1..10 | ForEach-Object { Q "$d\f$_.txt" }) $d
    [void](Wait-Many $ps 20); Start-Sleep 2
    $wins = @(Get-Windows).Count; $procs = @(Get-Process -Name $ProcName -ErrorAction SilentlyContinue).Count; $tabs = @(Get-Tabs)
    if ($wins -ne 1)  { $bad += "round ${round}: $wins windows" }
    if ($procs -ne 1) { $bad += "round ${round}: $procs processes" }
    if ($tabs.Count -and $tabs.Count -ne 10) { $bad += "round ${round}: $($tabs.Count) tabs" }
  }
  Verdict $bad
}

Test-Case 'SI-05' '100 simultaneous calls for the SAME file -> one tab' 'P2' {
  $null = Observe (Q (F 'hello.txt'))
  $ps = Start-Many (1..100 | ForEach-Object { Q (F 'hello.txt') }) $SB
  [void](Wait-Many $ps 40); Start-Sleep 2
  $tabs = @(Get-Tabs); $bad = @()
  if ($tabs.Count -gt 1) { $bad += "$($tabs.Count) tabs for one file" }
  if (@(Get-Process -Name $ProcName -ErrorAction SilentlyContinue).Count -ne 1) { $bad += 'process count != 1' }
  Verdict $bad
}

Test-Case 'SI-06' 'Main window killed (crash), next start recovers' 'P1' {
  $bad = @()
  foreach ($i in 1..6) {
    $null = Observe (Q (F 'hello.txt'))
    Get-Process -Name $ProcName | Stop-Process -Force; Start-Sleep -Milliseconds (Get-Random -Min 0 -Max 300)
    $r = Invoke-Rpad -A (Q (F 'lines100.txt')) -Cwd $SB
    $w = Wait-Window 8
    if ($w.Count -ne 1) { $bad += "round ${i}: after crash, new start gives $($w.Count) windows (stale lock/pipe?)" }
    $t = @(Get-Tabs); if ($t.Count -and -not ($t -like '*lines100*')) { $bad += "round ${i}: file not opened: <$($t -join ',')>" }
  }
  Verdict $bad
}

Test-Case 'SI-07' 'Main window frozen (suspended): second start must not hang forever' 'P1' {
  $null = Observe (Q (F 'hello.txt')); $m = Get-Main
  [void][RpadNative]::NtSuspendProcess($m.Handle)
  try { $r = Invoke-Rpad -A (Q (F 'lines100.txt')) -Cwd $SB -Wait 10 } finally { [void][RpadNative]::NtResumeProcess($m.Handle) }
  $stuck = -not $r.Exited
  Start-Sleep 2
  $r2 = Invoke-Rpad -A (Q (F 'empty.txt')) -Cwd $SB -Wait 10
  if (-not $r2.Exited) { return (Fail 'after the main window recovered, second starts still hang (deadlock)') }
  if ($stuck) { Review "UNSPECIFIED (Q21): a second start waited >10 s on a frozen main window. Better: time out with an error." } else { Pass 'second start gave up / returned while main was frozen' }
}

Test-Case 'SI-08' '300 repeated calls: handle / memory / thread growth' 'P2' {
  $null = Observe (Q (F 'hello.txt')); $m = Get-Main
  $m.Refresh(); $h0 = $m.HandleCount; $w0 = $m.WorkingSet64; $t0 = $m.Threads.Count
  $fails = 0; 1..300 | ForEach-Object { $r = Invoke-Rpad -A (Q (F 'hello.txt')) -Cwd $SB; if (-not $r.Exited -or $r.ExitCode -ne 0) { $fails++ } }
  Start-Sleep 2; $m.Refresh()
  $h1 = $m.HandleCount; $w1 = $m.WorkingSet64; $t1 = $m.Threads.Count
  $bad = @()
  if ($fails) { $bad += "$fails of 300 calls failed/hung" }
  if ($h1 - $h0 -gt 300) { $bad += "handles grew $h0 -> $h1" }
  if (($w1 - $w0) / 1MB -gt 150) { $bad += "memory grew $([int]($w0/1MB)) -> $([int]($w1/1MB)) MB" }
  if ($t1 - $t0 -gt 50) { $bad += "threads grew $t0 -> $t1" }
  if (@(Get-Tabs).Count -gt 1) { $bad += 'same file produced extra tabs' }
  Verdict $bad "handles $h0->$h1 mem $([int]($w0/1MB))->$([int]($w1/1MB)) MB threads $t0->$t1"
}

Test-Case 'SI-09' 'Second start while main window is minimized' 'P2' {
  $null = Observe (Q (F 'hello.txt'))
  $w = (Wait-Window 3)[0]; $p = $null
  if ($w -and $w.TryGetCurrentPattern([Windows.Automation.WindowPattern]::Pattern, [ref]$p)) { $p.SetWindowVisualState('Minimized'); Start-Sleep 1 }
  $b = Observe (Q (F 'lines100.txt')) -Keep
  $state = ''; if ($p) { $state = $p.Current.WindowVisualState }
  Review "UNSPECIFIED (Q22): window state after 2nd start = $state (expected: restored and in front). tabs=<$($b.Tabs -join ',')> hung=$($b.Hung)"
}

Test-Case 'SI-10' 'Second start while main window shows a dialog' 'P2' -UI {
  $null = Observe (Q (F 'hello.txt'))
  [void](Focus-Rpad); Send-Keys 'DIRTY'; Send-Keys '^o'     # Ctrl+O may open a file dialog if rPad has one
  $b = Observe (Q (F 'lines100.txt')) -Keep
  Send-Keys '{ESC}'
  if ($b.Hung) { Fail 'second start blocked while a modal dialog was open' } else { Review "no hang. tabs=<$($b.Tabs -join ',')> (if no dialog opened, test is inconclusive)" }
}

Test-Case 'SI-11' 'Other copy of rpad.exe at a different path (two installs)' 'P2' {
  $dirB = Join-Path $Work ('copy B ' + [char]0x00e9); Remove-Tree $dirB
  Copy-Item -LiteralPath (Split-Path $Rpad) -Destination $dirB -Recurse
  $exeB = Join-Path $dirB (Split-Path $Rpad -Leaf)
  $a = Observe (Q (F 'hello.txt'))
  $r = Invoke-Rpad -A (Q (F 'lines100.txt')) -Cwd $SB -Exe $exeB
  Start-Sleep 2
  $w = @(Get-Windows).Count; $procs = @(Get-Process -Name $ProcName -ErrorAction SilentlyContinue).Count
  Remove-Tree $dirB
  Review "UNSPECIFIED (Q23): windows=$w processes=$procs exit=$($r.ExitCode). Same user + different exe path: forward to the window or start a second one? Either is fine if documented, but data-wise the same file must not be open in two windows."
}

Test-Case 'SI-12' 'Same file opened from two windows/paths (two buffers, last save wins)' 'P2' {
  $dirB = Join-Path $Work 'copy B2'; Remove-Tree $dirB
  Copy-Item -LiteralPath (Split-Path $Rpad) -Destination $dirB -Recurse
  $exeB = Join-Path $dirB (Split-Path $Rpad -Leaf)
  $null = Observe (Q (F 'hello.txt'))
  $null = Invoke-Rpad -A (Q (F 'hello.txt')) -Cwd $SB -Exe $exeB
  Start-Sleep 2; $w = @(Get-Windows).Count; Remove-Tree $dirB
  if ($w -gt 1) { Review "file open in $w windows at once: risk of overwriting. Check by hand that saving in one shows the change/prompt in the other." } else { Pass 'single window' }
}

###############################################################################
# 9. IPC FUZZ (hostile program talks to the running window)
###############################################################################
Test-Case 'IP-01' 'WM_COPYDATA garbage sent to the main window' 'P1' {
  $null = Observe (Q (F 'hello.txt')); $m = Get-Main
  if (-not $m -or $m.MainWindowHandle -eq 0) { return (Skip 'no main window handle') }
  $h = $m.MainWindowHandle; $bad = @(); $sent = 0
  $payloads = New-Object System.Collections.ArrayList
  [void]$payloads.Add(@(0, [byte[]]@())); [void]$payloads.Add(@(1, [byte[]]@(0))); [void]$payloads.Add(@(1, [byte[]]@(1, 2, 3)))
  [void]$payloads.Add(@(0, [Text.Encoding]::Unicode.GetBytes((F 'hello.txt') + "`0"))); [void]$payloads.Add(@(1, [Text.Encoding]::UTF8.GetBytes((F 'hello.txt') + "`0")))
  [void]$payloads.Add(@(0xFFFFFFFF, [Text.Encoding]::Unicode.GetBytes("-n`0--new`0-`0"))); [void]$payloads.Add(@(7, [Text.Encoding]::Unicode.GetBytes(('A' * 40000) + "`0")))
  $rnd = New-Object Random 99
  foreach ($n in 16, 1024, 65536, 1048576) { $b = New-Object byte[] $n; $rnd.NextBytes($b); [void]$payloads.Add(@(0, $b)); [void]$payloads.Add(@(5, $b)) }
  foreach ($pl in $payloads) {
    $bytes = [byte[]]$pl[1]; $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal([Math]::Max(1, $bytes.Length))
    try {
      if ($bytes.Length) { [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length) }
      $cds = New-Object RpadNative+COPYDATASTRUCT; $cds.dwData = [IntPtr][int64]([uint32]$pl[0]); $cds.cbData = $bytes.Length; $cds.lpData = $ptr
      $res = [IntPtr]::Zero; [void][RpadNative]::SendCopyData($h, 0x4A, [IntPtr]::Zero, [ref]$cds, 2, 3000, [ref]$res); $sent++
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr) }
    Start-Sleep -Milliseconds 150
    if (-not (Get-Main)) { $bad += "main process died after payload #$sent (dwData=$($pl[0]), $($bytes.Length) bytes)"; break }
  }
  if ((Get-Main) -and (Test-Frozen 2)) { $bad += 'window frozen after fuzz' }
  $t = @(Get-Tabs)
  Verdict $bad "sent $sent payloads. tabs afterwards=<$(Short ($t -join ',') 100)> (unexpected extra tabs named like garbage = rPad parses WM_COPYDATA, check Q24)"
}

Test-Case 'IP-02' 'Named pipes / mailslots with rpad in the name: garbage in' 'P1' {
  $null = Observe (Q (F 'hello.txt'))
  $names = @([IO.Directory]::GetFiles('\\.\pipe\') | Where-Object { $_ -match 'rpad' })
  if (-not $names.Count) { return (Review 'no named pipe containing "rpad" is visible. Mechanism unknown (Q24). Use Sysinternals handle.exe / Process Explorer to see how the second start talks to the first, then extend this test.') }
  $bad = @(); $log = @()
  foreach ($n in $names) {
    $short = $n -replace '^\\\\\.\\pipe\\', ''
    foreach ($payload in @([byte[]](1..200 | ForEach-Object { Get-Random -Max 256 }), [Text.Encoding]::UTF8.GetBytes("`0`0`0"), (New-Object byte[] 4MB), [Text.Encoding]::UTF8.GetBytes((F 'canary\secret.txt') + "`n"))) {
      try {
        $c = New-Object IO.Pipes.NamedPipeClientStream('.', $short, 'InOut'); $c.Connect(2000); $c.Write($payload, 0, $payload.Length); $c.Flush(); $c.Dispose(); $log += "$short ok"
      } catch { $log += "$short refused: $($_.Exception.Message)" }
      Start-Sleep -Milliseconds 300
      if (-not (Get-Main)) { $bad += "main died after garbage on pipe $short"; break }
    }
  }
  $secretTab = @(Get-Tabs) -like '*secret*'
  if ($secretTab) { $bad += 'an unauthenticated pipe client made rPad open a file (any local process can open files in the window)' }
  Verdict $bad ($log -join '; ')
}

###############################################################################
# 10. WINDOWS INTEGRATION
###############################################################################
Test-Case 'WI-01' 'Which rpad.exe is found on PATH' 'P2' {
  $hits = @(& where.exe rpad 2>$null)
  if ($hits.Count -eq 0) { Review 'not on PATH (the suite used -Rpad). The brief says it can be started from a command line, so install must add it to PATH.' }
  elseif ($hits.Count -gt 1) { Review "UNSPECIFIED: $($hits.Count) rpad.exe on PATH: $($hits -join ' ; '). An old copy earlier in PATH wins silently." }
  else { Pass $hits[0] }
}

Test-Case 'WI-02' 'GUI or console program? Does cmd.exe wait for it?' 'P1' {
  $b = [IO.File]::ReadAllBytes($Rpad); $pe = [BitConverter]::ToInt32($b, 0x3C); $sub = [BitConverter]::ToUInt16($b, $pe + 24 + 68)
  $f = Q (F 'hello.txt')
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process cmd.exe -ArgumentList ('/c ""' + $Rpad + '" ' + $f + '"') -PassThru -WindowStyle Hidden
  $ret = $p.WaitForExit(6000); $ms = $sw.ElapsedMilliseconds
  $kind = @{ 2 = 'GUI'; 3 = 'console' }[[int]$sub]
  if (-not $ret) { Stop-Rpad; Review "subsystem=$kind. cmd.exe /c rpad file did NOT return within 6 s: scripts and 'git commit' (editor use) block until the window closes. Fine for an editor, bad for 'start and continue' use. UNSPECIFIED (Q7)." }
  else { Pass "subsystem=$kind, cmd returned in $ms ms" }
}

Test-Case 'WI-03' 'File association / Open-with command lines (what Explorer sends)' 'P1' {
  $d = F 'names'; $weird = @('has space.txt', 'a&b.txt', '100%.txt', 'paren(1).txt', 'bang!.txt', ([string][char]0x65e5 + [char]0x672c + [char]0x8a9e + '.txt'))
  $bad = @()
  foreach ($n in $weird) {
    $o = Observe ('"' + $Rpad + '" "' + (Join-Path $d $n) + '"').Substring($Rpad.Length + 3) -Cwd $Work    # same as shell\open\command "rpad.exe" "%1"
    if ($o.Crash -or $o.Wins -lt 1) { $bad += "[$n] crash/no window" }
  }
  Verdict $bad
}

Test-Case 'WI-04' 'Registry open command quotes %1' 'P2' {
  $found = @(); $problems = @()
  foreach ($root in 'HKCU:\Software\Classes', 'HKLM:\Software\Classes') {
    $cands = @(); try { $cands += Get-Item "$root\Applications\$ProcName.exe" -ErrorAction Stop } catch { }
    try { $cands += Get-ChildItem $root -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like "*$ProcName*" } } catch { }
    foreach ($c in $cands) {
      foreach ($v in (Get-ChildItem "$($c.PSPath)\shell" -ErrorAction SilentlyContinue)) {
        $cmd = (Get-ItemProperty "$($v.PSPath)\command" -ErrorAction SilentlyContinue).'(default)'
        if ($cmd) { $found += $cmd; if ($cmd -notmatch '"%[1LV]"') { $problems += "unquoted placeholder: $cmd" } }
      }
    }
  }
  if (-not $found.Count) { return (Review 'no rpad ProgID / open verb in the registry. If the installer should register it ("Windows can open files with it"), that is a bug. Q25') }
  Verdict $problems ($found -join ' ; ')
}

Test-Case 'WI-05' 'Hostile environment: bad APPDATA / TEMP / profile' 'P2' {
  $bad = @()
  foreach ($case in @{ N = 'APPDATA+LOCALAPPDATA missing'; V = @{ APPDATA = 'Z:\nope\a'; LOCALAPPDATA = 'Z:\nope\l' } }, @{ N = 'TEMP/TMP missing'; V = @{ TEMP = 'Z:\nope\t'; TMP = 'Z:\nope\t' } }, @{ N = 'TEMP is a file'; V = @{ TEMP = (F 'hello.txt'); TMP = (F 'hello.txt') } }, @{ N = 'USERPROFILE missing'; V = @{ USERPROFILE = 'Z:\nope\u'; HOMEDRIVE = 'Z:'; HOMEPATH = '\nope' } }, @{ N = 'PATH empty'; V = @{ PATH = '' } }) {
    foreach ($k in $EnvKeys) { [Environment]::SetEnvironmentVariable($k, $OrigEnv[$k], 'Process') }
    foreach ($k in $case.V.Keys) { [Environment]::SetEnvironmentVariable($k, $case.V[$k], 'Process') }
    $o = Observe (Q (F 'hello.txt')); $v = Invoke-Rpad -A '-V'
    if ($o.Crash -or $o.Wins -lt 1) { $bad += "$($case.N): window did not open (exit=$($o.ExitCode))" }
    if (Test-CrashCode $v.ExitCode) { $bad += "$($case.N): -V crashed" }
  }
  Verdict $bad
}

Test-Case 'WI-06' 'DLL planting: garbage DLLs next to the opened file / in cwd' 'P2' {
  $base = Observe (Q (F 'hello.txt')); if ($base.Wins -lt 1) { return (Skip 'baseline did not open') }
  $d = F 'dllplant'; New-Item -ItemType Directory $d | Out-Null
  foreach ($n in 'version', 'dwmapi', 'uxtheme', 'userenv', 'winmm', 'netapi32', 'cryptsp', 'msimg32', 'wtsapi32', 'propsys', 'cryptbase', 'dbghelp', 'mpr', 'ntmarta', 'profapi', 'comctl32', 'urlmon', 'WINHTTP', 'iphlpapi', 'dnsapi') { [IO.File]::WriteAllBytes("$d\$n.dll", [byte[]](0x4D, 0x5A, 0x90, 0, 0, 0, 0, 0)) }
  [IO.File]::WriteAllText("$d\x.txt", 'x')
  $o = Observe '"x.txt"' -Cwd $d
  if ($o.Wins -lt 1 -or $o.Crash) { Fail "opens fine normally but fails with decoy DLLs in the file's folder (exit=$($o.ExitCode)): rPad loads DLLs from the current folder" } else { Pass }
}

Test-Case 'WI-07' 'Run from cmd.exe and PowerShell, odd shells' 'P2' {
  $f = F 'hello.txt'; $bad = @()
  $forms = @(
    @{ N = 'cmd /c';        E = 'cmd.exe';        A = '/c ""' + $Rpad + '" "' + $f + '""' },
    @{ N = 'cmd start';     E = 'cmd.exe';        A = '/c start "" "' + $Rpad + '" "' + $f + '"' },
    @{ N = 'powershell &';  E = 'powershell.exe'; A = '-NoProfile -Command "& ''' + $Rpad + ''' ''' + $f + '''"' },
    @{ N = 'Start-Process'; E = 'powershell.exe'; A = '-NoProfile -Command "Start-Process ''' + $Rpad + ''' -ArgumentList ''\"' + $f + '\"''"' }
  )
  $notes = @()
  foreach ($x in $forms) {
    Stop-Rpad
    $p = Start-Process $x.E -ArgumentList $x.A -PassThru -WindowStyle Hidden
    $w = Wait-Window 6; Start-Sleep 1
    $t = @(Get-Tabs)
    if ($w.Count -lt 1) { $bad += "$($x.N): no window" } elseif ($t.Count -and -not ($t -like '*hello*')) { $bad += "$($x.N): tabs <$($t -join ',')>" }
    $notes += "$($x.N): shell exited=$($p.WaitForExit(500))"
  }
  Verdict $bad ($notes -join ' | ')
}

Test-Case 'WI-08' 'Case of the exe name and quoting of the exe path' 'P3' {
  $bad = @()
  foreach ($e in $Rpad.ToUpper(), $Rpad.ToLower()) {
    Stop-Rpad; $r = Invoke-Rpad -A (Q (F 'hello.txt')) -Exe $e; $w = Wait-Window 5
    if ($w.Count -lt 1) { $bad += "case variant failed: $e" }
  }
  Verdict $bad
}

###############################################################################
# 11. SECURITY / FILES NOBODY NAMED
###############################################################################
Test-Case 'SC-01' 'Opening ONE file touches no neighbour: no new files, no changes' 'P1' {
  $d = F 'canary'; $snap = Get-Snap $d; $marker = 'SECRET-CANARY-7731'; $since = Get-Date
  $o = Observe (Q "$d\neighbor.txt")
  Start-Sleep 2
  $x = Observe (Q "$d\neighbor.txt:1") -Keep
  Stop-Rpad; Start-Sleep 1
  $bad = @(); $diff = Diff-Snap $snap (Get-Snap $d)
  if ($diff.Count) { $bad += "folder changed: $($diff -join ', ')" }
  $hits = @(Find-Leak $marker $since); if ($hits.Count) { $bad += "content of an unnamed file was copied to: $($hits -join ', ')" }
  Verdict $bad
}

Test-Case 'SC-03' 'Arguments cannot smuggle options: one quoted argument with spaces' 'P1' {
  $a = Observe ('"hello.txt -n"') -Cwd $SB
  $b = Observe ('"-n hello.txt"') -Cwd $SB
  $c = Observe ('"hello.txt:5 -V"') -Cwd $SB
  $bad = @()
  foreach ($x in $a, $b, $c) { if ($x.Exited -and $x.Out -match '\d+\.\d+') { $bad += "[$($x.A)] acted like -V" }; if ($x.Crash) { $bad += "[$($x.A)] crash" } }
  if ($a.Tabs.Count -gt 1) { $bad += "[$($a.A)] made two tabs (option injected)" }
  Verdict $bad ($a.Sum + ' || ' + $b.Sum + ' || ' + $c.Sum)
}

Test-Case 'SC-08' 'Many tabs at once: 200 files in one command' 'P2' {
  $d = F 'f200'; New-NumberedFiles $d 200
  $o = Observe ((1..200 | ForEach-Object { Q "$d\f$_.txt" }) -join ' ') -Cwd $d -Settle 2000
  $bad = @(); if ($o.Crash) { $bad += 'crash' }; if ($o.Frozen) { $bad += 'frozen' }
  if ($o.Tabs.Count -and $o.Tabs.Count -ne 200) { $bad += "tabs=$($o.Tabs.Count)" }
  Verdict $bad
}

###############################################################################
# 12. DATA LOSS  (types into the window; use -IncludeUI and do not touch the PC)
###############################################################################
Test-Case 'DL-01' 'Edit + Ctrl+S keeps encoding, BOM and line endings of all other bytes' 'P1' -UI {
  $bad = @(); $notes = @()
  foreach ($n in 'utf8_bom.txt', 'utf8_nobom.txt', 'utf16le.txt', 'utf16be.txt', 'cp1252.txt', 'crlf.txt', 'lf.txt', 'cr.txt', 'mixed_eol.txt') {
    $p = F "enc\$n"; $orig = [IO.File]::ReadAllBytes($p); $info = Enc-Info $n
    $null = Observe (Q $p); [void](Focus-Rpad)
    Send-Keys '^{HOME}'; Send-Keys 'ZZZ'; Send-Keys '^s'; Start-Sleep 1
    $new = [IO.File]::ReadAllBytes($p)
    $exp = [byte[]]($info.Bom + $info.Enc.GetBytes('ZZZ') + $orig[$info.Bom.Length..($orig.Length - 1)])
    if (($new -join ',') -ne ($exp -join ',')) {
      $cr0 = @($orig | Where-Object { $_ -eq 13 }).Count; $lf0 = @($orig | Where-Object { $_ -eq 10 }).Count
      $cr1 = @($new | Where-Object { $_ -eq 13 }).Count;  $lf1 = @($new | Where-Object { $_ -eq 10 }).Count
      $msg = "$n bytes differ from expected: len $($orig.Length)->$($new.Length) (exp $($exp.Length)), CR $cr0->$cr1, LF $lf0->$lf1, BOM start $((($new[0..2]) | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')"
      if ($n -eq 'cp1252.txt') { $notes += $msg + ' [ANSI handling UNSPECIFIED Q13]' } else { $bad += $msg }
    }
    Stop-Rpad
  }
  Verdict $bad ("all preserved. " + ($notes -join '; '))
}

Test-Case 'DL-02' 'Unsaved edit survives a second start on the SAME file' 'P1' -UI {
  $p = F 'hello.txt'; $h = Get-Hash $p
  $null = Observe (Q $p); [void](Focus-Rpad); Send-Keys '^{END}'; Send-Keys 'DIRTYTEXT'
  $null = Observe (Q $p) -Keep; $null = Observe '-n' -Keep; $null = Observe (Q (F 'lines100.txt')) -Keep
  [void](Select-Tab 'hello.txt'); $t = Get-EditorText
  $bad = @()
  if ($null -eq $t) { return (Review 'cannot read editor; by hand: DIRTYTEXT must still be there') }
  if ($t -notlike '*DIRTYTEXT*') { $bad += 'unsaved text LOST after reopening the file / opening other files' }
  if ((Get-Hash $p) -ne $h) { $bad += 'file on disk changed without Ctrl+S' }
  Verdict $bad
}

Test-Case 'DL-03' 'Kill the window with unsaved text: is anything recoverable?' 'P1' -UI {
  $p = F 'hello.txt'
  $null = Observe (Q $p); [void](Focus-Rpad); Send-Keys '^{END}'; Send-Keys 'UNSAVEDWORK'
  Stop-Rpad
  $null = Observe (Q $p); $t = Get-EditorText
  Review "UNSPECIFIED (Q27). After a crash/kill and restart: UNSAVEDWORK recovered=$($t -like '*UNSAVEDWORK*') (editor text='$(Short $t 40)'). Not required, but users expect it. Check there is at least no corruption of hello.txt: hash unchanged=$((Get-Hash $p) -eq (Get-Hash (Join-Path $Fx 'hello.txt')))"
}

Test-Case 'DL-04' 'File changed outside while rPad has unsaved edits, then Ctrl+S' 'P1' -UI {
  $p = F 'hello.txt'
  $null = Observe (Q $p); [void](Focus-Rpad); Send-Keys '^{END}'; Send-Keys 'LOCALEDIT'
  [IO.File]::WriteAllText($p, "EXTERNAL-CHANGE`r`n"); Start-Sleep 1.5
  [void](Focus-Rpad); Send-Keys '^s'; Start-Sleep 1
  $dialog = @(Get-Windows).Count -gt 1
  $disk = [IO.File]::ReadAllText($p)
  if ($dialog) { Send-Keys '{ESC}' }
  if ($disk -notlike '*EXTERNAL-CHANGE*' -and -not $dialog) { Fail 'silent overwrite: the outside change was destroyed with no prompt (UNSPECIFIED Q16, but this is data loss)' }
  else { Review "UNSPECIFIED (Q16): dialog shown=$dialog; disk now='$(Short $disk 50)'. Good: warn before overwriting, or reload/merge." }
}

Test-Case 'DL-05' 'Save to a read-only file: error shown, text kept' 'P1' -UI {
  $p = F 'hello.txt'; (Get-Item -LiteralPath $p).IsReadOnly = $true; $h = Get-Hash $p
  $null = Observe (Q $p); [void](Focus-Rpad); Send-Keys '^{END}'; Send-Keys 'WILLNOTSAVE'; Send-Keys '^s'; Start-Sleep 1
  $dialog = @(Get-Windows).Count -gt 1
  $t = Get-EditorText
  if ($dialog) { Send-Keys '{ESC}' }
  $bad = @(); if ((Get-Hash $p) -ne $h) { $bad += 'read-only file was modified' }
  if ($null -ne $t -and $t -notlike '*WILLNOTSAVE*') { $bad += 'typed text vanished after failed save' }
  Verdict $bad "error dialog visible=$dialog"
  (Get-Item -LiteralPath $p).IsReadOnly = $false
}

Test-Case 'DL-06' 'Save when the file is locked by another program' 'P1' -UI {
  $p = F 'hello.txt'
  $null = Observe (Q $p); [void](Focus-Rpad); Send-Keys '^{END}'; Send-Keys 'LOCKEDSAVE'
  $fs = [IO.File]::Open($p, 'Open', 'Read', 'Read'); $h = Get-Hash $p
  try { Send-Keys '^s'; Start-Sleep 1; $dialog = @(Get-Windows).Count -gt 1; $t = Get-EditorText; if ($dialog) { Send-Keys '{ESC}' } } finally { $fs.Close() }
  $bad = @(); if ($null -ne $t -and $t -notlike '*LOCKEDSAVE*') { $bad += 'text lost after failed save' }
  Verdict $bad "error dialog visible=$dialog; the title must still show unsaved state"
}

Test-Case 'DL-07' 'Save after the file was deleted outside' 'P2' -UI {
  $p = F 'hello.txt'
  $null = Observe (Q $p); [void](Focus-Rpad); Send-Keys '^{END}'; Send-Keys 'AFTERDELETE'
  Remove-Item -LiteralPath $p -Force; Start-Sleep 1; [void](Focus-Rpad); Send-Keys '^s'; Start-Sleep 1
  $dialog = @(Get-Windows).Count -gt 1; if ($dialog) { Send-Keys '{ESC}' }
  Review "UNSPECIFIED (Q16): file exists again=$(Test-Path -LiteralPath $p) dialog=$dialog. Good: recreate or ask Save As; never lose the text."
}

Test-Case 'DL-08' 'Close window with unsaved edits: prompt or silent loss?' 'P1' -UI {
  $p = F 'hello.txt'
  $null = Observe (Q $p); [void](Focus-Rpad); Send-Keys '^{END}'; Send-Keys 'CLOSEME'
  $m = Get-Main; [void]$m.CloseMainWindow(); Start-Sleep 2
  $gone = -not (Get-Main); $dialog = @(Get-Windows).Count -gt 1
  if ($gone) { Fail 'window closed without any prompt although there were unsaved edits (data loss, unless a recovery copy exists: see DL-03)' }
  else { Review "window still open after close request; dialog=$dialog (expected: Save / Don't save / Cancel)" }
}

Test-Case 'DL-09' 'Kill rPad during a save of a large file: file is old or new, never half' 'P1' -UI -Slow {
  $big = Join-Path $SB 'big_save.txt'; New-BigFile $big 60MB; $old = Get-Hash $big; $olen = (Get-Item $big).Length
  $bad = @()
  foreach ($i in 1..6) {
    $null = Observe (Q $big) -Settle 1500; [void](Focus-Rpad); Send-Keys '^{HOME}'; Send-Keys 'XX'; Send-Keys '^s'
    Start-Sleep -Milliseconds (20 * $i); Stop-Rpad
    $len = (Get-Item $big).Length
    if ($len -ne $olen -and $len -ne ($olen + 2)) { $bad += "round ${i}: file is $len bytes (old $olen, new $($olen + 2)): torn write" }
    $olen = $len
  }
  Verdict $bad
}

###############################################################################
# 13. SPEED
###############################################################################
Test-Case 'SP-01' 'Cold start to window (median of 5)' 'P3' {
  $t = @()
  foreach ($i in 1..5) { Stop-Rpad; $sw = [Diagnostics.Stopwatch]::StartNew(); $r = Invoke-Rpad -A (Q (F 'hello.txt')) -Wait 1; [void](Wait-Window 15); $t += $sw.ElapsedMilliseconds }
  $med = ($t | Sort-Object)[2]
  if ($med -gt 5000) { Fail "median $med ms" } elseif ($med -gt 1500) { Review "median $med ms: slowish" } else { Pass "median $med ms ($($t -join ','))" }
}

Test-Case 'SP-02' 'Second-start latency (median of 20)' 'P3' {
  $null = Observe (Q (F 'hello.txt')); $t = @()
  foreach ($i in 1..20) { $r = Invoke-Rpad -A (Q (F 'lines100.txt')); $t += $r.Ms }
  $med = ($t | Sort-Object)[10]; $max = ($t | Measure-Object -Maximum).Maximum
  if ($max -gt 5000 -or $med -gt 1500) { Fail "median $med ms, max $max ms" } else { Pass "median $med ms, max $max ms" }
}

Test-Case 'SP-03' 'File sizes 1 MB / 10 MB (and 100 MB, 500 MB with -IncludeSlow)' 'P2' {
  $sizes = @(1MB, 10MB); if ($IncludeSlow) { $sizes += 100MB, 500MB }
  $bad = @(); $notes = @()
  foreach ($s in $sizes) {
    $f = Join-Path $Work ("big_{0}MB.txt" -f ($s / 1MB)); if (-not (Test-Path $f)) { New-BigFile $f $s }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $o = Observe (Q $f) -Settle 300; $m = Get-Main; $mem = if ($m) { [int]($m.WorkingSet64 / 1MB) } else { 0 }
    $secs = [math]::Round($sw.Elapsed.TotalSeconds, 1); $notes += "$([int]($s/1MB))MB:${secs}s/${mem}MB"
    if ($o.Crash) { $bad += "$([int]($s/1MB)) MB crash" }
    if ($o.Frozen) { $bad += "$([int]($s/1MB)) MB frozen" }
    if ($mem -gt [Math]::Max(300, ($s / 1MB) * 12)) { $bad += "$([int]($s/1MB)) MB file uses $mem MB RAM" }
  }
  Verdict $bad ($notes -join ' ')
}

Test-Case 'SP-05' '1,000 files at once (needs 1000 args)' 'P3' -Slow {
  $d = F 'f1000b'; New-NumberedFiles $d 1000
  $sw = [Diagnostics.Stopwatch]::StartNew(); $o = Observe ((1..1000 | ForEach-Object { "f$_.txt" }) -join ' ') -Cwd $d -Settle 3000
  $m = Get-Main; $mem = if ($m) { [int]($m.WorkingSet64 / 1MB) } else { 0 }
  $bad = @(); if ($o.Crash) { $bad += 'crash' }; if ($o.Frozen) { $bad += 'frozen' }
  Verdict $bad "t=$([math]::Round($sw.Elapsed.TotalSeconds,1)) s tabs=$($o.Tabs.Count) mem=$mem MB"
}

Complete-Run

