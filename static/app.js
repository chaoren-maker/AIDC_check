(function () {
  let selectedHostId = null;
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
    return String(text || '')
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
    els.selectedHostBadge.textContent = `Host ID: ${selectedHostId}`;
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
    if (panelId === 'numa' && selectedHostId !== null) loadNuma();
    if (panelId === 'versions' && selectedHostId !== null) loadVersions();
    if (panelId === 'metrics' && selectedHostId !== null) loadMetrics();
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

  function buildTable(headers, rows, rowClassResolver) {
    const th = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const body = rows
      .map((row, idx) => {
        const cls = rowClassResolver ? rowClassResolver(row, idx) : '';
        return `<tr class="${cls}">${row.map((c) => `<td class="mono">${escapeHtml(c)}</td>`).join('')}</tr>`;
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

        const rows = hosts.map((host) => [
          host.id,
          host.host_ip || '',
          host.username || '',
          host.ssh_port || 22,
          host.remark || '-',
        ]);

        const html = buildTable(
          ['ID', 'IP / 主机', '用户名', '端口', '备注'],
          rows,
          (row) => (Number(row[0]) === selectedHostId ? 'selected host-row' : 'host-row')
        );

        els.hostListWrap.innerHTML = html;
        els.hostListWrap.querySelectorAll('tbody tr').forEach((tr) => {
          tr.style.cursor = 'pointer';
          tr.addEventListener('click', () => {
            const idText = tr.querySelector('td') ? tr.querySelector('td').textContent : '';
            selectedHostId = Number(idText);
            setSelectedHostBadge();
            refreshHostList();
          });
        });
      })
      .catch((err) => {
        showFeedback(els.hostListWrap, err.message, 'error');
      });
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
        const sections = [];

        if (Array.isArray(data.nodes) && data.nodes.length > 0) {
          const rows = data.nodes.map((n) => [
            n.node_id != null ? n.node_id : '-',
            Array.isArray(n.cpus) && n.cpus.length ? `${n.cpus.slice(0, 18).join(', ')}${n.cpus.length > 18 ? '...' : ''}` : '-',
            n.memory_mb != null ? n.memory_mb : '-',
            Array.isArray(n.gpus) && n.gpus.length ? n.gpus.join(', ') : '-',
          ]);
          sections.push(`<h3 class="text-lg font-bold mb-2">NUMA 节点</h3>${buildTable(['NUMA', 'CPU 列表', '内存(MB)', 'GPU 索引'], rows)}`);
        }

        if (Array.isArray(data.gpus) && data.gpus.length > 0) {
          const rows = data.gpus.map((g) => [g.gpu_index != null ? g.gpu_index : '-', g.numa_node != null ? g.numa_node : '-']);
          sections.push(`<h3 class="text-lg font-bold mt-6 mb-2">GPU / NUMA 绑定</h3>${buildTable(['GPU', 'NUMA 节点'], rows)}`);
        }

        content.innerHTML = sections.join('') || '<p class="text-slate-400">无数据或远程未安装 numactl / nvidia-smi。</p>';
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
    Promise.all([
      apiGet(`/api/hosts/${selectedHostId}/versions/gpu`),
      apiGet(`/api/hosts/${selectedHostId}/versions/nic`),
      apiGet(`/api/hosts/${selectedHostId}/versions/server`),
    ])
      .then(([gpu, nic, server]) => {
        const gpuRows = (gpu.gpus || []).map((g, idx) => [
          idx,
          g.name || '-',
          g.driver_version || gpu.driver_version || '-',
          g.vbios_version || '-',
        ]);
        const nicRows = (nic.nics || []).map((n) => [n.device || '-', n.firmware_version || '未知', n.subsystem || '-']);
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
        const optHtml = hosts.map((h) => `<option value="${h.id}">${h.host_ip} (ID:${h.id})</option>`).join('');
        serverSel.innerHTML = optHtml || '<option disabled>请先导入主机</option>';
        clientSel.innerHTML = optHtml || '<option disabled>请先导入主机</option>';
        if (hosts.length >= 2) {
          clientSel.selectedIndex = 1;
        }
      })
      .catch(() => {});
  }

  // =========================================================================
  // IB Test — single pair
  // =========================================================================

  document.getElementById('btn-ib-single-test').addEventListener('click', () => {
    const serverId = Number(document.getElementById('ib-server-select').value);
    const clientId = Number(document.getElementById('ib-client-select').value);
    const testType = document.getElementById('ib-test-type').value;
    const bidirectional = document.getElementById('ib-bidirectional').checked;
    const resultEl = document.getElementById('ib-single-result');

    if (!serverId || !clientId) {
      showFeedback(resultEl, '请选择 Server 和 Client 主机', 'error');
      return;
    }
    if (serverId === clientId) {
      showFeedback(resultEl, 'Server 和 Client 不能是同一台主机', 'error');
      return;
    }

    resultEl.innerHTML = '<div class="ib-running"><div class="spinner"></div>测试执行中，请稍候...</div>';

    const body = testType === 'bandwidth'
      ? { server_id: serverId, client_id: clientId, bidirectional }
      : { server_id: serverId, client_id: clientId };

    apiPost(`/api/ib/test/${testType}`, body)
      .then((data) => {
        resultEl.innerHTML = renderTestResult(data);
      })
      .catch((err) => showFeedback(resultEl, err.message, 'error'));
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
  // Init
  // =========================================================================

  setupUploadDnD();
  setSelectedHostBadge();
  showPanel('import');
  refreshHostList();
})();
