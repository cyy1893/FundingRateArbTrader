# 数据库落地计划（最小可行）

目标：把“需要持久化与可恢复”的核心流程落在数据库上，让风控/定时任务/订单追踪更稳定且代码更简练。

## 适合上数据库的内容（优先级从高到低）
1) 套利建仓/平仓任务状态机（状态、时间、关联订单）
2) 风控任务（定时平仓、避免爆仓）配置与触发记录
3) 订单请求/回执与失败日志（便于重试、排障）
4) 仓位/价格快照（用于复盘、风控阈值触发）
5) WebSocket/事件广播的可重放日志

## 方案建议
- 起步建议用 SQLite（单机最省事），后续可平滑迁到 Postgres。
- ORM：SQLAlchemy（或 sqlmodel），配合 Alembic 做迁移。
- 所有“交易状态”与“任务调度”由后端统一管理，前端只负责展示与发起。

## 最小闭环数据模型（第一阶段）

### 1) arb_position（对冲仓位/任务）
记录每一笔套利的全生命周期。
- id (PK)
- symbol
- left_venue / right_venue
- left_side / right_side
- notional
- leverage_left / leverage_right
- status: idle/pending/partially_filled/hedged/exiting/closed/failed
- opened_at / closed_at
- open_order_ids (json)
- close_order_ids (json)
- meta (json, 记录关键参数如避免不利价差等)

### 2) risk_task（风控/计划任务）
记录“定时平仓”和“避免爆仓”的触发配置与状态。
- id (PK)
- arb_position_id (FK)
- type: auto_close | liquidation_guard
- enabled
- threshold_pct (nullable)
- execute_at (nullable)
- triggered_at (nullable)
- status: pending/triggered/canceled/failed
- trigger_reason (text)

### 3) order_log（订单流水）
记录下单请求与回执，便于补单与问题追踪。
- id (PK)
- arb_position_id (FK)
- venue
- side
- price
- size
- reduce_only
- request_payload (json)
- response_payload (json)
- status: sent/accepted/rejected/failed
- created_at

## 后端接口建议（第一阶段）
- POST /arb/open
  - 输入：symbol、左右方向、notional、风控设置
  - 行为：写 arb_position + risk_task -> 下单 -> 更新订单日志
- POST /arb/close
  - 行为：更新状态 -> 发平仓单 -> 写 order_log
- GET /arb/status?id=...
  - 返回：当前状态 + 任务状态 + 最近订单

## 风控执行方式
- 后端定时任务（如 APScheduler/asyncio loop）
  - 轮询 risk_task 表
  - 到期或阈值触发时：
    - 更新任务状态
    - 生成平仓单
    - 更新 arb_position 状态
- 阈值触发依赖：
  - 可以用仓位快照 + mark_price 计算 pnl%（入库后可稳态触发）

## 前端配合变更（非代码，行为描述）
- 下单时不直接调用 /orders/xxx，改为 /arb/open
- 左侧面板的设置项写入 /arb/open 请求
- 通过 /arb/status 轮询或 WebSocket 拉取状态展示

## 风险与注意点
- 数据一致性：下单成功/失败必须落到 order_log
- 异常恢复：服务重启后仍可恢复风控任务与状态
- 权限隔离：请求必须校验 token 与账户归属
- 日志脱敏：敏感字段必须脱敏存储（key、nonce、签名）

## 后续可扩展
- 增加 position_snapshot（按时间记录 PnL 与 mark_price）
- 增加 event_log（用于回放与审计）
- 加入 WebSocket 推送“任务状态更新”

