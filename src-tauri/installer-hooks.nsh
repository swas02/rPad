; Adds the install folder to the user PATH, so `rpad file.txt` works in any terminal.
; It only adds the folder when it is not there yet. The user PATH is HKCU\Environment (per-user install).
!include "StrFunc.nsh"
${StrLoc}

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCmp $0 "" +2
    StrCpy $0 "$0;"
  ${StrLoc} $1 "$0" "$INSTDIR;" ">"
  StrCmp $1 "" 0 +3
    WriteRegExpandStr HKCU "Environment" "Path" "$0$INSTDIR"
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
