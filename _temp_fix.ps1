$path = "d:\Projects\KuguaStudio\packages\gui\src\renderer\index.ts"
$content = [System.IO.File]::ReadAllText($path)

# Fix 1: 统一换行符为 \n
$old1 = [regex]::Escape("        编辑器原始内容 = 文本;") + "\n" + [regex]::Escape("        文本编辑区.value = 文本;")
$new1 = "        // 统一换行符为 \n，与 textarea 行为一致，避免误判`"已修改`"`n        编辑器原始内容 = 文本.replace(/\r\n/g, `"\n`").replace(/\r/g, `"\n`");`n        文本编辑区.value = 编辑器原始内容;"
$content = $content -replace $old1, $new1

# Fix 2: 释放焦点
$old2 = [regex]::Escape("    }") + "\n" + [regex]::Escape("    // 停止媒体播放")
$new2 = "    }`n    // 先释放焦点，避免隐藏的 textarea 保持聚焦导致其他输入框无法输入`n    文本编辑区.blur();`n    // 停止媒体播放"
$content = $content -replace $old2, $new2

# Fix 3: ESC 处理器调用 关闭内置编辑器()
$old3 = [regex]::Escape("      隐藏右键菜单();") + "\n" +
        [regex]::Escape('      document.getElementById("openwith-dialog")?.classList.add("hidden");') + "\n" +
        [regex]::Escape('      document.getElementById("rename-dialog")?.classList.add("hidden");') + "\n" +
        [regex]::Escape('      document.getElementById("snippet-dialog")?.classList.add("hidden");') + "\n" +
        [regex]::Escape('      document.getElementById("note-dialog")?.classList.add("hidden");') + "\n" +
        [regex]::Escape('      document.getElementById("material-dialog")?.classList.add("hidden");') + "\n" +
        [regex]::Escape('      document.getElementById("preview-dialog")?.classList.add("hidden");')
$new3 = "      if (!document.getElementById(`"preview-dialog`")?.classList.contains(`"hidden`")) {`n        关闭内置编辑器();`n        return;`n      }`n      隐藏右键菜单();`n      document.getElementById(`"openwith-dialog`")?.classList.add(`"hidden`");`n      document.getElementById(`"rename-dialog`")?.classList.add(`"hidden`");`n      document.getElementById(`"snippet-dialog`")?.classList.add(`"hidden`");`n      document.getElementById(`"note-dialog`")?.classList.add(`"hidden`");`n      document.getElementById(`"material-dialog`")?.classList.add(`"hidden`");"
$content = $content -replace $old3, $new3

# Write back with UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $content, $utf8NoBom)

Write-Output "Done writing."