!macro customInit
  ; Andrew Downloader chạy nền trong system tray có thể giữ khóa app.asar
  ; và làm uninstaller cũ thất bại. Người dùng đã chủ động chạy Setup,
  ; vì vậy đóng toàn bộ cây tiến trình app trước khi nâng cấp.
  nsExec::ExecToStack '"$SYSDIR\taskkill.exe" /F /T /IM "Andrew Downloader.exe"'
  Pop $0
  Pop $1
  Sleep 800
!macroend
