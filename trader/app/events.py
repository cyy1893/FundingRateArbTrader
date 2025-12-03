from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Set


class EventBroadcaster:
    """
    Minimal pub/sub hub used to fan out order events to WebSocket clients.
    """

    def __init__(self) -> None:
        self._subscribers: Set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()

    async def register(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        async with self._lock:
            self._subscribers.add(queue)
        return queue

    async def unregister(self, queue: asyncio.Queue) -> None:
        async with self._lock:
            self._subscribers.discard(queue)

    async def publish(self, event: Dict[str, Any]) -> None:
        if not self._subscribers:
            return
        stale_queues: List[asyncio.Queue] = []
        for queue in self._subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                stale_queues.append(queue)

        if stale_queues:
            async with self._lock:
                for queue in stale_queues:
                    self._subscribers.discard(queue)
