# 2026-07-23 自动化测试报告

## 结论

**通过。** 共执行 **92 次测试**，**92 通过，0 失败**；Playwright 控制台 **0 Error / 0 Warning**。

| 测试层 | 结果 | 说明 |
|---|---:|---|
| Go HTTP / PostgreSQL 集成测试 | 22 / 22 | 真实路由、JWT、事务、并发、权限；媒体使用 S3 Stub |
| 前端 Bun 纯函数测试 | 33 / 33 | 11 个用例各重复 3 次，覆盖账号隔离、权限和素材查询/表单 |
| localhost 黑盒 API | 31 / 31 | 使用运行中的 `localhost:3000`，覆盖成功路径与边界/越权 |
| Playwright 真实浏览器 | 6 / 6 | 管理员、主账号、成员、个人账号、移动端和素材复制 |

## 关键验证结果

- 企业创建、搜索、主账号充值/扣减、状态切换和密码重置均符合预期。
- 成员创建不能伪造企业、角色或初始积分；跨企业成员操作被拒绝。
- 积分分配/收回支持幂等；余额不足和并发竞争不会产生负数或超发。
- 企业流水按成员、类型和关键词过滤，未发现跨企业数据泄露。
- 主账号可维护企业素材，成员只读，个人账号直接访问显示无权限。
- 企业文本、图片、视频复制后形成独立个人副本；源删除不影响副本。
- 媒体复制失败、数据库写入失败不会遗留个人记录或对象存储垃圾。
- 同一浏览器从企业成员切换到个人账号后，企业入口、企业信息和上一账号素材均不再显示。
- 桌面与移动导航均按企业身份显示“企业素材库”。

## 测试数据清理

自动创建的两家测试企业已在结束时统一设为 **disabled**。项目没有企业删除接口，因此未做物理删除；未修改既有企业或用户数据。

## 限制

- 图片/视频的授权、复制和失败清理由 Go 集成测试中的 S3 Stub 验证；未连接真实生产对象存储。
- 未实际调用收费 AI 上游；生成扣费与积分并发通过数据库/服务集成测试覆盖。
- 本轮只测试本次 Issues #16–#25，不扩展到无关功能回归。

## 产物

- 测试集：[`test-cases.md`](./test-cases.md)
- 一键复跑：[`run.sh`](./run.sh)
- 黑盒 API 明细：[`live-api-results.json`](./live-api-results.json)
- UI 明细：[`ui-results.json`](./ui-results.json)
- Go 日志：[`logs/go-router.log`](./logs/go-router.log)
- Bun 日志：[`logs/bun-frontend.log`](./logs/bun-frontend.log)
- Playwright 日志：[`logs/playwright-ui.log`](./logs/playwright-ui.log)
- 控制台日志：[`logs/playwright-console.log`](./logs/playwright-console.log)
- 清理结果：[`cleanup-results.json`](./cleanup-results.json)
- 截图：[`screenshots/`](./screenshots/)

## 复跑

```bash
./auto-test/2026-07-23/run.sh
```
