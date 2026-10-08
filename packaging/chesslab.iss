#ifndef AppVersion
  #define AppVersion "1.5.0"
#endif
#ifndef LegacyRoot
  #define LegacyRoot ""
#endif
[Setup]
AppId={{D186559E-BAFD-40CE-9C20-024769CFAE42}
AppName=Chess Lab
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\Chess Lab
DefaultGroupName=Chess Lab
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=ChessLab-Setup-{#AppVersion}
SetupIconFile=..\app\static\icons\favicon.ico
UninstallDisplayIcon={app}\ChessLab.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Files]
Source: "..\dist\ChessLab\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\Chess Lab"; Filename: "{app}\ChessLab.exe"; WorkingDir: "{app}"
Name: "{autoprograms}\Chess Lab"; Filename: "{app}\ChessLab.exe"; WorkingDir: "{app}"

[Run]
#if LegacyRoot != ""
Filename: "{app}\ChessLab.exe"; Parameters: "--migrate-from ""{#LegacyRoot}"""; Flags: runhidden waituntilterminated
#endif
Filename: "{app}\ChessLab.exe"; Description: "Open Chess Lab"; Flags: nowait postinstall skipifsilent

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var ResultCode: Integer;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\ChessLab.exe')) then
  begin
    if not Exec(ExpandConstant('{app}\ChessLab.exe'), '--stop --no-window', '', SW_HIDE,
                ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
      Result := 'Close Chess Lab and stop any running experiment, then try the update again.';
  end;
end;
