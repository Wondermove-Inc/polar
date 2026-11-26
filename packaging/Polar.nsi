Unicode true
RequestExecutionLevel user
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PolarLauncher"
!define RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define WEBKEY "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
Name "Polar"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Polar"
!define MUI_ICON "../desktop/icons/icon.ico"
!define MUI_UNICON "${MUI_ICON}"
SetCompressor /SOLID lzma
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"
!insertmacro MUI_LANGUAGE "English"
LangString Running ${LANG_KOREAN} "Polar를 종료한 뒤 다시 시도하세요."
LangString Running ${LANG_ENGLISH} "Close Polar and try again."
LangString Failed ${LANG_KOREAN} "설치를 완료할 수 없습니다. Polar를 닫고 다시 실행하세요."
LangString Failed ${LANG_ENGLISH} "Installation could not finish. Close Polar and run setup again."
LangString Runtime ${LANG_KOREAN} "Microsoft Edge WebView2 Runtime이 필요합니다. Microsoft 다운로드 페이지를 열까요? 설치 후 Polar 설치 파일을 다시 실행하세요."
LangString Runtime ${LANG_ENGLISH} "Microsoft Edge WebView2 Runtime is required. Open the Microsoft download page? Run Polar setup again after installing the runtime."

!macro Guard PREFIX
Function ${PREFIX}.onInit
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Polar"
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\PolarLauncherSetup") p.r1 ?e'
  Pop $2
  ${If} $1 P= 0
  ${OrIf} $2 == 183
    Abort
  ${EndIf}
  System::Call 'kernel32::OpenMutexW(i 0x100000, i 0, w "local.polar.launcher-sim") p.r0'
  ${If} $0 P<> 0
    System::Call 'kernel32::CloseHandle(p r0)'
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(Running)" /SD IDOK
    Abort
  ${EndIf}
FunctionEnd
!macroend
!insertmacro Guard ""
!insertmacro Guard "un"
!macro CleanPayload DIR
  Delete "${DIR}\Polar.exe"
  Delete "${DIR}\WebView2Loader.dll"
  RMDir "${DIR}"
!macroend
Section
  SetShellVarContext current
  SetRegView 32
  ReadRegStr $0 HKLM "${WEBKEY}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKCU "${WEBKEY}" "pv"
  ${EndIf}
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    MessageBox MB_YESNO|MB_ICONQUESTION "$(Runtime)" /SD IDNO IDNO +2
    ExecShell "open" "https://developer.microsoft.com/microsoft-edge/webview2/"
    Abort
  ${EndIf}
  SetRegView 64
  ReadRegStr $0 HKCU "${UNKEY}" "UninstallString"
  ${If} $0 != ""
  ${AndIf} $0 != '"$INSTDIR\Uninstall.exe"'
    Goto failed
  ${EndIf}
  IfFileExists "$INSTDIR\*.*" 0 claim
  IfFileExists "$INSTDIR\polar-install.id" claim failed
claim:
  CreateDirectory "$INSTDIR"
  ClearErrors
  FileOpen $0 "$INSTDIR\polar-install.id" w
  IfErrors failed
  FileWrite $0 "local.polar.launcher"
  FileClose $0
  ; Recover the previous application if an earlier update stopped between renames.
  IfFileExists "$INSTDIR\app\Polar.exe" recovered
  IfFileExists "$INSTDIR\previous\Polar.exe" 0 recovered
  Rename "$INSTDIR\previous" "$INSTDIR\app"
recovered:
  !insertmacro CleanPayload "$INSTDIR\previous"
  ClearErrors
  !insertmacro CleanPayload "$INSTDIR\incoming"
  ClearErrors
  SetOutPath "$INSTDIR\incoming"
  File /oname=Polar.exe "${BINARY}"
  !ifdef LOADER
    File /oname=WebView2Loader.dll "${LOADER}"
  !endif
  IfErrors failed
  SetOutPath "$INSTDIR"
  ClearErrors
  IfFileExists "$INSTDIR\app\*.*" 0 installNew
  Rename "$INSTDIR\app" "$INSTDIR\previous"
  IfErrors failed
installNew:
  Rename "$INSTDIR\incoming" "$INSTDIR\app"
  IfErrors rollback
  ClearErrors
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Polar Launcher"
  CreateShortcut "$SMPROGRAMS\Polar Launcher\Polar.lnk" "$INSTDIR\app\Polar.exe"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "Polar"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "1.0.0-rc.4"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\app\Polar.exe"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  IfErrors failed
  !insertmacro CleanPayload "$INSTDIR\previous"
  Goto done
rollback:
  Rename "$INSTDIR\previous" "$INSTDIR\app"
failed:
  MessageBox MB_OK|MB_ICONSTOP "$(Failed)" /SD IDOK
  Abort
done:
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  IfFileExists "$INSTDIR\polar-install.id" +2
  Abort
  ReadRegStr $0 HKCU "${RUNKEY}" "PolarLauncher"
  ${If} $0 == '"$INSTDIR\app\Polar.exe"'
    DeleteRegValue HKCU "${RUNKEY}" "PolarLauncher"
  ${EndIf}
  ReadRegStr $0 HKCU "${UNKEY}" "UninstallString"
  ${If} $0 == '"$INSTDIR\Uninstall.exe"'
    DeleteRegKey HKCU "${UNKEY}"
  ${EndIf}
  Delete "$SMPROGRAMS\Polar Launcher\Polar.lnk"
  RMDir "$SMPROGRAMS\Polar Launcher"
  !insertmacro CleanPayload "$INSTDIR\app"
  !insertmacro CleanPayload "$INSTDIR\incoming"
  !insertmacro CleanPayload "$INSTDIR\previous"
  Delete "$INSTDIR\polar-install.id"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
