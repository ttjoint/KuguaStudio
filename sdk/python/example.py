"""
KuguaStudio external module example (Python).

Demonstrates the four things an external module usually needs:
  1. Declare capabilities (command words -> command panel / AI routing)
  2. Be called by the platform and return a result
  3. Call platform capabilities (bidirectional communication)
  4. React to system.shutdown -- and decide whether to exit

Also shows how to request *managed startup* (``managed=True``): the first time
this module registers, the platform records its path and arguments so it can
be launched together with KuguaStudio next time. Existing user-edited config
is never overwritten.

Run:
    pip install websockets
    python example.py

Environment:
    KUGUA_PORT    main controller port (default 24601)
    KUGUA_TOKEN   auth token (required when the controller has one)
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

from nigane import NiganeClient, capability

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("example")

MODULE_NAME = "PythonExampleModule"


# ===== 1. Capability declarations =====

CAPABILITIES = [
    capability(
        "PythonExampleModule.greet",
        MODULE_NAME,
        title="Greet",
        description="Return a greeting. Demonstrates being called by the platform.",
        commands=["pygreet", "py打招呼"],
        params={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "who to greet"},
            },
        },
    ),
    capability(
        "PythonExampleModule.add",
        MODULE_NAME,
        title="Add",
        description="Add two numbers. Demonstrates parameter and result shapes.",
        commands=["pyadd", "py加法"],
        params={
            "type": "object",
            "properties": {
                "a": {"type": "number"},
                "b": {"type": "number"},
            },
            "required": ["a", "b"],
        },
    ),
    capability(
        "PythonExampleModule.info",
        MODULE_NAME,
        title="Runtime info",
        description="Return Python version and process info.",
        commands=["pyinfo", "py信息"],
    ),
]


# ===== 2. Handlers =====

def handle_greet(params: dict, message: dict) -> dict:
    who = params.get("name") or "world"
    log.info("called: greet (name=%s, from=%s)", who, message.get("from"))
    return {"text": f"Hello, {who}! Greetings from a Python external module."}


def handle_add(params: dict, message: dict) -> dict:
    a = params.get("a", 0)
    b = params.get("b", 0)
    log.info("called: add (%s + %s)", a, b)
    return {"sum": a + b}


def handle_info(params: dict, message: dict) -> dict:
    return {
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "pid": os.getpid(),
    }


# ===== 3. Build the client =====
#
# managed=True / managed_entry / managed_args:
#   ask KuguaStudio to launch this script together with the platform next time.
#   On the very first registration the platform stores these values.
#   If a config entry with the same module name already exists, whatever the
#   user edited in the UI wins -- your reported values are NOT applied.
#
#   Set managed=False (or omit) for a plain temporary registration.

CLIENT = NiganeClient(
    name=MODULE_NAME,
    version="0.1.0",
    capabilities=CAPABILITIES,
    managed=True,
    managed_entry=sys.executable,          # e.g. C:\Python312\python.exe
    managed_args=[os.path.abspath(__file__), "--hosted"],
)

CLIENT.register("PythonExampleModule.greet", handle_greet)
CLIENT.register("PythonExampleModule.add", handle_add)
CLIENT.register("PythonExampleModule.info", handle_info)


# ===== 4. Platform broadcast subscriptions =====

def on_platform_shutdown(params: dict, message: dict) -> None:
    """
    Received when the platform is exiting.

    The platform never signals your process -- whether to exit is up to you:
      * exit now (this example)
      * keep running and let the client reconnect when the platform returns
      * finish pending work, then exit
    """
    log.info("received system.shutdown, platform is exiting.")
    CLIENT.shutdown_requested = True
    CLIENT.stop()


def on_capability_changed(params: dict, message: dict) -> None:
    log.info(
        "capability registry changed: module=%s count=%s",
        params.get("module"),
        params.get("count"),
    )


def on_registry_conflict(params: dict, message: dict) -> None:
    """The platform declined to overwrite an existing config entry."""
    log.warning("registry conflict: %s", params)


CLIENT.on_event("system.shutdown", on_platform_shutdown)
CLIENT.on_event("capability.changed", on_capability_changed)
CLIENT.on_event("registry.conflict", on_registry_conflict)


# ===== 5. Demo: query the platform =====

async def demo_call_platform() -> None:
    await asyncio.sleep(3)
    try:
        names = await CLIENT.list_modules()
        log.info("online modules on the platform: %s", names)
    except Exception as err:
        log.warning("list_modules failed: %s", err)

    try:
        # Ask the platform for its own status/version (new in SDK 0.2).
        info = await CLIENT.platform_info()
        log.info("platform info: %s", info)
    except Exception as err:
        log.warning("platform_info failed: %s", err)


def on_platform_startup(params: dict, message: dict) -> None:
    """Optional: the platform announces itself once it is ready."""
    log.info(
        "platform started: v%s (protocol %s)",
        params.get("版本"),
        params.get("协议"),
    )


CLIENT.on_event("system.startup", on_platform_startup)


async def main() -> None:
    print("=" * 60)
    print("  KuguaStudio - Python external module example")
    print("=" * 60)
    print(f"  module : {MODULE_NAME}")
    print(f"  target : {CLIENT.url}")
    print(f"  managed: {CLIENT.managed}")
    print()
    print("  Type 'pygreet' in the platform chat to verify.")
    print("  Ctrl+C to quit.")
    print("=" * 60)
    print()

    asyncio.create_task(demo_call_platform())

    try:
        await CLIENT.run()
    except KeyboardInterrupt:
        pass
    finally:
        CLIENT.stop()
        log.info("example exited.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\ninterrupted.")
