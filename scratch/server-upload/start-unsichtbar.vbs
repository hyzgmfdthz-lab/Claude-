' Startet die Anwendung ohne Fenster im Hintergrund.
'
' Wird von Einrichten.bat in die Aufgabenplanung eingetragen und laeuft
' danach bei jeder Windows-Anmeldung automatisch mit.
'
' Sucht node.exe selbst: In der Aufgabenplanung ist der Suchpfad ein
' anderer als in der Eingabeaufforderung - "node" allein genuegt dort
' nicht zuverlaessig.
Option Explicit

Dim shell, fso, ordner, node, kandidat, befehl
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

ordner = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = ordner
If Not fso.FolderExists(ordner & "\daten") Then fso.CreateFolder ordner & "\daten"

node = "node"
Dim pfade
pfade = Array( _
  shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe"), _
  shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\node.exe"), _
  shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe"))
For Each kandidat In pfade
  If fso.FileExists(kandidat) Then
    node = kandidat
    Exit For
  End If
Next

shell.Environment("PROCESS")("MEGC_HOST") = "0.0.0.0"
shell.Environment("PROCESS")("MEGC_NO_BROWSER") = "1"

' cmd /c ""node.exe" "server.js" >> "server.log" 2>&1"
befehl = "cmd /c " & Anfuehren( _
  Anfuehren(node) & " " & Anfuehren(ordner & "\server\server.js") & _
  " >> " & Anfuehren(ordner & "\daten\server.log") & " 2>&1")

' 0 = kein Fenster, False = nicht auf das Ende warten
shell.Run befehl, 0, False

Function Anfuehren(text)
  Anfuehren = Chr(34) & text & Chr(34)
End Function
