; Goat Browser setup bootstrapper (NSIS 3). Build: npm run installer
; It only unpacks Goat to a temp folder and starts Goat's own installer screen
; (GoatBrowser.exe --goat-setup, see src/setup.js), which copies Goat into
; %LOCALAPPDATA%\Programs\Goat Browser, adds shortcuts, and registers it with Windows.
; Uninstalling (Windows "Apps" or Goat Settings > About) runs GoatBrowser.exe --goat-uninstall.

Unicode true
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define SRC "..\dist\Goat Browser-win32-x64"

Name "Goat Browser"
OutFile "..\dist\GoatBrowserSetup-${VERSION}.exe"
Icon "..\build\icon.ico"
RequestExecutionLevel user
SilentInstall silent
SetCompressor /SOLID lzma
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Goat Browser"
VIAddVersionKey "FileDescription" "Goat Browser setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Goat Browser"

Section
  InitPluginsDir
  Banner::show /NOUNLOAD /set 76 "Goat Browser" "Getting setup ready…"
  SetOutPath "$PLUGINSDIR\goat"
  File /r "${SRC}\*.*"
  Banner::destroy
  ExecWait '"$PLUGINSDIR\goat\GoatBrowser.exe" --goat-setup' $0
  SetOutPath "$TEMP" ; leave the folder so it can be cleaned up
SectionEnd
