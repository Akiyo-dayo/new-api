# 排行榜时间范围模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为排行榜增加个人本地的滚动窗口/自然周期切换，默认使用原仓滚动窗口。

**Architecture:** 后端将模式作为请求参数解析，并把模式纳入排行榜与消费统计缓存键；前端通过路由搜索参数和 localStorage 管理个人偏好，切换控件复用现有排行榜头部周期导航。

**Tech Stack:** Go、Gin、GORM、React、TanStack Router、TanStack Query、Zod、Vitest-free TypeScript build checks。

## Global Constraints

- 默认 `mode=rolling`，缺省和非法值必须兼容旧客户端。
- 自然周期保持当前 UTC 边界，不引入新的站点时区配置。
- 本轮只做本地实现和预览，不部署线上，不操作 PostgreSQL、Redis、channels、abilities 或 pricing options。

---

### Task 1: 后端模式与周期计算

**Files:**
- Modify: `service/rankings.go`
- Modify: `controller/rankings.go`
- Modify: `service/rankings_period_test.go`

- [ ] 写测试：验证 rolling 使用 24h/7d/30d/365d，natural 使用自然边界，非法模式回退 rolling，缓存键区分模式。
- [ ] 运行定向 Go 测试确认先失败。
- [ ] 增加模式类型、解析和模式化缓存键，保持旧函数调用兼容。
- [ ] 运行定向 Go 测试确认通过。

### Task 2: 前端路由、请求和本地偏好

**Files:**
- Modify: `web/src/routes/rankings/index.tsx`
- Modify: `web/src/features/rankings/types.ts`
- Modify: `web/src/features/rankings/api.ts`
- Modify: `web/src/features/rankings/hooks/use-rankings.ts`
- Modify: `web/src/features/rankings/index.tsx`
- Modify: `web/src/features/rankings/components/rankings-hero.tsx`

- [ ] 扩展搜索 schema、类型和 API 参数。
- [ ] 增加 localStorage 读写和 URL 优先级，默认 rolling。
- [ ] 在周期按钮后加入模式切换控件并保持移动端不溢出。
- [ ] 运行前端类型检查和构建。

### Task 3: 本地预览验收

**Files:**
- No additional source files.

- [ ] 启动本地前端预览服务。
- [ ] 验证默认请求为 rolling，切换后 URL、localStorage 和请求参数变为 natural。
- [ ] 向用户提供本地预览地址，明确未执行线上部署。
