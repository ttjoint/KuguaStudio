"""
苦音协议 Python SDK（单文件，可直接复制到你的项目里用）

用途：让你的 Python 程序以「外部模块」身份动态接入苦瓜工作室，
      注册自身能力，与平台双向通信。

依赖：pip install websockets   （唯一依赖）

协议规范：docs/接入协议.md
最小示例：sdk/external-module-python/example.py

—— 设计要点 ——
* 本文件不依赖苦瓜工作室仓库的任何代码，可独立复制。
* 所有协议细节（信封、握手、请求配对、重连）封装在 NiganeClient 里，
  业务代码只需 register / on_event / request 三种调用。
* 生命周期由你掌控：平台退出只广播 system.shutdown，不会对你发信号。
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any, Awaitable, Callable, Dict, Optional

try:
    import websockets
except ImportError as 错误:  # pragma: no cover
    raise ImportError(
        "缺少依赖 websockets，请先执行：pip install websockets"
    ) from 错误

日志 = logging.getLogger("nigane")

# 协议版本（与 packages/nigane/src/index.ts 的 协议版本 保持一致）
协议版本 = "0.2"

# 错误码（与协议规范一致）
错误码 = {
    "认证失败": 1001,
    "目标不存在": 1002,
    "未注册": 1003,
    "格式非法": 1004,
    "请求超时": 1005,
    "内部异常": 2000,
}

Handler = Callable[[Dict[str, Any], Dict[str, Any]], Any]
Event_Handler = Callable[[Dict[str, Any], Dict[str, Any]], None]


def 建信封(类型: str, 发送者: str, **部分: Any) -> Dict[str, Any]:
    """构造苦音协议信封"""
    信封 = {
        "nigane": 协议版本,
        "id": str(uuid.uuid4()),
        "type": 类型,
        "from": 发送者,
        "time": int(time.time()),
    }
    信封.update({k: v for k, v in 部分.items() if v is not None})
    return 信封


class NiganeClient:
    """苦音协议客户端。

    典型用法::

        客户端 = NiganeClient(名称="我的工具", 端口=24601)
        客户端.register("我的工具.回声", 处理函数)
        客户端.on_event("system.shutdown", lambda p, m: 退出())
        asyncio.run(客户端.运行())

    参数：
        名称     —— 模块名，全局唯一
        端口     —— 主控端口（默认 24601，读环境变量 KUGUA_PORT）
        主机     —— 默认 127.0.0.1
        令牌     —— 主控配置了 token 时必填（读环境变量 KUGUA_TOKEN）
        能力声明 —— 名单，决定平台如何暴露你的模块（见 docs/接入协议.md 第五节）
    """

    def __init__(
        self,
        名称: str,
        *,
        主机: str = "127.0.0.1",
        端口: int | None = None,
        令牌: str | None = None,
        版本: str = "0.1.0",
        能力声明: Optional[list[Dict[str, Any]]] = None,
        请求超时: float = 10.0,
        重连上限: int = 5,
    ) -> None:
        import os

        self.名称 = 名称
        self.主机 = 主机
        self.端口 = 端口 or int(os.environ.get("KUGUA_PORT", "24601"))
        self.令牌 = 令牌 if 令牌 is not None else os.environ.get("KUGUA_TOKEN", "")
        self.版本 = 版本
        self.能力声明 = 能力声明 or []
        self.请求超时 = 请求超时
        self.重连上限 = 重连上限

        self._ws: Any = None
        self._挂起: Dict[str, asyncio.Future] = {}
        self._请求表: Dict[str, Handler] = {}
        self._事件表: Dict[str, Event_Handler] = {}
        self._已握手 = asyncio.Event()
        self._停止 = asyncio.Event()
        self._连续失败 = 0
        # 由外部设置的「平台已通知退出」标志
        self.已收到退出通知 = False

    # ---------- 注册 ----------

    def register(self, action: str, 处理器: Handler) -> None:
        """注册一个可被平台调用的动作。

        处理器签名：处理函数(params: dict, 消息: dict) -> Any
        返回值会作为 response 的 data 发回平台；抛异常则回 error(2000)。
        """
        self._请求表[action] = 处理器

    def on_event(self, action: str, 处理器: Event_Handler) -> None:
        """订阅一个广播事件（无响应）。

        处理器签名：处理函数(params: dict, 消息: dict) -> None
        """
        self._事件表[action] = 处理器

    # ---------- 调用平台 ----------

    async def request(
        self,
        目标: str,
        action: str,
        params: Any = None,
        超时: float | None = None,
    ) -> Any:
        """调用平台能力（目标填 "kugua-main"）或其它模块（填其模块名）。"""
        if self._ws is None:
            raise RuntimeError("尚未连接到主控")
        消息 = 建信封("request", self.名称, to=目标, action=action, params=params)
        未来: asyncio.Future = asyncio.get_running_loop().create_future()
        self._挂起[消息["id"]] = 未来
        await self._ws.send(json.dumps(消息, ensure_ascii=False))
        try:
            return await asyncio.wait_for(未来, 超时 or self.请求超时)
        finally:
            self._挂起.pop(消息["id"], None)

    async def broadcast(self, action: str, params: Any = None) -> None:
        """向平台广播一个事件（所有在线模块都会收到，除自己外）。"""
        if self._ws is None:
            raise RuntimeError("尚未连接到主控")
        消息 = 建信封("event", self.名称, action=action, params=params)
        await self._ws.send(json.dumps(消息, ensure_ascii=False))

    # ---------- 连接与主循环 ----------

    @property
    def 地址(self) -> str:
        return f"ws://{self.主机}:{self.端口}"

    async def 运行(self) -> None:
        """连接并在断线后按退避重连，直到 stop() 被调用。

        连续失败达到「重连上限」时返回 —— 这通常意味着平台已经退出
        （平台被强杀时来不及广播 system.shutdown，只能靠这个兜底）。
        """
        while not self._停止.is_set():
            try:
                await self._单次连接()
            except Exception as 错误:
                if self._停止.is_set():
                    break
                self._连续失败 += 1
                日志.warning("连接异常：%s（第 %d 次）", 错误, self._连续失败)

            if self._停止.is_set():
                break

            if self.已收到退出通知:
                日志.info("平台已通知退出，本客户端结束。")
                break

            if self._连续失败 >= self.重连上限:
                日志.warning(
                    "连续 %d 次连不上平台，判定平台已退出，本客户端结束。"
                    "（可调大 重连上限）",
                    self._连续失败,
                )
                break

            延迟 = min(2 ** (self._连续失败 - 1), 30)
            日志.info("%d 秒后重连…", 延迟)
            try:
                await asyncio.wait_for(self._停止.wait(), 延迟)
            except asyncio.TimeoutError:
                pass

    async def _单次连接(self) -> None:
        async with websockets.connect(self.地址, ping_interval=None) as ws:
            self._ws = ws
            self._已握手.clear()

            # 握手：name 必填；capabilityDefs 决定平台如何暴露本模块
            握手参数: Dict[str, Any] = {
                "name": self.名称,
                "version": self.版本,
                "capabilityDefs": self.能力声明,
            }
            if self.令牌:
                握手参数["token"] = self.令牌

            await ws.send(
                json.dumps(
                    建信封("hello", self.名称, params=握手参数), ensure_ascii=False
                )
            )

            # 必须先启动接收循环，才能收到 hello_ack；
            # 否则「等待握手」会与「接收消息」互相阻塞（死锁）。
            接收 = asyncio.create_task(self._接收循环(ws))
            心跳 = asyncio.create_task(self._心跳循环(ws))
            try:
                try:
                    await asyncio.wait_for(self._已握手.wait(), 10)
                except asyncio.TimeoutError:
                    raise RuntimeError("握手超时，未收到 hello_ack") from None

                self._连续失败 = 0
                日志.info("已接入 %s", self.地址)

                # 接收循环结束（断开）或主动停止时退出
                await 接收
            finally:
                心跳.cancel()
                接收.cancel()
                self._ws = None
                # 所有挂起请求失败，避免调用方永久等待
                for 未来 in self._挂起.values():
                    if not 未来.done():
                        未来.set_exception(RuntimeError("连接已断开"))
                self._挂起.clear()

    async def _接收循环(self, ws: Any) -> None:
        async for 文本 in ws:
            await self._处理消息(文本)

    async def _心跳循环(self, ws: Any) -> None:
        while True:
            await asyncio.sleep(30)
            try:
                await ws.send(
                    json.dumps(建信封("ping", self.名称), ensure_ascii=False)
                )
            except Exception:
                return

    def stop(self) -> None:
        """请求停止（不会立刻断开，等当前消息处理完由主循环退出）。"""
        self._停止.set()

    # ---------- 收消息分发 ----------

    async def _处理消息(self, 文本: str) -> None:
        try:
            消息 = json.loads(文本)
        except json.JSONDecodeError:
            日志.warning("收到非 JSON 帧，忽略")
            return

        if not isinstance(消息, dict) or "nigane" not in 消息:
            return

        类型 = 消息.get("type")

        if 类型 == "hello_ack":
            self._已握手.set()
            模块列表 = (消息.get("data") or {}).get("modules") or []
            日志.info("握手成功，平台当前模块：%s", "、".join(模块列表))
            return

        if 类型 in ("response", "error"):
            未来 = self._挂起.get(消息.get("echo", ""))
            if 未来 is not None and not 未来.done():
                if 类型 == "error":
                    未来.set_exception(
                        RuntimeError(
                            f"[{消息.get('code')}] {消息.get('message', '模块错误')}"
                        )
                    )
                else:
                    未来.set_result(消息.get("data"))
            return

        if 类型 == "request":
            await self._处理请求(消息)
            return

        if 类型 == "event":
            处理器 = self._事件表.get(消息.get("action", ""))
            if 处理器 is not None:
                try:
                    处理器(消息.get("params") or {}, 消息)
                except Exception:
                    日志.exception("事件处理器异常：%s", 消息.get("action"))
            return

        if 类型 == "ping":
            await self._回复(消息, 类型="pong", echo=消息.get("id"))
            return

    async def _处理请求(self, 消息: Dict[str, Any]) -> None:
        action = 消息.get("action", "")
        处理器 = self._请求表.get(action)
        if 处理器 is None:
            await self._回复(
                消息,
                类型="error",
                code=错误码["未注册"],
                message=f"未实现的动作：{action}",
            )
            return

        try:
            结果 = 处理器(消息.get("params") or {}, 消息)
            if asyncio.iscoroutine(结果) or isinstance(结果, Awaitable):
                结果 = await 结果
            await self._回复(消息, 类型="response", data=结果)
        except Exception as 错误:
            日志.exception("处理器异常：%s", action)
            await self._回复(
                消息,
                类型="error",
                code=错误码["内部异常"],
                message=str(错误),
            )

    async def _回复(
        self,
        原始: Dict[str, Any],
        *,
        类型: str,
        echo: str | None = None,
        data: Any = None,
        code: int | None = None,
        message: str | None = None,
    ) -> None:
        if self._ws is None:
            return
        回复 = 建信封(
            类型,
            self.名称,
            to=原始.get("from"),
            echo=echo if echo is not None else 原始.get("id"),
            data=data,
            code=code,
            message=message,
        )
        try:
            await self._ws.send(json.dumps(回复, ensure_ascii=False))
        except Exception:
            日志.warning("回复发送失败，连接可能已断开")


def 建能力(
    名称: str,
    模块: str,
    *,
    标题: str | None = None,
    说明: str | None = None,
    中文指令: Optional[list[str]] = None,
    参数: Optional[Dict[str, Any]] = None,
    暴露指令: bool = True,
    暴露GUI: bool = True,
) -> Dict[str, Any]:
    """构造一条能力声明（方便写 能力声明 列表）。"""
    声明: Dict[str, Any] = {
        "名称": 名称,
        "模块": 模块,
        "动作": 名称,
        "暴露": {"指令": 暴露指令, "GUI": 暴露GUI},
    }
    if 标题:
        声明["标题"] = 标题
    if 说明:
        声明["说明"] = 说明
    if 中文指令:
        声明["中文指令"] = 中文指令
    if 参数:
        声明["参数"] = 参数
    return 声明
