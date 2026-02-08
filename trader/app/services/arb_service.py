from __future__ import annotations

from datetime import datetime
import uuid

from sqlmodel import Session, select

from app.db_models import ArbPosition, ArbPositionStatus, OrderLog, RiskTask, RiskTaskStatus, RiskTaskType
from app.models import ArbCloseRequest, ArbCloseResponse, ArbOpenRequest, ArbStatusResponse


class ArbService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def open_position(self, request: ArbOpenRequest, user_id: uuid.UUID) -> tuple[ArbPosition, list[RiskTask]]:
        now = datetime.utcnow()
        position = ArbPosition(
            user_id=user_id,
            symbol=request.symbol,
            left_venue=request.left_venue,
            right_venue=request.right_venue,
            left_side=request.left_side,
            right_side=request.right_side,
            notional=request.notional,
            leverage_left=request.leverage_left,
            leverage_right=request.leverage_right,
            status=ArbPositionStatus.pending,
            opened_at=now,
            created_at=now,
            updated_at=now,
            meta=request.meta or {
                "avoid_adverse_spread": request.avoid_adverse_spread,
                "auto_close_after_ms": request.auto_close_after_ms,
                "liquidation_guard_enabled": request.liquidation_guard_enabled,
                "liquidation_guard_threshold_pct": request.liquidation_guard_threshold_pct,
            },
        )
        self._session.add(position)

        risk_tasks: list[RiskTask] = []
        if request.liquidation_guard_enabled:
            threshold = request.liquidation_guard_threshold_pct or 50
            risk_tasks.append(
                RiskTask(
                    arb_position_id=position.id,
                    task_type=RiskTaskType.liquidation_guard,
                    enabled=True,
                    threshold_pct=threshold,
                    status=RiskTaskStatus.pending,
                    created_at=now,
                    updated_at=now,
                )
            )

        for task in risk_tasks:
            self._session.add(task)

        self._session.commit()
        return position, risk_tasks

    def close_position(self, request: ArbCloseRequest) -> ArbCloseResponse:
        position = self._get_position(uuid.UUID(request.arb_position_id))
        if position is None:
            raise ValueError("arb_position not found")
        now = datetime.utcnow()
        position.status = ArbPositionStatus.closed
        position.closed_at = now
        position.updated_at = now
        self._session.add(position)
        self._session.commit()
        return ArbCloseResponse(arb_position_id=str(position.id), status=position.status.value)

    def get_status(self, arb_position_id: str) -> ArbStatusResponse:
        position_id = uuid.UUID(arb_position_id)
        position = self._get_position(position_id)
        if position is None:
            raise ValueError("arb_position not found")

        tasks = self._session.exec(
            select(RiskTask).where(RiskTask.arb_position_id == position_id)
        ).all()
        logs = self._session.exec(
            select(OrderLog).where(OrderLog.arb_position_id == position_id).order_by(OrderLog.created_at.desc())
        ).all()

        return ArbStatusResponse(
            arb_position=_serialize_position(position),
            risk_tasks=[_serialize_risk_task(task) for task in tasks],
            order_logs=[_serialize_order_log(log) for log in logs],
        )

    def _get_position(self, position_id: uuid.UUID) -> ArbPosition | None:
        return self._session.exec(
            select(ArbPosition).where(ArbPosition.id == position_id)
        ).first()


def _serialize_position(position: ArbPosition):
    return {
        "id": str(position.id),
        "symbol": position.symbol,
        "left_venue": position.left_venue,
        "right_venue": position.right_venue,
        "left_side": position.left_side,
        "right_side": position.right_side,
        "notional": position.notional,
        "leverage_left": position.leverage_left,
        "leverage_right": position.leverage_right,
        "status": position.status.value,
        "opened_at": position.opened_at,
        "closed_at": position.closed_at,
        "meta": position.meta,
        "created_at": position.created_at,
        "updated_at": position.updated_at,
        "deleted_at": position.deleted_at,
    }


def _serialize_risk_task(task: RiskTask):
    return {
        "id": str(task.id),
        "arb_position_id": str(task.arb_position_id),
        "task_type": task.task_type.value,
        "enabled": task.enabled,
        "threshold_pct": task.threshold_pct,
        "execute_at": task.execute_at,
        "triggered_at": task.triggered_at,
        "status": task.status.value,
        "trigger_reason": task.trigger_reason,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "deleted_at": task.deleted_at,
    }


def _serialize_order_log(log: OrderLog):
    return {
        "id": str(log.id),
        "arb_position_id": str(log.arb_position_id),
        "venue": log.venue,
        "side": log.side,
        "price": log.price,
        "size": log.size,
        "reduce_only": log.reduce_only,
        "request_payload": log.request_payload,
        "response_payload": log.response_payload,
        "status": log.status.value,
        "created_at": log.created_at,
        "updated_at": log.updated_at,
        "deleted_at": log.deleted_at,
    }
