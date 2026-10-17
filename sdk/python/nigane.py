"""
Nigane Protocol Python SDK (single file, copy it into your own project)

Make your Python program join KuguaStudio as an "external module":
declare capabilities, communicate bidirectionally, optionally ask the
platform to host you on next startup.

Dependency: pip install websockets

Protocol spec: docs/接入协议.md
Example:       sdk/python/example.py

All public API is English; docstrings note the protocol terms in Chinese
where they map to server-side field names (capabilityDefs, 托管, ...).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
import uuid
from typing import Any, Awaitable, Callable, Dict, Optional

try:
    import websockets
except ImportError as 错误:  # pragma: no cover
    raise ImportError(
        "Missing dependency 'websockets'. Install it with: pip install websockets"
    ) from 错误

log = logging.getLogger("nigane")

# Protocol version (keep in sync with packages/nigane/src/index.ts)
PROTOCOL_VERSION = "0.2"

# Error codes from the protocol spec
ERROR_CODES = {
    "auth_failed": 1001,
    "target_not_found": 1002,
    "not_registered": 1003,
    "bad_format": 1004,
    "timeout": 1005,
    "internal": 2000,
}

Handler = Callable[[Dict[str, Any], Dict[str, Any]], Any]
EventHandler = Callable[[Dict[str, Any], Dict[str, Any]], None]


def make_envelope(msg_type: str, sender: str, **fields: Any) -> Dict[str, Any]:
    """Build a Nigane protocol envelope."""
    envelope = {
        "nigane": PROTOCOL_VERSION,
        "id": str(uuid.uuid4()),
        "type": msg_type,
        "from": sender,
        "time": int(time.time()),
    }
    envelope.update({k: v for k, v in fields.items() if v is not None})
    return envelope


class NiganeClient:
    """Nigane protocol client.

    Typical usage::

        client = NiganeClient(name="my-tool", port=24601)
        client.register("my-tool.echo", handler)
        client.on_event("system.shutdown", lambda p, m: client.stop())
        asyncio.run(client.run())

    Args:
        name:        Module name, globally unique.
        host:        Main controller host, default 127.0.0.1.
        port:        Main controller port. Defaults to env KUGUA_PORT or 24601.
        token:       Auth token. Defaults to env KUGUA_TOKEN.
        version:     Your module version.
        capabilities: Capability declarations (see docs/接入协议.md).
        managed:     Ask the platform to host this module on the next start
                     (protocol field ``托管``). Only used as the initial value
                     on first registration; existing user config always wins.
        managed_entry: Physical executable/script path used when hosted.
        managed_args: Arguments passed to the hosted process.
        managed_cwd:  Working directory for the hosted process.
        request_timeout: Default request timeout in seconds.
        max_retries: Give up after this many consecutive connection failures.
    """

    def __init__(
        self,
        name: str,
        *,
        host: str = "127.0.0.1",
        port: int | None = None,
        token: str | None = None,
        version: str = "0.1.0",
        capabilities: Optional[list[Dict[str, Any]]] = None,
        managed: bool = False,
        managed_entry: str | None = None,
        managed_args: Optional[list[str]] = None,
        managed_cwd: str | None = None,
        path: str | None = None,
        request_timeout: float = 10.0,
        max_retries: int = 5,
    ) -> None:
        self.name = name
        self.host = host
        self.port = port or int(os.environ.get("KUGUA_PORT", "24601"))
        self.token = token if token is not None else os.environ.get("KUGUA_TOKEN", "")
        self.version = version
        self.capabilities = capabilities or []
        self.request_timeout = request_timeout
        self.max_retries = max_retries

        # Physical path reported to the platform. Used to decide whether a
        # reconnect comes from the same place (in-place) or somewhere else.
        # Defaults to the running script's absolute path.
        self.path = path or os.path.abspath(sys.argv[0] if sys.argv else "")

        # Managed-startup request (protocol field ``托管``).
        # Only sent when explicitly enabled, so plain clients stay unchanged.
        self.managed = managed
        self.managed_entry = managed_entry
        self.managed_args = managed_args or []
        self.managed_cwd = managed_cwd

        self._ws: Any = None
        self._pending: Dict[str, asyncio.Future] = {}
        self._handlers: Dict[str, Handler] = {}
        self._event_handlers: Dict[str, EventHandler] = {}
        self._handshaked = asyncio.Event()
        self._stop = asyncio.Event()
        self._failures = 0
        # Set by you when the platform broadcast system.shutdown
        self.shutdown_requested = False

        # Protocol actions every module MUST implement, otherwise the platform
        # treats it as offline (red status light).
        self.register("module.query", self._handle_query)
        self.register("module.shutdown", self._handle_shutdown)

    # ---------- required protocol actions ----------

    def _handle_query(self, params: Dict[str, Any], message: Dict[str, Any]) -> Dict[str, Any]:
        """Reply to the platform's status query with our current identity.

        This is what the platform's refresh button asks for. Returning the
        correct name/version/path is what lets an offline module come back
        online (status light turns green again).
        """
        return {
            "name": self.name,
            "version": self.version,
            "path": self.path,
            "capabilityDefs": self.capabilities,
            "托管": self._managed_payload(),
        }

    def _handle_shutdown(self, params: Dict[str, Any], message: Dict[str, Any]) -> Dict[str, Any]:
        """The platform asks us to unregister / exit. Honour it politely."""
        self.shutdown_requested = True
        asyncio.get_event_loop().call_soon(self.stop)
        return {"ack": True}

    # ---------- registration ----------

    def register(self, action: str, handler: Handler) -> None:
        """Register an action the platform can call.

        Handler signature: handler(params: dict, message: dict) -> Any
        The return value becomes the response ``data``; a raised exception
        is turned into an ``error`` (code 2000).
        """
        self._handlers[action] = handler

    def on_event(self, action: str, handler: EventHandler) -> None:
        """Subscribe to a broadcast event (no response)."""
        self._event_handlers[action] = handler

    # ---------- calling the platform ----------

    async def request(
        self,
        target: str,
        action: str,
        params: Any = None,
        timeout: float | None = None,
    ) -> Any:
        """Call a platform capability ("kugua-main") or another module by name."""
        if self._ws is None:
            raise RuntimeError("not connected to the main controller")
        message = make_envelope("request", self.name, to=target, action=action, params=params)
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[message["id"]] = future
        await self._ws.send(json.dumps(message, ensure_ascii=False))
        try:
            return await asyncio.wait_for(future, timeout or self.request_timeout)
        finally:
            self._pending.pop(message["id"], None)

    async def platform_info(self) -> Dict[str, Any]:
        """Query the platform's online status and version (``nigane.platform.info``).

        Returns a dict with ``在线``/``版本``/``协议``/``启动时间``/``运行秒数``/
        ``模块数``.
        """
        return await self.request("kugua-main", "nigane.platform.info", {})

    async def list_modules(self) -> list:
        """List other modules currently online on the platform."""
        result = await self.request("kugua-main", "nigane.modules.names", {})
        return result if isinstance(result, list) else []

    async def broadcast(self, action: str, params: Any = None) -> None:
        """Broadcast an event to all other online modules."""
        if self._ws is None:
            raise RuntimeError("not connected to the main controller")
        message = make_envelope("event", self.name, action=action, params=params)
        await self._ws.send(json.dumps(message, ensure_ascii=False))

    # ---------- connection ----------

    @property
    def url(self) -> str:
        return f"ws://{self.host}:{self.port}"

    @property
    def is_connected(self) -> bool:
        return self._ws is not None

    def _managed_payload(self) -> Dict[str, Any] | None:
        """Build the ``托管`` handshake field (None when not requested)."""
        if not self.managed and not self.managed_entry:
            return None
        payload: Dict[str, Any] = {"enabled": self.managed}
        if self.managed_entry:
            payload["entry"] = self.managed_entry
        if self.managed_args:
            payload["args"] = self.managed_args
        if self.managed_cwd:
            payload["cwd"] = self.managed_cwd
        return payload

    async def run(self) -> None:
        """Connect and reconnect with backoff until stop() is called.

        Returns after ``max_retries`` consecutive failures, which usually means
        the platform is gone (a force-killed platform cannot broadcast
        system.shutdown, so this is the fallback signal).
        """
        while not self._stop.is_set():
            try:
                await self._connect_once()
            except Exception as err:
                if self._stop.is_set():
                    break
                self._failures += 1
                log.warning("connection error: %s (failure #%d)", err, self._failures)

            if self._stop.is_set():
                break

            if self.shutdown_requested:
                log.info("platform requested shutdown, client stops.")
                break

            if self._failures >= self.max_retries:
                log.warning(
                    "gave up after %d consecutive failures; assuming the platform "
                    "has exited (increase max_retries to keep retrying).",
                    self._failures,
                )
                break

            delay = min(2 ** (self._failures - 1), 30)
            log.info("reconnecting in %d s ...", delay)
            try:
                await asyncio.wait_for(self._stop.wait(), delay)
            except asyncio.TimeoutError:
                pass

    async def _connect_once(self) -> None:
        async with websockets.connect(self.url, ping_interval=None) as ws:
            self._ws = ws
            self._handshaked.clear()

            hello: Dict[str, Any] = {
                "name": self.name,
                "version": self.version,
                "path": self.path,
                "capabilityDefs": self.capabilities,
            }
            if self.token:
                hello["token"] = self.token
            managed_payload = self._managed_payload()
            if managed_payload is not None:
                hello["托管"] = managed_payload

            await ws.send(
                json.dumps(make_envelope("hello", self.name, params=hello), ensure_ascii=False)
            )

            # The receive loop must start before waiting for hello_ack,
            # otherwise both sides block forever (deadlock).
            receiver = asyncio.create_task(self._receive_loop(ws))
            heartbeat = asyncio.create_task(self._heartbeat_loop(ws))
            try:
                try:
                    await asyncio.wait_for(self._handshaked.wait(), 10)
                except asyncio.TimeoutError:
                    raise RuntimeError("handshake timeout: no hello_ack received") from None

                self._failures = 0
                log.info("connected to %s", self.url)

                # Notify the platform that this module has started (optional
                # on the platform side, but it keeps both sides in sync).
                try:
                    await ws.send(
                        json.dumps(
                            make_envelope(
                                "event",
                                self.name,
                                action="module.startup",
                                params={
                                    "name": self.name,
                                    "version": self.version,
                                    "path": self.path,
                                    "pid": os.getpid(),
                                },
                            ),
                            ensure_ascii=False,
                        )
                    )
                except Exception:
                    pass

                await receiver
            finally:
                # Tell the platform we are going away before the socket drops.
                if self._ws is not None and self._handshaked.is_set():
                    try:
                        await self._ws.send(
                            json.dumps(
                                make_envelope(
                                    "event",
                                    self.name,
                                    action="module.shutdown",
                                    params={"name": self.name, "version": self.version},
                                ),
                                ensure_ascii=False,
                            )
                        )
                    except Exception:
                        pass
                heartbeat.cancel()
                receiver.cancel()
                self._ws = None
                for future in self._pending.values():
                    if not future.done():
                        future.set_exception(RuntimeError("connection closed"))
                self._pending.clear()

    async def _receive_loop(self, ws: Any) -> None:
        async for text in ws:
            await self._dispatch(text)

    async def _heartbeat_loop(self, ws: Any) -> None:
        while True:
            await asyncio.sleep(30)
            try:
                await ws.send(json.dumps(make_envelope("ping", self.name), ensure_ascii=False))
            except Exception:
                return

    def stop(self) -> None:
        """Ask the client to stop (the run loop exits gracefully)."""
        self._stop.set()

    # ---------- inbound dispatch ----------

    async def _dispatch(self, text: str) -> None:
        try:
            message = json.loads(text)
        except json.JSONDecodeError:
            log.warning("received a non-JSON frame, ignored")
            return

        if not isinstance(message, dict) or "nigane" not in message:
            return

        msg_type = message.get("type")

        if msg_type == "hello_ack":
            self._handshaked.set()
            modules = (message.get("data") or {}).get("modules") or []
            log.info("handshake ok, platform modules: %s", ", ".join(modules))
            return

        if msg_type in ("response", "error"):
            future = self._pending.get(message.get("echo", ""))
            if future is not None and not future.done():
                if msg_type == "error":
                    future.set_exception(
                        RuntimeError(f"[{message.get('code')}] {message.get('message', 'module error')}")
                    )
                else:
                    future.set_result(message.get("data"))
            return

        if msg_type == "request":
            await self._handle_request(message)
            return

        if msg_type == "event":
            handler = self._event_handlers.get(message.get("action", ""))
            if handler is not None:
                try:
                    handler(message.get("params") or {}, message)
                except Exception:
                    log.exception("event handler failed: %s", message.get("action"))
            return

        if msg_type == "ping":
            await self._reply(message, msg_type="pong", echo=message.get("id"))
            return

    async def _handle_request(self, message: Dict[str, Any]) -> None:
        action = message.get("action", "")
        handler = self._handlers.get(action)
        if handler is None:
            await self._reply(
                message,
                msg_type="error",
                code=ERROR_CODES["not_registered"],
                message=f"action not implemented: {action}",
            )
            return

        try:
            result = handler(message.get("params") or {}, message)
            if asyncio.iscoroutine(result) or isinstance(result, Awaitable):
                result = await result
            await self._reply(message, msg_type="response", data=result)
        except Exception as err:
            log.exception("handler failed: %s", action)
            await self._reply(
                message,
                msg_type="error",
                code=ERROR_CODES["internal"],
                message=str(err),
            )

    async def _reply(
        self,
        original: Dict[str, Any],
        *,
        msg_type: str,
        echo: str | None = None,
        data: Any = None,
        code: int | None = None,
        message: str | None = None,
    ) -> None:
        if self._ws is None:
            return
        reply = make_envelope(
            msg_type,
            self.name,
            to=original.get("from"),
            echo=echo if echo is not None else original.get("id"),
            data=data,
            code=code,
            message=message,
        )
        try:
            await self._ws.send(json.dumps(reply, ensure_ascii=False))
        except Exception:
            log.warning("failed to send reply, connection may be gone")


def capability(
    name: str,
    module: str,
    *,
    title: str | None = None,
    description: str | None = None,
    commands: Optional[list[str]] = None,
    params: Optional[Dict[str, Any]] = None,
    expose_command: bool = True,
    expose_gui: bool = True,
) -> Dict[str, Any]:
    """Build one capability declaration (protocol field ``capabilityDefs`` 条目).

    ``commands`` are Chinese trigger words shown in the command panel and used
    by the AI router, e.g. ``commands=["echo", "回声"]``.
    """
    decl: Dict[str, Any] = {
        "名称": name,
        "模块": module,
        "动作": name,
        "暴露": {"指令": expose_command, "GUI": expose_gui},
    }
    if title:
        decl["标题"] = title
    if description:
        decl["说明"] = description
    if commands:
        decl["中文指令"] = commands
    if params:
        decl["参数"] = params
    return decl
