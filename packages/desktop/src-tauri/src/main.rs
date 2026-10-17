// 苦瓜工作室桌面壳
//
// 职责边界（刻意保持极薄）：
//   - 拉起 WebUI 侧车进程（node packages/webui/dist/server.js）
//   - 等它监听的端口就绪，然后把主窗口指向 http://127.0.0.1:<port>
//   - 窗口关闭 / 应用退出时，确保侧车被收走（不留孤儿 node 进程）
//
// 所有业务逻辑仍在 Node 侧，本壳不含任何业务代码。
// 这样 Chrome 版 WebUI 与 Tauri 版共用同一套前端与服务端。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// 侧车子进程句柄。用 Mutex 包住以便在退出钩子里取回并杀掉。
struct 侧车状态(Mutex<Option<Child>>);

/// 默认 WebUI 端口。与 kugua.config.json 的 webui.port 保持一致。
const 默认端口: u16 = 24600;

/// 从可执行文件位置向上找到仓库根（含 packages/webui/dist/server.js 的那一层）。
///
/// 开发时 `cargo run` 的可执行文件在 src-tauri/target/debug/，发布后可能被装在
/// 任意位置 —— 因此按「向上逐级试探」找，而不是写死相对路径。
fn 找仓库根() -> Option<PathBuf> {
    let 起点 = std::env::current_exe().ok()?;
    let mut 当前: Option<&Path> = 起点.parent();
    while let Some(目录) = 当前 {
        if 目录.join("packages/webui/dist/server.js").exists() {
            return Some(目录.to_path_buf());
        }
        // 也接受「当前目录及其上级」这种情况（从仓库根启动）
        当前 = 目录.parent();
    }
    // 兜底：从工作目录找
    let cwd = std::env::current_dir().ok()?;
    let mut 当前: Option<&Path> = Some(&cwd);
    while let Some(目录) = 当前 {
        if 目录.join("packages/webui/dist/server.js").exists() {
            return Some(目录.to_path_buf());
        }
        当前 = 目录.parent();
    }
    None
}

/// 端口是否已有人在监听（代表 WebUI 已经跑起来了）
fn 端口就绪(端口: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{端口}").parse().expect("地址常量非法"),
        Duration::from_millis(300),
    )
    .is_ok()
}

/// 启动 WebUI 侧车；若端口已就绪则复用它（例如用户已手动开着）。
fn 启动侧车(根: &Path, 端口: u16) -> Result<Option<Child>, String> {
    if 端口就绪(端口) {
        // 已有实例在跑：直接连过去，不重复启动，避免单实例守卫打架
        return Ok(None);
    }

    let 脚本 = 根.join("packages/webui/dist/server.js");
    if !脚本.exists() {
        return Err(format!(
            "找不到 WebUI 服务端：{}\n请先在仓库根执行 npm run build",
            脚本.display()
        ));
    }

    let mut 命令 = Command::new("node");
    命令
        .arg(&脚本)
        .arg("--no-open") // 关键：不弹系统浏览器
        .current_dir(根)
        // 不弹控制台窗口
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        命令.creation_flags(CREATE_NO_WINDOW);
    }

    let 子 = 命令
        .spawn()
        .map_err(|e| format!("无法启动 node 侧车：{e}（请确认已安装 Node.js 并加入 PATH）"))?;
    绑定作业对象(&子);
    Ok(Some(子))
}

/// 等端口就绪，最多等 timeout
fn 等端口(端口: u16, 超时: Duration) -> bool {
    let 起点 = Instant::now();
    while 起点.elapsed() < 超时 {
        if 端口就绪(端口) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

/// 把侧车进程绑到 Windows Job Object 上。
///
/// 这是最可靠的一层保障：只要本进程消失（正常退出、崩溃、被任务管理器杀掉），
/// 操作系统会连带收掉 Job 里的所有子进程，不会留下孤儿 node。
#[cfg(windows)]
fn 绑定作业对象(子进程: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject, JobObjectExtendedLimitInformation,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // 句柄交给 Job 持有后不主动关闭：随进程退出由系统回收
    static 已建: std::sync::OnceLock<isize> = std::sync::OnceLock::new();
    let 作业 = *已建.get_or_init(|| unsafe {
        let 句柄 = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if 句柄.is_null() {
            return 0;
        }
        let mut 信息: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        信息.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            句柄,
            JobObjectExtendedLimitInformation,
            &信息 as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        句柄 as isize
    });

    if 作业 == 0 {
        return;
    }
    unsafe {
        AssignProcessToJobObject(作业 as *mut std::ffi::c_void, 子进程.as_raw_handle() as *mut std::ffi::c_void);
    }
}

#[cfg(not(windows))]
fn 绑定作业对象(_子进程: &Child) {}

/// 结束侧车进程树。
///
/// 直接 kill 父进程可能留下 node 子进程（模块进程），因此 Windows 上用 taskkill /T 连树一起收。
fn 关闭侧车(子进程: &mut Child) {
    let pid = 子进程.id();
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = 子进程.kill();
    }
    let _ = 子进程.wait();
}

/// 关闭主窗口并结束应用。
///
/// 这是前端关窗按钮的正式入口：不依赖 `core:window:allow-close` 之类的
/// window capability（远程 URL 下容易因 url 匹配不上而被静默拒绝），
/// 而是走本应用自己的 invoke 命令，行为完全可控。
#[tauri::command]
fn quit_app(应用: tauri::AppHandle) {
    if let Some(状态) = 应用.try_state::<侧车状态>() {
        if let Ok(mut 锁) = 状态.0.lock() {
            if let Some(mut 子) = 锁.take() {
                关闭侧车(&mut 子);
            }
        }
    }
    // 侧车已收干净，直接结束进程。
    //
    // 不用 应用.exit(0)：它要重入事件循环排队，在关闭流程中可能卡住，
    // 把进程变成「窗口已消失、进程仍在」的僵尸。
    std::process::exit(0);
}

/// 最小化主窗口（同样走自定义命令，避免 capability 远程 URL 匹配问题）
#[tauri::command]
fn minimize_window(窗口: tauri::Window) -> Result<(), String> {
    窗口.minimize().map_err(|e| e.to_string())
}

/// 切换最大化，返回切换后的状态
#[tauri::command]
fn toggle_maximize(窗口: tauri::Window) -> Result<bool, String> {
    // Tauri 没有 toggle_maximize，按当前状态自行切换
    if 窗口.is_maximized().map_err(|e| e.to_string())? {
        窗口.unmaximize().map_err(|e| e.to_string())?;
    } else {
        窗口.maximize().map_err(|e| e.to_string())?;
    }
    // 最大化有动画，状态不是立刻可读：短暂轮询，避免前端拿到过时值
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(25));
        if 窗口.is_maximized().unwrap_or(false) {
            return Ok(true);
        }
    }
    Ok(窗口.is_maximized().unwrap_or(false))
}

/// 查询是否最大化
#[tauri::command]
fn is_maximized(窗口: tauri::Window) -> Result<bool, String> {
    窗口.is_maximized().map_err(|e| e.to_string())
}

fn main() {
    let 根 = 找仓库根();
    let mut 侧车: Option<Child> = None;

    match &根 {
        Some(目录) => match 启动侧车(目录, 默认端口) {
            Ok(子) => 侧车 = 子,
            Err(错误) => eprintln!("[桌面端] {错误}"),
        },
        None => eprintln!("[桌面端] 未定位到仓库根（缺少 packages/webui/dist/server.js）"),
    }

    let 就绪 = 等端口(默认端口, Duration::from_secs(60));

    let 应用 = tauri::Builder::default()
        .manage(侧车状态(Mutex::new(侧车)))
        .invoke_handler(tauri::generate_handler![
            quit_app,
            minimize_window,
            toggle_maximize,
            is_maximized
        ])
        // 窗口关闭即收侧车。
        //
        // 注意：这里**不要**调 app_handle().exit()——它会在关闭流程中重入事件循环，
        // 导致窗口卡在「已请求关闭但未销毁」的状态（WebView 已退，窗口句柄仍在）。
        // 让 Tauri 自己走完关闭流程，退出时机交给 RunEvent::Exit。
        .on_window_event(|窗口, 事件| {
            if let tauri::WindowEvent::CloseRequested { .. } = 事件 {
                if let Some(状态) = 窗口.try_state::<侧车状态>() {
                    if let Ok(mut 锁) = 状态.0.lock() {
                        if let Some(mut 子) = 锁.take() {
                            关闭侧车(&mut 子);
                        }
                    }
                }
                // 单窗口应用：关窗即退出。
                //
                // 用 process::exit 而非 app_handle().exit()：后者要重入事件循环排队，
                // 而此刻正处于关闭流程中，实测会把进程卡成「WebView 已退、窗口句柄仍在」
                // 的僵尸。侧车已在上面同步收干净，这里直接结束进程是安全的。
                std::process::exit(0);
            }
        })
        .setup(move |应用句柄| {
            let 地址 = format!("http://127.0.0.1:{默认端口}");

            if 就绪 {
                WebviewWindowBuilder::new(应用句柄, "main", WebviewUrl::External(地址.parse()?))
                    .title("苦瓜工作室")
                    .inner_size(1440.0, 900.0)
                    .min_inner_size(900.0, 600.0)
                    .center()
                    .visible(true)
                    .build()?;
            } else {
                // 侧车没起来：显示一段可读的诊断页，而不是白屏
                let 诊断 = 诊断页(根.as_deref(), &地址);
                let 数据 = 诊断
                    .replace('\\', "\\\\")
                    .replace('`', "\\`")
                    .replace('$', "\\$");
                let html = format!(
                    "data:text/html;charset=utf-8,{}",
                    urlencoding(&format!(
                        "<html><body style=\"font-family:system-ui;padding:2rem;line-height:1.7\">{}</body></html>",
                        数据.replace('\n', "<br>")
                    ))
                );
                WebviewWindowBuilder::new(应用句柄, "main", WebviewUrl::External(html.parse()?))
                    .title("苦瓜工作室 - 启动失败")
                    .inner_size(900.0, 600.0)
                    .center()
                    .visible(true)
                    .build()?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 应用初始化失败");

    // 窗口全关 → 允许退出（Tauri 在某些平台不会自动退出）
    应用.run(|应用句柄, 事件| {
        if let RunEvent::ExitRequested { api, .. } = &事件 {
            // 没有窗口了就该退出；保持默认行为
            let _ = api;
        }
        if let RunEvent::Exit = 事件 {
            if let Some(状态) = 应用句柄.try_state::<侧车状态>() {
                if let Ok(mut 锁) = 状态.0.lock() {
                    if let Some(mut 子) = 锁.take() {
                        关闭侧车(&mut 子);
                    }
                }
            }
        }
    });
}

/// 侧车启动失败时展示的诊断信息（纯文本，避免注入）
fn 诊断页(根: Option<&Path>, 地址: &str) -> String {
    let mut 行 = vec![
        "<h2>苦瓜工作室启动失败</h2>".to_string(),
        format!("WebUI 服务端地址：{地址}"),
    ];
    match 根 {
        Some(目录) => {
            行.push(format!("仓库根：{}", 目录.display()));
            let 脚本 = 目录.join("packages/webui/dist/server.js");
            行.push(format!(
                "服务端脚本：{}（{}）",
                脚本.display(),
                if 脚本.exists() { "存在" } else { "缺失" }
            ));
        }
        None => 行.push("未定位到仓库根（找不到 packages/webui/dist/server.js）。".to_string()),
    }
    行.push(String::new());
    行.push("请检查：".to_string());
    行.push("1. 是否已安装 Node.js 并加入 PATH（命令行执行 node -v）".to_string());
    行.push("2. 是否已在仓库根执行过 npm run build".to_string());
    行.push("3. 端口 24600 是否被其他程序占用".to_string());
    行.join("\n")
}

/// 极简 percent-encoding，仅用于把诊断页塞进 data: URL
fn urlencoding(文本: &str) -> String {
    let mut 出 = String::with_capacity(文本.len() * 3);
    for 字节 in 文本.as_bytes() {
        match 字节 {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                出.push(*字节 as char)
            }
            _ => 出.push_str(&format!("%{字节:02X}")),
        }
    }
    出
}
