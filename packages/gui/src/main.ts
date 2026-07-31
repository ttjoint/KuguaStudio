/**
 * Electron 主进程
 * 职责：启动苦音主控、创建 GUI 窗口、代理渲染进程与主控的通信。
 */

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from "electron";
import { spawn, type ChildProcess, exec } from "node:child_process";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NiganeClient } from "@kugua/nigane";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// 扩展 app 类型以支持自定义属性
const appWithMeta = app as typeof app & { isQuiting?: boolean };

let 托盘图标: Tray | null = null;

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const 图标路径 = resolve(__dirname, "assets/icon.jpg");

interface 配置 {
  host?: string;
  port?: number;
  token?: string;
}

function 加载配置(): 配置 {
  const 路径 = resolve(process.cwd(), "kugua.config.json");
  if (!existsSync(路径)) return {};
  try {
    return JSON.parse(readFileSync(路径, "utf-8")) as 配置;
  } catch {
    return {};
  }
}

let 主控进程: ChildProcess | null = null;
let 苦音客户端: NiganeClient | null = null;
let 主窗口: BrowserWindow | null = null;

/**
 * 清理占用指定端口的旧进程
 * Windows: 使用 netstat 查找并杀掉
 * 非 Windows: 使用 lsof 查找并杀掉
 */
async function 清理端口占用(port: number): Promise<void> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execAsync(`netstat -aon | findstr :${port} | findstr LISTENING`);
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const pids = new Set<number>();
      for (const line of lines) {
        const parts = line.split(/\s+/).filter(Boolean);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(pid)) pids.add(pid);
      }
      for (const pid of pids) {
        if (pid === process.pid) continue;
        try {
          process.kill(pid, "SIGTERM");
          console.log(`[GUI] 已清理占用端口 ${port} 的旧进程 PID=${pid}`);
        } catch {
          // 忽略，尝试强制杀掉
          try {
            await execAsync(`taskkill /F /PID ${pid}`);
            console.log(`[GUI] 已强制清理占用端口 ${port} 的旧进程 PID=${pid}`);
          } catch {
            // 忽略
          }
        }
      }
      if (pids.size > 0) {
        // 等待一小段时间让端口释放
        await new Promise((r) => setTimeout(r, 500));
      }
    } else {
      const { stdout } = await execAsync(`lsof -ti:${port} 2>/dev/null || true`);
      const pids = stdout.trim().split(/\s+/).filter(Boolean).map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
      for (const pid of pids) {
        if (pid === process.pid) continue;
        try {
          process.kill(pid, "SIGTERM");
          console.log(`[GUI] 已清理占用端口 ${port} 的旧进程 PID=${pid}`);
        } catch {
          // 忽略
        }
      }
      if (pids.length > 0) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  } catch {
    // 查找端口命令执行失败（如无旧进程），直接跳过
  }
}

function 启动主控(配置: 配置): Promise<void> {
  return new Promise((res, rej) => {
    const 主控脚本 = resolve(process.cwd(), "../main/dist/index.js");
    const proc = spawn("node", [主控脚本], {
      stdio: "pipe",
      cwd: resolve(process.cwd(), "../.."),
    });
    主控进程 = proc;

    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      console.log("[主控]", text.trim());
      if (text.includes("苦音服务端已启动")) {
        resolve();
      }
    });
    proc.stderr?.on("data", (data: Buffer) => {
      console.error("[主控]", data.toString().trim());
    });
    proc.on("error", rej);
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`[主控] 进程异常退出，退出码 ${code}`);
      }
    });

    setTimeout(() => res(), 3000);
  });
}

function 创建托盘(): void {
  const 图标 = nativeImage.createFromPath(图标路径);
  托盘图标 = new Tray(图标.resize({ width: 16, height: 16 }));
  托盘图标.setToolTip("苦瓜工作室（主进程运行中）");
  
  const 菜单 = Menu.buildFromTemplate([
    { label: "显示主界面", click: () => {
      if (主窗口) {
        主窗口.show();
        主窗口.focus();
      }
    }},
    { type: "separator" },
    { label: "退出主进程", click: () => {
      console.log("[托盘] 收到退出指令");
      appWithMeta.isQuiting = true; // 标记为正在退出，避免窗口关闭事件被拦截
      苦音客户端?.close();
      主控进程?.kill();
      托盘图标?.destroy();
      托盘图标 = null;
      app.quit();
    }}
  ]);
  托盘图标.setContextMenu(菜单);
  
  // 双击托盘图标唤出/隐藏主窗口
  托盘图标.on("double-click", () => {
    if (主窗口) {
      if (主窗口.isVisible()) {
        主窗口.hide();
      } else {
        主窗口.show();
        主窗口.focus();
      }
    }
  });

  // 单击托盘图标显示右键菜单
  托盘图标.on("click", () => {
    托盘图标?.popUpContextMenu(菜单);
  });
}

async function 创建窗口(): Promise<void> {
  主窗口 = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: 图标路径,
    webPreferences: {
      preload: resolve(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 拦截关闭事件，隐藏到托盘而不是退出
  主窗口.on("close", (event) => {
    // 如果不是主动退出，则隐藏窗口
    if (!appWithMeta.isQuiting) {
      event.preventDefault();
      主窗口?.hide();
    }
  });

  await 主窗口.loadFile(resolve(__dirname, "renderer/index.html"));
}

function 注册IPC(): void {
  ipcMain.handle("kugua:request", async (_event, target: string, action: string, params: unknown) => {
    if (!苦音客户端) throw new Error("苦音客户端未初始化");
    return 苦音客户端.request(target, action, params);
  });

  ipcMain.handle("kugua:broadcast", async (_event, action: string, params: unknown) => {
    if (!苦音客户端) throw new Error("苦音客户端未初始化");
    return 苦音客户端.sendEvent(action, params);
  });
}

async function 初始化(): Promise<void> {
  // 先注册 IPC，再创建窗口，避免渲染进程加载后立即调用未注册的 handler
  注册IPC();

  // 创建托盘（即使关闭窗口也保持运行）
  创建托盘();

  // 创建窗口，确保后续步骤失败时用户也能看到错误
  await 创建窗口();

  const 配置 = 加载配置();
  const host = 配置.host ?? "127.0.0.1";
  const port = 配置.port ?? 24601;

  // 启动前先清理端口占用（防止上一次的旧进程残留）
  await 清理端口占用(port);

  try {
    await 启动主控(配置);
  } catch (err) {
    主窗口?.webContents.send("kugua:log", {
      时间: Date.now(),
      方向: "超时",
      类型: "error",
      from: "main",
      message: `主控启动失败：${String(err)}`,
    });
    return;
  }

  苦音客户端 = new NiganeClient({
    name: "gui",
    url: `ws://${host}:${port}`,
    token: 配置.token ?? "",
    version: "0.5.0",
    capabilities: ["gui"],
  });

  // 转发通信日志到渲染进程
  苦音客户端.on("log", (条目: unknown) => {
    主窗口?.webContents.send("kugua:log", 条目);
  });

  try {
    await 苦音客户端.connect();
    主窗口?.webContents.send("kugua:ready");
  } catch (err) {
    主窗口?.webContents.send("kugua:log", {
      时间: Date.now(),
      方向: "超时",
      类型: "error",
      from: "main",
      message: `连接主控失败：${String(err)}`,
    });
  }
}

app.whenReady().then(() => {
  初始化().catch((err) => {
    console.error("[GUI] 初始化失败：", err);
  });
});

app.on("window-all-closed", () => {
  // 如果托盘图标存在，则不退出程序，保持在后台运行
  if (托盘图标) {
    return;
  }
  // 没有托盘图标时，按原逻辑退出
  if (process.platform !== "darwin") {
    苦音客户端?.close();
    主控进程?.kill();
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void 创建窗口();
  }
});

