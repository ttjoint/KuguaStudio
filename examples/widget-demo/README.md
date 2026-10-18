# 小组件示例：sysmon

演示**插件如何向主界面注入实时展示块**（CPU / 内存）。这是最小可用样例，
也是 `docs/小组件设计.md` 的参考实现。

## 怎么跑

1. 把本目录复制到 `<仓库根>/plugins/sysmon`
2. 重启平台（或等 plugins 模块的目录轮询发现它）
3. 主界面顶部就会出现两个环形进度

`plugins/` 目录被 `.gitignore` 排除——那是用户自己的插件存放处，
所以示例放在 `examples/` 下，而不是直接放进去。

## 关键点

**声明写在 `kugua-plugin.json` 的 `widgets` 里**，运行时代码只管推数据：

```json
{ "id": "cpu", "type": "gauge", "title": "CPU",
  "unit": "%", "max": 100, "prominence": "primary",
  "warn": 70, "danger": 90, "stale": 15 }
```

```js
ctx.广播("widget.data", { id: "cpu", 值: 42.5 });
```

三处容易踩的坑：

1. **不要写位置。** 没有 `slot` / `order` / `size` 这些字段，
   写了也不会生效。位置和外形由平台按 `prominence` 决定，用户还能覆盖。
2. **`on_unload` 必须清掉定时器。** 否则插件卸载后还在推数据，
   界面会收到「幽灵」值。
3. **取不到的数据就别声明。** 这个示例原本还有网速组件，
   但读取网卡字节计数器依赖 `/proc/net/dev`（仅 Linux），
   Windows 上取不到——所以删掉了。显示假的 `0 MB/s` 比不显示更坏。

## 关于 `prominence`

- `primary` → 大卡，放顶部（单插件最多 2 个，多了自动降级）
- `normal` → 横条
- `secondary` → 压进底部状态栏

它表达的是**相对重要性，不是位置**：插件可能跑在完全不同的前端上，
无从知道「顶部」在哪、屏幕多宽。
