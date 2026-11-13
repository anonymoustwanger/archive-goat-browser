; Goat Browser (Chromium) package for one version: GoatBrowser-<version>-windows-x64.exe.
; People normally get it through GoatBrowserSetup.exe (GoatSetup.cs), which lets them
; pick a version, downloads this file and runs it with /S (silent). Run by hand it
; shows its own setup screens, so it also works offline.
; Built by .github/workflows/goat-release.yml:
;   makensis -DVERSION=5.0.0 -DSTAGE=<folder> chromium/installer/goat-setup.nsi
; <folder> holds mini_installer.exe (Goat's Chromium) and goat\ (extensions, Tor,
; helper, startup switches). Installs per user, no admin needed.
; Uninstall: Windows Settings > Apps, or Goat settings > Uninstall.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef STAGE
  !define STAGE "..\..\out"
!endif
!define APPDIR "$LOCALAPPDATA\Goat Browser\Application"

Name "Goat Browser"
OutFile "${STAGE}\GoatBrowser-${VERSION}-windows-x64.exe"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails nevershow
BrandingText "Goat Browser ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Goat Browser"
VIAddVersionKey "FileDescription" "Goat Browser setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Goat Browser"

!define MUI_ICON "goat.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install Goat Browser"
!define MUI_WELCOMEPAGE_TEXT "Goat is a private, fast browser built on Chromium.$\r$\n$\r$\n- Works with all Chrome extensions$\r$\n- Ads and trackers blocked$\r$\n- Built-in Tor and Tor windows$\r$\n- Page translation$\r$\n$\r$\nGoat installs just for you. No admin rights needed."
!define MUI_FINISHPAGE_TITLE "Goat Browser is ready"
!define MUI_FINISHPAGE_TEXT "Goat is installed. You'll find it in the Start menu and on your desktop.$\r$\n$\r$\nTip: pin the goat button in the toolbar for Tor and translation."
!define MUI_FINISHPAGE_RUN "${APPDIR}\chrome.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Goat Browser"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

Section "Goat Browser"
  SetDetailsPrint textonly
  DetailPrint "Preparing…"
  SetDetailsPrint none
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "${STAGE}\mini_installer.exe"

  ; The helper may be running Tor; stop it so its files can be replaced.
  nsExec::Exec 'taskkill /f /im goat-host.exe'
  Pop $0

  SetDetailsPrint textonly
  DetailPrint "Installing Goat Browser…"
  SetDetailsPrint none
  ExecWait '"$PLUGINSDIR\mini_installer.exe" --do-not-launch-chrome' $0
  ; 0 installed, 1 repaired, 2 updated, 3 already there, 4 newer already there, 30 updated (restart Goat to finish)
  ${If} $0 != 0
  ${AndIf} $0 != 1
  ${AndIf} $0 != 2
  ${AndIf} $0 != 3
  ${AndIf} $0 != 4
  ${AndIf} $0 != 30
    MessageBox MB_ICONSTOP "Goat Browser couldn't be installed (setup error $0).$\r$\nClose Goat if it's open and try again." /SD IDOK
    SetErrorLevel 3
    Abort
  ${EndIf}
  IfFileExists "${APPDIR}\chrome.exe" +4
    MessageBox MB_ICONSTOP "Goat Browser couldn't be installed: ${APPDIR} is missing." /SD IDOK
    SetErrorLevel 3
    Abort

  SetDetailsPrint textonly
  DetailPrint "Adding Tor, ad blocker and Goat tools…"
  SetDetailsPrint none
  RMDir /r "${APPDIR}\goat\ext"
  SetOutPath "${APPDIR}\goat"
  File /r "${STAGE}\goat\*.*"
  ; Default startup settings (Balanced), unless Goat settings already saved some.
  IfFileExists "${APPDIR}\goat\settings.switches" +3 0
    Rename "${APPDIR}\goat\settings.switches.default" "${APPDIR}\goat\settings.switches"
    Goto +2
  Delete "${APPDIR}\goat\settings.switches.default"
  SetOutPath "${APPDIR}"
  File "${STAGE}\initial_preferences"

  ; Native messaging host for the Goat extension (Chromium looks here).
  WriteRegStr HKCU "Software\Chromium\NativeMessagingHosts\com.goat.host" "" "${APPDIR}\goat\host-manifest.json"

  SetDetailsPrint textonly
  DetailPrint "Done."
SectionEnd
