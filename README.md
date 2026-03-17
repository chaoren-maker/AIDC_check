# GPU Server Inspection & IB Bench Web Tool

本地运行的 Web 小工具：通过浏览器导入 Excel 加载远程 GPU 主机列表，选择主机后查询 NUMA 拓扑、固件/版本、GPU 指标，并支持一键巡检。同时集成了 InfiniBand 网络性能测试（IB 网卡发现、带宽/延迟测试、批量测试与结果下载）。

支持三种 SSH 认证方式：**密码认证**、**密钥认证**、**Agent 认证**。

**重要**：本工具**仅在本机**安装与运行，通过 SSH 连接远程 GPU 服务器执行命令获取信息；**不会**在任意 GPU 服务器上安装或部署任何脚本或常驻进程。

## 运行方式（推荐虚拟环境，不影响本机 Python）

使用项目自带虚拟环境，**不修改系统 Python，也不影响本机其他 Python 项目**。

```bash
# 进入项目目录
cd /path/to/gpu_check

# 创建虚拟环境（仅首次需要）
python3 -m venv .venv

# 激活虚拟环境
# Linux / macOS:
source .venv/bin/activate
# Windows:
# .venv\Scripts\activate

# 在虚拟环境中安装依赖
pip install -r requirements.txt

# 启动后端（默认 http://127.0.0.1:8000）
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

或使用脚本一键启动（自动创建/使用 `.venv`，无需先手动激活）：

```bash
./run.sh          # 默认 8000 端口
./run.sh 9000     # 指定端口
```

在浏览器打开 `http://localhost:8000`（或所设端口）即可使用。退出时执行 `deactivate` 即可离开虚拟环境。

## Excel 主机表格式（导入用）

| 列名         | 必填 | 说明 |
|-------------- |------|------|
| `host_ip`    | 是   | 远程 GPU 服务器 IP 或主机名 |
| `username`   | 是   | SSH 登录用户名 |
| `password`   | 否   | SSH 登录密码（密码认证时需要） |
| `auth_type`  | 否   | 认证方式：`password` / `key` / `agent`（留空自动推断） |
| `key_path`   | 否   | SSH 私钥文件路径（密钥认证时需要） |
| `ssh_port`   | 否   | SSH 端口，默认 22 |
| `remark`     | 否   | 备注 |

首行为表头，从第二行起每行一台主机。支持 `.xlsx`。

### 认证方式说明

| 方式 | 使用场景 | 说明 |
|------|---------|------|
| **password** | 有密码的服务器 | Excel 中填写 `password` 列即可，`auth_type` 自动推断 |
| **key** | 密钥登录的服务器 | Excel 中填写 `key_path`，或在 Web 页面主机列表点击🔑按钮上传密钥 |
| **agent** | 已配置 SSH Agent 的服务器 | `password` 和 `key_path` 都不填，自动使用本机 SSH Agent |

上传的密钥文件保存在项目目录 `ssh_keys/`（已加入 `.gitignore`，不会被提交），权限设置为 `0600`。

## InfiniBand 测试功能

### IB 网卡发现
在侧边栏点击「IB 网卡」，选择一台主机后自动通过 SSH 执行 `ibstat` 和 `mst status -vv`，展示 200G/400G InfiniBand 网卡列表（接口名、LID、端口状态）。

### IB 单对测试
在「IB 测试」页面选择 Server 和 Client 两台主机，选择测试类型（带宽 `ib_write_bw` / 延迟 `ib_write_lat`），点击执行后展示每张 IB 卡对的测试结果与 PASS/FAIL 判定。

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

## 依赖说明

- **本机**：仅需 Python 3.8+；依赖全部安装在项目虚拟环境 `.venv` 中，不影响系统自带 Python 及其他项目。无需安装 nvidia 驱动或 nvidia-smi。
- **远程 GPU 主机**：需开放 SSH，并已安装 `nvidia-smi`、`numactl`、`lspci` 等（视 GPU 查询功能而定）。
- **远程 IB 测试主机**：需已安装 InfiniBand 相关工具——`ibstat`、`mst status`（Mellanox MST）、`ib_write_bw`、`ib_write_lat`（通常由 `perftest` 包提供）。
