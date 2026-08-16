; KyStudy keeps user-owned data beside the installed executable.
; The standard Tauri NSIS template includes these macros at the documented
; installer lifecycle points. Keep this file free of application secrets.

!macro NSIS_HOOK_PREINSTALL
  ; Fail before copying application files when the selected install location
  ; cannot be written by the current user. This avoids a silent AppData fallback.
  CreateDirectory "$INSTDIR\data"
  ClearErrors
  FileOpen $0 "$INSTDIR\data\.kystudy-data-v1" w
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "KyStudy cannot write its data folder at $INSTDIR\data.$\r$\n$\r$\nChoose a user-writable install location (for example, your user profile) or grant the current user write access to this data folder, then run the installer again."
    Abort
  ${Else}
    FileWrite $0 "KyStudy user data directory v1$\r$\n"
    FileClose $0
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; The default Tauri uninstaller removes only packaged files and leaves a
  ; non-empty data directory in place. Delete it only when the user selected
  ; the explicit "Delete app data" checkbox on the uninstall confirmation page.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RmDir /r "$INSTDIR\data"
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
