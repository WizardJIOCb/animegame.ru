$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$blendFile = Join-Path $PSScriptRoot "hoodie-fitting.blend"
$sceneScript = Join-Path $PSScriptRoot "create_hoodie_fitting_scene.py"
$blender = "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe"

if (!(Test-Path $blendFile)) {
  & $blender --background --python $sceneScript
}

$startup = Join-Path $env:TEMP "animegame_start_blender_mcp.py"
@"
import bpy

bpy.ops.wm.open_mainfile(filepath=r"$blendFile")
try:
    bpy.ops.preferences.addon_enable(module="codex_blender_mcp_bridge")
except Exception:
    pass

props = bpy.context.window_manager.codex_mcp_props
props.host = "127.0.0.1"
props.port = 9877
bpy.ops.codex_mcp.start_server()
"@ | Set-Content -LiteralPath $startup -Encoding UTF8

Start-Process -FilePath $blender -ArgumentList @("--python", $startup) -WorkingDirectory $projectRoot
Write-Host "Opened Blender hoodie fitting scene and requested Codex MCP addon server on 127.0.0.1:9877"
