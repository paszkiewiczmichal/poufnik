; Explorer context menu for the GitHub installer: right click on a file → Poufnik → ….
; On Windows 11 the installer registers an identity package (poufnik-menu.msix, see
; desktop/shell-menu/sparse) so the menu is at the top level, as in the Microsoft Store
; version. When that is not possible (Windows 10, the Store version installed, an unsigned
; build) it writes the classic registry menu, shown under "Pokaż więcej opcji". Per user, like
; the installation itself.

!include LogicLib.nsh

!define POUFNIK_MENU_ROOT "Software\Classes\SystemFileAssociations"

!macro POUFNIK_MENU_ITEM EXT KEY LABEL ACTION
  WriteRegStr HKCU "${POUFNIK_MENU_ROOT}\${EXT}\shell\Poufnik\shell\${KEY}" "MUIVerb" "${LABEL}"
  WriteRegStr HKCU "${POUFNIK_MENU_ROOT}\${EXT}\shell\Poufnik\shell\${KEY}\command" "" \
    '"$INSTDIR\${MAINBINARYNAME}.exe" --poufnik-action ${ACTION} "%1"'
!macroend

!macro POUFNIK_MENU_ROOT_KEY EXT
  WriteRegStr HKCU "${POUFNIK_MENU_ROOT}\${EXT}\shell\Poufnik" "MUIVerb" "Poufnik"
  WriteRegStr HKCU "${POUFNIK_MENU_ROOT}\${EXT}\shell\Poufnik" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr HKCU "${POUFNIK_MENU_ROOT}\${EXT}\shell\Poufnik" "SubCommands" ""
!macroend

; Documents: everything.
!macro POUFNIK_MENU_DOCUMENT EXT
  !insertmacro POUFNIK_MENU_ROOT_KEY ${EXT}
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "1anonymize" "Anonimizuj" "anonymize"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "2ocr" "Wyciągnij tekst (OCR)" "ocr"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "3markdown" "Anonimizuj do Markdown (dla AI)" "markdown"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "4restore" "Przywróć dane" "restore"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "5metadata" "Usuń metadane" "metadata"
!macroend

; Plain text has no text to recognize.
!macro POUFNIK_MENU_TEXT EXT
  !insertmacro POUFNIK_MENU_ROOT_KEY ${EXT}
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "1anonymize" "Anonimizuj" "anonymize"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "3markdown" "Anonimizuj do Markdown (dla AI)" "markdown"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "4restore" "Przywróć dane" "restore"
!macroend

; Scans and photos: nothing to restore in an image.
!macro POUFNIK_MENU_IMAGE EXT
  !insertmacro POUFNIK_MENU_ROOT_KEY ${EXT}
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "1anonymize" "Anonimizuj" "anonymize"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "2ocr" "Wyciągnij tekst (OCR)" "ocr"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "3markdown" "Anonimizuj do Markdown (dla AI)" "markdown"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "5metadata" "Usuń metadane" "metadata"
!macroend

; Spreadsheets, presentations and OpenDocument files: anonymized in their own format;
; nothing to restore (an AI answer comes back as text, Word or PDF).
!macro POUFNIK_MENU_OFFICE EXT
  !insertmacro POUFNIK_MENU_ROOT_KEY ${EXT}
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "1anonymize" "Anonimizuj" "anonymize"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "2ocr" "Wyciągnij tekst (OCR)" "ocr"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "3markdown" "Anonimizuj do Markdown (dla AI)" "markdown"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "5metadata" "Usuń metadane" "metadata"
!macroend

; Old Word and RTF files: converted to DOCX by the app, no metadata cleaning.
!macro POUFNIK_MENU_LEGACY EXT
  !insertmacro POUFNIK_MENU_ROOT_KEY ${EXT}
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "1anonymize" "Anonimizuj" "anonymize"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "2ocr" "Wyciągnij tekst (OCR)" "ocr"
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "3markdown" "Anonimizuj do Markdown (dla AI)" "markdown"
!macroend

; Pictures Poufnik does not anonymize (TIFF): metadata only.
!macro POUFNIK_MENU_METADATA EXT
  !insertmacro POUFNIK_MENU_ROOT_KEY ${EXT}
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "5metadata" "Usuń metadane" "metadata"
!macroend

; An answer from an AI chat saved as Markdown.
!macro POUFNIK_MENU_MARKDOWN EXT
  !insertmacro POUFNIK_MENU_ROOT_KEY ${EXT}
  !insertmacro POUFNIK_MENU_ITEM ${EXT} "4restore" "Przywróć dane" "restore"
!macroend

; Classic registry menu, used when the identity package below cannot be registered.
!macro POUFNIK_CLASSIC_MENU_ADD
  !insertmacro POUFNIK_MENU_DOCUMENT ".pdf"
  !insertmacro POUFNIK_MENU_DOCUMENT ".docx"
  !insertmacro POUFNIK_MENU_TEXT ".txt"
  !insertmacro POUFNIK_MENU_IMAGE ".png"
  !insertmacro POUFNIK_MENU_IMAGE ".jpg"
  !insertmacro POUFNIK_MENU_IMAGE ".jpeg"
  !insertmacro POUFNIK_MENU_IMAGE ".heic"
  !insertmacro POUFNIK_MENU_IMAGE ".heif"
  !insertmacro POUFNIK_MENU_MARKDOWN ".md"
  !insertmacro POUFNIK_MENU_METADATA ".jpe"
  !insertmacro POUFNIK_MENU_METADATA ".tif"
  !insertmacro POUFNIK_MENU_METADATA ".tiff"
  !insertmacro POUFNIK_MENU_OFFICE ".xlsx"
  !insertmacro POUFNIK_MENU_OFFICE ".pptx"
  !insertmacro POUFNIK_MENU_OFFICE ".odt"
  !insertmacro POUFNIK_MENU_OFFICE ".ods"
  !insertmacro POUFNIK_MENU_OFFICE ".odp"
  !insertmacro POUFNIK_MENU_LEGACY ".doc"
  !insertmacro POUFNIK_MENU_LEGACY ".rtf"
!macroend

!macro POUFNIK_CLASSIC_MENU_REMOVE
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.pdf\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.docx\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.txt\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.png\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.jpg\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.jpeg\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.heic\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.heif\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.md\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.jpe\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.tif\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.tiff\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.xlsx\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.pptx\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.odt\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.ods\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.odp\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.doc\shell\Poufnik"
  DeleteRegKey HKCU "${POUFNIK_MENU_ROOT}\.rtf\shell\Poufnik"
!macroend

; Windows 11 top-level menu: poufnik-menu.ps1 registers the signed identity package
; (poufnik-menu.msix) with this installation folder as its content, the same menu the
; Microsoft Store version has. Exit code 0 = registered, 3 = the Store version already has
; the menu; anything else (including "timeout") = classic menu.
; A hung AppX deployment must not block the installer or a silent update, hence the timeout.
!macro POUFNIK_IDENTITY_PACKAGE MODE
  StrCpy $R9 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ; A 32-bit installer must start the 64-bit PowerShell: the Appx cmdlets do not run in WOW64.
  ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy $R9 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  nsExec::ExecToLog /TIMEOUT=120000 '"$R9" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\poufnik-menu.ps1" -Mode ${MODE} -InstallDir "$INSTDIR"'
  Pop $R8
!macroend

; Before the files are copied: an update removes the old identity package first, which also
; releases poufnik_shell_menu.dll held by Explorer.
!macro NSIS_HOOK_PREINSTALL
  ${If} ${FileExists} "$INSTDIR\poufnik-menu.ps1"
    !insertmacro POUFNIK_IDENTITY_PACKAGE "unregister"
  ${EndIf}
  ; The engine and Tesseract folders are copied over, never cleared, so files an older version
  ; had and this one does not (removed prompts, old libraries, Tesseract training tools) would
  ; stay and be used. Only in a Poufnik installation, never in a folder the user picked that
  ; holds something else.
  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    RMDir /r "$INSTDIR\_internal"
    RMDir /r "$INSTDIR\binaries\tesseract"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro POUFNIK_CLASSIC_MENU_REMOVE
  StrCpy $R8 "1"
  ${If} ${FileExists} "$INSTDIR\poufnik-menu.msix"
    !insertmacro POUFNIK_IDENTITY_PACKAGE "register"
  ${EndIf}
  ${If} $R8 != "0"
  ${AndIf} $R8 != "3"
    !insertmacro POUFNIK_CLASSIC_MENU_ADD
  ${EndIf}
  ; Explorer reads the new verbs without a restart.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} ${FileExists} "$INSTDIR\poufnik-menu.ps1"
    !insertmacro POUFNIK_IDENTITY_PACKAGE "unregister"
    ${If} $R8 != "0"
      DetailPrint "Nie udało się usunąć menu kontekstowego Poufnika ($R8). Usuń je poleceniem: Get-AppxPackage Poufnik.MenuKontekstowe | Remove-AppxPackage"
    ${EndIf}
  ${EndIf}
  !insertmacro POUFNIK_CLASSIC_MENU_REMOVE
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
