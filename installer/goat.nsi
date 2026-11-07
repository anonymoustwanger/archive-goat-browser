; Goat Browser installer (NSIS 3). Build: npm run installer
; Installs for the current user only (no admin prompt) into
; %LOCALAPPDATA%\Programs\Goat Browser. Your profile (%APPDATA%\Goat Browser)
; is not touched, so cookies, settings and bookmarks carry over.

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define APP      "Goat Browser"
!define EXE      "GoatBrowser.exe"
!define REGKEY   "GoatBrowser"
!define PROGID   "GoatHTML"
!define UNINST   "Software\Microsoft\Windows\CurrentVersion\Uninstall\${REGKEY}"
!define CLIENTS  "Software\Clients\StartMenuInternet\${REGKEY}"
!define SRC      "..\dist\Goat Browser-win32-x64"

Name "${APP}"
OutFile "..\dist\GoatBrowserSetup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "${UNINST}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Goat Browser"

!define MUI_ICON "..\build\icon.ico"
!define MUI_UNICON "..\build\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "This installs ${APP} ${VERSION}, a private and fast browser.$\r$\n$\r$\nIf you already use Goat, your tabs, cookies, settings and bookmarks are kept.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APP}"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Make ${APP} my default browser"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION OpenDefaultApps
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; Goat must be closed so its files can be replaced.
!macro CloseGoat
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq ${EXE}" /NH | find /I "${EXE}"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "${APP} is open. It will be closed to continue (your tabs are saved)." IDOK +2
    Abort
    nsExec::Exec 'taskkill /IM ${EXE}'
    Sleep 2500
    nsExec::Exec 'taskkill /F /IM ${EXE}'
    Sleep 800
  ${EndIf}
!macroend

Function .onInit
  !insertmacro CloseGoat
FunctionEnd

Function OpenDefaultApps
  ExecShell "open" "ms-settings:defaultapps?registeredAppUser=${REGKEY}"
FunctionEnd

Section "${APP} (required)" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  ; Remove files from an older version first (keeps nothing stale in resources\).
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall ${APP}.exe"

  CreateShortcut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0

  ; Apps & features entry
  WriteRegStr HKCU "${UNINST}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "Goat Browser"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Uninstall ${APP}.exe"'
  WriteRegStr HKCU "${UNINST}" "QuietUninstallString" '"$INSTDIR\Uninstall ${APP}.exe" /S'
  WriteRegStr HKCU "${UNINST}" "URLInfoAbout" "https://github.com/anonymoustwanger/goat-browser"
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST}" "EstimatedSize" "$0"

  ; Register as a browser, so Windows lists it under Default apps.
  WriteRegStr HKCU "Software\Classes\${PROGID}" "" "Goat Browser HTML Document"
  WriteRegStr HKCU "Software\Classes\${PROGID}" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "Software\Classes\${PROGID}\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\${PROGID}\Application" "ApplicationName" "${APP}"
  WriteRegStr HKCU "Software\Classes\${PROGID}\Application" "ApplicationIcon" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${CLIENTS}" "" "${APP}"
  WriteRegStr HKCU "${CLIENTS}\DefaultIcon" "" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${CLIENTS}\shell\open\command" "" '"$INSTDIR\${EXE}"'
  WriteRegStr HKCU "${CLIENTS}\Capabilities" "ApplicationName" "${APP}"
  WriteRegStr HKCU "${CLIENTS}\Capabilities" "ApplicationDescription" "A private, fast browser built on Chromium."
  WriteRegStr HKCU "${CLIENTS}\Capabilities" "ApplicationIcon" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${CLIENTS}\Capabilities\StartMenu" "StartMenuInternet" "${REGKEY}"
  WriteRegStr HKCU "${CLIENTS}\Capabilities\URLAssociations" "http" "${PROGID}"
  WriteRegStr HKCU "${CLIENTS}\Capabilities\URLAssociations" "https" "${PROGID}"
  WriteRegStr HKCU "${CLIENTS}\Capabilities\FileAssociations" ".htm" "${PROGID}"
  WriteRegStr HKCU "${CLIENTS}\Capabilities\FileAssociations" ".html" "${PROGID}"
  WriteRegStr HKCU "${CLIENTS}\Capabilities\FileAssociations" ".pdf" "${PROGID}"
  WriteRegStr HKCU "Software\RegisteredApplications" "${REGKEY}" "${CLIENTS}\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "The browser, a Start menu shortcut, and an entry in Windows Default apps."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "A shortcut on your desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Function un.onInit
  !insertmacro CloseGoat
FunctionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  DeleteRegKey HKCU "${UNINST}"
  DeleteRegKey HKCU "${CLIENTS}"
  DeleteRegKey HKCU "Software\Classes\${PROGID}"
  DeleteRegValue HKCU "Software\RegisteredApplications" "${REGKEY}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  IfSilent done
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Goat profile (cookies, history, bookmarks, settings, extensions)?$\r$\n$\r$\nChoose No to keep it for a later reinstall." IDNO done
  RMDir /r "$APPDATA\${APP}"
  done:
SectionEnd
