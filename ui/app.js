// LiteMerge - Vanilla JS Desktop Frontend
(() => {
  'use strict';

  // Tauri Invoke Bridge
  const getTauriInvoke = () => {
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      return window.__TAURI__.core.invoke;
    }
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      return window.__TAURI_INTERNALS__.invoke;
    }
    return null;
  };

  const getTauriListen = () => {
    if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
      return window.__TAURI__.event.listen;
    }
    return null;
  };

  const invoke = (cmd, args) => {
    const fn = getTauriInvoke();
    if (!fn) {
      console.warn(`Tauri invoke not found for ${cmd}. Running in preview mode.`);
      return Promise.reject(new Error('Tauri API is not available'));
    }
    return fn(cmd, args);
  };

  const listen = (event, callback) => {
    const fn = getTauriListen();
    if (fn) {
      return fn(event, callback);
    }
    return Promise.resolve(() => {});
  };

  // State
  const state = {
    files: [], // Array of FileInfo
    outputPath: '',
    isMerging: false,
    libreOffice: {
      is_available: false,
      path: null,
      version: null,
    },
  };

  // DOM Elements
  const el = {
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    loStatusBadge: document.getElementById('loStatusBadge'),
    loStatusText: document.getElementById('loStatusText'),
    dropZone: document.getElementById('dropZone'),
    browseBtn: document.getElementById('browseBtn'),
    fileInput: document.getElementById('fileInput'),
    fileCountBadge: document.getElementById('fileCountBadge'),
    clearAllBtn: document.getElementById('clearAllBtn'),
    emptyState: document.getElementById('emptyState'),
    fileList: document.getElementById('fileList'),
    outputPathInput: document.getElementById('outputPathInput'),
    chooseOutputBtn: document.getElementById('chooseOutputBtn'),
    mergeBtn: document.getElementById('mergeBtn'),
    progressSection: document.getElementById('progressSection'),
    progressStep: document.getElementById('progressStep'),
    progressPercent: document.getElementById('progressPercent'),
    progressBarFill: document.getElementById('progressBarFill'),
    alertSuccess: document.getElementById('alertSuccess'),
    successTitle: document.getElementById('successTitle'),
    successMsg: document.getElementById('successMsg'),
    alertError: document.getElementById('alertError'),
    errorMsg: document.getElementById('errorMsg'),
  };

  // Theme Management
  const initTheme = () => {
    const stored = localStorage.getItem('litemerge_theme');
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = stored || (systemPrefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', initialTheme);

    el.themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('litemerge_theme', next);
    });
  };

  // LibreOffice Status
  const checkLibreOfficeStatus = async () => {
    try {
      const status = await invoke('check_libreoffice_cmd');
      state.libreOffice = status;

      el.loStatusBadge.classList.remove('checking', 'available', 'unavailable');

      if (status.is_available) {
        el.loStatusBadge.classList.add('available');
        el.loStatusText.textContent = 'LibreOffice Ready';
        el.loStatusBadge.title = `LibreOffice detected: ${status.version || status.path}\nPPT and PPTX conversion is enabled.`;
      } else {
        el.loStatusBadge.classList.add('unavailable');
        el.loStatusText.textContent = 'PDF Only Mode';
        el.loStatusBadge.title = 'LibreOffice was not detected. PowerPoint files (.ppt, .pptx) require LibreOffice to be converted.\nDirect PDF merging works fully without LibreOffice.';
      }
    } catch (err) {
      console.error('Failed to check LibreOffice status:', err);
      el.loStatusBadge.classList.add('unavailable');
      el.loStatusText.textContent = 'PDF Mode';
    }
  };

  // Render File List
  const renderFileList = () => {
    const count = state.files.length;
    el.fileCountBadge.textContent = count;

    if (count === 0) {
      el.emptyState.style.display = 'flex';
      el.fileList.style.display = 'none';
      el.clearAllBtn.style.display = 'none';
    } else {
      el.emptyState.style.display = 'none';
      el.fileList.style.display = 'block';
      el.clearAllBtn.style.display = 'inline-block';
    }

    el.fileList.innerHTML = '';

    state.files.forEach((file, index) => {
      const li = document.createElement('li');
      li.className = 'file-item';
      li.draggable = !state.isMerging;
      li.dataset.index = index;

      const extClass = (file.extension || 'pdf').toLowerCase();

      li.innerHTML = `
        <span class="file-index">${index + 1}</span>
        <span class="file-badge ${extClass}">${file.extension.toUpperCase()}</span>
        <div class="file-info" title="${escapeHtml(file.path)}">
          <div class="file-name">${escapeHtml(file.name)}</div>
          <div class="file-meta">
            <span>${file.size_formatted}</span>
            ${file.is_presentation && !state.libreOffice.is_available ? '<span style="color:var(--warning-text);font-weight:600;">(Needs LibreOffice)</span>' : ''}
          </div>
        </div>
        <div class="file-actions">
          <button type="button" class="action-btn btn-up" data-action="up" title="Move Up" ${index === 0 || state.isMerging ? 'disabled' : ''}>▲</button>
          <button type="button" class="action-btn btn-down" data-action="down" title="Move Down" ${index === count - 1 || state.isMerging ? 'disabled' : ''}>▼</button>
          <button type="button" class="action-btn btn-remove" data-action="remove" title="Remove File" ${state.isMerging ? 'disabled' : ''}>✕</button>
        </div>
      `;

      // Drag to reorder inside list
      li.addEventListener('dragstart', handleDragStart);
      li.addEventListener('dragover', handleDragOver);
      li.addEventListener('drop', handleDropReorder);
      li.addEventListener('dragend', handleDragEnd);

      el.fileList.appendChild(li);
    });

    updateMergeButtonState();
  };

  // Helper Escape HTML
  const escapeHtml = (str) => {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[m]));
  };

  // Reorder Actions
  const moveFile = (index, delta) => {
    const newIndex = index + delta;
    if (newIndex < 0 || newIndex >= state.files.length) return;
    const temp = state.files[index];
    state.files[index] = state.files[newIndex];
    state.files[newIndex] = temp;
    renderFileList();
  };

  const removeFile = (index) => {
    state.files.splice(index, 1);
    renderFileList();
  };

  // Reorder Drag & Drop in List
  let dragSrcEl = null;

  function handleDragStart(e) {
    if (state.isMerging) return;
    dragSrcEl = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.index);
    this.classList.add('dragging');
  }

  function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
  }

  function handleDropReorder(e) {
    if (e.stopPropagation) e.stopPropagation();
    if (dragSrcEl !== this) {
      const srcIdx = parseInt(dragSrcEl.dataset.index, 10);
      const targetIdx = parseInt(this.dataset.index, 10);
      const [moved] = state.files.splice(srcIdx, 1);
      state.files.splice(targetIdx, 0, moved);
      renderFileList();
    }
    return false;
  }

  function handleDragEnd() {
    this.classList.remove('dragging');
  }

  // File List Click Handler
  el.fileList.addEventListener('click', (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn || btn.disabled) return;
    const item = btn.closest('.file-item');
    if (!item) return;
    const index = parseInt(item.dataset.index, 10);
    const action = btn.dataset.action;

    if (action === 'up') moveFile(index, -1);
    else if (action === 'down') moveFile(index, 1);
    else if (action === 'remove') removeFile(index);
  });

  // Add Files
  const addFiles = (newFiles) => {
    if (!Array.isArray(newFiles) || newFiles.length === 0) return;

    let addedCount = 0;
    let hasPptWithoutLO = false;

    for (const f of newFiles) {
      // Prevent duplicates by identical path
      if (!state.files.some(existing => existing.path === f.path)) {
        state.files.push(f);
        addedCount++;
        if (f.is_presentation && !state.libreOffice.is_available) {
          hasPptWithoutLO = true;
        }
      }
    }

    if (addedCount > 0) {
      renderFileList();
      hideAlerts();

      // Automatically suggest output path if not set yet
      if (!state.outputPath && state.files.length > 0) {
        suggestOutputPath(state.files[0].path);
      }

      if (hasPptWithoutLO) {
        showError('One or more presentation files (.ppt, .pptx) were added, but LibreOffice was not detected. Please install LibreOffice or remove presentation files before merging.');
      }
    }
  };

  // Suggest default output path
  const suggestOutputPath = (samplePath) => {
    if (!samplePath) return;
    // Replace last path segment with merged_document.pdf
    const lastSlash = Math.max(samplePath.lastIndexOf('/'), samplePath.lastIndexOf('\\'));
    if (lastSlash !== -1) {
      const dir = samplePath.substring(0, lastSlash + 1);
      state.outputPath = `${dir}merged_document.pdf`;
      el.outputPathInput.value = state.outputPath;
      updateMergeButtonState();
    }
  };

  // Pick Files
  const handlePickFiles = async () => {
    hideAlerts();
    try {
      const files = await invoke('pick_files_cmd');
      addFiles(files);
    } catch (err) {
      showError(`Failed to pick files: ${err}`);
    }
  };

  // Pick Output Location
  const handlePickOutputLocation = async () => {
    hideAlerts();
    try {
      const defaultName = 'merged_document.pdf';
      const chosen = await invoke('pick_save_location_cmd', { defaultName });
      if (chosen) {
        state.outputPath = chosen;
        el.outputPathInput.value = chosen;
        updateMergeButtonState();
      }
    } catch (err) {
      showError(`Failed to select save location: ${err}`);
    }
  };

  // Drag and Drop Zone
  el.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.dropZone.classList.add('dragover');
  });

  el.dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.dropZone.classList.remove('dragover');
  });

  el.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.dropZone.classList.remove('dragover');
  });

  // Listen for native OS file drop from Tauri
  listen('native-file-drop', async (event) => {
    const paths = event.payload;
    if (Array.isArray(paths) && paths.length > 0) {
      try {
        const fileInfos = await invoke('process_dropped_paths_cmd', { paths });
        addFiles(fileInfos);
      } catch (err) {
        showError(`Error reading dropped files: ${err}`);
      }
    }
  });

  // Listen for merge-progress events
  listen('merge-progress', (event) => {
    const payload = event.payload;
    if (payload) {
      const pct = Math.min(100, Math.max(0, payload.percent || 0));
      el.progressPercent.textContent = `${pct}%`;
      el.progressBarFill.style.width = `${pct}%`;
      el.progressStep.textContent = payload.step || 'Processing...';
    }
  });

  // Update Merge Button State
  const updateMergeButtonState = () => {
    const fileCount = state.files.length;
    const hasEnoughFiles = fileCount >= 1;
    const hasOutputPath = Boolean(state.outputPath && state.outputPath.trim());

    el.mergeBtn.disabled = !hasEnoughFiles || !hasOutputPath || state.isMerging;

    if (fileCount > 0) {
      el.mergeBtn.querySelector('span').textContent = `Merge ${fileCount} File${fileCount > 1 ? 's' : ''} into PDF`;
    } else {
      el.mergeBtn.querySelector('span').textContent = 'Merge Files';
    }
  };

  // Perform Merge
  const handleMerge = async () => {
    if (state.files.length === 0) {
      showError('Please add at least one document to merge.');
      return;
    }

    if (!state.outputPath || !state.outputPath.trim()) {
      showError('Please choose an output save location and filename.');
      return;
    }

    // Check if PPT files exist without LibreOffice
    const hasPpt = state.files.some(f => f.is_presentation);
    if (hasPpt && !state.libreOffice.is_available) {
      showError('One or more PowerPoint presentations are in the list, but LibreOffice is not installed. Please install LibreOffice or remove presentation files before merging.');
      return;
    }

    hideAlerts();
    state.isMerging = true;
    updateMergeButtonState();

    el.progressSection.style.display = 'block';
    el.progressPercent.textContent = '0%';
    el.progressBarFill.style.width = '0%';
    el.progressStep.textContent = 'Initializing merger...';

    const filePaths = state.files.map(f => f.path);
    const outputPath = state.outputPath;

    try {
      const response = await invoke('merge_files_cmd', {
        request: {
          file_paths: filePaths,
          output_path: outputPath,
        },
      });

      // Complete
      el.progressBarFill.style.width = '100%';
      el.progressPercent.textContent = '100%';
      el.progressStep.textContent = 'Merge complete!';

      showSuccess(
        `Successfully merged ${state.files.length} document${state.files.length > 1 ? 's' : ''} (${response.total_pages} pages, ${response.file_size_formatted})!`,
        `Saved to: ${response.output_path}`
      );
    } catch (err) {
      console.error('Merge error:', err);
      showError(typeof err === 'string' ? err : (err.message || 'An unknown error occurred during merging.'));
      el.progressSection.style.display = 'none';
    } finally {
      state.isMerging = false;
      updateMergeButtonState();
    }
  };

  // Alerts
  const showSuccess = (title, msg) => {
    el.alertError.style.display = 'none';
    el.successTitle.textContent = title;
    el.successMsg.textContent = msg;
    el.alertSuccess.style.display = 'flex';
  };

  const showError = (msg) => {
    el.alertSuccess.style.display = 'none';
    el.errorMsg.textContent = msg;
    el.alertError.style.display = 'flex';
  };

  const hideAlerts = () => {
    el.alertSuccess.style.display = 'none';
    el.alertError.style.display = 'none';
  };

  // Event Listeners
  el.browseBtn.addEventListener('click', handlePickFiles);
  el.dropZone.addEventListener('click', (e) => {
    if (e.target !== el.browseBtn) {
      handlePickFiles();
    }
  });

  el.chooseOutputBtn.addEventListener('click', handlePickOutputLocation);
  el.mergeBtn.addEventListener('click', handleMerge);

  el.clearAllBtn.addEventListener('click', () => {
    if (state.isMerging) return;
    state.files = [];
    renderFileList();
    hideAlerts();
    el.progressSection.style.display = 'none';
  });

  // Initialization
  initTheme();
  checkLibreOfficeStatus();
  renderFileList();
})();

