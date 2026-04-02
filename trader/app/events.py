from __future__ import annotations

import asyncio
from typing import Any, Dict, List


class EventBroadcaster:
    """
    Minimal pub/sub hub used to fan out order events to user-scoped WebSocket clients.
    """

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()

    async def register(self, channel: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        async with self._lock:
            self._subscribers.setdefault(channel, set()).add(queue)
        return queue

    async def unregister(self, channel: str, queue: asyncio.Queue) -> None:
        async with self._lock:
            channel_subscribers = self._subscribers.get(channel)
            if channel_subscribers is None:
                return
            channel_subscribers.discard(queue)
            if not channel_subscribers:
                self._subscribers.pop(channel, None)

    async def publish(self, channel: str, event: Dict[str, Any]) -> None:
        subscribers = self._subscribers.get(channel)
        if not subscribers:
            return
        stale_queues: List[asyncio.Queue] = []
        for queue in list(subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                stale_queues.append(queue)

        if stale_queues:
            async with self._lock:
                channel_subscribers = self._subscribers.get(channel)
                if channel_subscribers is None:
                    return
                for queue in stale_queues:
                    channel_subscribers.discard(queue)
                if not channel_subscribers:
                    self._subscribers.pop(channel, None)
