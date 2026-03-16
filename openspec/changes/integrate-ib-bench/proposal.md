# Proposal: 集成 ib-bench（InfiniBand 性能测试）到 GPU 巡检平台

## Why

当前 GPU 巡检平台只覆盖 GPU 信息（NUMA、固件、指标、健康巡检），但运维在 GPU 集群中还有一个高频场景：**InfiniBand 网络的带宽与延迟测试**。`ib-bench` 项目已经实现了完整的 IB 网卡发现、NUMA 绑定、并行测速、结果排序与 PASS/FAIL 判定，但它是纯 CLI 工具，无 Web 界面。将其集成到本平台后，运维可以在**同一个浏览器界面**中完成 GPU 巡检 + IB 网络测试，无需切换到命令行。

## What Changes

- **新增后端模块**：将 ib-bench 的核心逻辑（网卡发现 `netcard`、NUMA 采集 `numa_info`、测速执行 `main`、结果解析 `sorted_results`）移植或引用到当前后端，通过 SSH 在远程主机上执行 `ibstat`、`ib_write_bw`、`ib_write_lat` 等命令，不在远程部署脚本。
- **新增 API**：
  - IB 网卡发现：查询远程主机的 InfiniBand 网卡列表（型号、速率、LID、端口状态）。
  - IB 单对测试：在指定的两台主机之间执行带宽或延迟测试，返回结果与 PASS/FAIL。
  - IB 批量测试：基于已导入主机列表，自动配对并批量并行执行 IB 测试（带宽/延迟），完成后返回所有配对的汇总结果。
  - IB 测试结果查询与日志下载：查看历次测试的汇总结果，支持下载完整测试日志文件。
- **新增 Web UI 页面**：在侧边栏新增「IB 网卡」「IB 测试」入口：
  - IB 网卡页面：展示选中主机的 InfiniBand 网卡信息。
  - IB 测试页面：支持单对测试（选择 server/client）和批量测试（自动配对已导入的全部主机），展示结果表格（含 PASS/FAIL），并提供日志下载按钮。
- **复用已有凭证**：IB 测试所需的主机 IP 和 SSH 凭证直接复用已导入的 Excel 主机列表，无需额外配置。
- **新增依赖**：`psutil`（系统资源检测），`pyyaml`（如需 ib-bench 配置兼容）。

## Capabilities

### New Capabilities

- `ib-card-discovery`：查询远程主机的 InfiniBand 网卡列表（型号、速率 200G/400G、LID、端口状态），通过 SSH 执行 `ibstat`/`mst status` 并解析。
- `ib-bandwidth-test`：在两台远程主机之间执行 `ib_write_bw` 带宽测试，支持双向模式，返回每网卡对的带宽结果与 PASS/FAIL 判定。
- `ib-latency-test`：在两台远程主机之间执行 `ib_write_lat` 延迟测试（64/128/256/512B），返回延迟结果与 PASS/FAIL 判定。
- `ib-batch-test`：批量测试——基于已导入主机列表自动配对，并行执行 IB 带宽/延迟测试，返回所有配对的汇总结果。
- `ib-test-results`：测试结果持久化与查询，支持查看历次测试汇总和下载完整测试日志文件。
- `ib-test-ui`：在 Web UI 中新增 IB 网卡查看与 IB 测试页面，支持单对测试与批量测试，展示结果表格（PASS/FAIL），并提供日志下载。

### Modified Capabilities

- `web-ui`：侧边栏导航新增「IB 网卡」和「IB 测试」入口；主机选择逻辑扩展为可选择两台主机（单对测试需要 server + client）；批量测试自动使用全部已导入主机；结果页提供日志下载入口。

## Impact

- **新增代码**：后端新增 `app/remote/ib_cards.py`、`app/remote/ib_test.py`，路由新增 `app/routers/ib.py`。
- **前端**：`static/index.html` 新增两个面板、`static/app.js` 新增对应交互逻辑。
- **依赖**：`requirements.txt` 可能新增 `psutil`、`pyyaml`。
- **远程主机要求**：需已安装 `ibstat`、`ib_write_bw`、`ib_write_lat` 等 RDMA 测试工具（通常 `perftest` 包提供）。
- **ib-bench 源码**：参考 `/Users/pangchao/network_check/ib-bench/src/ib_bench/` 中 `netcard.py`、`main.py`、`config.py`、`sorted_results.py` 的解析逻辑，适配到本项目的 SSH runner + FastAPI 架构中。
