# 交易页面左侧面板新增功能计划

目标：在交易页面左侧面板新增 3 个可配置功能，并贯通到下单/风控逻辑中：
1) 避免不利价差（仅勾选时启用）
2) 定时自动平仓（24 小时 / 2 天 / 1 周）
3) 避免爆仓（浮盈/浮亏达到阈值时双边平仓，默认 50%）

## 1. 现状摸排与入口定位
- UI 入口：`gateway/src/components/quick-trade-panel.tsx`（左侧面板）
- 下单逻辑：`gateway/src/app/trading/page.tsx` -> `executeArbitrage`
- 订阅/配置：`gateway/src/hooks/use-order-book-websocket.ts` 的 `OrderBookSubscription`
- 后端下单：`trader/app/main.py`（/orders/lighter, /orders/grvt）
- 事件广播：`trader/app/events.py`

## 2. 前端 UI 方案
在左侧面板新增 3 个设置块，并与当前状态管理联动。
- 避免不利价差：Checkbox + 简要说明文案（默认启用或默认禁用需确认）
- 定时自动平仓：Select（24h / 2d / 1w / 关闭）
- 避免爆仓：Checkbox + 数值输入框（百分比，默认 50%）

UI 交互要求：
- 控件状态需要和下单/监控逻辑绑定（非仅展示）。
- 校验范围：百分比 1–100，空值/非法值不允许提交。
- 当功能未勾选时，执行流程保持现状。

## 3. 前端状态与类型
- 扩展 `OrderBookSubscription`（或单独本地状态）以携带新增参数：
  - `avoid_adverse_spread: boolean`
  - `auto_close_after_ms?: number` (24h/2d/1w -> 毫秒)
  - `auto_close_enabled: boolean`
  - `liquidation_guard_enabled: boolean`
  - `liquidation_guard_threshold_pct?: number`
- 在 `QuickTradePanel` 内维护并通过 `onConfigChange` 回传。
- 在 `trading/page.tsx` 中消费这些配置，传给下单及后续风控逻辑。

## 4. 下单逻辑调整（前端）
- 避免不利价差：
  - 现有 `longPrice > shortPrice` 直接阻止下单；改为仅当 `avoid_adverse_spread` 勾选时才阻止。
- 定时自动平仓与避免爆仓：
  - 需要在“建仓成功”之后触发，前端仅负责携带参数并展示状态。
  - 是否由前端定时触发平仓 or 后端守护：需确认（建议后端执行）。

## 5. 后端/风控执行方案
新增一个“仓位风控/计划任务”路径：
- 方案 A（推荐）：在 trader 后端新增任务/管理器
  - 接收建仓成功事件（或新增“建仓记录”接口）
  - 记录 auto-close deadline，并定时检查
  - 监控浮盈/浮亏百分比（读取仓位/标记价格）
  - 触发双边平仓（post-only 优先，超时或极端情况可降级）
- 方案 B（前端定时 + API）：
  - 前端在建仓成功后启动计时器，达到期限调用平仓接口
  - 前端订阅仓位变化，触发爆仓保护平仓
  - 风险：前端关闭即失效，不建议

需要补充的后端能力：
- 查询当前仓位/浮盈浮亏（已有 balances 但需包含实时 pnl% 或可推导）
- 新增“平仓”接口（两端一起）或统一“对冲平仓”服务方法
- 记录并广播：计划平仓任务状态、触发原因（定时/阈值）

## 6. API/类型契约
- 若后端负责风控：
  - 新增 `POST /arb/open` 或扩展现有下单接口，携带上述设置
  - 返回 `arb_id` 供状态追踪
  - 提供 `GET /arb/status` 供前端展示
- 若暂不动后端：
  - 仅在前端层面保留参数，并在未来接入后端

## 7. 验收要点
- 不勾选“避免不利价差”时，即使价差不利也允许下单。
- 选择定时平仓后，建仓成功 -> 到期自动挂单平仓（双边）。
- 勾选“避免爆仓”且阈值生效时，浮盈/浮亏超过阈值 -> 双边自动平仓。
- 默认阈值 50%，可编辑且校验。

## 8. 待确认问题
- 默认勾选状态：避免不利价差 / 避免爆仓 是否默认开启？
- “建仓成功”的判定口径：两端都成交？是否允许部分成交？
- 平仓方式：是否允许 taker emergency？默认 post-only？
- 浮盈/浮亏的百分比计算方式：以保证金/名义/权益为基准？

