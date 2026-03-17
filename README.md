# AIDC Inspection — AI 数据中心巡检工具

本地运行的 Web 巡检平台：通过浏览器导入 Excel 加载远程设备列表（GPU / CPU / 交换机 / 安全设备），对设备进行连通性检测、GPU 拓扑/版本/指标查询、DCGMI 诊断、InfiniBand 网络拓扑与性能测试，适用于**新机上架验收**与**日常巡检**。

支持三种 SSH 认证方式：**密码认证**、**密钥认证**、**Agent 认证**。

> **重要**：本工具**仅在本机**安装与运行，通过 SSH 连接远程设备执行命令获取信息；**不会**在任何远程设备上安装或部署脚本或常驻进程。

---

## 功能概览

| 模块 | 功能 | 说明 |
|------|------|------|
| **导入 Excel** | 设备列表导入 | 拖拽或选择文件后**自动导入**，无需手动点击 |
| **设备列表** | 主机管理 | 查看/删除主机，上传 SSH 密钥（密钥认证设备） |
| **连通性检查** | ICMP Ping 批量检测 | 对所有已导入设备进行 Ping 连通性探测（轻量无需 SSH） |
| **GPU 拓扑** | NUMA 拓扑查询 | 通过 SSH 获取 GPU-CPU-NIC 的 NUMA 亲和关系 |
| **版本信息** | 固件/驱动版本 | 查询 nvidia-smi、CUDA、驱动、OS 内核等版本 |
| **指标 & 巡检** | GPU 实时指标 + 阈值巡检 | 查看温度/功耗/显存/利用率，支持阈值告警巡检 |
| **DCGMI 诊断** | GPU 健康诊断 | Level 1 / Level 2 诊断，支持单机和批量模式 |
| **IB 拓扑** | InfiniBand 拓扑查看 | 交换机拓扑与连接关系展示 |
| **IB 网卡** | IB 网卡发现 | 通过 `ibstat` / `mst status` 发现 200G/400G IB 网卡 |
| **IB 测试** | 带宽/延迟性能测试 | 单对测试 + 批量自动配对并行测试，结果可下载 |

---

## 运行方式

使用项目自带虚拟环境，**不修改系统 Python，也不影响本机其他 Python 项目**。

### 一键启动（推荐）

```bash
cd /path/to/AIDC_check
./run.sh          # 默认 8000 端口
./run.sh 9000     # 指定端口
```

脚本会自动创建 `.venv`、安装依赖、启动服务。

### 手动启动

```bash
cd /path/to/AIDC_check
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

启动后浏览器打开 `http://localhost:8000` 即可使用。

---

## Excel 主机表格式

| 列名 | 必填 | 说明 |
|------|------|------|
| `host_ip` | 是 | 远程设备 IP 或主机名 |
| `hostname` | 否 | 设备主机名（显示用） |
| `username` | 是 | SSH 登录用户名 |
| `password` | 否 | SSH 登录密码（密码认证时需要） |
| `device_type` | 否 | 设备类型：`GPU` / `CPU` / `交换机` / `安全设备`（默认 GPU） |
| `auth_type` | 否 | 认证方式：`password` / `key` / `agent`（留空自动推断） |
| `key_path` | 否 | SSH 私钥文件路径（密钥认证时需要） |
| `ssh_port` | 否 | SSH 端口，默认 22 |
| `remark` | 否 | 备注 |

首行为表头，从第二行起每行一台主机。支持 `.xlsx` / `.xls`。

### 认证方式说明

| 方式 | 使用场景 | 说明 |
|------|---------|------|
| **password** | 有密码的服务器 | Excel 中填写 `password` 列即可，`auth_type` 自动推断 |
| **key** | 密钥登录的服务器 | Excel 中填写 `key_path`，或在 Web 页面主机列表点击上传密钥按钮 |
| **agent** | 已配置 SSH Agent 的服务器 | `password` 和 `key_path` 都不填，自动使用本机 SSH Agent |

上传的密钥文件保存在项目目录 `ssh_keys/`（已加入 `.gitignore`，不会被提交），权限设置为 `0600`。

---

## 连通性检查

对所有已导入设备进行 **ICMP Ping** 探测（非 SSH），轻量高效。结果以在线/离线状态展示，方便快速排查网络问题。

---

## GPU 检查

侧边栏「GPU 检查」为可折叠分组，包含以下子功能：

### GPU 拓扑

通过 SSH 执行 `nvidia-smi topo -m` 和 `numactl` 等命令，展示 GPU-CPU-NIC 的 NUMA 亲和关系拓扑。

### 版本信息

查询远程主机的 nvidia-smi、CUDA 版本、GPU 驱动版本、OS 内核版本等信息。

### 指标 & 巡检

- **GPU 指标**：实时查看 GPU 温度、功耗、显存使用率、GPU 利用率等关键指标
- **阈值巡检**：对指标进行阈值检查，超限项高亮告警

### DCGMI 诊断

使用 NVIDIA DCGM（Data Center GPU Manager）对 GPU 进行健康诊断，适用于**新机验收**场景。

- **Level 1 诊断**（快速）：基本部署验证，包括黑名单检查、NVML 库、CUDA 运行时、驱动兼容性等
- **Level 2 诊断**（标准）：在 Level 1 基础上增加 PCIe 带宽、功耗、显存、诊断测试等
- **单机模式**：选择一台主机执行诊断
- **批量模式**：对所有 GPU 设备批量执行诊断，支持后台运行和轮询进度
- **结果持久化**：每次诊断结果保存在 `dcgmi_results/` 目录，包含结构化汇总和原始日志
- **故障排查提示**：Fail / Warn 项自动内联显示常见原因和排查建议

---

## InfiniBand 测试

侧边栏「InfiniBand」为可折叠分组，包含以下子功能：

### IB 拓扑

查看 InfiniBand 交换机拓扑与设备连接关系。

### IB 网卡发现

选择主机后自动通过 SSH 执行 `ibstat` 和 `mst status -vv`，展示 200G/400G InfiniBand 网卡列表（接口名、LID、端口状态）。

### IB 单对测试

选择 Server 和 Client 两台主机，选择测试类型（带宽 `ib_write_bw` / 延迟 `ib_write_lat`），点击执行后展示每张 IB 卡对的测试结果与 PASS/FAIL 判定。

### IB 批量测试

点击「批量测试」按钮，系统将自动使用全部已导入主机进行 Dual 模式配对、无冲突分组、并行执行测试。测试完成后展示汇总结果表格，每条记录可下载完整日志。

### PASS/FAIL 标准

| 测试类型 | 200G | 400G |
|---------|------|------|
| 带宽（单向）| >= 190 Gb/s | >= 380 Gb/s |
| 带宽（双向）| >= 390 Gb/s | >= 760 Gb/s |

| 延迟 | 64B | 128B | 256B | 512B |
|------|-----|------|------|------|
| 阈值 | < 3.0μs | < 3.0μs | < 4.0μs | < 4.0μs |

### 测试日志

每次测试的日志保存在项目目录下 `ib_test_results/<task_id>/`，包含 `summary.json`（结构化汇总）和 `raw_log.txt`（完整命令输出），可通过页面按钮直接下载。

---

## UI 特性

- **深色科技风界面**：渐变背景、毛玻璃卡片、流光标题
- **二级折叠导航**：GPU 检查与 InfiniBand 为一级分组，展开后显示子功能
- **一级按钮青色调、二级按钮紫色调**，视觉层次分明
- **拖拽导入 Excel**：选择或拖拽文件后自动导入，无需手动点击
- **密码认证设备自动隐藏密钥上传按钮**

---

## 依赖说明

- **本机**：仅需 Python 3.8+；依赖全部安装在项目虚拟环境 `.venv` 中，不影响系统自带 Python 及其他项目。无需安装 nvidia 驱动或 nvidia-smi。
- **远程 GPU 主机**：需开放 SSH，并已安装 `nvidia-smi`、`numactl`、`lspci` 等（视 GPU 查询功能而定）。DCGMI 诊断需安装 `dcgmi`（NVIDIA DCGM 工具）。
- **远程 IB 测试主机**：需已安装 InfiniBand 相关工具——`ibstat`、`mst status`（Mellanox MST）、`ib_write_bw`、`ib_write_lat`（通常由 `perftest` 包提供）。

---

## 安全说明

- SSH 密钥文件保存在 `ssh_keys/`，已加入 `.gitignore`
- 测试结果日志（`dcgmi_results/`、`ib_test_results/`）已加入 `.gitignore`
- API 返回的主机列表不包含密码和密钥路径（已脱敏）
- `.gitignore` 已配置通用安全规则：排除 `*.pem`、`*.key`、`*.p12`、`id_rsa*`、`credentials.json`、`.env*` 等敏感文件类型
