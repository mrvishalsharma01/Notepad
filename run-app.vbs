Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "c:\Users\visha\OneDrive\Desktop\Notepad"
WshShell.Run "cmd /c npm start", 0, false
