# Tasks: 集成 ib-bench 到 GPU 巡检平台

## 1. IB 测试常量与配置

- [x] 1.1 创建 `app/remote/ib_config.py`，定义阈值和常量
  - 带宽阈值：200G 单向 190、双向 390；400G 单向 380、双向 760
  - 延迟阈值：64B→3.0, 128B→3.0, 256B→4.0, 512B→4.0
  - 测试参数：SERVER_WAIT_TIME=8, TEST_DURATION=10, SERVER_DURATION=48, LATENCY_TEST_SIZES=[64,128,256,512], LATENCY_MTU=4096
  - 并发控制：DEFAULT_MAX_CONCURRENT=10, BASE_PORT=12400

## 2. IB 网卡发现模块

- [x] 2.1 创建 `app/remote/ib_cards.py`，移植 ib-bench `netcard.py` 的解析逻辑
  - `discover_ib_cards(host_ip, username, password)` → dict with 200G/400G card lists
  - 通过 SSH 执行 `mst status -vv` 和 `ibstat`
  - 过滤 VF 和 onboard 网卡
  - 返回 `{"200G": [{"interface": str, "lid": str}], "400G": [...]}`

## 3. IB 带宽测试模块

- [x] 3.1 创建 `app/remote/ib_test.py`，实现单对带宽测试
  - `run_bandwidth_test(server_creds, client_creds, cards, bidirectional=False)` → list of per-card results
  - SSH 到 server 启动 `ib_write_bw --ib-dev=DEV -p PORT -D 48 -q 4 --report_gbits -F`
  - 等待 SERVER_WAIT_TIME 后 SSH 到 client 启动 `ib_write_bw --ib-dev=DEV SERVER_IP -p PORT -D 10 -q 4 --report_gbits -F`
  - 解析 stdout 提取 BW average，PASS/FAIL 判定
- [x] 3.2 实现结果解析函数 `parse_bw_output(stdout)` → bandwidth_gbps float

## 4. IB 延迟测试模块

- [x] 4.1 在 `app/remote/ib_test.py` 中实现单对延迟测试
  - `run_latency_test(server_creds, client_creds, cards)` → list of per-card-per-size results
  - 对每个 size (64/128/256/512) 执行 `ib_write_lat` server/client
  - 解析 t_avg，PASS/FAIL 判定（card pair 需四个 size 全过才 PASS）
- [x] 4.2 实现结果解析函数 `parse_latency_output(stdout)` → avg_latency_us float

## 5. 批量测试模块

- [x] 5.1 在 `app/remote/ib_batch.py` 中实现批量配对逻辑
  - `generate_pairs(hosts_info, mode='dual')` → list of (server, client, cards) tuples
  - 移植 ib-bench 的 `generate_group_combinations` 逻辑
- [x] 5.2 实现无冲突分组
  - `group_pairs_no_conflict(pairs)` → list of groups，每组内无 IP 冲突
- [x] 5.3 实现批量执行引擎
  - `run_batch_test(test_type, pairs_groups, max_concurrent=10)` → task_id
  - 使用 `concurrent.futures.ThreadPoolExecutor` 并行执行
  - 组内并行，组间串行
  - 异步执行，立即返回 task_id

## 6. 测试结果持久化与查询

- [x] 6.1 创建 `app/ib_results_store.py`，管理测试结果存储
  - 任务状态追踪（running/completed/failed）
  - 创建 `ib_test_results/<task_id>/` 目录
  - 写入 `summary.json`：task_id, timestamp, test_type, pairs_results, pass_count, fail_count
  - 写入 `raw_log.txt`：完整命令输出
- [x] 6.2 实现查询函数
  - `list_results()` → list of {task_id, timestamp, type, pass_count, fail_count, status}
  - `get_summary(task_id)` → dict
  - `get_status(task_id)` → status string
  - `get_log_path(task_id)` → file path for download

## 7. API 路由

- [x] 7.1 创建 `app/routers/ib.py`，注册到 main app
- [x] 7.2 `GET /api/ib/{host_id}/cards` — IB 网卡发现
- [x] 7.3 `POST /api/ib/test/bandwidth` — 单对带宽测试，body: {server_id, client_id, bidirectional}
- [x] 7.4 `POST /api/ib/test/latency` — 单对延迟测试，body: {server_id, client_id}
- [x] 7.5 `POST /api/ib/test/batch` — 批量测试，body: {test_type: "bandwidth"|"latency", bidirectional?}
- [x] 7.6 `GET /api/ib/test/batch/{task_id}/status` — 查询批量测试状态
- [x] 7.7 `GET /api/ib/results` — 列出历史测试结果
- [x] 7.8 `GET /api/ib/results/{task_id}/summary` — 某次测试的汇总
- [x] 7.9 `GET /api/ib/results/{task_id}/log` — 下载测试日志

## 8. 前端：IB 网卡页面

- [x] 8.1 侧边栏新增「IB 网卡」导航项
- [x] 8.2 IB 网卡面板：选择主机后调用 `/api/ib/{host_id}/cards`，展示 200G/400G 分组表格

## 9. 前端：IB 测试页面

- [x] 9.1 侧边栏新增「IB 测试」导航项
- [x] 9.2 单对测试 UI：两个主机下拉选择（server/client）、测试类型（带宽/延迟）、双向选项、执行按钮
- [x] 9.3 批量测试 UI：一键批量测试按钮、测试类型选择、执行中状态显示、轮询结果
- [x] 9.4 结果展示区：完成后显示结果表格（配对、速率、数值、PASS/FAIL），统计卡片（总对数/通过/失败）
- [x] 9.5 日志下载：每行结果提供"下载日志"按钮，调用 `/api/ib/results/{task_id}/log`

## 10. 前端：历史结果页面

- [x] 10.1 在 IB 测试面板下方显示历史测试列表
- [x] 10.2 点击某次测试可展开查看详细配对结果
- [x] 10.3 每条历史记录提供日志下载按钮

## 11. 依赖与文档

- [x] 11.1 更新 `requirements.txt`（如有新增依赖）
- [x] 11.2 更新 `README.md`，补充 IB 测试功能说明和远程主机要求
