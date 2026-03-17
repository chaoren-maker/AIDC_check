(function () {
  let selectedHostId = null;
  let selectedHostLabel = '';
  let selectedFile = null;

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

    const panel = document.getElementById(`panel-${panelId}`);
    if (panel) {
      panel.classList.add('visible');
    }
    const navBtn = document.querySelector(`.panel-switch[data-panel="${panelId}"]`);
    if (navBtn) {
      navBtn.classList.add('active');
    }

    if (panelId === 'hosts') refreshHostList();
    if (panelId === 'connectivity') { /* manual trigger via button */ }
    if (panelId === 'numa' && selectedHostId !== null) loadNuma();
    if (panelId === 'versions' && selectedHostId !== null) loadVersions();
    if (panelId === 'metrics' && selectedHostId !== null) loadMetrics();
    if (panelId === 'ib-topo') loadIbTopo();
    if (panelId === 'ib-cards' && selectedHostId !== null) loadIbCards();
    if (panelId === 'ib-test') { populateIbHostSelects(); loadIbHistory(); }
  }

  document.querySelectorAll('.panel-switch[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      showPanel(btn.getAttribute('data-panel'));
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
    if (!content || !setHint('inspection-hint')) {
      if (content) content.innerHTML = '';
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

  function setupUploadDnD() {
    const pickBtn = document.getElementById('btn-pick-file');
    const importBtn = document.getElementById('btn-import');

    pickBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      setSelectedFile(els.fileInput.files && els.fileInput.files[0]);
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
    });

    importBtn.addEventListener('click', () => {
      const file = selectedFile || (els.fileInput.files && els.fileInput.files[0]);
      if (!file) {
        showFeedback(els.importResult, '请先选择 Excel 文件', 'error');
        return;
      }
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
        ['Server', 'Client', '速率', 'Server BW(Gb/s)', 'Client BW(Gb/s)', '阈值(Gb/s)', '结果'],
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
        ['Server', 'Client', '速率', '消息大小', '延迟(μs)', '阈值(μs)', '结果'],
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
          ['Server', 'Client', '速率', 'Server BW(Gb/s)', 'Client BW(Gb/s)', '阈值(Gb/s)', '结果'],
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
          ['Server', 'Client', '速率', '消息大小', '延迟(μs)', '阈值(μs)', '结果'],
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
  // Init
  // =========================================================================

  setupUploadDnD();
  setSelectedHostBadge();
  showPanel('import');
  refreshHostList();
})();
