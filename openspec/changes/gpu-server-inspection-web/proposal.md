# Proposal: GPU Server Inspection Web Tool

## Why

运维和开发需要从浏览器集中查看**远程** GPU 服务器的 NUMA 拓扑、固件版本（GPU/网卡）、服务器版本以及 GPU 各项指标与健康状态。工具在**本地**运行，不向 GPU 服务器部署任何脚本，通过远程连接（如 SSH）执行命令获取信息，避免逐台手动 SSH，提高巡检与排障效率。

## What Changes

- 新增后端服务（**仅部署在本地**）：通过 SSH 等方式连接远程 GPU 服务器，在远程执行 `nvidia-smi`、`numactl`、`lspci` 等命令并解析输出，提供 NUMA 拓扑、固件版本、服务器信息、GPU 指标与巡检结果的查询 API。
- **主机与凭证管理**：支持通过**导入 Excel 表**加载 GPU 服务器列表，表中包含每台服务器的 IP、登录账号、密码等，供后续远程查询使用。
- 新增 Web 前端：在浏览器中展示已加载的主机列表，支持选择目标主机后按模块查询（拓扑、版本、指标）与一键巡检。

## Capabilities

### New Capabilities

- `host-list-import`: 通过导入 Excel 文件加载 GPU 服务器列表（IP、登录账号、密码等）；提供已加载主机列表的查询与展示。
- `numa-topology`: 对指定远程主机查询并展示 NUMA 节点拓扑、CPU/内存/GPU 与 NUMA 节点的归属关系。
- `firmware-versions`: 对指定远程主机查询并展示 GPU 驱动/固件版本、网卡固件版本、服务器/OS 版本等。
- `gpu-metrics-inspection`: 对指定远程主机查询 GPU 各项指标（温度、显存、利用率等）并支持巡检（健康判断与汇总报告）。
- `web-ui`: 提供浏览器可访问的前端页面：导入 Excel 加载主机、选择主机、发起查询、展示结果及执行巡检。

### Modified Capabilities

- （无：本项目为新建，无既有能力变更。）

## Impact

- **新增代码**：后端（Python FastAPI）在本地运行，通过 SSH（如 paramiko）连接远程执行命令；前端（单页 HTML/JS）提供导入 Excel、主机选择与结果展示。
- **依赖**：本地无需安装 nvidia-smi/numactl；远程主机需具备 SSH 及上述命令；后端需 Excel 解析库（如 openpyxl）。
- **部署**：工具**仅在本机**安装与运行，通过浏览器访问；不在任何 GPU 服务器上安装或部署脚本。
