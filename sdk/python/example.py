"""
苦瓜工作室 · Python 外部模块接入示例

演示一个完整可运行的外部模块，覆盖接入方最常用的四种能力：
  1. 声明能力（中文指令）→ 出现在平台指令面板 / 可被 AI 路由
  2. 被平台调用 → 处理请求并返回结果
  3. 主动调用平台能力 → 平台 ↔ 外部模块双向通信
  4. 订阅 system.shutdown → 平台退出时自行决定是否退出

运行：
    pip install websockets
    python example.py

环境变量：
    KUGUA_PORT   主控端口（默认 24601）
    KUGUA_TOKEN  主控令牌（主控配置了 token 时必填）

接入成功后，在平台对话里输入「打招呼」即可看到本模块的响应。
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

# SDK 就在同目录；实际使用时把 nigane.py 复制到你的项目里即可
from nigane import NiganeClient, 建能力

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
日志 = logging.getLogger("示例")

模块名 = "Python示例模块"


# ===== 1. 声明能力：决定平台如何暴露本模块 =====

能力声明 = [
    建能力(
        "Python示例模块.打招呼",
        模块名,
        标题="打招呼",
        说明="返回一句问候。演示外部模块被平台调用",
        中文指令=["打招呼", "py打招呼"],
        参数={
            "type": "object",
            "properties": {
                "名字": {"type": "string", "description": "要问候的对象"},
            },
        },
    ),
    建能力(
        "Python示例模块.加法",
        模块名,
        标题="加法",
        说明="两数相加，演示参数与返回值的结构",
        中文指令=["py加法"],
        参数={
            "type": "object",
            "properties": {
                "a": {"type": "number"},
                "b": {"type": "number"},
            },
            "required": ["a", "b"],
        },
    ),
    建能力(
        "Python示例模块.系统信息",
        模块名,
        标题="系统信息",
        说明="返回本机 Python 版本与进程信息",
        中文指令=["py信息"],
    ),
]


# ===== 2. 处理器：被平台调用时执行 =====

def 处理打招呼(params: dict, 消息: dict) -> dict:
    名字 = params.get("名字") or "世界"
    日志.info("被平台调用：打招呼（名字=%s，来自 %s）", 名字, 消息.get("from"))
    return {"文本": f"你好，{名字}！这是来自 Python 外部模块的问候。"}


def 处理加法(params: dict, 消息: dict) -> dict:
    a = params.get("a", 0)
    b = params.get("b", 0)
    日志.info("被平台调用：加法（%s + %s）", a, b)
    return {"和": a + b}


def 处理系统信息(params: dict, 消息: dict) -> dict:
    return {
        "Python": sys.version.split()[0],
        "平台": sys.platform,
        "PID": os.getpid(),
    }


# ===== 3. 组装客户端 =====

客户端 = NiganeClient(
    名称=模块名,
    版本="0.1.0",
    能力声明=能力声明,
)

客户端.register("Python示例模块.打招呼", 处理打招呼)
客户端.register("Python示例模块.加法", 处理加法)
客户端.register("Python示例模块.系统信息", 处理系统信息)


# ===== 4. 订阅平台广播 =====

def 平台退出(params: dict, 消息: dict) -> None:
    """
    平台退出/重启时收到 system.shutdown。

    平台此时**不会**对本进程发任何信号 —— 退出与否完全由你决定：
      * 直接退出（本示例的选择）
      * 继续运行，下次平台起来后客户端会自动重连
      * 先把未完成的工作收尾，再退出
    """
    日志.info("收到 system.shutdown，平台正在退出。")
    客户端.已收到退出通知 = True
    客户端.stop()


def 能力变更(params: dict, 消息: dict) -> None:
    日志.info(
        "能力注册表变化：模块 %s，现有 %s 项",
        params.get("模块"),
        params.get("数量"),
    )


客户端.on_event("system.shutdown", 平台退出)
客户端.on_event("capability.changed", 能力变更)


# ===== 5. 演示「主动调用平台能力」 =====

async def 主动调用演示() -> None:
    """接入后主动查一次模块列表，证明双向通信就绪。"""
    await asyncio.sleep(3)
    try:
        模块列表 = await 客户端.request("kugua-main", "nigane.modules.names", {})
        日志.info("主动调用 nigane.modules.names 成功：%s", 模块列表)
    except Exception as 错误:
        日志.warning("主动调用失败：%s", 错误)


async def 主流程() -> None:
    print("=" * 56)
    print("  苦瓜工作室 · Python 外部模块示例")
    print("=" * 56)
    print(f"  模块名：{模块名}")
    print(f"  目标：  {客户端.地址}")
    print()
    print("  接入后在平台对话输入「打招呼」即可验证。")
    print("  Ctrl+C 退出。")
    print("=" * 56)
    print()

    asyncio.create_task(主动调用演示())

    try:
        await 客户端.运行()
    except KeyboardInterrupt:
        pass
    finally:
        客户端.stop()
        日志.info("示例已退出。")


if __name__ == "__main__":
    try:
        asyncio.run(主流程())
    except KeyboardInterrupt:
        print("\n已中断。")
