(function () {
  let selectedHostId = null;
  let selectedHostLabel = '';
  let selectedFile = null;
  const PHASE1_ENABLED = (() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('phase1') !== 'off' && p.get('legacy') !== '1';
  })();

  const els = {
    selectedHostBadge: document.getElementById('selected-host-badge'),
    fileInput: document.getElementById('excel-file'),
    fileName: document.getElementById('selected-file-name'),
    dropzone: document.getElementById('upload-dropzone'),
    importResult: document.getElementById('import-result'),
    hostListWrap: document.getElementById('host-list-wrap'),
    metricsDashboard: document.getElementById('metrics-dashboard-placeholder'),
  };

  function escapeHtml(text) {
    return String(text ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function setSelectedHostBadge() {
    if (selectedHostId === null) {
      els.selectedHostBadge.textContent = '未选择';
      return;
    }
    els.selectedHostBadge.textContent = selectedHostLabel || `Host ID: ${selectedHostId}`;
  }

  function showPanel(panelId) {
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('visible'));
    document.querySelectorAll('.panel-switch').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel-switch-sub').forEach((b) => b.classList.remove('active'));

    const panel = document.getElementById(`panel-${panelId}`);
    if (panel) {
      panel.classList.add('visible');
    }

    const navBtn = document.querySelector(`.panel-switch[data-panel="${panelId}"], .panel-switch-sub[data-panel="${panelId}"]`);
    if (navBtn) {
      navBtn.classList.add('active');
      const group = navBtn.closest('.nav-group-items');
      if (group && group.classList.contains('collapsed')) {
        group.classList.remove('collapsed');
        const toggle = group.previousElementSibling;
        if (toggle) toggle.classList.add('open');
      }
    }

    if (panelId === 'hosts') refreshHostList();
    if (panelId === 'connectivity') { /* manual trigger via button */ }
    if (panelId === 'numa' && selectedHostId !== null) loadNuma();
    if (panelId === 'versions' && selectedHostId !== null) loadVersions();
    if (panelId === 'metrics' && selectedHostId !== null) loadMetrics();
    if (panelId === 'dcgmi') loadDcgmiHistory();
    if (panelId === 'ib-topo') loadIbTopo();
    if (panelId === 'ib-cards' && selectedHostId !== null) loadIbCards();
    if (panelId === 'ib-test') { populateIbHostSelects(); loadIbHistory(); }
    if (panelId === 'eth-test') { populateEthHostSelects(); loadEthHistory(); }
    if (panelId === 'dashboard' && PHASE1_ENABLED) startDashboardAutoRefresh();
    if (panelId !== 'dashboard') stopDashboardAutoRefresh();
    if (panelId === 'logs' && PHASE1_ENABLED) loadUnifiedLogs();
    if (panelId === 'oneclick' && PHASE1_ENABLED) initOneclickPanel();
  }

  document.querySelectorAll('.panel-switch[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      showPanel(btn.getAttribute('data-panel'));
    });
  });

  document.querySelectorAll('.panel-switch-sub[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      showPanel(btn.getAttribute('data-panel'));
    });
  });

  document.querySelectorAll('.nav-group-toggle[data-group]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const groupId = toggle.getAttribute('data-group');
      const items = document.getElementById(groupId);
      if (!items) return;
      const isCollapsed = items.classList.contains('collapsed');
      items.classList.toggle('collapsed', !isCollapsed);
      toggle.classList.toggle('open', isCollapsed);
    });
  });

  function apiGet(path) {
    return fetch(path).then((resp) => {
      if (!resp.ok) {
        return resp
          .json()
          .then((payload) => Promise.reject(new Error(payload.detail || resp.statusText)));
      }
      return resp.json();
    });
  }

  function apiPost(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((resp) => {
      if (!resp.ok) {
        return resp
          .json()
          .then((payload) => Promise.reject(new Error(payload.detail || resp.statusText)));
      }
      return resp.json();
    });
  }

  function showFeedback(el, message, type) {
    el.innerHTML = `<div class="feedback ${type}">${escapeHtml(message || '')}</div>`;
  }

  function buildTable(headers, rows, rowClassResolver, rawHtml) {
    const th = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const body = rows
      .map((row, idx) => {
        const cls = rowClassResolver ? rowClassResolver(row, idx) : '';
        const cells = row.map((c) => rawHtml ? `<td class="mono">${c}</td>` : `<td class="mono">${escapeHtml(c)}</td>`).join('');
        return `<tr class="${cls}">${cells}</tr>`;
      })
      .join('');
    return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function renderGauge(label, value, color) {
    const pct = Math.max(0, Math.min(100, Number(value || 0)));
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (pct / 100) * circumference;
    return `
      <div class="gauge-card">
        <div class="text-xs text-slate-400 mb-1">${escapeHtml(label)}</div>
        <svg width="96" height="96" viewBox="0 0 96 96" class="mx-auto">
          <circle cx="48" cy="48" r="36" fill="none" stroke="rgba(100,116,139,0.3)" stroke-width="8"/>
          <circle cx="48" cy="48" r="36" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" transform="rotate(-90 48 48)"/>
          <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#e2e8f0" font-size="16" class="mono">${pct}%</text>
        </svg>
      </div>
    `;
  }

  function refreshHostList() {
    apiGet('/api/hosts')
      .then((data) => {
        const hosts = data.hosts || [];
        if (hosts.length === 0) {
          els.hostListWrap.innerHTML = '<p class="text-slate-400">暂无主机，请先在「导入 Excel」中上传。</p>';
          return;
        }

        const authBadge = (t) => {
          const map = { password: '密码', key: '密钥', agent: 'Agent' };
          const colors = { password: 'badge-pass', key: 'badge-key', agent: 'badge-agent' };
          const label = map[t] || t || '密码';
          const cls = colors[t] || 'badge-pass';
          return `<span class="${cls}">${escapeHtml(label)}</span>`;
        };

        const dtBadge = (t) => {
          const m = { GPU: 'badge-pass', CPU: 'badge-key', '交换机': 'badge-agent' };
          const cls = m[t] || 'badge-pass';
          return `<span class="${cls}">${escapeHtml(t || 'GPU')}</span>`;
        };

        const rows = hosts.map((host) => [
          host.id,
          `<span class="status-dot" id="dot-${host.id}"></span>`,
          host.hostname || '-',
          host.host_ip || '',
          dtBadge(host.device_type),
          host.username || '',
          authBadge(host.auth_type),
          host.ssh_port || 22,
          host.remark || '-',
          (host.auth_type !== 'password'
            ? `<button class="key-upload-btn" data-host-id="${host.id}" title="上传 SSH 私钥文件">上传密钥</button>`
            : '') +
          `<button class="del-host-btn" data-host-id="${host.id}" title="移除此主机">删除</button>`,
        ]);

        const html = buildTable(
          ['ID', '状态', '主机名', 'IP', '类型', '用户名', '认证', '端口', '备注', '操作'],
          rows,
          (row) => (Number(row[0]) === selectedHostId ? 'selected host-row' : 'host-row'),
          true
        );

        els.hostListWrap.innerHTML = html;

        els.hostListWrap.querySelectorAll('.key-upload-btn').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            triggerKeyUpload(Number(btn.getAttribute('data-host-id')));
          });
        });

        els.hostListWrap.querySelectorAll('.del-host-btn').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const hid = Number(btn.getAttribute('data-host-id'));
            if (!confirm(`确认删除主机 ID ${hid}？`)) return;
            fetch(`/api/hosts/${hid}`, { method: 'DELETE' })
              .then((r) => r.json())
              .then(() => { if (selectedHostId === hid) { selectedHostId = null; selectedHostLabel = ''; setSelectedHostBadge(); } refreshHostList(); })
              .catch((err) => alert('删除失败: ' + err.message));
          });
        });

        els.hostListWrap.querySelectorAll('tbody tr').forEach((tr, idx) => {
          tr.style.cursor = 'pointer';
          tr.addEventListener('click', () => {
            const host = hosts[idx];
            if (!host) return;
            selectedHostId = host.id;
            selectedHostLabel = host.hostname
              ? `${host.hostname} (${host.host_ip})`
              : host.host_ip;
            setSelectedHostBadge();
            refreshHostList();
          });
        });

        hosts.forEach((host) => {
          const dot = document.getElementById(`dot-${host.id}`);
          if (dot) dot.className = 'status-dot checking';
          fetch(`/api/hosts/${host.id}/ping`)
            .then((r) => r.json())
            .then((d) => {
              if (dot) dot.className = d.online ? 'status-dot online' : 'status-dot offline';
            })
            .catch(() => { if (dot) dot.className = 'status-dot offline'; });
        });
      })
      .catch((err) => {
        showFeedback(els.hostListWrap, err.message, 'error');
      });
  }

  function triggerKeyUpload(hostId) {
    const keyInput = document.getElementById('key-file-input');
    keyInput.onchange = async () => {
      const file = keyInput.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const resp = await fetch(`/api/hosts/${hostId}/upload-key`, { method: 'POST', body: fd });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || 'Upload failed');
        refreshHostList();
      } catch (e) {
        alert('密钥上传失败: ' + e.message);
      } finally {
        keyInput.value = '';
      }
    };
    keyInput.click();
  }

  function setHint(hintId) {
    const hint = document.getElementById(hintId);
    if (!hint) return false;
    if (selectedHostId === null) {
      hint.textContent = '请先在左侧「主机列表」中选择一台主机。';
      return false;
    }
    hint.textContent = `当前主机 ID: ${selectedHostId}`;
    return true;
  }

  function loadNuma() {
    const content = document.getElementById('numa-content');
    if (!content || !setHint('numa-hint')) {
      if (content) content.innerHTML = '';
      return;
    }

    content.innerHTML = '<p class="text-slate-400">加载中...</p>';
    apiGet(`/api/hosts/${selectedHostId}/numa-topology`)
      .then((data) => {
        if (data.raw_unavailable) {
          content.innerHTML = '<p class="text-slate-400">远程主机未安装 nvidia-smi 或执行失败。</p>';
          return;
        }
        const sections = [];

        // GPU / NUMA affinity summary
        if (Array.isArray(data.gpus) && data.gpus.length > 0) {
          const rows = data.gpus.map((g) => [
            g.device || '-',
            g.numa_node != null ? g.numa_node : 'N/A',
            g.cpu_affinity || '-',
          ]);
          sections.push(`<h3 class="text-lg font-bold mb-2">GPU / NUMA 绑定</h3>${buildTable(['GPU', 'NUMA 节点', 'CPU Affinity'], rows)}`);
        }

        // Full topology matrix
        const headers = data.headers || [];
        const rows = data.rows || [];
        if (headers.length > 0 && rows.length > 0) {
          const connColor = (v) => {
            if (v === 'X') return 'color:#94a3b8';
            if (v && v.startsWith('NV')) return 'color:#4ade80;font-weight:700';
            if (v === 'PIX' || v === 'PXB') return 'color:#67e8f9';
            if (v === 'NODE') return 'color:#fbbf24';
            if (v === 'SYS') return 'color:#f87171';
            return '';
          };

          let th = '<th></th>' + headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('') +
                   '<th>CPU Affinity</th><th>NUMA</th>';
          let body = rows.map((r) => {
            let cells = `<td class="mono" style="font-weight:700;color:#a5f3fc">${escapeHtml(r.device)}</td>`;
            headers.forEach((h) => {
              const v = (r.connections || {})[h] || '-';
              cells += `<td class="mono" style="${connColor(v)}">${escapeHtml(v)}</td>`;
            });
            cells += `<td class="mono">${escapeHtml(r.cpu_affinity || '-')}</td>`;
            cells += `<td class="mono">${escapeHtml(r.numa_affinity || '-')}</td>`;
            return `<tr>${cells}</tr>`;
          }).join('');

          sections.push(
            `<h3 class="text-lg font-bold mt-6 mb-2">拓扑矩阵 (nvidia-smi topo -m)</h3>` +
            `<div class="table-wrap"><table style="font-size:12px"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`
          );
        }

        // Legend
        const legend = data.legend || {};
        const legendKeys = Object.keys(legend);
        if (legendKeys.length > 0) {
          let legendHtml = '<div class="mt-4 p-4 rounded-xl border border-slate-700/50 bg-slate-900/40"><h4 class="text-sm font-bold mb-2 text-slate-300">Legend</h4>';
          legendHtml += '<div class="grid gap-1 text-xs text-slate-400">';
          legendKeys.forEach((k) => {
            legendHtml += `<div><span class="mono text-cyan-300 mr-2">${escapeHtml(k)}</span>${escapeHtml(legend[k])}</div>`;
          });
          legendHtml += '</div></div>';
          sections.push(legendHtml);
        }

        // NIC Legend
        const nicLegend = data.nic_legend || {};
        const nicKeys = Object.keys(nicLegend);
        if (nicKeys.length > 0) {
          let nicHtml = '<div class="mt-3 p-4 rounded-xl border border-slate-700/50 bg-slate-900/40"><h4 class="text-sm font-bold mb-2 text-slate-300">NIC Legend</h4>';
          nicHtml += '<div class="grid grid-cols-2 md:grid-cols-4 gap-1 text-xs text-slate-400">';
          nicKeys.forEach((k) => {
            nicHtml += `<div><span class="mono text-purple-300">${escapeHtml(k)}</span>: <span class="mono">${escapeHtml(nicLegend[k])}</span></div>`;
          });
          nicHtml += '</div></div>';
          sections.push(nicHtml);
        }

        content.innerHTML = sections.join('') || '<p class="text-slate-400">无数据。</p>';
      })
      .catch((err) => showFeedback(content, err.message, 'error'));
  }

  function loadVersions() {
    const content = document.getElementById('versions-content');
    if (!content || !setHint('versions-hint')) {
      if (content) content.innerHTML = '';
      return;
    }

    content.innerHTML = '<p class="text-slate-400">加载中...</p>';
    apiGet(`/api/hosts/${selectedHostId}/versions`)
      .then((data) => {
        const gpu = data.gpu || {};
        const nics = data.nics || [];
        const server = data.server || {};

        const gpuRows = (gpu.gpus || []).map((g, idx) => [
          idx,
          g.name || '-',
          g.driver_version || gpu.driver_version || '-',
          g.vbios_version || '-',
        ]);
        const nicRows = nics.map((n) => [n.device || '-', n.firmware_version || '未知', n.subsystem || '-']);
        const serverRows = [[server.kernel || '-', server.distro || '-', server.version_id || '-']];

        const blocks = [
          `<h3 class="text-lg font-bold mb-2">GPU 固件/驱动</h3>${gpuRows.length ? buildTable(['GPU', '型号', '驱动版本', 'VBIOS'], gpuRows) : '<p class="text-slate-400">无 GPU 信息</p>'}`,
          `<h3 class="text-lg font-bold mt-6 mb-2">网卡固件</h3>${nicRows.length ? buildTable(['设备', '固件版本', '子系统'], nicRows) : '<p class="text-slate-400">无网卡信息</p>'}`,
          `<h3 class="text-lg font-bold mt-6 mb-2">服务器 / OS</h3>${buildTable(['Kernel', 'Distribution', 'Version'], serverRows)}`,
        ];

        content.innerHTML = blocks.join('');
      })
      .catch((err) => showFeedback(content, err.message, 'error'));
  }

  function loadMetrics() {
    const content = document.getElementById('metrics-content');
    if (!content || !setHint('metrics-hint')) {
      if (content) content.innerHTML = '';
      els.metricsDashboard.innerHTML = '';
      return;
    }

    content.innerHTML = '<p class="text-slate-400">加载中...</p>';
    apiGet(`/api/hosts/${selectedHostId}/gpu/metrics`)
      .then((data) => {
        const gpus = data.gpus || [];
        if (gpus.length === 0) {
          content.innerHTML = '<p class="text-slate-400">无 GPU 数据</p>';
          els.metricsDashboard.innerHTML = '';
          return;
        }

        const avgTemp = Math.round(gpus.reduce((sum, g) => sum + Number(g.temperature_gpu || 0), 0) / gpus.length);
        const avgGpuUtil = Math.round(gpus.reduce((sum, g) => sum + Number(g.utilization_gpu_percent || 0), 0) / gpus.length);
        const avgMemUtil = Math.round(gpus.reduce((sum, g) => sum + Number(g.memory_used_percent || 0), 0) / gpus.length);

        els.metricsDashboard.innerHTML =
          renderGauge('平均温度占比', Math.min(100, Math.round((avgTemp / 100) * 100)), '#22d3ee') +
          renderGauge('平均 GPU 利用率', avgGpuUtil, '#8b5cf6') +
          renderGauge('平均显存占用率', avgMemUtil, '#38bdf8');

        const rows = gpus.map((g) => [
          g.index != null ? g.index : '-',
          g.name || '-',
          g.temperature_gpu != null ? g.temperature_gpu : '-',
          `${g.memory_used_mb != null ? g.memory_used_mb : '-'} / ${g.memory_total_mb != null ? g.memory_total_mb : '-'}`,
          g.memory_used_percent != null ? g.memory_used_percent : '-',
          g.utilization_gpu_percent != null ? g.utilization_gpu_percent : '-',
          g.utilization_memory_percent != null ? g.utilization_memory_percent : '-',
        ]);

        content.innerHTML = buildTable(
          ['索引', '型号', '温度(℃)', '显存(MB)', '显存使用率%', 'GPU 利用率%', '显存带宽利用率%'],
          rows
        );
      })
      .catch((err) => {
        els.metricsDashboard.innerHTML = '';
        showFeedback(content, err.message, 'error');
      });
  }

  function runInspection() {
    const content = document.getElementById('inspection-content');
    if (!content) return;
    if (selectedHostId === null) {
      showFeedback(content, '请先在「设备列表」中选择一台主机', 'error');
      return;
    }

    content.innerHTML = '<p class="text-slate-400">巡检执行中...</p>';
    apiGet(`/api/hosts/${selectedHostId}/gpu/inspection`)
      .then((data) => {
        const summary = data.summary || {};
        const gpus = data.gpus || [];

        const summaryCards = `
          <div class="grid md:grid-cols-4 gap-3 mb-5">
            <div class="gauge-card"><div class="text-xs text-slate-400">总 GPU</div><div class="text-2xl font-bold mono">${summary.total || 0}</div></div>
            <div class="gauge-card"><div class="text-xs text-slate-400">正常</div><div class="text-2xl font-bold text-emerald-300 mono">${summary.ok || 0}</div></div>
            <div class="gauge-card"><div class="text-xs text-slate-400">警告</div><div class="text-2xl font-bold text-amber-300 mono">${summary.warning || 0}</div></div>
            <div class="gauge-card"><div class="text-xs text-slate-400">异常</div><div class="text-2xl font-bold text-rose-300 mono">${summary.error || 0}</div></div>
          </div>
        `;

        const rows = gpus.map((g) => [
          g.index != null ? g.index : '-',
          g.name || '-',
          g.inspection_status || '-',
          g.temperature_gpu != null ? g.temperature_gpu : '-',
          g.memory_used_percent != null ? g.memory_used_percent : '-',
        ]);

        const table = rows.length
          ? buildTable(['索引', '型号', '状态', '温度(℃)', '显存占比%'], rows)
          : '<p class="text-slate-400">无巡检数据</p>';

        content.innerHTML = summaryCards + table;
      })
      .catch((err) => showFeedback(content, err.message, 'error'));
  }

  function setSelectedFile(file) {
    selectedFile = file || null;
    els.fileName.textContent = selectedFile ? selectedFile.name : '尚未选择文件';
  }

  function doImportFile(file) {
    if (!file) return;
    showFeedback(els.importResult, '正在导入…', 'info');
    const fd = new FormData();
    fd.append('file', file);

    fetch('/api/hosts/import', { method: 'POST', body: fd })
      .then((resp) => {
        if (!resp.ok) {
          return resp
            .json()
            .then((payload) => Promise.reject(new Error(payload.detail || resp.statusText)));
        }
        return resp.json();
      })
      .then((data) => {
        showFeedback(els.importResult, data.message || '导入成功', 'success');
        setSelectedFile(null);
        els.fileInput.value = '';
        refreshHostList();
        showPanel('hosts');
      })
      .catch((err) => {
        showFeedback(els.importResult, err.message, 'error');
      });
  }

  function setupUploadDnD() {
    const pickBtn = document.getElementById('btn-pick-file');

    pickBtn.addEventListener('click', () => els.fileInput.click());

    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      if (file) {
        setSelectedFile(file);
        doImportFile(file);
      }
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      els.dropzone.addEventListener(eventName, (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        els.dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      els.dropzone.addEventListener(eventName, (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        els.dropzone.classList.remove('dragover');
      });
    });

    els.dropzone.addEventListener('drop', (evt) => {
      const files = evt.dataTransfer && evt.dataTransfer.files;
      if (!files || !files[0]) return;
      els.fileInput.files = files;
      setSelectedFile(files[0]);
      doImportFile(files[0]);
    });
  }

  document.getElementById('btn-run-inspection').addEventListener('click', runInspection);

  document.getElementById('btn-clear-hosts').addEventListener('click', () => {
    if (!confirm('确认清空全部主机？')) return;
    fetch('/api/hosts', { method: 'DELETE' })
      .then((r) => r.json())
      .then(() => { selectedHostId = null; selectedHostLabel = ''; setSelectedHostBadge(); refreshHostList(); })
      .catch((err) => alert('清空失败: ' + err.message));
  });

  // =========================================================================
  // IB Cards
  // =========================================================================

  function loadIbCards() {
    const content = document.getElementById('ib-cards-content');
    if (!content || !setHint('ib-cards-hint')) {
      if (content) content.innerHTML = '';
      return;
    }
    content.innerHTML = '<p class="text-slate-400">加载中...</p>';
    apiGet(`/api/ib/${selectedHostId}/cards`)
      .then((data) => {
        const sections = [];
        for (const speed of ['400G', '200G']) {
          const cards = data[speed] || [];
          if (cards.length === 0) continue;
          const rows = cards.map((c) => [c.interface || '-', speed, c.lid || '-', c.ca_type || '-', c.state || '-']);
          sections.push(
            `<h3 class="text-lg font-bold mb-2 ${sections.length ? 'mt-6' : ''}">${speed} 网卡 (${cards.length})</h3>` +
            buildTable(['接口', '速率', 'LID', 'CA Type', '端口状态'], rows)
          );
        }
        content.innerHTML = sections.length
          ? sections.join('')
          : '<p class="text-slate-400">未发现 InfiniBand 网卡（ibstat 未安装或无 IB 卡）。</p>';
      })
      .catch((err) => showFeedback(content, err.message, 'error'));
  }

  // =========================================================================
  // IB Test — host selects
  // =========================================================================

  function populateIbHostSelects() {
    apiGet('/api/hosts')
      .then((data) => {
        const hosts = data.hosts || [];
        const serverSel = document.getElementById('ib-server-select');
        const clientSel = document.getElementById('ib-client-select');
        const optHtml = hosts.map((h) => {
          const label = h.hostname ? `${h.hostname} (${h.host_ip})` : `${h.host_ip} (ID:${h.id})`;
          return `<option value="${h.id}">${escapeHtml(label)}</option>`;
        }).join('');
        serverSel.innerHTML = optHtml || '<option disabled>请先导入主机</option>';
        clientSel.innerHTML = optHtml || '<option disabled>请先导入主机</option>';
        if (hosts.length >= 2) {
          clientSel.selectedIndex = 1;
        }
        loadIbCardOptions('ib-server-select', 'ib-server-card');
        loadIbCardOptions('ib-client-select', 'ib-client-card');
      })
      .catch(() => {});
  }

  function loadIbCardOptions(hostSelectId, cardSelectId) {
    const hostSel = document.getElementById(hostSelectId);
    const cardSel = document.getElementById(cardSelectId);
    if (!hostSel || !cardSel) return;

    const fillCards = () => {
      const hostId = hostSel.value;
      cardSel.innerHTML = '<option value="">加载中...</option>';
      if (!hostId) { cardSel.innerHTML = '<option value="">全部（自动配对）</option>'; return; }
      apiGet(`/api/ib/${hostId}/cards`)
        .then((data) => {
          let opts = '<option value="">全部（自动配对）</option>';
          for (const speed of ['400G', '200G']) {
            const cards = data[speed] || [];
            cards.forEach((c) => {
              const label = `${c.interface} [${speed}] ${c.state || ''}`;
              opts += `<option value="${escapeHtml(c.interface)}" data-speed="${speed}">${escapeHtml(label)}</option>`;
            });
          }
          cardSel.innerHTML = opts;
        })
        .catch(() => { cardSel.innerHTML = '<option value="">获取失败</option>'; });
    };

    hostSel.addEventListener('change', fillCards);
    fillCards();
  }

  // =========================================================================
  // IB Test — single pair
  // =========================================================================

  document.getElementById('btn-ib-single-test').addEventListener('click', () => {
    const serverVal = document.getElementById('ib-server-select').value;
    const clientVal = document.getElementById('ib-client-select').value;
    const serverId = serverVal !== '' ? Number(serverVal) : null;
    const clientId = clientVal !== '' ? Number(clientVal) : null;
    const serverDev = document.getElementById('ib-server-card').value || null;
    const clientDev = document.getElementById('ib-client-card').value || null;
    const testType = document.getElementById('ib-test-type').value;
    const bidirectional = document.getElementById('ib-bidirectional').checked;
    const resultEl = document.getElementById('ib-single-result');

    if (serverId == null || clientId == null) {
      showFeedback(resultEl, '请选择 Server 和 Client 主机', 'error');
      return;
    }
    if (serverId === clientId) {
      showFeedback(resultEl, 'Server 和 Client 不能是同一台主机', 'error');
      return;
    }

    const abortCtrl = new AbortController();
    resultEl.innerHTML =
      '<div class="ib-running"><div class="spinner"></div>测试执行中，请稍候...' +
      '<button class="cancel-btn" id="btn-cancel-single">取消</button></div>';

    document.getElementById('btn-cancel-single').addEventListener('click', () => {
      abortCtrl.abort();
      resultEl.innerHTML = '<div class="feedback error">测试已取消</div>';
    });

    const body = { server_id: serverId, client_id: clientId };
    if (serverDev) body.server_dev = serverDev;
    if (clientDev) body.client_dev = clientDev;
    if (testType === 'bandwidth') body.bidirectional = bidirectional;

    fetch(`/api/ib/test/${testType}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortCtrl.signal,
    })
      .then((r) => { if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.detail || r.statusText))); return r.json(); })
      .then((data) => { resultEl.innerHTML = renderTestResult(data); })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        showFeedback(resultEl, err.message, 'error');
      });
  });

  // =========================================================================
  // IB Test — batch
  // =========================================================================

  document.getElementById('btn-ib-batch-test').addEventListener('click', () => {
    const testType = document.getElementById('ib-batch-type').value;
    const bidirectional = document.getElementById('ib-batch-bidir').checked;
    const statusEl = document.getElementById('ib-batch-status');
    const resultEl = document.getElementById('ib-batch-result');

    statusEl.innerHTML = '<div class="ib-running"><div class="spinner"></div>正在启动批量测试...</div>';
    resultEl.innerHTML = '';

    apiPost('/api/ib/test/batch', { test_type: testType, bidirectional })
      .then((data) => {
        const taskId = data.task_id;
        statusEl.innerHTML = `<div class="ib-running"><div class="spinner"></div>批量测试进行中 (ID: ${escapeHtml(taskId)})...</div>`;
        pollBatchStatus(taskId, statusEl, resultEl);
      })
      .catch((err) => showFeedback(statusEl, err.message, 'error'));
  });

  function pollBatchStatus(taskId, statusEl, resultEl) {
    const poll = () => {
      apiGet(`/api/ib/test/batch/${taskId}/status`)
        .then((s) => {
          if (s.status === 'running') {
            statusEl.innerHTML = `<div class="ib-running"><div class="spinner"></div>批量测试进行中 (${s.completed_pairs}/${s.total_pairs} 对完成)...</div>`;
            setTimeout(poll, 3000);
          } else if (s.status === 'completed') {
            statusEl.innerHTML = `<div class="feedback success">批量测试完成</div>`;
            apiGet(`/api/ib/results/${taskId}/summary`)
              .then((summary) => {
                resultEl.innerHTML = renderBatchSummary(summary);
                loadIbHistory();
              })
              .catch((err) => showFeedback(resultEl, err.message, 'error'));
          } else {
            statusEl.innerHTML = `<div class="feedback error">批量测试失败: ${escapeHtml(s.error || 'unknown')}</div>`;
          }
        })
        .catch((err) => {
          statusEl.innerHTML = `<div class="feedback error">查询状态失败: ${escapeHtml(err.message)}</div>`;
        });
    };
    setTimeout(poll, 3000);
  }

  // =========================================================================
  // Result rendering helpers
  // =========================================================================

  function passBadge(passed) {
    return passed ? '<span class="badge-pass">PASS</span>' : '<span class="badge-fail">FAIL</span>';
  }

  function renderTestResult(data) {
    if (!data || !data.pairs || data.pairs.length === 0) {
      return '<p class="text-slate-400">无测试结果（未找到匹配的 IB 网卡对）。</p>';
    }

    const taskId = data.task_id || '';
    let html = '';

    if (data.test_type === 'bandwidth') {
      const rows = data.pairs.map((p) => [
        `${data.server_ip}:${p.server_dev}`,
        `${data.client_ip}:${p.client_dev}`,
        p.speed || '-',
        p.server_bw_gbps != null ? p.server_bw_gbps.toFixed(2) : '-',
        p.client_bw_gbps != null ? p.client_bw_gbps.toFixed(2) : '-',
        p.threshold_gbps || '-',
      ]);

      html += buildTableWithBadge(
        ['Server', 'Client', 'IB速率', 'Server BW(Gb/s)', 'Client BW(Gb/s)', '阈值(Gb/s)', '结果'],
        rows,
        data.pairs.map((p) => p.passed)
      );
    } else {
      let rows = [];
      for (const pair of data.pairs) {
        for (const sz of (pair.sizes || [])) {
          rows.push({
            cells: [
              `${data.server_ip}:${pair.server_dev}`,
              `${data.client_ip}:${pair.client_dev}`,
              pair.speed || '-',
              sz.size_bytes + 'B',
              sz.t_avg_us != null ? sz.t_avg_us.toFixed(2) : '-',
              sz.threshold_us || '-',
            ],
            passed: sz.passed,
          });
        }
      }
      html += buildTableWithBadge(
        ['Server', 'Client', 'IB速率', '消息大小', '延迟(μs)', '阈值(μs)', '结果'],
        rows.map((r) => r.cells),
        rows.map((r) => r.passed)
      );
    }

    if (taskId) {
      html += `<div class="mt-3"><button class="dl-btn" onclick="window.open('/api/ib/results/${escapeHtml(taskId)}/log','_blank')">下载日志</button></div>`;
    }

    return html;
  }

  function renderBatchSummary(summary) {
    if (!summary) return '<p class="text-slate-400">无汇总数据</p>';

    const passCount = summary.pass_count || 0;
    const failCount = summary.fail_count || 0;
    const total = passCount + failCount;

    let html = `
      <div class="stats-row">
        <div class="stat-card"><div class="text-xs text-slate-400">总测试对</div><div class="text-2xl font-bold mono">${total}</div></div>
        <div class="stat-card"><div class="text-xs text-slate-400">通过</div><div class="text-2xl font-bold text-emerald-300 mono">${passCount}</div></div>
        <div class="stat-card"><div class="text-xs text-slate-400">失败</div><div class="text-2xl font-bold text-rose-300 mono">${failCount}</div></div>
        <div class="stat-card"><div class="text-xs text-slate-400">测试类型</div><div class="text-sm font-semibold text-cyan-300">${escapeHtml(summary.test_type || '-')}</div></div>
      </div>
    `;

    const results = summary.results || [];
    if (summary.test_type === 'bandwidth') {
      const rows = [];
      const passedArr = [];
      for (const r of results) {
        for (const p of (r.pairs || [])) {
          rows.push([
            `${r.server_ip}:${p.server_dev}`,
            `${r.client_ip}:${p.client_dev}`,
            p.speed || '-',
            p.server_bw_gbps != null ? Number(p.server_bw_gbps).toFixed(2) : '-',
            p.client_bw_gbps != null ? Number(p.client_bw_gbps).toFixed(2) : '-',
            p.threshold_gbps || '-',
          ]);
          passedArr.push(p.passed);
        }
      }
      if (rows.length) {
        html += buildTableWithBadge(
          ['Server', 'Client', 'IB速率', 'Server BW(Gb/s)', 'Client BW(Gb/s)', '阈值(Gb/s)', '结果'],
          rows, passedArr
        );
      }
    } else {
      const rows = [];
      const passedArr = [];
      for (const r of results) {
        for (const pair of (r.pairs || [])) {
          for (const sz of (pair.sizes || [])) {
            rows.push([
              `${r.server_ip}:${pair.server_dev}`,
              `${r.client_ip}:${pair.client_dev}`,
              pair.speed || '-',
              sz.size_bytes + 'B',
              sz.t_avg_us != null ? Number(sz.t_avg_us).toFixed(2) : '-',
              sz.threshold_us || '-',
            ]);
            passedArr.push(sz.passed);
          }
        }
      }
      if (rows.length) {
        html += buildTableWithBadge(
          ['Server', 'Client', 'IB速率', '消息大小', '延迟(μs)', '阈值(μs)', '结果'],
          rows, passedArr
        );
      }
    }

    const taskId = summary.task_id || '';
    if (taskId) {
      html += `<div class="mt-3"><button class="dl-btn" onclick="window.open('/api/ib/results/${escapeHtml(taskId)}/log','_blank')">下载完整日志</button></div>`;
    }

    return html;
  }

  function buildTableWithBadge(headers, rows, passedArr) {
    const th = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const body = rows
      .map((row, idx) => {
        const badge = passBadge(passedArr[idx]);
        const cls = passedArr[idx] ? '' : 'style="background: rgba(127,29,29,0.1)"';
        return `<tr ${cls}>${row.map((c) => `<td class="mono">${escapeHtml(c)}</td>`).join('')}<td>${badge}</td></tr>`;
      })
      .join('');
    return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // =========================================================================
  // IB History
  // =========================================================================

  function loadIbHistory() {
    const listEl = document.getElementById('ib-history-list');
    if (!listEl) return;
    apiGet('/api/ib/results')
      .then((items) => {
        if (!items || items.length === 0) {
          listEl.innerHTML = '<p class="text-slate-400">暂无历史测试记录。</p>';
          return;
        }
        const rows = items.map((item) => [
          item.task_id || '-',
          item.test_type || '-',
          item.started_at ? item.started_at.replace('T', ' ').substring(0, 19) : '-',
          item.status || '-',
          String(item.pass_count || 0),
          String(item.fail_count || 0),
        ]);
        const th = ['任务ID', '类型', '时间', '状态', '通过', '失败', '操作']
          .map((h) => `<th>${escapeHtml(h)}</th>`).join('');
        const body = items.map((item, idx) => {
          const r = rows[idx];
          return `<tr class="history-row" data-task-id="${escapeHtml(item.task_id || '')}">
            ${r.map((c) => `<td class="mono">${escapeHtml(c)}</td>`).join('')}
            <td><button class="dl-btn" onclick="event.stopPropagation();window.open('/api/ib/results/${escapeHtml(item.task_id || '')}/log','_blank')">日志</button></td>
          </tr>`;
        }).join('');
        listEl.innerHTML = `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;

        listEl.querySelectorAll('.history-row').forEach((tr) => {
          tr.addEventListener('click', () => {
            const taskId = tr.getAttribute('data-task-id');
            if (taskId) loadHistoryDetail(taskId);
          });
        });
      })
      .catch(() => {
        listEl.innerHTML = '';
      });
  }

  function loadHistoryDetail(taskId) {
    const detailEl = document.getElementById('ib-history-detail');
    if (!detailEl) return;
    detailEl.innerHTML = '<p class="text-slate-400">加载中...</p>';
    apiGet(`/api/ib/results/${taskId}/summary`)
      .then((summary) => {
        detailEl.innerHTML = `<h4 class="text-md font-bold mb-2">测试详情: ${escapeHtml(taskId)}</h4>` + renderBatchSummary(summary);
      })
      .catch((err) => showFeedback(detailEl, err.message, 'error'));
  }

  // =========================================================================
  // Connectivity Check
  // =========================================================================

  document.getElementById('btn-connectivity-check').addEventListener('click', async () => {
    const resultEl = document.getElementById('connectivity-result');
    resultEl.innerHTML = '<div class="ib-running"><div class="spinner"></div><span>正在批量 PING 探测所有设备连通性...</span></div>';

    try {
      const hostData = await apiGet('/api/hosts');
      const hosts = hostData.hosts || [];
      if (hosts.length === 0) {
        showFeedback(resultEl, '暂无设备，请先导入 Excel', 'error');
        return;
      }

      const results = [];
      const promises = hosts.map((host) =>
        fetch(`/api/hosts/${host.id}/ping`)
          .then((r) => r.json())
          .then((d) => results.push({ ...host, online: d.online }))
          .catch(() => results.push({ ...host, online: false }))
      );
      await Promise.all(promises);

      results.sort((a, b) => a.id - b.id);
      const offline = results.filter((r) => !r.online);
      const online = results.filter((r) => r.online);

      let html = '<div class="topo-summary-grid mb-4">';
      html += renderTopoStat(results.length, '总设备数', '#e2e8f0');
      html += renderTopoStat(online.length, '在线', '#4ade80');
      html += renderTopoStat(offline.length, '不可达', '#f87171');
      html += '</div>';

      if (offline.length > 0) {
        html += '<div class="topo-section-title" style="color:#f87171">不可达设备</div>';
        const offRows = offline.map((h) => [
          h.id,
          h.hostname || '-',
          h.host_ip,
          h.device_type || 'GPU',
          h.remark || '-',
        ]);
        html += buildTable(['ID', '主机名', 'IP', '类型', '备注'], offRows);
      }

      if (online.length > 0) {
        html += '<div class="topo-section-title" style="color:#4ade80">在线设备</div>';
        const onRows = online.map((h) => [
          h.id,
          h.hostname || '-',
          h.host_ip,
          h.device_type || 'GPU',
          h.remark || '-',
        ]);
        html += buildTable(['ID', '主机名', 'IP', '类型', '备注'], onRows);
      }

      resultEl.innerHTML = html;
    } catch (err) {
      showFeedback(resultEl, err.message, 'error');
    }
  });

  // =========================================================================
  // IB Topology
  // =========================================================================

  function loadIbTopo() {
    const hintEl = document.getElementById('ib-topo-hint');
    if (selectedHostId === null) { setHint('ib-topo-hint'); return; }
    if (hintEl) hintEl.textContent = '';
  }

  document.getElementById('btn-ib-topo-query').addEventListener('click', async () => {
    const resultEl = document.getElementById('ib-topo-result');
    const btn = document.getElementById('btn-ib-topo-query');
    if (selectedHostId === null) {
      showFeedback(resultEl, '请先在主机列表中选择一台主机', 'error');
      return;
    }

    const totalSec = 150;
    let remaining = totalSec;
    const countdownEl = 'ib-topo-countdown';
    resultEl.innerHTML = `<div class="ib-running"><div class="spinner"></div><span>正在远程执行 iblinkinfo ... <span id="${countdownEl}" class="text-cyan-300 font-mono">${remaining}s</span></span></div>`;
    btn.disabled = true;
    btn.style.opacity = '0.5';

    const timer = setInterval(() => {
      remaining--;
      const cdEl = document.getElementById(countdownEl);
      if (cdEl) cdEl.textContent = `${remaining}s`;
      if (remaining <= 0) {
        clearInterval(timer);
        showFeedback(resultEl, '连接超时，请确认主机网络可达或换一台主机重试', 'error');
        btn.disabled = false;
        btn.style.opacity = '';
      }
    }, 1000);

    try {
      const data = await apiGet(`/api/ib-topo/${selectedHostId}`);
      clearInterval(timer);
      btn.disabled = false;
      btn.style.opacity = '';
      renderIbTopology(data);
    } catch (err) {
      clearInterval(timer);
      btn.disabled = false;
      btn.style.opacity = '';
      showFeedback(resultEl, err.message, 'error');
    }
  });

  function renderIbTopology(data) {
    const el = document.getElementById('ib-topo-result');
    const s = data.summary || {};
    const anomalies = data.anomalies || [];
    const leafs = data.leafs || [];
    const spines = data.spines || [];
    const servers = data.servers || [];
    const leafServerMap = data.leaf_server_map || {};
    const spineLeafMatrix = data.spine_leaf_matrix || {};
    const leafSpineMap = data.leaf_spine_map || {};

    let html = '';

    // Summary cards
    html += '<div class="topo-summary-grid">';
    html += renderTopoStat(s.spine_count, 'Spine 交换机', '#c4b5fd');
    html += renderTopoStat(s.leaf_count, 'Leaf 交换机', '#a5f3fc');
    html += renderTopoStat(s.server_count, 'GPU 服务器', '#e2e8f0');
    html += renderTopoStat(s.total_active_links, '活跃链路', '#4ade80');
    html += renderTopoStat(s.total_down_links, '断开端口', '#fbbf24');
    html += renderTopoStat(s.error_count, '错误', '#f87171');
    html += renderTopoStat(s.warning_count, '告警', '#fbbf24');
    html += '</div>';

    // Health badge
    const hCls = s.health === 'healthy' ? 'healthy' : 'unhealthy';
    const hLabel = s.health === 'healthy' ? '线序正常' : '发现异常';
    html += `<div class="mb-6"><span class="topo-health ${hCls}">${hLabel}</span></div>`;

    // Topology diagram
    html += '<div class="topo-section-title">拓扑总览</div>';
    html += '<div class="topo-diagram">';
    html += '<div class="topo-tier-label">SPINE 层</div>';
    html += '<div class="topo-tier">';
    spines.forEach((name) => {
      html += `<div class="topo-node spine">${escapeHtml(name)}</div>`;
    });
    html += '</div>';

    html += '<div class="text-center text-slate-500 text-xs my-2">│ 每 Leaf 双上行 × 16 Spine │</div>';

    html += '<div class="topo-tier-label">LEAF 层</div>';
    html += '<div class="topo-tier">';
    leafs.forEach((name) => {
      html += `<div class="topo-node leaf">${escapeHtml(name)}</div>`;
    });
    html += '</div>';

    html += '<div class="text-center text-slate-500 text-xs my-2">│ 下行接入 GPU 服务器 │</div>';

    html += '<div class="topo-tier-label">SERVER 层</div>';
    html += '<div class="topo-tier">';
    servers.forEach((name) => {
      const short = name.replace(/^bj09-gpu-200b-/, '');
      html += `<div class="topo-node server" title="${escapeHtml(name)}">${escapeHtml(short)}</div>`;
    });
    html += '</div>';
    html += '</div>';

    // Leaf → Server detail
    html += '<div class="topo-section-title">Leaf 接入详情</div>';
    const activeLeafs = leafs.filter((l) => (leafServerMap[l] || []).length > 0);
    const errorPorts = new Set();
    anomalies.filter((a) => a.type === 'server_port_mismatch').forEach((a) => {
      errorPorts.add(`${a.leaf}:${a.actual_port}`);
    });

    activeLeafs.forEach((leafName) => {
      const entries = leafServerMap[leafName] || [];
      html += '<div class="topo-leaf-group">';
      html += `<div class="leaf-title">
        <div class="topo-node leaf" style="min-width:auto;padding:3px 8px;font-size:11px">${escapeHtml(leafName)}</div>
        <span class="text-xs text-slate-400">${entries.length} 台服务器接入</span>
      </div>`;
      html += '<div class="server-chips">';
      entries.forEach((e) => {
        const short = (e.server || '').replace(/^bj09-gpu-200b-/, '');
        const isErr = errorPorts.has(`${leafName}:${e.leaf_port}`);
        const cls = isErr ? 'server-chip error' : 'server-chip';
        const tip = `${e.server} [${e.hca}] → port ${e.leaf_port}`;
        html += `<div class="${cls}" title="${escapeHtml(tip)}">P${e.leaf_port}: ${escapeHtml(short)} (${escapeHtml(e.hca)})</div>`;
      });
      html += '</div></div>';
    });

    // Spine-Leaf full-mesh matrix
    html += '<div class="topo-section-title">Spine ↔ Leaf 互联矩阵</div>';
    html += '<div class="topo-matrix"><table><thead><tr><th>Leaf \\ Spine</th>';
    spines.forEach((sp) => {
      html += `<th>${escapeHtml(sp.replace('ibspine', 'S'))}</th>`;
    });
    html += '</tr></thead><tbody>';

    leafs.forEach((leaf) => {
      html += `<tr><td style="text-align:left;font-weight:600;color:#a5f3fc">${escapeHtml(leaf)}</td>`;
      spines.forEach((spine) => {
        const pairs = (leafSpineMap[leaf] || {})[spine] || [];
        if (pairs.length > 0) {
          const ports = pairs.map((p) => p.leaf_port).sort((a, b) => a - b).join(',');
          html += `<td class="connected" title="Leaf ports: ${ports}">✓ ${pairs.length}</td>`;
        } else {
          html += '<td class="missing" title="缺少连接">✗</td>';
        }
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    // Anomalies
    if (anomalies.length > 0) {
      const errors = anomalies.filter((a) => a.level === 'error');
      const warnings = anomalies.filter((a) => a.level === 'warning');

      html += '<div class="topo-section-title">异常检测结果</div>';

      if (errors.length > 0) {
        html += `<p class="text-sm text-rose-300 mb-2 font-semibold">错误 (${errors.length})</p>`;
        html += '<ul class="anomaly-list">';
        errors.forEach((a) => {
          html += renderAnomalyItem(a);
        });
        html += '</ul>';
      }

      if (warnings.length > 0) {
        html += `<p class="text-sm text-yellow-300 mb-2 mt-4 font-semibold">告警 (${warnings.length})</p>`;
        html += '<ul class="anomaly-list">';
        warnings.forEach((a) => {
          html += renderAnomalyItem(a);
        });
        html += '</ul>';
      }
    } else {
      html += '<div class="topo-section-title">异常检测结果</div>';
      html += '<p class="text-sm text-emerald-300">未发现异常，所有线序和互联关系正确。</p>';
    }

    el.innerHTML = html;
  }

  function renderTopoStat(val, label, color) {
    return `<div class="topo-stat">
      <div class="val" style="color:${color}">${val ?? '-'}</div>
      <div class="lbl">${label}</div>
    </div>`;
  }

  function renderAnomalyItem(a) {
    const icon = a.level === 'error' ? '!' : '?';
    return `<li class="anomaly-item">
      <div class="anomaly-icon ${a.level}">${icon}</div>
      <div>
        <div class="anomaly-msg">${escapeHtml(a.message)}</div>
        <div class="anomaly-type">${escapeHtml(a.type)}</div>
      </div>
    </li>`;
  }

  // =========================================================================
  // DCGMI Diagnostics
  // =========================================================================

  const _dcgmiTroubleshootSrc = {
    'denylist':                  { causes: 'GPU 被列入驱动黑名单，可能是已知故障卡', fix: '检查 dmesg 日志；确认 GPU 型号是否在驱动支持列表中；尝试更新驱动' },
    'nvml library':              { causes: 'NVML 共享库加载失败', fix: '确认 libnvidia-ml.so 存在；检查 LD_LIBRARY_PATH 和 ldconfig' },
    'cuda main library':         { causes: 'CUDA 运行时库加载失败', fix: '确认 libcuda.so 存在；运行 ldconfig；检查驱动与 CUDA 版本兼容性' },
    'cuda runtime library':      { causes: 'CUDA Runtime 与驱动版本不匹配', fix: '运行 nvidia-smi 和 nvcc --version 对比版本；必要时重装匹配版本' },
    'permissions and os blocks': { causes: '/dev/nvidia* 设备文件权限不足或 cgroups 限制', fix: '检查 ls -la /dev/nvidia*；确认用户在 video 组中；检查容器 cgroup 配置' },
    'persistence mode':          { causes: 'GPU 未开启持久模式，驱动可能在空闲时卸载', fix: '执行 nvidia-smi -pm 1 开启持久模式（需 root）' },
    'environment variables':     { causes: '环境变量冲突（如 CUDA_VISIBLE_DEVICES 设置异常）', fix: '检查 env | grep -i cuda 和 env | grep -i nvidia；清除异常变量后重试' },
    'page retirement/row remap': { causes: 'GPU 存在过多页退休(page retirement)或行重映射', fix: '运行 nvidia-smi -q -d PAGE_RETIREMENT 查看；若 pending 数过多需更换 GPU' },
    'graphics processes':        { causes: '有图形进程占用 GPU 导致诊断无法独占', fix: '运行 nvidia-smi 查看占用进程；停止相关进程后重试（或使用 systemctl isolate multi-user.target）' },
    'inforom':                   { causes: 'GPU InfoROM 数据校验失败（固件区域损坏）', fix: '运行 nvidia-smi -q -d INFOROM 检查版本和校验状态；联系 NVIDIA 获取固件更新' },
    'software':                  { causes: 'CUDA 驱动/Runtime 不匹配、GPU 被进程占用、Persistence Mode 未开启', fix: '运行 nvidia-smi 检查驱动版本；确认无进程占用 GPU；执行 nvidia-smi -pm 1' },
    'pcie':                      { causes: 'PCIe 链路降速或训练失败（带宽/宽度低于预期）', fix: '运行 nvidia-smi -q -d PERFORMANCE 检查 PCIe Gen/Width；检查物理插槽和线缆' },
    'gpu memory':                { causes: '显存硬件故障或 ECC 不可纠正错误过多', fix: '运行 nvidia-smi -q -d ECC 检查错误计数；若 Uncorrectable 持续增长需更换 GPU' },
    'pulse test':                { causes: 'GPU 计算单元短时压力测试未通过', fix: '检查 GPU 温度和供电是否正常；重跑确认是否偶发；持续失败需 RMA' },
    'targeted stress':           { causes: 'GPU 定向压力测试失败（计算/显存/PCIe）', fix: '查看详细日志确定是计算、显存还是 PCIe 子项失败；检查散热和供电' },
    'targeted power':            { causes: 'GPU 功耗异常（超限或不足）', fix: '运行 nvidia-smi -q -d POWER 检查功耗限制；确认 PSU 供电充足和 PCIe 辅助供电线缆' },
    'memory bandwidth':          { causes: '显存带宽低于预期阈值', fix: '检查 ECC 模式是否开启（会降低约 6% 带宽）；排除散热降频因素' },
    'memtest':                   { causes: '显存硬件测试发现坏位', fix: '多次重跑确认；若持续报错需 RMA 更换 GPU' },
    'diagnostic':                { causes: '综合诊断异常', fix: '查看原始日志中的具体错误描述；运行 dcgmi diag -r 2 -v 获取详细信息' },
  };

  function _dcgmiLookup(name) {
    if (!name) return null;
    return _dcgmiTroubleshootSrc[name.toLowerCase().trim()] || null;
  }

  function dcgmiResultBadge(result, testName) {
    const info = (result === 'Fail' || result === 'Warn') ? _dcgmiLookup(testName) : null;
    const tooltip = info ? ` title="常见原因：${escapeHtml(info.causes)}"` : '';
    if (result === 'Pass') return '<span class="badge-pass">Pass</span>';
    if (result === 'Fail') return `<span class="badge-fail"${tooltip}>Fail</span>`;
    if (result === 'Warn') return `<span class="badge-agent"${tooltip}>Warn</span>`;
    if (result === 'Skip') return '<span class="badge-key">Skip</span>';
    return `<span class="badge-pass">${escapeHtml(result)}</span>`;
  }

  function dcgmiOverallBadge(overall) {
    if (overall === 'Pass') return '<span class="badge-pass" style="font-size:14px;padding:4px 16px">PASS</span>';
    if (overall === 'Fail') return '<span class="badge-fail" style="font-size:14px;padding:4px 16px">FAIL</span>';
    if (overall === 'Warn') return '<span class="badge-agent" style="font-size:14px;padding:4px 16px">WARN</span>';
    return `<span class="badge-pass" style="font-size:14px;padding:4px 16px">${escapeHtml(overall || '-')}</span>`;
  }

  function renderDcgmiSingleResult(data) {
    if (!data || !data.categories || data.categories.length === 0) {
      if (data && data.error) return `<div class="feedback error">${escapeHtml(data.error)}</div>`;
      return '<p class="text-slate-400">无诊断输出（dcgmi 可能未安装或未返回结果）。</p>';
    }

    let html = '<div class="topo-summary-grid mb-4">';
    html += renderTopoStat(data.pass_count || 0, '通过', '#4ade80');
    html += renderTopoStat(data.fail_count || 0, '失败', '#f87171');
    html += renderTopoStat(data.warn_count || 0, '警告', '#fbbf24');
    html += `<div class="topo-stat"><div class="val">${dcgmiOverallBadge(data.overall)}</div><div class="lbl">总体结果</div></div>`;
    html += '</div>';

    html += `<p class="text-sm text-slate-400 mb-3">主机: ${escapeHtml(data.hostname || data.host_ip || '')} | Level ${data.level || '-'}</p>`;

    for (const cat of data.categories) {
      html += `<div class="topo-section-title">${escapeHtml(cat.name)}</div>`;
      const th = ['测试项', '结果'].map((h) => `<th>${escapeHtml(h)}</th>`).join('');
      const body = cat.tests.map((t) => {
        const isFail = t.result === 'Fail';
        const isWarn = t.result === 'Warn';
        const bgStyle = isFail ? ' style="background:rgba(127,29,29,0.15)"' : '';
        const info = (isFail || isWarn) ? _dcgmiLookup(t.name) : null;
        const detailPart = t.detail ? `<span class="text-xs text-slate-400 ml-2">(${escapeHtml(t.detail)})</span>` : '';
        let extraHtml = '';
        if (info) {
          extraHtml += `<div class="dcgmi-cause-tip">常见原因：${escapeHtml(info.causes)}</div>`;
          extraHtml += `<div class="dcgmi-fix-tip">${isFail ? '排查建议' : '建议关注'}：${escapeHtml(info.fix)}</div>`;
        }
        return `<tr${bgStyle}><td class="mono">${escapeHtml(t.name)}${detailPart}${extraHtml}</td><td>${dcgmiResultBadge(t.result, t.name)}</td></tr>`;
      }).join('');
      html += `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
    }

    if (data.task_id) {
      html += `<div class="mt-3"><button class="dl-btn" onclick="window.open('/api/dcgmi/results/${escapeHtml(data.task_id)}/log','_blank')">下载原始日志</button></div>`;
    }

    return html;
  }

  function renderDcgmiBatchSummary(summary) {
    if (!summary) return '<p class="text-slate-400">无汇总数据</p>';

    const results = summary.results || [];
    const totalHosts = results.length;
    const passHosts = results.filter((r) => r.overall === 'Pass').length;
    const failHosts = results.filter((r) => r.overall === 'Fail' || r.overall === 'Error').length;
    const warnHosts = results.filter((r) => r.overall === 'Warn').length;

    let html = '<div class="topo-summary-grid mb-4">';
    html += renderTopoStat(totalHosts, '总设备数', '#e2e8f0');
    html += renderTopoStat(passHosts, '通过', '#4ade80');
    html += renderTopoStat(failHosts, '失败', '#f87171');
    html += renderTopoStat(warnHosts, '警告', '#fbbf24');
    html += '</div>';

    if (results.length > 0) {
      const th = ['主机', 'IP', 'Level', '通过', '失败', '警告', '结果']
        .map((h) => `<th>${escapeHtml(h)}</th>`).join('');
      const body = results.map((r) => {
        const bgStyle = (r.overall === 'Fail' || r.overall === 'Error')
          ? ' style="background:rgba(127,29,29,0.1)"' : '';
        return `<tr${bgStyle}>
          <td class="mono">${escapeHtml(r.hostname || '-')}</td>
          <td class="mono">${escapeHtml(r.host_ip || '-')}</td>
          <td class="mono">${r.level || '-'}</td>
          <td class="mono">${r.pass_count || 0}</td>
          <td class="mono">${r.fail_count || 0}</td>
          <td class="mono">${r.warn_count || 0}</td>
          <td>${r.error ? '<span class="badge-fail">Error</span>' : dcgmiOverallBadge(r.overall)}</td>
        </tr>`;
      }).join('');
      html += `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
    }

    if (summary.task_id) {
      html += `<div class="mt-3"><button class="dl-btn" onclick="window.open('/api/dcgmi/results/${escapeHtml(summary.task_id)}/log','_blank')">下载完整日志</button></div>`;
    }

    return html;
  }

  // Single-host DCGMI
  document.getElementById('btn-dcgmi-single').addEventListener('click', () => {
    const hintEl = document.getElementById('dcgmi-single-hint');
    const statusEl = document.getElementById('dcgmi-single-status');
    const resultEl = document.getElementById('dcgmi-single-result');
    const level = Number(document.getElementById('dcgmi-single-level').value);

    if (selectedHostId === null) {
      showFeedback(statusEl, '请先在「设备列表」中选择一台 GPU 主机', 'error');
      return;
    }

    statusEl.innerHTML = `<div class="ib-running"><div class="spinner"></div>正在对主机 ${escapeHtml(selectedHostLabel)} 执行 DCGMI Level ${level} 诊断...</div>`;
    resultEl.innerHTML = '';

    apiPost('/api/dcgmi/diag', { host_id: selectedHostId, level })
      .then((data) => {
        statusEl.innerHTML = '<div class="feedback success">单机诊断完成</div>';
        resultEl.innerHTML = renderDcgmiSingleResult(data);
        loadDcgmiHistory();
      })
      .catch((err) => {
        statusEl.innerHTML = '';
        showFeedback(resultEl, err.message, 'error');
      });
  });

  // Batch DCGMI
  document.getElementById('btn-dcgmi-batch').addEventListener('click', () => {
    const level = Number(document.getElementById('dcgmi-batch-level').value);
    const statusEl = document.getElementById('dcgmi-batch-status');
    const resultEl = document.getElementById('dcgmi-batch-result');

    statusEl.innerHTML = '<div class="ib-running"><div class="spinner"></div>正在启动批量 DCGMI 诊断...</div>';
    resultEl.innerHTML = '';

    apiPost('/api/dcgmi/batch', { level })
      .then((data) => {
        const taskId = data.task_id;
        statusEl.innerHTML = `<div class="ib-running"><div class="spinner"></div>批量诊断进行中 (ID: ${escapeHtml(taskId)})...</div>`;
        pollDcgmiBatchStatus(taskId, statusEl, resultEl);
      })
      .catch((err) => showFeedback(statusEl, err.message, 'error'));
  });

  function pollDcgmiBatchStatus(taskId, statusEl, resultEl) {
    const poll = () => {
      apiGet(`/api/dcgmi/batch/${taskId}/status`)
        .then((s) => {
          if (s.status === 'running') {
            statusEl.innerHTML = `<div class="ib-running"><div class="spinner"></div>批量诊断进行中 (${s.completed_hosts}/${s.total_hosts} 台完成)...</div>`;
            setTimeout(poll, 3000);
          } else if (s.status === 'completed') {
            statusEl.innerHTML = '<div class="feedback success">批量诊断完成</div>';
            apiGet(`/api/dcgmi/results/${taskId}/summary`)
              .then((summary) => {
                resultEl.innerHTML = renderDcgmiBatchSummary(summary);
                loadDcgmiHistory();
              })
              .catch((err) => showFeedback(resultEl, err.message, 'error'));
          } else {
            statusEl.innerHTML = `<div class="feedback error">批量诊断失败: ${escapeHtml(s.error || 'unknown')}</div>`;
          }
        })
        .catch((err) => {
          statusEl.innerHTML = `<div class="feedback error">查询状态失败: ${escapeHtml(err.message)}</div>`;
        });
    };
    setTimeout(poll, 3000);
  }

  // DCGMI History
  function loadDcgmiHistory() {
    const listEl = document.getElementById('dcgmi-history-list');
    if (!listEl) return;
    apiGet('/api/dcgmi/results')
      .then((items) => {
        if (!items || items.length === 0) {
          listEl.innerHTML = '<p class="text-slate-400">暂无历史诊断记录。</p>';
          return;
        }
        const th = ['任务ID', 'Level', '时间', '状态', '设备数', '通过', '失败', '操作']
          .map((h) => `<th>${escapeHtml(h)}</th>`).join('');
        const body = items.map((item) => {
          return `<tr class="history-row" data-dcgmi-task-id="${escapeHtml(item.task_id || '')}">
            <td class="mono">${escapeHtml(item.task_id || '-')}</td>
            <td class="mono">${item.level || '-'}</td>
            <td class="mono">${item.started_at ? item.started_at.replace('T', ' ').substring(0, 19) : '-'}</td>
            <td class="mono">${escapeHtml(item.status || '-')}</td>
            <td class="mono">${item.total_hosts || 0}</td>
            <td class="mono">${item.pass_count || 0}</td>
            <td class="mono">${item.fail_count || 0}</td>
            <td><button class="dl-btn" onclick="event.stopPropagation();window.open('/api/dcgmi/results/${escapeHtml(item.task_id || '')}/log','_blank')">日志</button></td>
          </tr>`;
        }).join('');
        listEl.innerHTML = `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;

        listEl.querySelectorAll('.history-row[data-dcgmi-task-id]').forEach((tr) => {
          tr.addEventListener('click', () => {
            const taskId = tr.getAttribute('data-dcgmi-task-id');
            if (taskId) loadDcgmiHistoryDetail(taskId);
          });
        });
      })
      .catch(() => { listEl.innerHTML = ''; });
  }

  function loadDcgmiHistoryDetail(taskId) {
    const detailEl = document.getElementById('dcgmi-history-detail');
    if (!detailEl) return;
    detailEl.innerHTML = '<p class="text-slate-400">加载中...</p>';
    apiGet(`/api/dcgmi/results/${taskId}/summary`)
      .then((summary) => {
        detailEl.innerHTML = `<h4 class="text-md font-bold mb-2">诊断详情: ${escapeHtml(taskId)}</h4>` + renderDcgmiBatchSummary(summary);
      })
      .catch((err) => showFeedback(detailEl, err.message, 'error'));
  }

  // =========================================================================
  // Ethernet Bandwidth Test
  // =========================================================================

  let ethSingleAbort = null;
  let ethBatchTaskIdActive = null;
  let ethBatchTimers = { poll: null, tick: null };
  let ethBatchStartedAtMs = 0;

  function clearEthBatchTimers() {
    if (ethBatchTimers.poll != null) clearTimeout(ethBatchTimers.poll);
    if (ethBatchTimers.tick != null) clearInterval(ethBatchTimers.tick);
    ethBatchTimers.poll = null;
    ethBatchTimers.tick = null;
  }

  function setEthBatchUiRunning(running) {
    const btnBatch = document.getElementById('btn-eth-batch-test');
    const btnStop = document.getElementById('btn-eth-batch-stop');
    const modeSel = document.getElementById('eth-batch-mode');
    if (btnBatch) btnBatch.disabled = running;
    if (modeSel) modeSel.disabled = running;
    if (btnStop) {
      if (running) {
        btnStop.classList.remove('hidden');
        btnStop.disabled = false;
      } else {
        btnStop.classList.add('hidden');
        btnStop.disabled = false;
      }
    }
  }

  function initEthBatchProgressShell(statusEl) {
    statusEl.innerHTML = `
    <div class="eth-batch-live rounded-xl border border-cyan-400/20 bg-slate-900/40 p-4">
      <div class="flex items-start gap-3">
        <div class="spinner shrink-0 mt-1"></div>
        <div class="min-w-0 flex-1">
          <div class="text-slate-200">
            已运行 <span id="eth-batch-elapsed" class="font-mono text-cyan-300">0</span> 秒
            · 进度 <span id="eth-batch-nums" class="font-mono text-slate-300">0 / ?</span> 对
          </div>
          <div id="eth-batch-current" class="text-sm text-slate-400 mt-2">当前：—</div>
          <div id="eth-batch-phase" class="text-xs text-slate-500 mt-1"></div>
        </div>
      </div>
    </div>`;
  }

  function updateEthBatchProgressFields(s) {
    const nums = document.getElementById('eth-batch-nums');
    const cur = document.getElementById('eth-batch-current');
    const phase = document.getElementById('eth-batch-phase');
    if (nums) nums.textContent = `${s.completed_pairs ?? 0} / ${s.total_pairs ?? '?'}`;
    if (cur) cur.textContent = `当前：${s.current_pair ? s.current_pair : '（排队 / 启动中）'}`;
    if (phase) phase.textContent = s.current_phase || '';
    if (s.started_at) {
      const t = Date.parse(s.started_at);
      if (!Number.isNaN(t)) ethBatchStartedAtMs = t;
    }
  }

  function tickEthBatchElapsed() {
    const el = document.getElementById('eth-batch-elapsed');
    if (!el || !ethBatchStartedAtMs) return;
    el.textContent = String(Math.max(0, Math.floor((Date.now() - ethBatchStartedAtMs) / 1000)));
  }

  function populateEthHostSelects() {
    const srcSel = document.getElementById('eth-src-host');
    const dstSel = document.getElementById('eth-dst-host');
    if (!srcSel || !dstSel) return;

    apiGet('/api/hosts')
      .then((data) => {
        const hosts = (data.hosts || []).filter(
          (h) => h.device_type === 'GPU' || h.device_type === 'CPU'
        );
        const optHtml = hosts.map((h) => {
          const label = `${h.host_ip} (${h.hostname || h.device_type})`;
          return `<option value="${h.id}">${escapeHtml(label)}</option>`;
        }).join('');
        srcSel.innerHTML = optHtml || '<option disabled>无 GPU/CPU 主机</option>';
        dstSel.innerHTML = optHtml || '<option disabled>无 GPU/CPU 主机</option>';
        if (hosts.length >= 2) dstSel.selectedIndex = 1;
      })
      .catch(() => {});
  }

  function ethPassBadge(passed) {
    if (passed) return '<span class="badge-pass">PASS</span>';
    return '<span class="badge-fail">FAIL</span>';
  }

  function renderEthSingleResult(r) {
    let html = '<div class="topo-summary-grid mb-4">';
    html += renderTopoStat(r.bandwidth || 'Unknown', '带宽', r.passed ? '#4ade80' : '#f87171');
    html += renderTopoStat(r.src_ip, '源主机', '#e2e8f0');
    html += renderTopoStat(r.dst_ip, '目标主机', '#e2e8f0');
    html += '</div>';
    html += `<div class="mb-2">${ethPassBadge(r.passed)} 阈值: &ge; ${46} Gbits/sec</div>`;
    if (r.error) {
      html += `<div class="feedback error">${escapeHtml(r.error)}</div>`;
    }
    return html;
  }

  document.getElementById('btn-eth-single-test').addEventListener('click', async () => {
    const srcSel = document.getElementById('eth-src-host');
    const dstSel = document.getElementById('eth-dst-host');
    const resultEl = document.getElementById('eth-single-result');
    const btnStop = document.getElementById('btn-eth-single-stop');
    const btnStart = document.getElementById('btn-eth-single-test');
    const hint = document.getElementById('eth-single-hint');

    const srcId = srcSel.value;
    const dstId = dstSel.value;
    if (!srcId || !dstId) {
      showFeedback(resultEl, '请选择源主机和目标主机', 'error');
      return;
    }
    if (srcId === dstId) {
      showFeedback(resultEl, '源主机和目标主机不能相同', 'error');
      return;
    }

    if (ethSingleAbort) ethSingleAbort.abort();
    ethSingleAbort = new AbortController();
    if (btnStop) btnStop.classList.remove('hidden');
    if (hint) hint.classList.remove('hidden');
    if (btnStart) btnStart.disabled = true;

    let sec = 0;
    resultEl.innerHTML = `<div class="ib-running"><div class="spinner"></div><span>正在执行 iperf 带宽测试… 已等待 <span id="eth-single-sec" class="font-mono text-cyan-300">0</span> 秒（约 30~90 秒）</span></div>`;
    const secTimer = setInterval(() => {
      sec += 1;
      const el = document.getElementById('eth-single-sec');
      if (el) el.textContent = String(sec);
    }, 1000);

    try {
      const resp = await fetch('/api/eth/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src_host_id: Number(srcId), dst_host_id: Number(dstId) }),
        signal: ethSingleAbort.signal,
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail || resp.statusText);
      }
      const data = await resp.json();
      resultEl.innerHTML = renderEthSingleResult(data);
      loadEthHistory();
    } catch (err) {
      if (err.name === 'AbortError') {
        showFeedback(resultEl, '已取消本页等待。服务端上的单次测试可能仍在执行，请稍后刷新「历史测试记录」。', 'info');
      } else {
        showFeedback(resultEl, err.message, 'error');
      }
    } finally {
      clearInterval(secTimer);
      ethSingleAbort = null;
      if (btnStop) btnStop.classList.add('hidden');
      if (hint) hint.classList.add('hidden');
      if (btnStart) btnStart.disabled = false;
    }
  });

  document.getElementById('btn-eth-single-stop').addEventListener('click', () => {
    if (ethSingleAbort) ethSingleAbort.abort();
  });

  // Batch test
  document.getElementById('btn-eth-batch-test').addEventListener('click', async () => {
    const statusEl = document.getElementById('eth-batch-status');
    const resultEl = document.getElementById('eth-batch-result');
    const modeSel = document.getElementById('eth-batch-mode');
    const mode = modeSel.value;

    statusEl.innerHTML = '<div class="ib-running"><div class="spinner"></div><span>正在启动批量以太网测试...</span></div>';
    resultEl.innerHTML = '';

    try {
      const resp = await fetch('/api/eth/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail || resp.statusText);
      }
      const data = await resp.json();
      pollEthBatchStatus(data.task_id);
    } catch (err) {
      setEthBatchUiRunning(false);
      showFeedback(statusEl, err.message, 'error');
    }
  });

  document.getElementById('btn-eth-batch-stop').addEventListener('click', () => {
    if (!ethBatchTaskIdActive) return;
    const btnStop = document.getElementById('btn-eth-batch-stop');
    fetch(`/api/eth/batch/${ethBatchTaskIdActive}/cancel`, { method: 'POST' })
      .then((r) => {
        if (!r.ok) return r.json().then((j) => Promise.reject(new Error(j.detail || r.statusText)));
        const phase = document.getElementById('eth-batch-phase');
        if (phase) phase.textContent = '已发送停止请求，将在当前这一对测试结束后停止后续对…';
        if (btnStop) btnStop.disabled = true;
      })
      .catch((e) => {
        showFeedback(document.getElementById('eth-batch-status'), e.message, 'error');
        if (btnStop) btnStop.disabled = false;
      });
  });

  function pollEthBatchStatus(taskId) {
    clearEthBatchTimers();
    ethBatchTaskIdActive = taskId;
    ethBatchStartedAtMs = Date.now();

    const statusEl = document.getElementById('eth-batch-status');
    const resultEl = document.getElementById('eth-batch-result');

    setEthBatchUiRunning(true);
    initEthBatchProgressShell(statusEl);
    ethBatchTimers.tick = setInterval(tickEthBatchElapsed, 1000);
    tickEthBatchElapsed();

    const schedulePoll = (delay) => {
      ethBatchTimers.poll = setTimeout(doPoll, delay);
    };

    function finishBatchUi() {
      clearEthBatchTimers();
      setEthBatchUiRunning(false);
      ethBatchTaskIdActive = null;
    }

    function doPoll() {
      ethBatchTimers.poll = null;
      apiGet(`/api/eth/batch/${taskId}/status`)
        .then((s) => {
          updateEthBatchProgressFields(s);
          if (s.status === 'running') {
            schedulePoll(5000);
          } else if (s.status === 'completed' || s.status === 'cancelled') {
            finishBatchUi();
            const msg = s.status === 'cancelled' ? '批量测试已停止（已保存已完成部分）' : '批量测试已完成';
            statusEl.innerHTML = `<div class="feedback ${s.status === 'cancelled' ? 'info' : 'success'}">${escapeHtml(msg)}</div>`;
            apiGet(`/api/eth/results/${taskId}/summary`)
              .then((summary) => {
                resultEl.innerHTML = renderEthBatchSummary(summary);
                loadEthHistory();
              })
              .catch((err) => showFeedback(resultEl, err.message, 'error'));
          } else {
            finishBatchUi();
            statusEl.innerHTML = `<div class="feedback error">测试失败: ${escapeHtml(s.error || '未知错误')}</div>`;
          }
        })
        .catch((err) => {
          finishBatchUi();
          statusEl.innerHTML = `<div class="feedback error">${escapeHtml(err.message)}</div>`;
        });
    }

    schedulePoll(800);
  }

  function renderEthBatchSummary(summary) {
    const results = summary.results || [];
    if (results.length === 0) return '<p class="text-slate-400">无测试结果</p>';

    let html = '';
    if (summary.status === 'cancelled') {
      html += '<div class="feedback info mb-4">本任务由用户停止，以下为已完成测试对的结果。</div>';
    }

    html += '<div class="topo-summary-grid mb-4">';
    html += renderTopoStat(results.length, '总测试对', '#e2e8f0');
    html += renderTopoStat(summary.pass_count || 0, '通过', '#4ade80');
    html += renderTopoStat(summary.fail_count || 0, '未通过', '#f87171');
    html += '</div>';

    const th = ['源 IP', '源主机名', '目标 IP', '目标主机名', '带宽', '结果']
      .map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const body = results.map((r) => {
      const bgStyle = r.passed ? '' : ' style="background: rgba(127,29,29,0.1)"';
      return `<tr${bgStyle}>
        <td class="mono">${escapeHtml(r.src_ip || '')}</td>
        <td class="mono">${escapeHtml(r.src_hostname || '-')}</td>
        <td class="mono">${escapeHtml(r.dst_ip || '')}</td>
        <td class="mono">${escapeHtml(r.dst_hostname || '-')}</td>
        <td class="mono">${escapeHtml(r.bandwidth || 'Unknown')}</td>
        <td>${ethPassBadge(r.passed)}</td>
      </tr>`;
    }).join('');

    html += `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;

    if (summary.task_id) {
      html += `<div class="mt-3"><button class="dl-btn" onclick="window.open('/api/eth/results/${escapeHtml(summary.task_id)}/log','_blank')">下载完整日志</button></div>`;
    }

    return html;
  }

  // Ethernet History
  function loadEthHistory() {
    const listEl = document.getElementById('eth-history-list');
    if (!listEl) return;
    apiGet('/api/eth/results')
      .then((items) => {
        if (!items || items.length === 0) {
          listEl.innerHTML = '<p class="text-slate-400">暂无历史测试记录。</p>';
          return;
        }
        const th = ['任务ID', '模式', '时间', '状态', '通过', '失败', '操作']
          .map((h) => `<th>${escapeHtml(h)}</th>`).join('');
        const body = items.map((item) => {
          const modeLabel = item.mode === 'fullmesh' ? '全网格' : (item.mode === 'sequential' ? '顺序' : (item.mode || '-'));
          return `<tr class="eth-history-row" data-task-id="${escapeHtml(item.task_id || '')}">
            <td class="mono">${escapeHtml(item.task_id || '-')}</td>
            <td class="mono">${escapeHtml(modeLabel)}</td>
            <td class="mono">${item.started_at ? item.started_at.replace('T', ' ').substring(0, 19) : '-'}</td>
            <td class="mono">${escapeHtml(item.status || '-')}</td>
            <td class="mono">${item.pass_count || 0}</td>
            <td class="mono">${item.fail_count || 0}</td>
            <td><button class="dl-btn" onclick="event.stopPropagation();window.open('/api/eth/results/${escapeHtml(item.task_id || '')}/log','_blank')">日志</button></td>
          </tr>`;
        }).join('');
        listEl.innerHTML = `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;

        listEl.querySelectorAll('.eth-history-row').forEach((tr) => {
          tr.addEventListener('click', () => {
            const taskId = tr.getAttribute('data-task-id');
            if (taskId) loadEthHistoryDetail(taskId);
          });
        });
      })
      .catch(() => { listEl.innerHTML = ''; });
  }

  function loadEthHistoryDetail(taskId) {
    const detailEl = document.getElementById('eth-history-detail');
    if (!detailEl) return;
    detailEl.innerHTML = '<p class="text-slate-400">加载中...</p>';
    apiGet(`/api/eth/results/${taskId}/summary`)
      .then((summary) => {
        detailEl.innerHTML = `<h4 class="text-md font-bold mb-2">测试详情: ${escapeHtml(taskId)}</h4>` + renderEthBatchSummary(summary);
      })
      .catch((err) => showFeedback(detailEl, err.message, 'error'));
  }

  // =========================================================================
  // Phase1 Feature Toggle + Dashboard + Unified Logs + One-click
  // =========================================================================

  function mapLimit(items, limit, worker) {
    return new Promise((resolve) => {
      const out = new Array(items.length);
      let idx = 0;
      let running = 0;
      const total = items.length;
      if (total === 0) {
        resolve(out);
        return;
      }
      const launch = () => {
        while (running < limit && idx < total) {
          const cur = idx++;
          running += 1;
          Promise.resolve(worker(items[cur], cur))
            .then((v) => { out[cur] = v; })
            .catch((e) => { out[cur] = { error: e?.message || 'error' }; })
            .finally(() => {
              running -= 1;
              if (idx >= total && running === 0) resolve(out);
              else launch();
            });
        }
      };
      launch();
    });
  }

  function formatTs(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function applyPhase1Visibility() {
    if (PHASE1_ENABLED) return;
    document.querySelectorAll('.phase1-feature').forEach((el) => {
      el.classList.add('hidden');
    });
  }

  async function initMockModeBadge() {
    const badge = document.getElementById('mock-mode-badge');
    if (!badge) return;
    try {
      const status = await apiGet('/api/mock/status');
      if (status && status.enabled) {
        badge.classList.remove('hidden');
        const scenario = status.scenario ? ` (${status.scenario})` : '';
        badge.textContent = `Mock 模式${scenario}`;
      } else {
        badge.classList.add('hidden');
      }
    } catch (_) {
      badge.classList.add('hidden');
    }
  }

  // ---- Dashboard
  let dashboardTimer = null;
  let dashboardPaused = false;
  let dashboardBusy = false;
  let dashboardBound = false;
  const DASHBOARD_INTERVAL_MS = 15000;

  function setDashboardTimeLabel(text) {
    const el = document.getElementById('dashboard-last-update');
    if (!el) return;
    el.textContent = text;
  }

  function renderDashboardSummary(cards) {
    const el = document.getElementById('dashboard-summary');
    if (!el) return;
    let html = '';
    html += renderTopoStat(cards.total_hosts, '总设备', '#e2e8f0');
    html += renderTopoStat(cards.gpu_hosts, 'GPU 主机', '#a5f3fc');
    html += renderTopoStat(cards.cpu_hosts, 'CPU 主机', '#c4b5fd');
    html += renderTopoStat(`${cards.online_hosts}/${cards.total_hosts}`, '在线设备', '#4ade80');
    html += renderTopoStat(cards.alert_hosts, '告警主机', cards.alert_hosts > 0 ? '#fbbf24' : '#4ade80');
    html += renderTopoStat(cards.metric_failed, '指标失败', cards.metric_failed > 0 ? '#f87171' : '#4ade80');
    el.innerHTML = html;
  }

  function renderDashboardTopList(containerId, rows, metricName) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<p class="text-slate-400 text-sm">暂无数据</p>';
      return;
    }
    const body = rows.map((r, i) => `<tr data-host-id="${r.host.id}" class="dash-row">
      <td class="mono">${i + 1}</td>
      <td class="mono">${escapeHtml(r.host.hostname || '-')}</td>
      <td class="mono">${escapeHtml(r.host.host_ip || '-')}</td>
      <td class="mono">${escapeHtml(r.value)}</td>
    </tr>`).join('');
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>#</th><th>主机</th><th>IP</th><th>${escapeHtml(metricName)}</th></tr></thead><tbody>${body}</tbody></table></div>`;
    el.querySelectorAll('.dash-row').forEach((tr) => {
      tr.addEventListener('click', () => {
        const hostId = Number(tr.getAttribute('data-host-id'));
        const target = rows.find((r) => r.host.id === hostId)?.host;
        if (!target) return;
        selectedHostId = target.id;
        selectedHostLabel = target.hostname ? `${target.hostname} (${target.host_ip})` : target.host_ip;
        setSelectedHostBadge();
        refreshHostList();
        showPanel('metrics');
      });
    });
  }

  async function refreshDashboardData() {
    if (!PHASE1_ENABLED || dashboardBusy || dashboardPaused) return;
    dashboardBusy = true;
    const errEl = document.getElementById('dashboard-errors');
    if (errEl) errEl.innerHTML = '';
    setDashboardTimeLabel('最近刷新：刷新中...');
    try {
      const hostData = await apiGet('/api/hosts');
      const hosts = hostData.hosts || [];
      const gpuHosts = hosts.filter((h) => h.device_type === 'GPU');
      const cpuHosts = hosts.filter((h) => h.device_type === 'CPU');

      const pingRows = await mapLimit(hosts, 10, async (h) => {
        try {
          const p = await apiGet(`/api/hosts/${h.id}/ping`);
          return { host: h, online: !!p.online };
        } catch (_) {
          return { host: h, online: false };
        }
      });
      const onlineMap = new Map(pingRows.map((p) => [p.host.id, p.online]));

      const metricRows = await mapLimit(gpuHosts, 6, async (h) => {
        if (!onlineMap.get(h.id)) {
          return { host: h, ok: false, reason: 'offline' };
        }
        try {
          const m = await apiGet(`/api/hosts/${h.id}/gpu/metrics`);
          const gpus = m.gpus || [];
          if (!gpus.length) return { host: h, ok: false, reason: 'no gpu' };
          const avgTemp = Math.round(gpus.reduce((s, g) => s + Number(g.temperature_gpu || 0), 0) / gpus.length);
          const avgMem = Math.round(gpus.reduce((s, g) => s + Number(g.memory_used_percent || 0), 0) / gpus.length);
          const avgUtil = Math.round(gpus.reduce((s, g) => s + Number(g.utilization_gpu_percent || 0), 0) / gpus.length);
          const alert = avgTemp >= 85 || avgMem >= 90;
          return { host: h, ok: true, avgTemp, avgMem, avgUtil, alert };
        } catch (e) {
          return { host: h, ok: false, reason: e.message || 'metrics error' };
        }
      });

      const metricOk = metricRows.filter((m) => m.ok);
      const metricFailed = metricRows.length - metricOk.length;
      const alertHosts = metricOk.filter((m) => m.alert).length;
      const onlineHosts = pingRows.filter((p) => p.online).length;

      renderDashboardSummary({
        total_hosts: hosts.length,
        gpu_hosts: gpuHosts.length,
        cpu_hosts: cpuHosts.length,
        online_hosts: onlineHosts,
        alert_hosts: alertHosts,
        metric_failed: metricFailed,
      });

      const topTemp = [...metricOk].sort((a, b) => b.avgTemp - a.avgTemp).slice(0, 5).map((m) => ({ host: m.host, value: `${m.avgTemp} °C` }));
      const topMem = [...metricOk].sort((a, b) => b.avgMem - a.avgMem).slice(0, 5).map((m) => ({ host: m.host, value: `${m.avgMem} %` }));
      const topUtil = [...metricOk].sort((a, b) => b.avgUtil - a.avgUtil).slice(0, 5).map((m) => ({ host: m.host, value: `${m.avgUtil} %` }));
      renderDashboardTopList('dashboard-top-temp', topTemp, '温度');
      renderDashboardTopList('dashboard-top-mem', topMem, '显存占用');
      renderDashboardTopList('dashboard-top-util', topUtil, 'GPU 利用率');

      const failedRows = metricRows.filter((m) => !m.ok);
      if (errEl && failedRows.length) {
        const brief = failedRows.slice(0, 8).map((m) => `${m.host.host_ip}: ${m.reason}`).join(' | ');
        showFeedback(errEl, `部分主机指标未获取：${brief}${failedRows.length > 8 ? ' ...' : ''}`, 'info');
      }

      setDashboardTimeLabel(`最近刷新：${formatTs(new Date().toISOString())}`);
    } catch (err) {
      if (errEl) showFeedback(errEl, err.message || '刷新失败', 'error');
      setDashboardTimeLabel('最近刷新：失败');
    } finally {
      dashboardBusy = false;
    }
  }

  function bindDashboardControls() {
    if (dashboardBound) return;
    dashboardBound = true;
    const btnRefresh = document.getElementById('btn-dashboard-refresh');
    const btnToggle = document.getElementById('btn-dashboard-toggle');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        if (dashboardPaused) return;
        refreshDashboardData();
      });
    }
    if (btnToggle) {
      btnToggle.addEventListener('click', () => {
        dashboardPaused = !dashboardPaused;
        btnToggle.textContent = dashboardPaused ? '继续自动刷新' : '暂停自动刷新';
        if (!dashboardPaused) refreshDashboardData();
      });
    }
  }

  function startDashboardAutoRefresh() {
    if (!PHASE1_ENABLED) return;
    bindDashboardControls();
    if (!dashboardPaused) refreshDashboardData();
    if (dashboardTimer) clearInterval(dashboardTimer);
    dashboardTimer = setInterval(() => {
      if (!dashboardPaused) refreshDashboardData();
    }, DASHBOARD_INTERVAL_MS);
  }

  function stopDashboardAutoRefresh() {
    if (dashboardTimer) {
      clearInterval(dashboardTimer);
      dashboardTimer = null;
    }
  }

  // ---- Unified Logs
  let unifiedLogs = [];
  let logsBound = false;

  function normalizeUnifiedLogs(moduleName, items) {
    return (items || []).map((item) => {
      const started = item.started_at || '';
      const passCount = Number(item.pass_count || 0);
      const failCount = Number(item.fail_count || 0);
      const status = String(item.status || '-');
      const mode = moduleName === 'eth' ? (item.mode || '-') : (item.test_type || item.level || '-');
      return {
        module: moduleName,
        task_id: item.task_id || '',
        started_at: started,
        started_sort: Date.parse(started) || 0,
        status,
        mode,
        pass_count: passCount,
        fail_count: failCount,
      };
    });
  }

  function renderUnifiedLogsTable() {
    const listEl = document.getElementById('logs-list');
    const detailEl = document.getElementById('logs-detail');
    if (!listEl) return;
    const moduleVal = document.getElementById('logs-filter-module')?.value || 'all';
    const statusVal = document.getElementById('logs-filter-status')?.value || 'all';
    const kw = (document.getElementById('logs-filter-keyword')?.value || '').trim().toLowerCase();
    const filtered = unifiedLogs.filter((r) => {
      if (moduleVal !== 'all' && r.module !== moduleVal) return false;
      if (statusVal !== 'all' && r.status !== statusVal) return false;
      if (!kw) return true;
      const text = `${r.task_id} ${r.mode} ${r.status} ${r.module}`.toLowerCase();
      return text.includes(kw);
    });
    if (!filtered.length) {
      listEl.innerHTML = '<p class="text-slate-400">暂无匹配记录。</p>';
      if (detailEl) detailEl.innerHTML = '';
      return;
    }
    const body = filtered.map((r) => `<tr class="unilog-row" data-module="${r.module}" data-task-id="${escapeHtml(r.task_id)}">
      <td class="mono">${escapeHtml(r.module.toUpperCase())}</td>
      <td class="mono">${escapeHtml(r.task_id)}</td>
      <td class="mono">${escapeHtml(r.mode)}</td>
      <td class="mono">${escapeHtml(r.status)}</td>
      <td class="mono">${escapeHtml(formatTs(r.started_at))}</td>
      <td class="mono">${r.pass_count}/${r.fail_count}</td>
      <td><button class="dl-btn unilog-dl" data-module="${r.module}" data-task-id="${escapeHtml(r.task_id)}">日志</button></td>
    </tr>`).join('');
    listEl.innerHTML = `<div class="table-wrap"><table><thead><tr><th>模块</th><th>任务ID</th><th>类型/模式</th><th>状态</th><th>时间</th><th>通过/失败</th><th>操作</th></tr></thead><tbody>${body}</tbody></table></div>`;
    listEl.querySelectorAll('.unilog-row').forEach((tr) => {
      tr.addEventListener('click', () => {
        loadUnifiedLogDetail(tr.getAttribute('data-module'), tr.getAttribute('data-task-id'));
      });
    });
    listEl.querySelectorAll('.unilog-dl').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const m = btn.getAttribute('data-module');
        const t = btn.getAttribute('data-task-id');
        window.open(`/api/${m}/results/${t}/log`, '_blank');
      });
    });
  }

  async function loadUnifiedLogs() {
    if (!PHASE1_ENABLED) return;
    const listEl = document.getElementById('logs-list');
    if (listEl) listEl.innerHTML = '<p class="text-slate-400">加载中...</p>';
    try {
      const [dcgmi, ib, eth] = await Promise.all([
        apiGet('/api/dcgmi/results').catch(() => []),
        apiGet('/api/ib/results').catch(() => []),
        apiGet('/api/eth/results').catch(() => []),
      ]);
      unifiedLogs = [
        ...normalizeUnifiedLogs('dcgmi', dcgmi),
        ...normalizeUnifiedLogs('ib', ib),
        ...normalizeUnifiedLogs('eth', eth),
      ].sort((a, b) => b.started_sort - a.started_sort);
      renderUnifiedLogsTable();
    } catch (err) {
      if (listEl) showFeedback(listEl, err.message || '加载失败', 'error');
    }
  }

  function bindUnifiedLogsControls() {
    if (logsBound || !PHASE1_ENABLED) return;
    logsBound = true;
    ['logs-filter-module', 'logs-filter-status', 'logs-filter-keyword'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(id === 'logs-filter-keyword' ? 'input' : 'change', renderUnifiedLogsTable);
    });
    const btn = document.getElementById('btn-logs-refresh');
    if (btn) btn.addEventListener('click', loadUnifiedLogs);
  }

  async function loadUnifiedLogDetail(moduleName, taskId) {
    const detailEl = document.getElementById('logs-detail');
    if (!detailEl) return;
    detailEl.innerHTML = '<p class="text-slate-400">加载中...</p>';
    try {
      const summary = await apiGet(`/api/${moduleName}/results/${taskId}/summary`);
      let html = `<h4 class="text-md font-bold mb-2">任务详情: ${escapeHtml(taskId)} (${escapeHtml(moduleName.toUpperCase())})</h4>`;
      if (moduleName === 'dcgmi') html += renderDcgmiBatchSummary(summary);
      else if (moduleName === 'ib') html += renderBatchSummary(summary);
      else html += renderEthBatchSummary(summary);
      detailEl.innerHTML = html;
    } catch (err) {
      showFeedback(detailEl, err.message || '加载详情失败', 'error');
    }
  }

  // ---- One-click pipeline
  let oneclickBound = false;
  let oneclickState = {
    running: false,
    stopRequested: false,
    activeTask: null,
    activeStep: null,
    elapsedTimer: null,
    startMs: 0,
  };

  function initOneclickPanel() {
    if (!PHASE1_ENABLED || oneclickBound) return;
    oneclickBound = true;
    const startBtn = document.getElementById('btn-oneclick-start');
    const stopBtn = document.getElementById('btn-oneclick-stop');
    if (startBtn) startBtn.addEventListener('click', startOneclickRun);
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        if (!oneclickState.running) return;
        oneclickState.stopRequested = true;
        stopBtn.disabled = true;
        if (oneclickState.activeStep === 'eth' && oneclickState.activeTask) {
          fetch(`/api/eth/batch/${oneclickState.activeTask}/cancel`, { method: 'POST' }).catch(() => {});
        }
      });
    }
    renderOneclickSteps();
  }

  function renderOneclickSteps() {
    const el = document.getElementById('oneclick-steps');
    if (!el) return;
    const mk = (id, title) => `<div class="phase1-step" id="oneclick-step-${id}">
      <div class="phase1-step-head">
        <span class="phase1-step-title">${escapeHtml(title)}</span>
        <span class="phase1-step-status" id="oneclick-step-${id}-status">未开始</span>
      </div>
      <div class="phase1-step-detail" id="oneclick-step-${id}-detail">-</div>
    </div>`;
    el.innerHTML = mk('ping', 'Step 1: PING') + mk('eth', 'Step 2: 以太网') + mk('dcgmi', 'Step 3: DCGMI') + mk('ib', 'Step 4: IB');
  }

  function setOneclickStep(step, status, detail) {
    const sEl = document.getElementById(`oneclick-step-${step}-status`);
    const dEl = document.getElementById(`oneclick-step-${step}-detail`);
    const card = document.getElementById(`oneclick-step-${step}`);
    if (sEl) sEl.textContent = status;
    if (dEl) dEl.textContent = detail || '-';
    if (card) {
      card.classList.remove('step-running', 'step-ok', 'step-fail', 'step-skip');
      if (status === '运行中') card.classList.add('step-running');
      else if (status === '完成') card.classList.add('step-ok');
      else if (status === '失败') card.classList.add('step-fail');
      else if (status === '跳过') card.classList.add('step-skip');
    }
  }

  function setOneclickRunningUi(running) {
    const startBtn = document.getElementById('btn-oneclick-start');
    const stopBtn = document.getElementById('btn-oneclick-stop');
    if (startBtn) startBtn.disabled = running;
    if (stopBtn) {
      if (running) {
        stopBtn.classList.remove('hidden');
        stopBtn.disabled = false;
      } else {
        stopBtn.classList.add('hidden');
      }
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runOneclickPingStep() {
    const hostData = await apiGet('/api/hosts');
    const hosts = hostData.hosts || [];
    const pingRows = await mapLimit(hosts, 10, async (h) => {
      try {
        const p = await apiGet(`/api/hosts/${h.id}/ping`);
        return !!p.online;
      } catch (_) {
        return false;
      }
    });
    const online = pingRows.filter(Boolean).length;
    return { total: hosts.length, online, offline: hosts.length - online };
  }

  async function runAndPollBatch(startPath, payload, statusPathBuilder, kind) {
    const startResp = await apiPost(startPath, payload);
    const taskId = startResp.task_id;
    oneclickState.activeTask = taskId;
    while (true) {
      if (oneclickState.stopRequested && kind !== 'eth') {
        return { status: 'detached', task_id: taskId };
      }
      const s = await apiGet(statusPathBuilder(taskId));
      if (s.status === 'running') {
        let detail = '运行中';
        if (typeof s.completed_pairs === 'number') detail = `${s.completed_pairs}/${s.total_pairs || '?'} 对`;
        if (typeof s.completed_hosts === 'number') detail = `${s.completed_hosts}/${s.total_hosts || '?'} 台`;
        if (kind === 'eth') setOneclickStep('eth', '运行中', detail);
        if (kind === 'dcgmi') setOneclickStep('dcgmi', '运行中', detail);
        if (kind === 'ib') setOneclickStep('ib', '运行中', detail);
        if (oneclickState.stopRequested && kind === 'eth') {
          fetch(`/api/eth/batch/${taskId}/cancel`, { method: 'POST' }).catch(() => {});
        }
        await sleep(3000);
        continue;
      }
      return { ...s, task_id: taskId };
    }
  }

  async function startOneclickRun() {
    if (oneclickState.running) return;
    initOneclickPanel();
    renderOneclickSteps();
    const summaryEl = document.getElementById('oneclick-summary');
    if (summaryEl) summaryEl.innerHTML = '';
    const enableIb = !!document.getElementById('oneclick-enable-ib')?.checked;
    const ibType = document.getElementById('oneclick-ib-type')?.value || 'bandwidth';
    const ibBidir = !!document.getElementById('oneclick-ib-bidir')?.checked;
    const ethMode = document.getElementById('oneclick-eth-mode')?.value || 'fullmesh';
    const dcgmiLevel = Number(document.getElementById('oneclick-dcgmi-level')?.value || 1);

    oneclickState.running = true;
    oneclickState.stopRequested = false;
    oneclickState.activeTask = null;
    oneclickState.activeStep = null;
    oneclickState.startMs = Date.now();
    setOneclickRunningUi(true);
    const elapsedEl = document.getElementById('oneclick-elapsed');
    if (oneclickState.elapsedTimer) clearInterval(oneclickState.elapsedTimer);
    oneclickState.elapsedTimer = setInterval(() => {
      if (!elapsedEl) return;
      elapsedEl.textContent = `总耗时：${Math.floor((Date.now() - oneclickState.startMs) / 1000)} 秒`;
    }, 1000);

    let hadFailure = false;
    try {
      oneclickState.activeStep = 'ping';
      setOneclickStep('ping', '运行中', '正在探测所有设备');
      try {
        const ping = await runOneclickPingStep();
        setOneclickStep('ping', '完成', `在线 ${ping.online}/${ping.total}，离线 ${ping.offline}`);
      } catch (e) {
        hadFailure = true;
        setOneclickStep('ping', '失败', e.message || 'PING 阶段失败');
      }
      if (oneclickState.stopRequested) {
        setOneclickStep('eth', '跳过', '用户停止后续步骤');
        setOneclickStep('dcgmi', '跳过', '用户停止后续步骤');
        setOneclickStep('ib', '跳过', '用户停止后续步骤');
        return;
      }

      oneclickState.activeStep = 'eth';
      setOneclickStep('eth', '运行中', '正在启动批量以太网测试');
      try {
        const ethStatus = await runAndPollBatch('/api/eth/batch', { mode: ethMode }, (tid) => `/api/eth/batch/${tid}/status`, 'eth');
        if (ethStatus.status === 'completed' || ethStatus.status === 'cancelled') {
          setOneclickStep('eth', '完成', ethStatus.status === 'cancelled' ? '任务被停止（已保存部分结果）' : '批量测试完成');
        } else if (ethStatus.status === 'detached') {
          setOneclickStep('eth', '跳过', '已停止轮询，后台继续执行');
        } else {
          hadFailure = true;
          setOneclickStep('eth', '失败', ethStatus.error || '任务失败');
        }
      } catch (e) {
        hadFailure = true;
        setOneclickStep('eth', '失败', e.message || '以太网阶段失败');
      }
      if (oneclickState.stopRequested) {
        setOneclickStep('dcgmi', '跳过', '用户停止后续步骤');
        setOneclickStep('ib', '跳过', '用户停止后续步骤');
        return;
      }

      oneclickState.activeStep = 'dcgmi';
      setOneclickStep('dcgmi', '运行中', `Level ${dcgmiLevel}`);
      try {
        const dcgmiStatus = await runAndPollBatch('/api/dcgmi/batch', { level: dcgmiLevel }, (tid) => `/api/dcgmi/batch/${tid}/status`, 'dcgmi');
        if (dcgmiStatus.status === 'completed') setOneclickStep('dcgmi', '完成', '批量诊断完成');
        else if (dcgmiStatus.status === 'detached') setOneclickStep('dcgmi', '跳过', '已停止轮询，后台继续执行');
        else {
          hadFailure = true;
          setOneclickStep('dcgmi', '失败', dcgmiStatus.error || '任务失败');
        }
      } catch (e) {
        hadFailure = true;
        setOneclickStep('dcgmi', '失败', e.message || 'DCGMI 阶段失败');
      }
      if (oneclickState.stopRequested) {
        setOneclickStep('ib', '跳过', '用户停止后续步骤');
        return;
      }

      if (!enableIb) {
        setOneclickStep('ib', '跳过', '配置为不执行 IB 测试');
      } else {
        oneclickState.activeStep = 'ib';
        setOneclickStep('ib', '运行中', '正在启动批量测试');
        try {
          const ibStatus = await runAndPollBatch('/api/ib/test/batch', { test_type: ibType, bidirectional: ibBidir }, (tid) => `/api/ib/test/batch/${tid}/status`, 'ib');
          if (ibStatus.status === 'completed') setOneclickStep('ib', '完成', '批量测试完成');
          else if (ibStatus.status === 'detached') setOneclickStep('ib', '跳过', '已停止轮询，后台继续执行');
          else {
            hadFailure = true;
            setOneclickStep('ib', '失败', ibStatus.error || '任务失败');
          }
        } catch (e) {
          hadFailure = true;
          setOneclickStep('ib', '失败', e.message || 'IB 阶段失败');
        }
      }
    } catch (err) {
      if (summaryEl) showFeedback(summaryEl, err.message || '一键巡检失败', 'error');
    } finally {
      oneclickState.running = false;
      oneclickState.activeTask = null;
      oneclickState.activeStep = null;
      if (oneclickState.elapsedTimer) clearInterval(oneclickState.elapsedTimer);
      oneclickState.elapsedTimer = null;
      setOneclickRunningUi(false);
      if (summaryEl) {
        if (oneclickState.stopRequested) showFeedback(summaryEl, '已停止后续步骤。已启动任务可能仍在后台执行。', 'info');
        else if (hadFailure) showFeedback(summaryEl, '一键巡检已结束，部分阶段失败，请查看步骤详情。', 'info');
        else showFeedback(summaryEl, '一键巡检流程执行结束。', 'success');
      }
    }
  }

  // =========================================================================
  // Init
  // =========================================================================

  applyPhase1Visibility();
  initMockModeBadge();
  bindUnifiedLogsControls();
  setupUploadDnD();
  setSelectedHostBadge();
  showPanel('import');
  refreshHostList();
})();
