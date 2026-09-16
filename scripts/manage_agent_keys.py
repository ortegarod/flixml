#!/usr/bin/env python3
"""Create, list, and revoke agent API keys.

Each caller (AI agent, script, human) gets its own key. An admin key sees
everything; any other key sees only the jobs, media and projects it created and
the characters in its allowlist, and can be limited to certain workflows or
capped on concurrent jobs. Admin keys can also manage keys in Studio under
Settings → API keys, which is open to anyone while keys aren't required; this
script does the same from a terminal.

See config.json `security.require_api_key` to control whether a key is
required at all (default: false, requests without one are unrestricted).

A new key is printed once. Pass --key-file to write it to a file readable only
by you instead, so it never lands in a terminal log.

Usage (run from the repo root, with .env's DATABASE_URL available):
    python scripts/manage_agent_keys.py create <id> <name> [--admin] \\
        [--characters my_character] [--workflows sdxl_lora] [--max-concurrent 1] [--key-file PATH]
    python scripts/manage_agent_keys.py update <id> [--admin | --no-admin] \\
        [--characters a,b] [--workflows a,b] [--max-concurrent N]   (pass "" to clear a list)
    python scripts/manage_agent_keys.py list
    python scripts/manage_agent_keys.py rotate <id> [--key-file PATH]
    python scripts/manage_agent_keys.py revoke <id>
    python scripts/manage_agent_keys.py enable <id>
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

_APP_DIR = Path(__file__).resolve().parent.parent / "app"
if str(_APP_DIR) not in sys.path:
    sys.path.insert(0, str(_APP_DIR))

from flixml import db  # noqa: E402
from flixml.auth import generate_key, hash_key  # noqa: E402


def _emit_key(raw_key: str, key_file: str | None, label: str) -> None:
    """Print the key, or write it to a file only the current user can read."""
    if key_file:
        path = Path(key_file).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(raw_key + "\n")
        os.chmod(path, 0o600)
        print(f"{label} written to {path} (mode 600)")
    else:
        print(f"{label} (shown once, store it now): {raw_key}")
    print("Send it as: Authorization: Bearer <key>")


def _describe(agent: dict) -> None:
    if agent["is_admin"]:
        print("  admin: sees everything")
    if agent["allowed_characters"]:
        print(f"  characters: {', '.join(agent['allowed_characters'])}")
    if agent["allowed_workflows"]:
        print(f"  workflows:  {', '.join(agent['allowed_workflows'])}")
    if agent["max_concurrent_jobs"] is not None:
        print(f"  max concurrent jobs: {agent['max_concurrent_jobs']}")


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
        is_admin=args.admin,
    )
    print(f"Created agent '{agent['id']}' ({agent['name']})")
    _describe(agent)
    print()
    _emit_key(raw_key, args.key_file, "API key")


async def cmd_update(args: argparse.Namespace) -> None:
    fields: dict = {}
    if args.admin is not None:
        fields["is_admin"] = args.admin
    if args.characters is not None:
        fields["allowed_characters"] = _split(args.characters)
    if args.workflows is not None:
        fields["allowed_workflows"] = _split(args.workflows)
    if args.max_concurrent is not None:
        fields["max_concurrent_jobs"] = args.max_concurrent if args.max_concurrent > 0 else None
    if not await db.update_agent(args.id, fields):
        print(f"No such agent: {args.id}", file=sys.stderr)
        raise SystemExit(1)
    agent = await db.get_agent(args.id)
    print(f"Updated '{args.id}'")
    _describe(agent)


async def cmd_list(_args: argparse.Namespace) -> None:
    agents = await db.list_agents()
    if not agents:
        print("No agents provisioned.")
        return
    for agent in agents:
        status = "enabled" if agent["enabled"] else "REVOKED"
        print(f"{agent['id']:<20} {agent['name']:<24} {status:<8} last_used={agent['last_used_at'] or 'never'}")
        _describe(agent)


async def cmd_rotate(args: argparse.Namespace) -> None:
    if not await db.get_agent(args.id):
        print(f"No such agent: {args.id}", file=sys.stderr)
        raise SystemExit(1)
    raw_key = generate_key()
    await db.set_agent_key_hash(args.id, hash_key(raw_key))
    print(f"Rotated key for '{args.id}'. Old key is now invalid.")
    _emit_key(raw_key, args.key_file, "New API key")


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
    p_create.add_argument("id", help="Slug, e.g. 'my-agent'")
    p_create.add_argument("name", help="Display name")
    p_create.add_argument("--characters", help="Comma-separated character id allowlist (default: unrestricted)")
    p_create.add_argument("--workflows", help="Comma-separated workflow id allowlist (default: unrestricted)")
    p_create.add_argument("--max-concurrent", type=int, default=None, help="Max in-flight jobs for this agent")
    p_create.add_argument("--admin", action="store_true", help="See and manage everything, not just what this agent owns")
    p_create.add_argument("--key-file", help="Write the key to this file (mode 600) instead of printing it")
    p_create.set_defaults(func=cmd_create)

    p_update = sub.add_parser("update", help="Change an agent's scope; only the options given change")
    p_update.add_argument("id")
    p_update.add_argument("--admin", dest="admin", action="store_true", default=None)
    p_update.add_argument("--no-admin", dest="admin", action="store_false")
    p_update.add_argument("--characters", help='Comma-separated character allowlist; "" allows all')
    p_update.add_argument("--workflows", help='Comma-separated workflow allowlist; "" allows all')
    p_update.add_argument("--max-concurrent", type=int, help="Max in-flight jobs; 0 removes the cap")
    p_update.set_defaults(func=cmd_update)

    p_list = sub.add_parser("list", help="List provisioned agents")
    p_list.set_defaults(func=cmd_list)

    p_rotate = sub.add_parser("rotate", help="Issue a new key for an agent, invalidating the old one")
    p_rotate.add_argument("id")
    p_rotate.add_argument("--key-file", help="Write the key to this file (mode 600) instead of printing it")
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
