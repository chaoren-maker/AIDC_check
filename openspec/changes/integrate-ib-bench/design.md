# Design: 集成 ib-bench 到 GPU 巡检平台

## Context

当前平台已有：本地后端（FastAPI + paramiko SSH）、Excel 主机导入、GPU 巡检 Web UI。ib-bench 是独立的 CLI 工具，通过 SSH 在远程主机上执行 `ibstat`/`mst status`/`ib_write_bw`/`ib_write_lat`，发现 IB 网卡并执行带宽/延迟测试。它使用 paramiko、pandas/openpyxl 解析 Excel 凭证，与本项目技术栈高度一致。

需要将 ib-bench 的核心功能移植到本项目后端，暴露为 REST API，并在前端提供 IB 网卡查看、单对测试、批量测试、结果展示与日志下载。

约束：
- 不在远程主机上部署任何脚本。
- 复用已导入的 Excel 主机列表（host_ip, username, password）。
- 远程主机需已安装 `ibstat`, `ib_write_bw`, `ib_write_lat`, `mst status` 等。

## Goals / Non-Goals

**Goals:**

- 在 Web UI 中查看任一已导入主机的 InfiniBand 网卡列表（型号、速率 200G/400G、LID、端口状态）。
- 支持单对测试：选择 server + client 两台主机，选择测试类型（带宽/延迟），执行后展示每网卡对的结果与 PASS/FAIL。
- 支持批量测试：基于全部已导入主机自动配对（参考 ib-bench 的 dual 模式），并行执行带宽/延迟测试，完成后展示所有配对的汇总结果表格。
- 测试结果持久化：每次测试保存日志文件到本地目录（`ib_test_results/`），API 可查询历次测试列表与汇总，前端提供日志下载按钮。

**Non-Goals:**

- 不实现 ib-bench 的 `env` 环境管理子命令（凭证已由平台统一管理）。
- 不实现 quad 模式（首版只实现 dual 模式配对，覆盖绝大多数场景）。
- 不在前端做实时流式日志（首版为请求/响应模式，测试完成后一次性返回结果）。
- 不自动判断集群最优并行度（首版使用固定默认并发数或简单配置）。

## Decisions

### 1. IB 网卡发现：移植 ib-bench 的 netcard 解析逻辑

- 理由：ib-bench 的 `netcard.py` 已有成熟的 `ibstat` + `mst status` 解析代码，可过滤 VF、onboard 网卡，区分 200G/400G。直接移植其解析函数到 `app/remote/ib_cards.py`，通过本项目已有的 SSH runner 执行命令。
- 备选：重新实现 —— 没必要，ib-bench 的解析已处理了各种边界情况。

### 2. 单对测试：后端在两台主机上分别启动 server/client 进程

- 理由：参考 ib-bench `main.py` 的测试流程——先在 server 端 SSH 执行 `ib_write_bw --ib-dev=xxx -p PORT -D DURATION ...`，等待 `SERVER_WAIT_TIME` 秒后再在 client 端 SSH 执行对应的 client 命令，收集 stdout 解析结果。
- 命令格式直接复用 ib-bench 的参数组合。
- 通过 paramiko 并发执行多网卡对（同一对主机的多张网卡使用不同端口 12400+）。

### 3. 批量测试：dual 模式配对 + 分组无冲突并行

- 理由：参考 ib-bench 的 `generate_group_combinations(mode='dual')`——将主机分为两半配对；再通过 `group_server_pairs_without_conflict` 分组，使得同一组内无 IP 冲突，然后组内并行、组间串行。
- 并行度：首版使用 `asyncio` 或 `concurrent.futures.ThreadPoolExecutor`（后端已是 FastAPI 异步框架，paramiko 本身是同步的，用线程池包装）。

### 4. 结果解析与 PASS/FAIL 判定

- 带宽阈值直接使用 ib-bench `config.py` 的值：200G 单向 >= 190 Gb/s, 400G 单向 >= 380 Gb/s, 双向分别 >= 390 / 760。
- 延迟阈值：64B/128B < 3.0μs, 256B/512B < 4.0μs；四个尺寸全部通过才算 PASS。
- 移植 `sorted_results.py` 的解析逻辑到 `app/remote/ib_test.py`。

### 5. 测试结果持久化与日志下载

- 每次测试（单对或批量）创建一个结果目录 `ib_test_results/<timestamp>/`，包含：
  - `summary.json`：结构化汇总（测试类型、所有配对结果、PASS/FAIL、时间戳）。
  - `raw_log.txt`：完整的原始命令输出。
- 后端提供 API：`GET /api/ib/results` 列出历次测试，`GET /api/ib/results/<id>/summary` 返回汇总 JSON，`GET /api/ib/results/<id>/log` 返回日志文件供下载。
- 前端在结果页展示汇总表格，每行有"下载日志"按钮。

### 6. Web UI 扩展

- 侧边栏新增两个入口：「IB 网卡」和「IB 测试」。
- IB 网卡页面：选择一台主机 → 展示其 IB 网卡列表。
- IB 测试页面：
  - 单对测试：从主机列表中选 server 和 client，选测试类型（带宽/延迟），点击"执行"。
  - 批量测试：一键"批量测试"按钮，使用全部已导入主机自动配对，选择测试类型后执行。
  - 测试完成后展示结果表格（配对、速率、数值、PASS/FAIL），每条提供日志下载。
  - 历史结果列表：可查看之前的测试记录。

### 7. 前端技术

- 延续现有 Tailwind 深色科技风，IB 测试面板结构与 GPU 巡检一致。
- 批量测试执行时间较长（可能数十秒到数分钟），前端显示"执行中…"状态；首版不做 WebSocket 流式，完成后一次性加载结果。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 批量测试耗时长（几十对主机可能数分钟），HTTP 请求可能超时 | 后端异步执行，返回 task_id；前端轮询 `/api/ib/results/<task_id>/status` 直到完成 |
| 远程未安装 ibstat / perftest | API 返回明确错误信息 "ibstat not found" 或 "ib_write_bw not found" |
| 测试过程中 server 端进程未就绪就启动 client | 复用 ib-bench 的 `SERVER_WAIT_TIME=8s` 等待策略 |
| 并发 SSH 连接数过多 | 限制并发度（默认 10），可通过环境变量调整 |
| 日志文件增长 | 首版不做自动清理，文档说明手动删除 `ib_test_results/` 即可 |

## Open Questions

- 批量测试的并行度默认值设为多少合适？ib-bench 默认 30，但本项目首版可保守设为 10。
- 是否需要在前端支持选择 dual/quad 配对模式？首版建议只支持 dual。
- 延迟测试的 MTU 是否需要前端可配？首版建议固定 4096。
