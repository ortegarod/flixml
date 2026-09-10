#!/usr/bin/env python3
"""Create, list, and revoke agent API keys.

Agent identity lets multiple callers (AI agents, scripts, humans) share one
Studio instance's generation queue while still being told apart: jobs get
attributed to the agent that submitted them, and a key can optionally be
restricted to specific characters/workflows or capped on concurrent jobs.
There is deliberately no HTTP endpoint for minting keys — only someone with
shell access to this box can create one.

See config.json `security.require_api_key` to control whether a key is
required at all (default: false, i.e. attribution only).

Usage (run from the repo root, with .env's DATABASE_URL available):
    python scripts/manage_agent_keys.py create <id> <name> \\
        [--characters ciri,rigo] [--workflows flux2_lora] [--max-concurrent 1]
    python scripts/manage_agent_keys.py list
    python scripts/manage_agent_keys.py rotate <id>
    python scripts/manage_agent_keys.py revoke <id>
    python scripts/manage_agent_keys.py enable <id>
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

_APP_DIR = Path(__file__).resolve().parent.parent / "app"
if str(_APP_DIR) not in sys.path:
    sys.path.insert(0, str(_APP_DIR))

from flixml import db  # noqa: E402
from flixml.auth import generate_key, hash_key  # noqa: E402


def _split(value: str | None) -> list[str] | None:
    if not value:
        return None
    return [item.strip() for item in value.split(",") if item.strip()]


async def cmd_create(args: argparse.Namespace) -> None:
    raw_key = generate_key()
    agent = await db.create_agent(
        id=args.id,
        name=args.name,
        key_hash=hash_key(raw_key),
        allowed_characters=_split(args.characters),
        allowed_workflows=_split(args.workflows),
        max_concurrent_jobs=args.max_concurrent,
    )
    print(f"Created agent '{agent['id']}' ({agent['name']})")
    if agent["allowed_characters"]:
        print(f"  characters: {', '.join(agent['allowed_characters'])}")
    if agent["allowed_workflows"]:
        print(f"  workflows:  {', '.join(agent['allowed_workflows'])}")
    if agent["max_concurrent_jobs"] is not None:
        print(f"  max concurrent jobs: {agent['max_concurrent_jobs']}")
    print()
    print(f"API key (shown once, store it now): {raw_key}")
    print("Send it as: Authorization: Bearer <key>")


async def cmd_list(_args: argparse.Namespace) -> None:
    agents = await db.list_agents()
    if not agents:
        print("No agents provisioned.")
        return
    for agent in agents:
        status = "enabled" if agent["enabled"] else "REVOKED"
        print(f"{agent['id']:<20} {agent['name']:<24} {status:<8} last_used={agent['last_used_at'] or 'never'}")
        if agent["allowed_characters"]:
            print(f"  characters: {', '.join(agent['allowed_characters'])}")
        if agent["allowed_workflows"]:
            print(f"  workflows:  {', '.join(agent['allowed_workflows'])}")
        if agent["max_concurrent_jobs"] is not None:
            print(f"  max concurrent jobs: {agent['max_concurrent_jobs']}")


async def cmd_rotate(args: argparse.Namespace) -> None:
    if not await db.get_agent(args.id):
        print(f"No such agent: {args.id}", file=sys.stderr)
        raise SystemExit(1)
    raw_key = generate_key()
    await db.set_agent_key_hash(args.id, hash_key(raw_key))
    print(f"Rotated key for '{args.id}'. Old key is now invalid.")
    print(f"New API key (shown once): {raw_key}")


async def cmd_revoke(args: argparse.Namespace) -> None:
    if not await db.set_agent_enabled(args.id, False):
        print(f"No such agent: {args.id}", file=sys.stderr)
        raise SystemExit(1)
    print(f"Revoked '{args.id}'. Its key no longer resolves.")


async def cmd_enable(args: argparse.Namespace) -> None:
    if not await db.set_agent_enabled(args.id, True):
        print(f"No such agent: {args.id}", file=sys.stderr)
        raise SystemExit(1)
    print(f"Enabled '{args.id}'.")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_create = sub.add_parser("create", help="Provision a new agent + API key")
    p_create.add_argument("id", help="Slug, e.g. 'ciri'")
    p_create.add_argument("name", help="Display name")
    p_create.add_argument("--characters", help="Comma-separated character id allowlist (default: unrestricted)")
    p_create.add_argument("--workflows", help="Comma-separated workflow id allowlist (default: unrestricted)")
    p_create.add_argument("--max-concurrent", type=int, default=None, help="Max in-flight jobs for this agent")
    p_create.set_defaults(func=cmd_create)

    p_list = sub.add_parser("list", help="List provisioned agents")
    p_list.set_defaults(func=cmd_list)

    p_rotate = sub.add_parser("rotate", help="Issue a new key for an agent, invalidating the old one")
    p_rotate.add_argument("id")
    p_rotate.set_defaults(func=cmd_rotate)

    p_revoke = sub.add_parser("revoke", help="Disable an agent's key")
    p_revoke.add_argument("id")
    p_revoke.set_defaults(func=cmd_revoke)

    p_enable = sub.add_parser("enable", help="Re-enable a revoked agent")
    p_enable.add_argument("id")
    p_enable.set_defaults(func=cmd_enable)

    args = parser.parse_args()
    await db.init_db()
    try:
        await args.func(args)
    finally:
        await db.close_db()


if __name__ == "__main__":
    asyncio.run(main())
