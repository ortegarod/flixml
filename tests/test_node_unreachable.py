import asyncio
import json
import os
import socket
import tempfile
import unittest
from unittest import mock

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/x")
os.environ.setdefault("FLIXML_OUTPUT_DIR", tempfile.mkdtemp())
os.environ.setdefault("FLIXML_TRAINING_DIR", tempfile.mkdtemp())
os.environ.setdefault("FLIXML_LORA_OUTPUT_DIR", tempfile.mkdtemp())
os.environ.setdefault("FLIXML_COMFY_LORA_DIR", tempfile.mkdtemp())

import httpx

from flixml import node_events
from flixml.comfy import ComfyClient, NodeUnreachable, request_timeout


def closed_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class NodeUnreachableTest(unittest.TestCase):
    def setUp(self):
        self._saved = set(node_events._unreachable)
        node_events._unreachable.clear()

    def tearDown(self):
        node_events._unreachable.clear()
        node_events._unreachable.update(self._saved)

    def test_known_down_node_fails_before_any_request(self):
        node_events._unreachable.add("gpu1")
        client = ComfyClient("http://10.255.255.1:8188", 120.0, "gpu1")
        with mock.patch.object(httpx.AsyncClient, "get", side_effect=AssertionError("sent a request")):
            with self.assertRaises(NodeUnreachable) as ctx:
                asyncio.run(client.get("/system_stats"))
        self.assertEqual(str(ctx.exception), "Can't connect to ComfyUI on gpu1 (10.255.255.1:8188). Is it running?")

    def test_refused_port_fails_with_the_same_message(self):
        port = closed_port()
        client = ComfyClient(f"http://127.0.0.1:{port}", 120.0, "gpu1")
        with self.assertRaises(NodeUnreachable) as ctx:
            asyncio.run(client.get("/system_stats"))
        self.assertEqual(str(ctx.exception), f"Can't connect to ComfyUI on gpu1 (127.0.0.1:{port}). Is it running?")

    def test_connect_timeout_is_mapped(self):
        client = ComfyClient("http://10.255.255.1:8188", 120.0, "gpu1")
        with mock.patch.object(httpx.AsyncClient, "post", side_effect=httpx.ConnectTimeout("t")):
            with self.assertRaises(NodeUnreachable):
                asyncio.run(client.post("/queue", {}))

    def test_connect_timeout_is_short_and_read_timeout_stays_long(self):
        timeout = request_timeout(120.0)
        self.assertEqual(timeout.connect, 5.0)
        self.assertEqual(timeout.read, 120.0)

    def test_api_answers_503_with_the_message(self):
        from flixml import api

        response = asyncio.run(api._node_unreachable(None, NodeUnreachable("gpu1", "http://10.255.255.1:8188")))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            json.loads(response.body),
            {"detail": "Can't connect to ComfyUI on gpu1 (10.255.255.1:8188). Is it running?"},
        )


if __name__ == "__main__":
    unittest.main()
