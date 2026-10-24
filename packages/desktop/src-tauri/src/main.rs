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
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// 侧车子进程句柄。
///
/// 只持有、不主动杀掉：关 GUI 不等退后端（后端有自己的生命周期与退出入口）。
/// 持有 `Child` 的意义是不让句柄被提前 drop，同时壳进程若异常死亡，
/// Job Object（见 `绑定作业对象`）会由系统连带收走这棵进程树。
#[allow(dead_code)]
struct 侧车状态(Arc<Mutex<Option<Child>>>);

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

/// 闪屏页的 data URI（base64）。
///
/// 用 `include_str!` 把 HTML 编进二进制，再用 data URI 加载——这样闪屏不依赖
/// 任何外部文件或自定义协议，壳被单独拷走也能用。
///
/// **必须 base64，不能直接拼原文。** 这个坑踩过一次：直接拼的话，HTML 里的
/// 换行符会让 URL 解析在第一行就断掉，`+` 又会被解码成空格（CSS 里的
/// `+` 选择器、`2.4s` 之类会全乱），结果页面是一片空白——而窗口本身
/// 是"可见"的，透明窗口配空内容，看起来就是"闪屏压根没出现"。
fn 闪屏页地址() -> String {
    use base64::Engine;
    let 页 = include_str!("../../splash.html");
    let 编码 = base64::engine::general_purpose::STANDARD.encode(页.as_bytes());
    format!("data:text/html;charset=utf-8;base64,{编码}")
}

/// 让闪屏窗口推进到某个阶段（调用页面里注入的 `window.__splash.阶段`）。
///
/// 用 eval 而不是 IPC：闪屏页是纯静态的，没必要为它拉起整套 Tauri 通信；
/// 而且 eval 在这里是**壳 -> 自己加载的页面**，不涉及任何外部输入。
fn 推进闪屏(应用: &tauri::AppHandle, 阶段: &str) {
    if let Some(屏) = 应用.get_webview_window("splash") {
        let _ = 屏.eval(&format!(
            "window.__splash && window.__splash.阶段({});",
            字符串字面量(阶段)
        ));
    }
}

/// 让闪屏淡出（主界面已经画好了）。
fn 闪屏淡出(应用: &tauri::AppHandle) {
    if let Some(屏) = 应用.get_webview_window("splash") {
        // 先推进到"完成"再淡出，让进度条走到 100%
        let _ = 屏.eval(
            "window.__splash && window.__splash.阶段('完成');",
        );
        let 屏2 = 屏.clone();
        // 等淡出动画走完再销毁窗口，否则会"啪"地消失
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(430));
            let _ = 屏2.eval("window.__splash && window.__splash.淡出(0);");
            std::thread::sleep(Duration::from_millis(120));
            let _ = 屏2.close();
        });
    }
}

/// 把一段文本转成安全的 JS 字符串字面量（加引号、转义）。
fn 字符串字面量(s: &str) -> String {
    let mut 输出 = String::with_capacity(s.len() + 2);
    输出.push('"');
    for 字 in s.chars() {
        match 字 {
            '"' => 输出.push_str("\\\""),
            '\\' => 输出.push_str("\\\\"),
            '\n' => 输出.push_str("\\n"),
            '\r' => 输出.push_str("\\r"),
            '\t' => 输出.push_str("\\t"),
            // 防止内容里出现 </script> 之类把上下文提前闭合
            '<' => 输出.push_str("\\u003c"),
            _ => 输出.push(字),
        }
    }
    输出.push('"');
    输出
}

/// 记录当前窗口几何到磁盘。
///
/// 设计要点：
/// - **最大化时不覆盖普通尺寸**：用户最大化后关闭，下次取消最大化应该
///   回到他原来的窗口大小，而不是一个铺满屏幕的"普通窗口"。
///   具体逻辑在 窗口状态::更新 里。
/// - 忽略轻微抖动：拖动窗口会连续触发 Moved，每次都写盘太浪费。
///   只有变化超过阈值才写（坐标 2px / 尺寸 2px）。
fn 记录窗口几何(窗口: &tauri::Window) {
    use std::sync::Mutex;
    static 上次写入: Mutex<Option<窗口状态::几何>> = Mutex::new(None);

    // 缩放系数：Tauri 的 position/size 是物理像素，持久化要逻辑像素，
    // 否则在 125%/150% 缩放的屏幕上，每次重启窗口都会越来越大。
    let 缩放 = 窗口.scale_factor().unwrap_or(1.0);
    let 位置 = 窗口
        .outer_position()
        .ok()
        .map(|p| ((p.x as f64 / 缩放).round() as i32, (p.y as f64 / 缩放).round() as i32));
    let 尺寸 = 窗口
        .inner_size()
        .ok()
        .map(|s| ((s.width as f64 / 缩放).round() as u32, (s.height as f64 / 缩放).round() as u32));

    // 是否最大化：**同时**看状态位与「是否贴合屏幕工作区」。
    //
    // 为什么不能只信 is_maximized()：实测时序是 OS 先发 Resized、
    // 之后才更新最大化状态位。那一次 Resized 里 is_maximized() 返回
    // false，于是全屏尺寸被当成"用户的普通尺寸"写进磁盘，之前的
    // 1100×750 永久丢失（诊断日志实证两次）。
    //
    // 为什么用 work_area 而不是显示器全尺寸：最大化时窗口贴合的是
    // 工作区（屏幕减去任务栏），在本机是 2560×1392 而屏幕是 2560×1440。
    // 用全尺寸比较会永远不相等，判断失效。
    let 状态最大化 = 窗口.is_maximized().unwrap_or(false);
    let 贴工作区 = match (尺寸, 窗口.current_monitor().ok().flatten()) {
        (Some((宽, 高)), Some(屏)) => {
            let 缩放 = 窗口.scale_factor().unwrap_or(1.0);
            let 区 = 屏.work_area();
            let 区宽 = (区.size.width as f64 / 缩放).round() as u32;
            let 区高 = (区.size.height as f64 / 缩放).round() as u32;
            // 允许 8px 误差：DPI 取整、边框阴影各有几像素出入
            宽.abs_diff(区宽) <= 8 && 高.abs_diff(区高) <= 8
        }
        _ => false,
    };
    let 最大化 = 状态最大化 || 贴工作区;

    // 最大化时**什么都不写**：磁盘里保留的仍是最后一次非最大化值。
    // 关闭窗口时另走 记录关闭状态（那里才写 maximized 标记）。
    if 最大化 {
        return;
    }

    let 已有 = 上次写入
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .or_else(窗口状态::读取)
        .unwrap_or_else(窗口状态::几何::默认);

    let 新值 = 窗口状态::更新(&已有, 位置, 尺寸, false);

    // 变化太小就不写盘（拖动会连续触发 Moved，每次都写太浪费）
    let 需要写 = match 上次写入.lock().ok().and_then(|g| g.clone()) {
        None => true,
        Some(旧) => {
            (旧.x - 新值.x).abs() > 2
                || (旧.y - 新值.y).abs() > 2
                || 旧.宽.abs_diff(新值.宽) > 2
                || 旧.高.abs_diff(新值.高) > 2
                || 旧.最大化 != 新值.最大化
        }
    };
    if !需要写 {
        return;
    }

    窗口状态::保存(&新值);
    if let Ok(mut 锁) = 上次写入.lock() {
        *锁 = Some(新值);
    }
}

/// 关闭窗口时记录：这里**需要**把最大化标志写进去。
///
/// 与 记录窗口几何 的区别：那个只管普通状态，这个管"下次打开时的形态"。
/// 尺寸仍然沿用磁盘里最后一次非最大化的值，只翻转 maximized 标记。
fn 记录关闭状态(窗口: &tauri::Window) {
    let 最大化 = 窗口.is_maximized().unwrap_or(false);
    let 已有 = 窗口状态::读取().unwrap_or_else(窗口状态::几何::默认);
    let mut 新值 = 已有;
    新值.最大化 = 最大化;
    窗口状态::保存(&新值);
}

/// 建主窗口。/// 建主窗口。
///
/// 后端已经能应答了才调它——主窗口一加载就是正确内容。
/// 窗口创建必须在主线程，调用方负责用 `run_on_main_thread` 排队。
fn 建主窗口(应用: &tauri::AppHandle, 地址: &str) -> Result<tauri::WebviewWindow, String> {
    let 窗 = WebviewWindowBuilder::new(
        应用,
        "main",
        WebviewUrl::External(
            地址.parse::<tauri::Url>()
                .map_err(|e| e.to_string())?,
        ),
    )
        .title("苦瓜工作室")
        // 去掉系统标题栏：页面顶栏已经自绘了一套（含拖拽区与最小化/最大化/
        // 关闭），再叠一层 Windows 原生标题栏就是两排一模一样的按钮。
        .decorations(false)
        .min_inner_size(900.0, 600.0)
        // 先隐藏：等页面首帧渲染完自己调 show_window 显示。
        // 那时屏幕上出现的第一个画面就已经是完整界面，没有白屏。
        .visible(false);

    // 恢复上次的窗口几何。没有记录（首次启动）就用默认 1440×900 居中。
    let 上次 = 窗口状态::读取();
    let 窗 = match &上次 {
        Some(几何) => 窗
            .inner_size(几何.宽 as f64, 几何.高 as f64)
            .position(几何.x as f64, 几何.y as f64),
        None => 窗.inner_size(1440.0, 900.0).center(),
    }
    .build()
    .map_err(|e| e.to_string())?;

    // 上次是最大化 → 这次也最大化。
    // 要在 build 之后单独调：builder 没有 .maximized() 方法，
    // 而且最大化必须在窗口存在之后才有意义。
    if let Some(几何) = &上次 {
        if 几何.最大化 {
            let _ = 窗.maximize();
        }
    }

    // 超时兜底：页面若加载失败就没人调 show_window，窗口永远不出现，
    // 而闪屏会一直在旁边转圈。8 秒后强制收场。
    兜底显示(应用, 8);
    Ok(窗)
}

/// 后端起不来时，把闪屏换成可读的诊断信息。
///
/// 不新开窗口：那样闪屏会先消失再出现新窗口，视觉上跳一下。
/// 直接改当前这扇窗的内容和尺寸，用户看到的是"球变成了一段说明"。
fn 显示闪屏诊断(应用: &tauri::AppHandle, 根: Option<&Path>, 地址: &str) {
    let 诊断 = 诊断页(根, 地址);
    if let Some(屏) = 应用.get_webview_window("splash") {
        let _ = 屏.eval(&format!(
            "document.body.style.background='#1e1e1e';\
             document.body.style.color='#dcdcdc';\
             document.body.style.font='13.5px system-ui';\
             document.body.style.padding='1.8rem';\
             document.body.style.whiteSpace='pre-wrap';\
             document.body.style.overflow='auto';\
             document.body.style.lineHeight='1.7';\
             var s=document.getElementById('舞台'); if(s) s.style.display='none';\
             var d=document.createElement('div'); d.textContent={};\
             document.body.appendChild(d);",
            字符串字面量(&诊断)
        ));
        let _ = 屏.set_size(tauri::LogicalSize::new(720.0, 480.0));
        let _ = 屏.set_resizable(true);
        let _ = 屏.set_always_on_top(false);
    }
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
            // 闪屏若还挂着就一起撤掉，否则它会一直浮在界面上层
            闪屏淡出(&句柄);
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
    // 主窗口在这一刻才第一次出现在屏幕上——此刻它里面已经是画好的界面了
    // （页面用双层 rAF 确保至少完整绘制过一帧才调本命令）。
    //
    // 交接顺序很重要：先把主窗口摆出来（此时闪屏还在它上面、且是置顶的），
    // 再让闪屏淡出。如果反过来先撤闪屏，中间会闪一下桌面。
    窗口.show().map_err(|e| e.to_string())?;

    // 闪屏淡出（异步，不阻塞本命令返回）
    let 应用 = 窗口.app_handle().clone();
    闪屏淡出(&应用);

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


/// 窗口状态持久化：记住上次的位置 / 大小 / 是否最大化。
///
/// **为什么需要**：原来 `inner_size(1440.0, 900.0)` 是硬编码的，每次启动
/// 都回到同一个默认尺寸。用户把窗口拖大、挪到第二块屏幕、最大化——下次
/// 打开全忘了，得重新摆一遍。
///
/// **为什么手写 JSON 而不是加 serde**：整个桌面壳只存 4 个数字 + 1 个布尔，
/// 引入 serde/serde_json 会让 release 体积和编译时间都涨一截（本项目开了
/// lto + opt-level=s，很在意体积）。字段固定、没有嵌套，手写解析足够可靠：
/// 逐行找 `"键": 值`，值不是合法数字就当作没有这一项，退回到默认值。
///
/// 存储位置：与单例锁同目录（`%LOCALAPPDATA%\KuguaStudio`），
/// 这样卸载/清缓存时能和其它本地状态一起处理。
mod 窗口状态 {
    use std::path::PathBuf;

    /// 持久化的窗口几何信息
    #[derive(Debug, Clone, PartialEq)]
    pub struct 几何 {
        pub x: i32,
        pub y: i32,
        pub 宽: u32,
        pub 高: u32,
        pub 最大化: bool,
    }

    impl 几何 {
        /// 默认窗口：居中 1440×900（与改动前行为一致）
        pub fn 默认() -> Self {
            几何 {
                x: 0,
                y: 0,
                宽: 1440,
                高: 900,
                最大化: false,
            }
        }

        /// 尺寸是否是合理的正数。用来挡掉"文件损坏写成 0×0"这类情况——
        /// 真把 0 宽窗口建出来，用户会看到一条线，且没法拖，只能改文件。
        pub fn 尺寸合理(&self) -> bool {
            self.宽 >= 400 && self.高 >= 300 && self.宽 <= 10000 && self.高 <= 10000
        }
    }

    /// 状态目录：`%LOCALAPPDATA%\KuguaStudio`
    ///
    /// 与单例互斥体不同，窗口状态必须落到磁盘才能跨进程保留。
    /// 放 LOCALAPPDATA 而不是程序目录：程序可能装在 Program Files（无写权限），
    /// 也可能用户在只读盘上运行。
    fn 状态目录() -> Option<PathBuf> {
        let 基 = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                // 非 Windows 或环境变量缺失的兜底
                std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share"))
            })?;
        Some(基.join("KuguaStudio"))
    }

    /// 状态文件路径
    pub fn 路径() -> Option<PathBuf> {
        Some(状态目录()?.join("window.json"))
    }

    /// 读取上次保存的几何信息；文件不存在/损坏/尺寸不合理都返回 None。
    pub fn 读取() -> Option<几何> {
        let 路径 = 路径()?;
        let 文本 = std::fs::read_to_string(&路径).ok()?;
        let 值 = 解析(&文本)?;
        if !值.尺寸合理() {
            return None; // 坏数据当作没有，用默认值
        }
        Some(值)
    }

    /// 保存几何信息（静默失败：存不下来不该影响程序运行）
    pub fn 保存(值: &几何) {
        let Some(路径) = 路径() else { return };
        if let Some(父) = 路径.parent() {
            let _ = std::fs::create_dir_all(父);
        }
        let _ = std::fs::write(&路径, 序列化(值));
    }

    /// 极简序列化（字段固定，不处理嵌套）
    pub fn 序列化(值: &几何) -> String {
        format!(
            "{{\n  \"x\": {},\n  \"y\": {},\n  \"width\": {},\n  \"height\": {},\n  \"maximized\": {}\n}}\n",
            值.x, 值.y, 值.宽, 值.高, 值.最大化
        )
    }

    /// 极简解析：按行找 "键": 值。
    ///
    /// 容错策略：任何一个键缺失就用默认值补，因此老版本文件、
    /// 手工编辑漏字段都能正常读。完全解析不出数字则整体退回默认。
    pub fn 解析(文本: &str) -> Option<几何> {
        let mut 值 = 几何::默认();
        let mut 命中数 = 0;

        // 同时支持多行（本程序写出的格式）和单行
        // （`{"x":1,"y":2}`——手工编辑、其它工具生成都可能是这种）。
        // 所以先按行切，再把每行按逗号切成片段：单行里逗号能分开键值。
        let 片段 = 文本
            .lines()
            .flat_map(|行| 行.split(','))
            .map(|s| s.trim().trim_matches(|c| c == '{' || c == '}').trim());

        for 行 in 片段 {
            let 行 = 行.trim();
            let Some(冒号) = 行.find(':') else { continue };
            let 键 = 行[..冒号].trim().trim_matches('"');
            // 值部分去掉尾逗号、括号、空白
            let 原值 = 行[冒号 + 1..]
                .trim()
                .trim_end_matches(',')
                .trim_end_matches('}')
                .trim();
            match 键 {
                "x" => {
                    // 坐标允许负数（多显示器在左边/上边时是负值）
                    if let Ok(v) = 原值.parse::<i32>() {
                        值.x = v;
                        命中数 += 1;
                    }
                }
                "y" => {
                    if let Ok(v) = 原值.parse::<i32>() {
                        值.y = v;
                        命中数 += 1;
                    }
                }
                "width" => {
                    if let Ok(v) = 原值.parse::<u32>() {
                        值.宽 = v;
                        命中数 += 1;
                    }
                }
                "height" => {
                    if let Ok(v) = 原值.parse::<u32>() {
                        值.高 = v;
                        命中数 += 1;
                    }
                }
                "maximized" => {
                    let 小写 = 原值.to_ascii_lowercase();
                    值.最大化 = 小写 == "true";
                    命中数 += 1;
                }
                _ => {}
            }
        }

        if 命中数 == 0 {
            None
        } else {
            Some(值)
        }
    }

    /// 从窗口当前状态捕获几何信息。
    ///
    /// 最大化时**不覆盖**保存的普通尺寸：否则用户最大化后关闭，
    /// 下次取消最大化就会变成一个铺满屏幕的"普通窗口"。
    /// 这里的做法是：最大化时保留传入的 `已有`（用来填尺寸），只翻转标记。
    pub fn 更新(
        已有: &几何,
        位置: Option<(i32, i32)>,
        尺寸: Option<(u32, u32)>,
        最大化: bool,
    ) -> 几何 {
        if 最大化 {
            // 最大化状态下，位置和尺寸都不可信（是全屏尺寸），沿用旧的
            let mut 结果 = 已有.clone();
            结果.最大化 = true;
            return 结果;
        }
        let (宽, 高) = 尺寸.unwrap_or((已有.宽, 已有.高));
        let (x, y) = 位置.unwrap_or((已有.x, 已有.y));
        let 候选 = 几何 {
            x,
            y,
            宽,
            高,
            最大化: false,
        };
        // 尺寸不合理就别存了（可能正处于最小化/异常状态）
        if 候选.尺寸合理() {
            候选
        } else {
            let mut 兜底 = 已有.clone();
            兜底.最大化 = false;
            兜底
        }
    }

    #[cfg(test)]
    mod 测试 {
        use super::*;

        #[test]
        fn 序列化再解析能还原() {
            let 原 = 几何 {
                x: -1200,
                y: 40,
                宽: 1600,
                高: 1000,
                最大化: true,
            };
            let 文本 = 序列化(&原);
            let 回 = 解析(&文本).expect("应该能解析");
            assert_eq!(原, 回);
        }

        #[test]
        fn 负坐标能保留_多显示器在左边() {
            let 文本 = r#"{"x": -1920, "y": -100, "width": 1200, "height": 800, "maximized": false}"#;
            let 值 = 解析(文本).expect("应该能解析");
            assert_eq!(值.x, -1920);
            assert_eq!(值.y, -100);
        }

        #[test]
        fn 缺字段用默认值补() {
            // 只有 width：其它字段应该回落到默认
            let 值 = 解析(r#"{"width": 1000}"#).expect("应该能解析");
            let 默认 = 几何::默认();
            assert_eq!(值.宽, 1000);
            assert_eq!(值.高, 默认.高);
            assert_eq!(值.x, 默认.x);
        }

        #[test]
        fn 完全无法解析返回_None() {
            assert!(解析("这不是 JSON").is_none());
            assert!(解析("").is_none());
        }

        #[test]
        fn 尺寸不合理视为无效_防止_0_尺寸窗口() {
            let 值 = 几何 {
                x: 0,
                y: 0,
                宽: 0,
                高: 0,
                最大化: false,
            };
            assert!(!值.尺寸合理());
            let 太小 = 几何 {
                宽: 100,
                高: 100,
                ..几何::默认()
            };
            assert!(!太小.尺寸合理());
            assert!(几何::默认().尺寸合理());
        }

        #[test]
        fn 最大化时不覆盖普通尺寸() {
            let 已有 = 几何 {
                x: 100,
                y: 100,
                宽: 1200,
                高: 800,
                最大化: false,
            };
            // 最大化时窗口报告的是全屏尺寸，不能存进去
            let 新 = 更新(&已有, Some((0, 0)), Some((2560, 1440)), true);
            assert_eq!(新.宽, 1200, "普通尺寸应保留");
            assert_eq!(新.高, 800);
            assert_eq!(新.x, 100);
            assert!(新.最大化);
        }

        #[test]
        fn 取消最大化后恢复普通尺寸() {
            let 最大化中 = 几何 {
                x: 100,
                y: 100,
                宽: 1200,
                高: 800,
                最大化: true,
            };
            let 新 = 更新(&最大化中, Some((300, 200)), Some((1000, 700)), false);
            assert_eq!(新.宽, 1000);
            assert_eq!(新.高, 700);
            assert!(!新.最大化);
        }

        #[test]
        fn 异常小尺寸不写入() {
            let 已有 = 几何::默认();
            let 新 = 更新(&已有, Some((0, 0)), Some((0, 0)), false);
            assert_eq!(新.宽, 已有.宽, "0 宽应被挡掉");
            assert_eq!(新.高, 已有.高);
        }
    }
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

    // 侧车启动与端口等待从主线程挪到了 setup 里的后台线程。
    //
    // 原来这段是同步阻塞在 main 里的（最长 60 秒），期间**窗口一个都没有**，
    // 用户双击后看到的是"什么也没发生"。现在闪屏先出现，这些耗时操作在后台跑，
    // 进度通过 splash 的进度条反馈出来。
    //
    // 侧车句柄仍要进 `侧车状态` 供全程持有（Job Object 兜底），所以用
    // Arc<Mutex<Option<Child>>> 在后台线程与状态之间共享。
    let 侧车句柄: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let 侧车写入 = 侧车句柄.clone();

    let 应用 = tauri::Builder::default()
        .manage(侧车状态(侧车句柄))
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
        .on_window_event(|窗口, 事件| {
            // ── 窗口几何持久化 ──
            //
            // 只处理主窗口：闪屏是临时的，记它没有意义。
            // 三类事件都会改变"用户期望下次看到的样子"，所以都记：
            //   Moved   ：拖到别的位置/另一块屏幕
            //   Resized ：拖边框改变大小
            //   CloseRequested：关闭前最后存一次（最大化状态在 Resized 里读不到）
            if 窗口.label() == "main" {
                match 事件 {
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                        记录窗口几何(窗口);
                    }
                    _ => {}
                }
            }

            if let tauri::WindowEvent::CloseRequested { .. } = 事件 {
                // 只有**主窗口**关闭才结束整个 GUI。
                //
                // 闪屏（"splash"）在交接完成后会被主动关闭，那一下不能当成
                // 用户关窗——否则闪屏一消失，刚显示出来的主界面会跟着没掉。
                if 窗口.label() != "main" {
                    return;
                }
                // 关闭前最后存一次：这里要写最大化标记
                记录关闭状态(窗口);
                // 用 process::exit 而非 app_handle().exit()：后者要重入事件循环排队，
                // 而此刻正处于关闭流程中，实测会把进程卡成「WebView 已退、窗口句柄仍在」
                // 的僵尸。侧车不在退出路径上，直接结束进程是安全的。
                std::process::exit(0);
            }
        })
        .setup(move |应用句柄| {
            let 地址 = format!("http://127.0.0.1:{默认端口}");

            // ── 1. 闪屏：先亮出来，用户立刻有反馈 ──
            //
            // 独立窗口（透明 / 无边框 / 置顶 / 不进任务栏）。透明是关键：
            // 它在桌面上看起来就是一个悬着的发光球，而不是"又一个窗口"。
            let _闪屏 = WebviewWindowBuilder::new(
                应用句柄,
                "splash",
                WebviewUrl::External(闪屏页地址().parse()?),
            )
            .title("苦瓜工作室")
            .inner_size(420.0, 300.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .resizable(false)
            .center()
            .skip_taskbar(true)
            .shadow(false)
            .visible(true)
            .build()?;

            // ── 2. 后台线程：启动侧车 + 等端口，就绪后才建主窗口 ──
            //
            // 主窗口**不在这里建**。原因：它加载的是 http://127.0.0.1:端口，
            // 后端此刻还没起来，提前建出来的只会是"连接被拒绝"错误页，而且
            // 不会自己恢复——补救方式只剩重载，而重载的时机又和页面自身生命周期
            // 打架（eval 可能落在导航过程中被丢弃）。等后端真能应答了再建，
            // 一次就加载出正确内容。
            let 应用后台 = 应用句柄.handle().clone();
            let 根后台 = 根.clone();
            let 地址后台 = 地址.clone();
            std::thread::spawn(move || {
                let mut 侧车: Option<Child> = None;
                match &根后台 {
                    Some(目录) => match 启动侧车(目录, 默认端口) {
                        Ok(子) => 侧车 = 子,
                        Err(错误) => eprintln!("[桌面端] {错误}"),
                    },
                    None => {
                        eprintln!("[桌面端] 未定位到仓库根（缺少 packages/webui/dist/server.js）")
                    }
                }
                // 句柄立刻进共享状态：Job Object 兜底从此全程有效
                if let Ok(mut 锁) = 侧车写入.lock() {
                    *锁 = 侧车;
                }

                if 等端口(默认端口, Duration::from_secs(60)) {
                    推进闪屏(&应用后台, "主控就绪");

                    // 窗口创建必须在主线程（Tauri 要求），排队过去。
                    let 应建 = 应用后台.clone();
                    let 址 = 地址后台.clone();
                    if let Err(错误) = 应用后台.run_on_main_thread(move || {
                        if let Err(错) = 建主窗口(&应建, &址) {
                            eprintln!("[桌面端] 建主窗口失败：{错}");
                            推进闪屏(&应建, "失败");
                        }
                    }) {
                        eprintln!("[桌面端] 无法排队建窗口：{错误}");
                    }
                } else {
                    // 后端起不来：把闪屏换成诊断信息，别让用户对着一个转圈的球
                    // 干等 60 秒还不知道发生了什么。
                    显示闪屏诊断(&应用后台, 根后台.as_deref(), &地址后台);
                }
            });

            // 后端退出时连带关掉桌面窗口（Web 网页端不处理，只显示断线提示）
            启动后端监视(默认端口);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 应用初始化失败");

    // 窗口全关 → 允许退出（Tauri 在某些平台不会自动退出）
    应用.run(|应用句柄, 事件| {
        if let RunEvent::ExitRequested { api, .. } = &事件 {
            // 只要主窗口还在，就不能因为「暂时没有窗口了」而退出。
            //
            // 典型场景：闪屏关闭的瞬间，主窗口刚建好但还没完全就位，
            // 窗口计数短暂归零，Tauri 就会报 ExitRequested。
            // 这里主动拦下来；真正退出的路径是主窗口的 CloseRequested
            // 或后端监视器判定后端已死。
            if 应用句柄.get_webview_window("main").is_some() {
                api.prevent_exit();
            }
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
