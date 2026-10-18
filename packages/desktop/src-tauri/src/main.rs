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

/// 侧车子进程句柄。
///
/// 只持有、不主动杀掉：关 GUI 不等退后端（后端有自己的生命周期与退出入口）。
/// 持有 `Child` 的意义是不让句柄被提前 drop，同时壳进程若异常死亡，
/// Job Object（见 `绑定作业对象`）会由系统连带收走这棵进程树。
#[allow(dead_code)]
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
///
/// **当前没有调用点**：关 GUI 不再收后端（后端只能从设置页红色「退出」或
/// 托盘右键菜单退出）。壳进程异常死亡时由 Job Object（见 `绑定作业对象`）
/// 由系统兜底收走子进程树，不依赖这个函数。
/// 保留它是为了将来若需要"关壳同时退平台"的入口时有现成实现。
#[allow(dead_code)]
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


/// 后端存活监视器。
///
/// **语义**：后端（WebUI 服务端）一旦真正退出，桌面壳也要跟着退出——
/// 留一个只剩报错页的空窗口没有意义。但**不能**一探不到端口就退：
/// 平台「重启」会先杀旧进程再起新进程，中间有几百毫秒到几秒的空窗。
///
/// 所以用「连续失败计数」而不是「一次失败即退」：
///   - 每 1 秒探一次端口
///   - 连续失败达到阈值（默认 10 次 ≈ 10 秒）才判定后端已退出
///
/// 这个阈值要大于重启的最坏耗时（关主控 + 关模块 + 重新拉起，实测数秒），
/// 又要短到用户不会盯着一个死窗口发呆。
///
/// **这只是兜底**。正常退出/重启时后端会通过 WebSocket 主动推 `platform_exit`，
/// 前端收到后立即自行关窗（几百毫秒级），根本走不到这里。这条探测路径覆盖的是
/// 后端**崩溃/被强杀**——那种情况下没人能发消息，只能靠探端口。
fn 启动后端监视(端口: u16) {
    std::thread::spawn(move || {
        // 启动阶段先等后端就绪（最多 60 秒），避免刚开窗还没起来就误判
        let 启动期限 = Instant::now() + Duration::from_secs(60);
        let mut 曾经就绪 = false;
        while Instant::now() < 启动期限 {
            if 端口就绪(端口) {
                曾经就绪 = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        if !曾经就绪 {
            // 一直没起来：交给启动诊断页处理，监视器不参与退出决策
            return;
        }

        const 容错次数: u32 = 10;
        let mut 连续失败: u32 = 0;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            if 端口就绪(端口) {
                连续失败 = 0;
                continue;
            }
            连续失败 += 1;
            if 连续失败 >= 容错次数 {
                // 后端确实没了（被设置页「退出」或托盘「退出」结束，或崩溃）。
                // 直接结束本进程：窗口会随之消失。用 process::exit 而非
                // app_handle().exit() 的原因同关窗路径（避免关闭流程卡住）。
                eprintln!("[桌面端] 后端已退出，关闭桌面窗口");
                std::process::exit(0);
            }
        }
    });
}

/// 只关闭 GUI 窗口，**不动后端**。
///
/// 这是前端关窗按钮（右上角 ✕）的正式入口。语义刻意定为「关掉这扇窗」，
/// 而不是「关掉整个平台」：
///
/// - 后端可能根本不是本壳拉起的（用户先跑了 start.bat，再开桌面端复用），
///   这种情况下壳**没有资格**去结束它。
/// - 就算后端是本壳拉起的，用户关窗的意图通常也只是「先不看了」；
///   把后端一起杀掉，托盘图标会消失、正在跑的长任务会中断，而且下次还得
///   重新等模块加载。
///
/// 后端只能从两处退出：设置页的红色「退出」按钮，或托盘右键菜单的「退出」。
#[tauri::command]
fn quit_app(应用: tauri::AppHandle) {
    let _ = 应用;
    // **刻意不碰后端**。即使侧车是本壳拉起的，关窗也只在关这扇窗。
    //
    // 理由：后端有自己的生命周期与单例锁，用户对它的预期是「一直在，
    // 直到我明确退出」。关个窗口就把正在跑的长任务、模块加载状态全丢掉，
    // 是很容易让人意外的事。后端退出的入口只有两处：
    // 设置页的红色「退出」按钮、托盘右键菜单的「退出」。
    //
    // 副作用是有可能留下一个没有窗口的 node 进程——但它是用户想要的
    // 常驻后端，托盘图标会一直显示，随时可以再打开界面。
    //
    // 不用 应用.exit(0)：它要重入事件循环排队，在关闭流程中可能卡住，
    // 把进程变成「窗口已消失、进程仍在」的僵尸。直接结束本进程即可。
    std::process::exit(0);
}


/// 若窗口在若干秒内仍不可见，强制显示它。
///
/// 配合 `show_window` 使用：正常路径是页面首帧后自己报"我好了"，
/// 这条兜底只在页面没能报到时生效（加载失败、脚本报错、极端慢）。
fn 兜底显示(应用: &tauri::AppHandle, 秒: u64) {
    let 句柄 = 应用.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(秒));
        if let Some(窗) = 句柄.get_webview_window("main") {
            // 已经显示了就什么都不做（绝大多数情况下会走到这里）
            if let Ok(真) = 窗.is_visible() {
                if 真 {
                    return;
                }
            }
            eprintln!("[桌面端] 页面未在 {秒} 秒内报告就绪，强制显示窗口");
            let _ = 窗.show();
        }
    });
}

/// 首帧就绪后显示主窗口。
///
/// 窗口创建时是**隐藏**的（`.visible(false)`），否则会先白一下再渲染出界面：
/// WebView2 建好窗口句柄和真正画出页面之间有几百毫秒的空档，那段就是白屏。
///
/// 由页面在 DOM 渲染完成后调用本命令把窗口显示出来。这比"固定延迟 N 毫秒
/// 再显示"可靠得多——延迟定短了在慢机器上照样白，定长了在快机器上白等。
///
/// 页面加载失败的情况下没人会调用它，所以 `建窗口` 那边还挂了一个超时兜底，
/// 保证窗口最终一定会出现（宁可白屏，也不能变成"程序启动了但没窗口"）。
#[tauri::command]
fn show_window(窗口: tauri::Window) -> Result<(), String> {
    // 先 minimize/restore 一轮不是必要的，直接 show 即可；focus 让它在多窗口
    // 环境下（比如同时开着浏览器版）跑到前面。
    窗口.show().map_err(|e| e.to_string())?;
    窗口.set_focus().map_err(|e| e.to_string())?;
    Ok(())
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


/// 桌面壳单例守卫。
///
/// **为什么必须做**：`start.bat` 每次运行都会启动本程序。没有单例的话，
/// 你点几次就多几个窗口，而且它们都指向同一个后端——看起来像「打开了多份
/// Studio」，实际是同一份数据被多个窗口同时操作，很容易造成"我这边改了
/// 那边没变"的困惑。
///
/// 做法：用一个具名互斥体（mutex）标记"已经有一个桌面壳在跑"。
/// 后启动的那个发现互斥体已存在，就把已有窗口**唤到前台**然后自己退出。
///
/// 选互斥体而不是锁文件：互斥体是内核对象，进程一死（包括被任务管理器杀掉）
/// 系统会自动释放，不会有残留锁导致"再也打不开"。
#[cfg(windows)]
mod 单例 {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    /// 互斥体名（带 Local\ 前缀 = 仅当前登录会话，多用户环境下互不干扰）
    const 互斥体名: &str = r"Local\KuguaStudio.DesktopShell";

    /// 转成宽字符（带结尾 0）
    fn 宽(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    /// 持有互斥体句柄；进程存活期间一直持有，退出时由系统回收。
    pub struct 守卫(HANDLE);

    // 句柄只在进程生命周期内使用，不需要跨线程共享所有权判断
    unsafe impl Send for 守卫 {}

    impl Drop for 守卫 {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    /// 尝试取得单例。
    ///
    /// - `Some(守卫)`：本进程是唯一实例，正常继续启动
    /// - `None`：已有实例在跑，调用方应**激活已有窗口并退出**
    pub fn 取得() -> Option<守卫> {
        let 名字 = 宽(互斥体名);
        let 句柄 = unsafe { CreateMutexW(std::ptr::null(), 0, 名字.as_ptr()) };
        if 句柄.is_null() {
            // 创建失败（极少见）：不阻止启动，宁可多开也不要打不开
            return Some(守卫(std::ptr::null_mut()));
        }
        // 句柄有效但对象已存在 → 说明已有实例
        let 已存在 = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        if 已存在 {
            unsafe {
                CloseHandle(句柄);
            }
            return None;
        }
        Some(守卫(句柄))
    }

    /// 把已有窗口唤到前台（最小化则先还原）。
    ///
    /// 找不到窗口也不报错：可能正在启动中，或用户关掉了窗口但进程还在收尾。
    pub fn 激活已有窗口() -> bool {
        let 标题 = 宽("苦瓜工作室");
        let 标题前缀 = 宽("苦瓜工作室");
        unsafe {
            let mut 窗口 = FindWindowW(std::ptr::null(), 标题.as_ptr());
            if 窗口.is_null() {
                // 启动失败时标题带后缀（"苦瓜工作室 - 启动失败"），退化为按前缀找
                let _ = 标题前缀;
                窗口 = FindWindowW(std::ptr::null(), 宽("苦瓜工作室 - 启动失败").as_ptr());
            }
            if 窗口.is_null() {
                return false;
            }
            if IsIconic(窗口) != 0 {
                ShowWindow(窗口, SW_RESTORE);
            }
            SetForegroundWindow(窗口) != 0
        }
    }
}

/// 非 Windows 平台：不做单例限制（Tauri 在 Linux/macOS 上通常由桌面环境
/// 保证只有一个实例；本项目目前也只在 Windows 上分发）。
#[cfg(not(windows))]
mod 单例 {
    pub struct 守卫;
    pub fn 取得() -> Option<守卫> {
        Some(守卫)
    }
    pub fn 激活已有窗口() -> bool {
        false
    }
}

fn main() {
    // 单例检查必须在**所有初始化之前**：
    // 后面的侧车启动、端口等待都要花时间，先判断能避免"新窗口闪一下才退出"。
    let _单例守卫 = match 单例::取得() {
        Some(守卫) => 守卫,
        None => {
            // 已经有窗口了：把它叫到前面，本次启动直接结束。
            // 用户看到的应该是"原来的窗口跳出来了"，而不是"又多了一个窗口"。
            if !单例::激活已有窗口() {
                eprintln!("[桌面端] 已有实例在运行，但未能激活它的窗口");
            }
            std::process::exit(0);
        }
    };

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
            show_window,
            minimize_window,
            toggle_maximize,
            is_maximized
        ])
        // 窗口关闭：**只退 GUI，不收侧车**（与原实现相反）。
        //
        // 原实现"关窗即收侧车"，等于让右上角 ✕ 拥有了结束整个平台的权力。
        // 但用户关窗的意图通常只是"先不看了"，后端一旦被杀，正在跑的长任务
        // 会中断、托盘图标会消失、下次打开还要重新等模块加载。
        // 现在后端只能从设置页红色「退出」或托盘右键菜单退出。
        //
        // 注意：这里**不要**调 app_handle().exit()——它会在关闭流程中重入事件循环，
        // 导致窗口卡在「已请求关闭但未销毁」的状态（WebView 已退，窗口句柄仍在）。
        .on_window_event(|_窗口, 事件| {
            if let tauri::WindowEvent::CloseRequested { .. } = 事件 {
                // 用 process::exit 而非 app_handle().exit()：后者要重入事件循环排队，
                // 而此刻正处于关闭流程中，实测会把进程卡成「WebView 已退、窗口句柄仍在」
                // 的僵尸。侧车不在退出路径上，直接结束进程是安全的。
                std::process::exit(0);
            }
        })
        .setup(move |应用句柄| {
            let 地址 = format!("http://127.0.0.1:{默认端口}");

            if 就绪 {
                WebviewWindowBuilder::new(应用句柄, "main", WebviewUrl::External(地址.parse()?))
                    .title("苦瓜工作室")
                    // 去掉系统标题栏：页面顶栏已经自绘了一套（含拖拽区与
                    // 最小化/最大化/关闭），再叠一层 Windows 原生标题栏就会出现
                    // 两排一模一样的按钮，既重复又浪费垂直空间。
                    // 自绘标题栏的拖拽依赖 CSS 的 `app-region: drag`，见 style.css。
                    .decorations(false)
                    .inner_size(1440.0, 900.0)
                    .min_inner_size(900.0, 600.0)
                    .center()
                    // 先隐藏，等页面首帧渲染完由它调 show_window 显示，
                    // 避免"先白一下再出界面"。见 show_window 的说明。
                    .visible(false)
                    .build()?;
                // 超时兜底：页面若加载失败（或注入脚本没跑起来），没人会调
                // show_window，窗口就永远不出现——那是比白屏更糟的故障。
                // 这里在 8 秒后强制显示，宁可白屏也要让用户看到东西。
                兜底显示(&应用句柄.handle().clone(), 8);
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
                    .decorations(false)
                    .inner_size(900.0, 600.0)
                    .center()
                    .visible(true)
                    .build()?;
            }
            // 后端退出时连带关掉桌面窗口（Web 网页端不处理，只显示断线提示）
            启动后端监视(默认端口);
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
            // 同样不收侧车：见上面 CloseRequested 的说明。
            // 后端由平台自己管理生命周期（设置页"退出"或托盘"退出"）。
            let _ = 应用句柄;
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
