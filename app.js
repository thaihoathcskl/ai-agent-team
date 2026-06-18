// AgentTeam Studio Frontend Client Controller

const API_BASE = window.location.origin;

// State management
let clientState = {
  settings: {},
  agentStatus: {},
  dataMeta: {},
  logs: [],
  currentData: null,
  activeTab: 'tab-ingest'
};

// Video player state
let isPlaying = false;
let currentSceneIndex = 0;
let sceneTimeout = null;
let synthAudioContext = null;
let synthInterval = null;
let speechUtterance = null;

// Recording state variables
let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];
let recordAudioDest = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupEventListeners();
  setupDragAndDrop();
  setupThumbnailGenerator();
  
  // Start polling loops
  pollStatus();
  pollLogs();
  setInterval(pollStatus, 3000);
  setInterval(pollLogs, 3000);

  // Initial draw of thumbnail
  drawThumbnail();
  
  // Load browser voices list
  setupVoiceSelector();
});

// ----------------------------------------------------
// API Connection & Polling
// ----------------------------------------------------
async function pollStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    const data = await res.json();
    
    clientState.settings = data.settings;
    clientState.agentStatus = data.agentStatus;
    clientState.dataMeta = data.dataMeta;

    updateAgentNodesUI();
    updateSchedulerStatusUI();
    
    // Auto-update data to keep UI in sync automatically
    fetchData();
  } catch (err) {
    console.error('Error polling status:', err);
  }
}

async function pollLogs() {
  try {
    const res = await fetch(`${API_BASE}/api/logs`);
    const data = await res.json();
    
    // Only update if logs changed
    if (data.logs.length !== clientState.logs.length) {
      clientState.logs = data.logs;
      const terminal = document.getElementById('log-terminal');
      terminal.innerHTML = clientState.logs
        .map(line => `<div class="log-line">${escapeHTML(line)}</div>`)
        .join('');
      terminal.scrollTop = terminal.scrollHeight;
    }
  } catch (err) {
    console.error('Error polling logs:', err);
  }
}

async function fetchData() {
  try {
    const res = await fetch(`${API_BASE}/api/data`);
    const result = await res.json();
    clientState.currentData = result.data;
    
    // Populate form fields
    const rawContentEl = document.getElementById('txt-raw-content');
    if (result.data.rawText && !rawContentEl.matches(':focus')) {
      rawContentEl.value = result.data.rawText;
    }

    const summaryEl = document.getElementById('txt-summary');
    if (result.data.summary && !summaryEl.matches(':focus')) {
      summaryEl.value = result.data.summary;
    }

    const scriptEl = document.getElementById('txt-script');
    if (result.data.script && !scriptEl.matches(':focus')) {
      scriptEl.value = result.data.script;
    }

    // Storyboard compilation
    if (result.data.storyboard && result.data.storyboard.length > 0) {
      renderStoryboard(result.data.storyboard);
      document.getElementById('btn-play-video').disabled = false;
      document.getElementById('btn-record-video').disabled = false;
    } else {
      document.getElementById('btn-play-video').disabled = true;
      document.getElementById('btn-record-video').disabled = true;
    }

    // YouTube publish panel metadata
    if (result.data.youtubeMetadata) {
      const titleEl = document.getElementById('pub-title');
      const descEl = document.getElementById('pub-description');
      const tagsEl = document.getElementById('pub-tags');
      const privacyEl = document.getElementById('pub-privacy');
      const catEl = document.getElementById('pub-category');

      if (!titleEl.matches(':focus')) titleEl.value = result.data.youtubeMetadata.title;
      if (!descEl.matches(':focus')) descEl.value = result.data.youtubeMetadata.description;
      if (!tagsEl.matches(':focus')) tagsEl.value = result.data.youtubeMetadata.tags;
      privacyEl.value = result.data.youtubeMetadata.privacyStatus;
      catEl.value = result.data.youtubeMetadata.category;

      // Update thumbnail canvas title text
      document.getElementById('thumb-text').value = result.data.youtubeMetadata.title;
      drawThumbnail();
    }
  } catch (err) {
    console.error('Error fetching data:', err);
  }
}

// ----------------------------------------------------
// UI Updates & Interactions
// ----------------------------------------------------
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const tabId = tab.getAttribute('data-tab');
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      clientState.activeTab = tabId;

      // Trigger fetch when user views tab
      fetchData();
      
      // Auto-draw canvas sizes if tab elements become visible
      if (tabId === 'tab-video') {
        initVideoCanvas();
      }
    });
  });
}

function updateAgentNodesUI() {
  const agents = ['ingester', 'summarizer', 'writer', 'director', 'publisher'];
  agents.forEach(agent => {
    const node = document.getElementById(`node-${agent}`);
    if (!node) return;

    const status = clientState.agentStatus[agent];
    node.className = `agent-node ${status}`;

    let statusText = 'Đang chờ...';
    if (status === 'active') {
      statusText = '🤖 Đang chạy...';
    } else if (status === 'success') {
      statusText = '✅ Đã hoàn thành';
    } else if (status === 'error') {
      statusText = '❌ Bị lỗi';
    }

    node.querySelector('.node-status').textContent = statusText;
  });
}

function updateSchedulerStatusUI() {
  const indicator = document.querySelector('.status-indicator span');
  const text = document.getElementById('scheduler-status-text');
  
  if (clientState.settings.isAutoScheduleActive) {
    indicator.className = 'pulse-green';
    text.textContent = `Lên lịch: Bật (5h / 6h)`;
  } else {
    indicator.className = '';
    text.style.backgroundColor = '#64748b';
    indicator.style.boxShadow = 'none';
    text.textContent = 'Lên lịch: Tắt';
  }
}

// ----------------------------------------------------
// Actions & Handlers
// ----------------------------------------------------
function setupEventListeners() {
  // Run all pipeline
  document.getElementById('btn-run-all').addEventListener('click', async () => {
    try {
      const rawText = document.getElementById('txt-raw-content').value.trim();
      let source = null;
      
      if (rawText) {
        source = { type: 'text', data: rawText, name: 'Nhập trực tiếp' };
      }

      const res = await fetch(`${API_BASE}/api/run-ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source })
      });
      const data = await res.json();
      alert(data.message);
    } catch (err) {
      alert('Không thể chạy hệ thống: ' + err.message);
    }
  });

  // Run Web/RSS Ingest
  document.getElementById('btn-run-web').addEventListener('click', async () => {
    const url = document.getElementById('input-url').value.trim();
    if (!url) return alert('Vui lòng nhập URL!');
    
    try {
      const res = await fetch(`${API_BASE}/api/run-ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: { type: 'url', data: url, name: url }
        })
      });
      const data = await res.json();
      alert('Đang cào dữ liệu từ trang web...');
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  });

  // Save edits
  document.getElementById('btn-save-summary').addEventListener('click', () => saveEdits('summary', 'txt-summary'));
  document.getElementById('btn-save-script').addEventListener('click', () => saveEdits('script', 'txt-script'));

  // Video play controller
  document.getElementById('btn-play-video').addEventListener('click', toggleVideoPlayer);

  // Video record controller
  document.getElementById('btn-record-video').addEventListener('click', startRecording);

  // Publish YouTube trigger
  document.getElementById('btn-publish-youtube').addEventListener('click', runPublishPipeline);

  // Clear logs
  document.getElementById('btn-clear-logs').addEventListener('click', async () => {
    await fetch(`${API_BASE}/api/clear-logs`, { method: 'POST' });
    pollLogs();
  });

  // Modal Settings
  const settingsModal = document.getElementById('modal-settings');
  
  // Provider change listener to fill default model
  document.getElementById('cfg-api-provider').addEventListener('change', (e) => {
    const prov = e.target.value;
    const modelInput = document.getElementById('cfg-api-model');
    if (prov === 'gemini') {
      modelInput.value = 'gemini-2.5-flash';
    } else if (prov === 'groq') {
      modelInput.value = 'llama-3.3-70b-versatile';
    } else if (prov === 'openrouter') {
      modelInput.value = 'google/gemini-2.5-flash';
    } else if (prov === 'ollama') {
      modelInput.value = 'qwen2.5:1.5b';
    }
  });

  document.getElementById('btn-open-settings').addEventListener('click', () => {
    // Fill settings modal
    const provider = clientState.settings.apiProvider || 'gemini';
    document.getElementById('cfg-api-provider').value = provider;
    
    // Default model if blank
    let model = clientState.settings.apiModel || '';
    if (!model) {
      if (provider === 'gemini') model = 'gemini-2.5-flash';
      else if (provider === 'groq') model = 'llama-3.3-70b-versatile';
      else if (provider === 'openrouter') model = 'google/gemini-2.5-flash';
      else if (provider === 'ollama') model = 'qwen2.5:1.5b';
    }
    document.getElementById('cfg-api-model').value = model;
    
    document.getElementById('cfg-api-key').value = clientState.settings.apiKey || clientState.settings.geminiApiKey || localStorage.getItem('gemini_api_key') || '';
    document.getElementById('cfg-rss-url').value = clientState.settings.rssFeedUrl || '';
    document.getElementById('cfg-ingest-dir').value = clientState.settings.ingestDirectory || '';
    document.getElementById('cfg-ingest-time').value = clientState.settings.ingestTime || '05:00';
    document.getElementById('cfg-publish-time').value = clientState.settings.publishTime || '06:00';
    document.getElementById('cfg-scheduler-enable').checked = clientState.settings.isAutoScheduleActive || false;
    
    settingsModal.classList.add('active');
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    settingsModal.classList.remove('active');
  });

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const provider = document.getElementById('cfg-api-provider').value;
    const model = document.getElementById('cfg-api-model').value.trim();
    const key = document.getElementById('cfg-api-key').value.trim();
    
    if (key && provider === 'gemini') {
      localStorage.setItem('gemini_api_key', key);
    }
    
    const body = {
      apiProvider: provider,
      apiModel: model,
      apiKey: key,
      geminiApiKey: key, // maintain backward compatibility
      rssFeedUrl: document.getElementById('cfg-rss-url').value.trim(),
      ingestDirectory: document.getElementById('cfg-ingest-dir').value.trim(),
      ingestTime: document.getElementById('cfg-ingest-time').value,
      publishTime: document.getElementById('cfg-publish-time').value,
      isAutoScheduleActive: document.getElementById('cfg-scheduler-enable').checked
    };

    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        alert('Đã cập nhật cài đặt hệ thống!');
        settingsModal.classList.remove('active');
        pollStatus();
      }
    } catch (e) {
      alert('Không thể lưu cài đặt: ' + e.message);
    }
  });
}

async function saveEdits(type, elementId) {
  const content = document.getElementById(elementId).value;
  try {
    const body = {};
    body[type] = content;
    const res = await fetch(`${API_BASE}/api/save-edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) alert('Đã lưu nội dung chỉnh sửa!');
  } catch (err) {
    alert('Lỗi khi lưu chỉnh sửa: ' + err.message);
  }
}

// ----------------------------------------------------
// Drag & Drop Ingestion Parser (Client-Side)
// ----------------------------------------------------
function setupDragAndDrop() {
  const zone = document.getElementById('drag-drop-zone');
  const fileInput = document.getElementById('file-upload');
  const infoBar = document.getElementById('file-info');
  const nameDisplay = document.getElementById('file-name-display');
  const cancelBtn = document.getElementById('btn-cancel-file');
  const rawTextarea = document.getElementById('txt-raw-content');

  // Prevent defaults
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    zone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // Visual cues
  ['dragenter', 'dragover'].forEach(eventName => {
    zone.addEventListener(eventName, () => zone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    zone.addEventListener(eventName, () => zone.classList.remove('dragover'), false);
  });

  // Handle drop
  zone.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files);
  });

  fileInput.addEventListener('change', e => {
    handleFiles(e.target.files);
  });

  cancelBtn.addEventListener('click', () => {
    infoBar.style.display = 'none';
    fileInput.value = '';
    rawTextarea.value = '';
  });

  function handleFiles(files) {
    if (files.length === 0) return;
    const file = files[0];
    nameDisplay.textContent = `${file.name} (${formatBytes(file.size)})`;
    infoBar.style.display = 'flex';

    const reader = new FileReader();

    if (file.name.endsWith('.txt')) {
      reader.onload = e => {
        rawTextarea.value = e.target.result;
      };
      reader.readAsText(file);
    } else if (file.name.endsWith('.docx')) {
      reader.onload = function(loadEvent) {
        const arrayBuffer = loadEvent.target.result;
        mammoth.extractRawText({ arrayBuffer: arrayBuffer })
          .then(result => {
            rawTextarea.value = result.value;
          })
          .catch(err => {
            alert('Lỗi phân tích file Word: ' + err.message);
          });
      };
      reader.readAsArrayBuffer(file);
    } else if (file.name.endsWith('.pdf')) {
      reader.onload = function() {
        const typedarray = new Uint8Array(this.result);
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
        pdfjsLib.getDocument(typedarray).promise.then(pdf => {
          let maxPages = pdf.numPages;
          let countPromises = [];
          
          for (let j = 1; j <= maxPages; j++) {
            const pagePromise = pdf.getPage(j).then(page => {
              return page.getTextContent().then(textContent => {
                return textContent.items.map(item => item.str).join(' ');
              });
            });
            countPromises.push(pagePromise);
          }

          Promise.all(countPromises).then(texts => {
            rawTextarea.value = texts.join('\n\n');
          });
        }).catch(err => {
          alert('Lỗi phân tích PDF: ' + err.message);
        });
      };
      reader.readAsArrayBuffer(file);
    } else {
      alert('Định dạng tệp không được hỗ trợ. Hãy tải lên PDF, Docx hoặc Txt.');
    }
  }
}

// ----------------------------------------------------
// Video Storyboard & Player Simulation (Canvas, Speech TTS, Audio Web Synthesis)
// ----------------------------------------------------
function renderStoryboard(storyboard) {
  const container = document.getElementById('storyboard-list-container');
  if (storyboard.length === 0) {
    container.innerHTML = `<div class="storyboard-empty-state">Chưa có storyboard.</div>`;
    return;
  }

  container.innerHTML = storyboard.map((scene, i) => `
    <div class="storyboard-card" id="scene-card-${i}" onclick="jumpToScene(${i})">
      <div class="scene-meta">
        <span>CẢNH ${scene.id}</span>
        <span>⏱ ${scene.duration} giây</span>
      </div>
      <div class="scene-visual"><strong>Visual:</strong> ${scene.visual}</div>
      <div class="scene-script">💬 "${scene.script}"</div>
      <div class="scene-music" style="font-size:0.75rem; color:#d946ef; margin-top:4px;">🎵 Nhạc nền: ${scene.bgMusic}</div>
    </div>
  `).join('');
}

function initVideoCanvas() {
  const canvas = document.getElementById('video-canvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.fillStyle = '#94a3b8';
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Nhấp phát để chạy thử kịch bản video của bạn', canvas.width / 2, canvas.height / 2);
}

function jumpToScene(index) {
  if (!clientState.currentData || !clientState.currentData.storyboard) return;
  currentSceneIndex = index;
  drawScene(clientState.currentData.storyboard[index], 0, 8000);
  highlightSceneCard(index);
}

function drawScene(scene, elapsed = 0, durationMs = 8000) {
  const canvas = document.getElementById('video-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // 1. Compute transitions fade alpha
  let alpha = 1;
  if (isPlaying) {
    // Fade in first 500ms
    if (elapsed < 500) {
      alpha = elapsed / 500;
    }
    // Fade out last 500ms
    else if (durationMs - elapsed < 500) {
      alpha = Math.max(0, (durationMs - elapsed) / 500);
    }
  }

  // 2. Clear background with theme-based gradients based on scene ID
  const grad = ctx.createLinearGradient(0, 0, w, h);
  if (scene.id % 4 === 1) {
    grad.addColorStop(0, '#1e1b4b'); // indigo-dark
    grad.addColorStop(1, '#311042'); // purple-dark
  } else if (scene.id % 4 === 2) {
    grad.addColorStop(0, '#0f172a'); // slate-dark
    grad.addColorStop(1, '#1e293b'); // blue-dark
  } else if (scene.id % 4 === 3) {
    grad.addColorStop(0, '#022c22'); // emerald-dark
    grad.addColorStop(1, '#064e3b'); // teal-dark
  } else {
    grad.addColorStop(0, '#450a0a'); // red-dark
    grad.addColorStop(1, '#581c87'); // deep-purple
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 3. Draw Cyber Tech Grid Accent
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  for (let i = 0; i < w; i += 50) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
  }
  for (let i = 0; i < h; i += 50) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
  }

  // 4. Floating particles animation
  const time = Date.now() / 1000;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  for (let p = 0; p < 15; p++) {
    const px = ((p * 73 + time * (10 + p % 5)) % w);
    const py = ((p * 127 - time * (15 + p % 3)) % h + h) % h;
    const size = 1.2 + (p % 3) * 0.8;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Glassmorphism Card in Center
  const cardW = w - 120;
  const cardH = h - 150;
  const cardX = 60;
  const cardY = 50;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 18;
  
  // Card background
  ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 12);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 6. Icon selection logic based on scene keyword
  let icon = '💡';
  const visualLower = scene.visual.toLowerCase();
  const scriptLower = scene.script.toLowerCase();
  if (visualLower.includes('biểu đồ') || visualLower.includes('đồ thị') || visualLower.includes('số liệu') || visualLower.includes('analytics')) icon = '📊';
  else if (visualLower.includes('chào') || visualLower.includes('giới thiệu') || visualLower.includes('tiêu đề') || visualLower.includes('welcome')) icon = '👋';
  else if (visualLower.includes('giải pháp') || visualLower.includes('chìa khóa') || visualLower.includes('bước') || visualLower.includes('solution')) icon = '🎯';
  else if (visualLower.includes('đăng ký') || visualLower.includes('like') || visualLower.includes('subscribe') || visualLower.includes('kênh')) icon = '🚀';
  else if (visualLower.includes('chú ý') || visualLower.includes('cảnh báo') || visualLower.includes('warning') || visualLower.includes('đặc biệt')) icon = '⚠️';

  // Draw glowing icon circle
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.beginPath();
  ctx.arc(cardX + 60, cardY + cardH / 2, 40, 0, Math.PI * 2);
  ctx.fill();
  
  // Glowing border around icon
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw Icon
  ctx.font = '40px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(icon, cardX + 60, cardY + cardH / 2 + 14);
  ctx.restore();

  // 7. Draw Visual & Scene Metadata inside Card
  ctx.save();
  ctx.globalAlpha = alpha;
  
  // Scene title
  ctx.fillStyle = '#60a5fa'; // neon blue
  ctx.font = 'bold 15px Outfit, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`CẢNH ${scene.id} • ${scene.bgMusic.toUpperCase()}`, cardX + 130, cardY + 45);

  // Divider line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX + 130, cardY + 58);
  ctx.lineTo(cardX + cardW - 30, cardY + 58);
  ctx.stroke();

  // Draw Prompt details
  ctx.fillStyle = '#94a3b8'; // gray
  ctx.font = 'italic 12px Inter, sans-serif';
  ctx.fillText('Ý tưởng hiển thị cảnh quay:', cardX + 130, cardY + 78);

  ctx.fillStyle = '#f8fafc'; // slate-white
  ctx.font = 'normal 13px Inter, sans-serif';
  
  // Wrap visual description text
  const visualText = scene.visual;
  const words = visualText.split(' ');
  let line = '';
  let textY = cardY + 98;
  for (let n = 0; n < words.length; n++) {
    let testLine = line + words[n] + ' ';
    let metrics = ctx.measureText(testLine);
    if (metrics.width > cardW - 170 && n > 0) {
      ctx.fillText(line, cardX + 130, textY);
      line = words[n] + ' ';
      textY += 22;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, cardX + 130, textY);
  ctx.restore();

  // 8. Draw Subtitles Capsule at the bottom
  const subY = h - 65;
  ctx.save();
  ctx.globalAlpha = alpha;
  
  // Capsule bg
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(40, subY, w - 80, 42, 8);
  ctx.fill();
  ctx.stroke();

  // Subtitle text
  ctx.fillStyle = '#ffffff';
  ctx.font = '500 13px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(scene.script, w / 2, subY + 26);
  ctx.restore();

  // External subtitle box update
  const subtitleBox = document.getElementById('subtitle-box');
  if (subtitleBox) subtitleBox.textContent = scene.script;
}

function highlightSceneCard(index) {
  document.querySelectorAll('.storyboard-card').forEach((c, idx) => {
    if (idx === index) c.classList.add('active-scene');
    else c.classList.remove('active-scene');
  });
}

function toggleVideoPlayer() {
  if (isPlaying) {
    pauseVideo();
  } else {
    playVideo();
  }
}

function playVideo() {
  const storyboard = clientState.currentData?.storyboard;
  if (!storyboard || storyboard.length === 0) return;

  isPlaying = true;
  document.getElementById('btn-play-video').innerHTML = '<span class="material-icons-round">pause</span>';
  
  // Web Audio Context Synthesizer
  initSynthSound();

  playSceneSequence();
}

function playSceneSequence() {
  const storyboard = clientState.currentData.storyboard;
  if (currentSceneIndex >= storyboard.length) {
    // Reset to beginning
    currentSceneIndex = 0;
  }

  const scene = storyboard[currentSceneIndex];
  drawScene(scene, 0, durationMs);
  highlightSceneCard(currentSceneIndex);

  // TTS Narrator
  speakSceneScript(scene.script);

  const durationMs = scene.duration * 1000;
  let elapsed = 0;

  // Animation Loop on canvas during scene
  const animInterval = setInterval(() => {
    if (!isPlaying) {
      clearInterval(animInterval);
      return;
    }
    drawScene(scene, elapsed, durationMs);
    
    // Progress calculation
    const overallProgress = ((currentSceneIndex + (elapsed / durationMs)) / storyboard.length) * 100;
    document.getElementById('player-progress-bar').style.width = `${overallProgress}%`;
    
    elapsed += 100;
  }, 100);

  sceneTimeout = setTimeout(() => {
    clearInterval(animInterval);
    currentSceneIndex++;
    if (currentSceneIndex < storyboard.length) {
      playSceneSequence();
    } else {
      // Completed playlist
      if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      pauseVideo();
      currentSceneIndex = 0;
      document.getElementById('player-progress-bar').style.width = `100%`;
      document.getElementById('subtitle-box').textContent = "Trình phát đã hoàn thành video.";
    }
  }, durationMs);
}

function pauseVideo() {
  isPlaying = false;
  document.getElementById('btn-play-video').innerHTML = '<span class="material-icons-round">play_arrow</span>';
  
  if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  
  if (sceneTimeout) clearTimeout(sceneTimeout);
  if (speechUtterance) window.speechSynthesis.cancel();
  stopSynthSound();
}

function speakSceneScript(text) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    speechUtterance = new SpeechSynthesisUtterance(text);
    
    const select = document.getElementById('video-voice-select');
    if (select && select.value) {
      const voices = window.speechSynthesis.getVoices();
      const chosen = voices.find(v => v.name === select.value);
      if (chosen) speechUtterance.voice = chosen;
    } else {
      // Fallback to Vietnamese
      const voices = window.speechSynthesis.getVoices();
      const viVoice = voices.find(v => v.lang.includes('vi') || v.lang.includes('VN'));
      if (viVoice) speechUtterance.voice = viVoice;
    }

    speechUtterance.rate = 1.0;
    window.speechSynthesis.speak(speechUtterance);
  }
}

// ----------------------------------------------------
// Ambient Sound Synthesizer (Web Audio API)
// ----------------------------------------------------
function initSynthSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    synthAudioContext = new AudioContextClass();
    
    if (isRecording) {
      recordAudioDest = synthAudioContext.createMediaStreamDestination();
    }
    
    // Play a gentle chord loop sequence
    let step = 0;
    const notes = [261.63, 329.63, 392.00, 523.25]; // C chord tones
    
    synthInterval = setInterval(() => {
      if (!synthAudioContext) return;
      
      const osc = synthAudioContext.createOscillator();
      const gain = synthAudioContext.createGain();
      
      osc.connect(gain);
      gain.connect(synthAudioContext.destination);
      if (isRecording && recordAudioDest) {
        gain.connect(recordAudioDest);
      }
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(notes[step % notes.length], synthAudioContext.currentTime);
      
      gain.gain.setValueAtTime(0.06, synthAudioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, synthAudioContext.currentTime + 1.8);
      
      osc.start();
      osc.stop(synthAudioContext.currentTime + 2);
      
      step++;
    }, 1500);
  } catch (e) {
    console.error('Web Audio Synth failed:', e);
  }
}

function stopSynthSound() {
  if (synthInterval) clearInterval(synthInterval);
  if (synthAudioContext) {
    synthAudioContext.close();
    synthAudioContext = null;
  }
}

// ----------------------------------------------------
// YouTube Thumbnail Canvas Generator
// ----------------------------------------------------
function setupThumbnailGenerator() {
  document.getElementById('thumb-text').addEventListener('input', drawThumbnail);
  document.getElementById('thumb-bg-style').addEventListener('change', drawThumbnail);
}

function drawThumbnail() {
  const canvas = document.getElementById('thumbnail-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const style = document.getElementById('thumb-bg-style').value;
  const text = document.getElementById('thumb-text').value.toUpperCase();

  // Draw background gradients
  const grad = ctx.createLinearGradient(0, 0, w, h);
  if (style === 'neon') {
    grad.addColorStop(0, '#7c3aed'); // Purple
    grad.addColorStop(1, '#06b6d4'); // Cyan
  } else if (style === 'sunset') {
    grad.addColorStop(0, '#f97316'); // Orange
    grad.addColorStop(1, '#ef4444'); // Red
  } else if (style === 'forest') {
    grad.addColorStop(0, '#10b981'); // Emerald
    grad.addColorStop(1, '#06b6d4'); // Cyan
  } else {
    grad.addColorStop(0, '#1e293b'); // Slate
    grad.addColorStop(1, '#0f172a'); // Black
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Overlay neon glow border
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, w, h);

  // Tech Grid Accent
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  for (let i = 0; i < w; i += 20) {
    ctx.fillRect(i, 0, 1, h);
  }

  // Draw an AI Glowing Orb badge
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(w - 60, h/2, 45, 0, Math.PI*2);
  ctx.fill();
  ctx.font = '24px sans-serif';
  ctx.fillText('🤖', w - 74, h/2 + 8);

  // Draw Title Text
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 6;
  ctx.textAlign = 'left';
  
  // Wrap lines for thumbnail
  ctx.font = '800 16px Outfit, sans-serif';
  const words = text.split(' ');
  let line = '';
  let y = h / 2 - 15;
  
  for(let n = 0; n < words.length; n++) {
    let testLine = line + words[n] + ' ';
    let metrics = ctx.measureText(testLine);
    let testWidth = metrics.width;
    if (testWidth > w - 120 && n > 0) {
      ctx.fillText(line, 20, y);
      line = words[n] + ' ';
      y += 20;
    }
    else {
      line = testLine;
    }
  }
  ctx.fillText(line, 20, y);
  
  // Reset shadow
  ctx.shadowBlur = 0;

  // Render YouTube Badge banner overlay
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(20, h - 35, 65, 18);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 9px sans-serif';
  ctx.fillText('YOUTUBE', 26, h - 23);
}

// ----------------------------------------------------
// Step-by-Step Publishing Pipeline (YouTube)
// ----------------------------------------------------
async function runPublishPipeline() {
  const card = document.getElementById('upload-status-card');
  const stepAuth = document.getElementById('step-auth');
  const stepMeta = document.getElementById('step-meta');
  const stepProc = document.getElementById('step-processing');
  const successBox = document.getElementById('success-url-box');

  // Display upload section
  card.style.display = 'block';
  successBox.style.display = 'none';
  stepAuth.className = 'upload-step active';
  stepMeta.className = 'upload-step';
  stepProc.className = 'upload-step';

  try {
    // 1. Auth Simulation
    await new Promise(r => setTimeout(r, 1500));
    stepAuth.className = 'upload-step success';
    stepMeta.className = 'upload-step active';

    // Call server to trigger backend simulate upload
    const body = {
      title: document.getElementById('pub-title').value,
      description: document.getElementById('pub-description').value,
      tags: document.getElementById('pub-tags').value,
      privacyStatus: document.getElementById('pub-privacy').value
    };

    const res = await fetch(`${API_BASE}/api/run-publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    // 2. Metadata Upload Simulation
    await new Promise(r => setTimeout(r, 2000));
    stepMeta.className = 'upload-step success';
    stepProc.className = 'upload-step active';

    // 3. Waiting for Youtube Render
    await new Promise(r => setTimeout(r, 2500));
    stepProc.className = 'upload-step success';

    // Complete upload
    await pollStatus();
    await fetchData();

    const link = document.getElementById('publish-link');
    link.href = clientState.currentData?.publishUrl || '#';
    successBox.style.display = 'block';

  } catch (err) {
    alert('Lỗi đăng video: ' + err.message);
  }
}

// ----------------------------------------------------
// General Helpers
// ----------------------------------------------------
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function setupVoiceSelector() {
  if (typeof speechSynthesis === 'undefined') return;
  
  const populateVoices = () => {
    const voices = speechSynthesis.getVoices();
    const select = document.getElementById('video-voice-select');
    if (!select) return;
    
    const prevSelected = select.value;
    select.innerHTML = '';
    
    // Sort Vietnamese (vi) voices first
    const sorted = [...voices].sort((a, b) => {
      const aVi = a.lang.includes('vi') || a.lang.includes('VN');
      const bVi = b.lang.includes('vi') || b.lang.includes('VN');
      if (aVi && !bVi) return -1;
      if (!aVi && bVi) return 1;
      return a.name.localeCompare(b.name);
    });

    sorted.forEach(voice => {
      const opt = document.createElement('option');
      opt.value = voice.name;
      opt.textContent = `${voice.name} (${voice.lang})`;
      if (voice.name === prevSelected) {
        opt.selected = true;
      } else if (!prevSelected && (voice.lang.includes('vi') || voice.lang.includes('VN'))) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  };

  populateVoices();
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = populateVoices;
  }
}

function startRecording() {
  const canvas = document.getElementById('video-canvas');
  if (!canvas) return;
  
  recordedChunks = [];
  isRecording = true;
  
  // Capture canvas stream (30 fps)
  const canvasStream = canvas.captureStream(30);
  
  // Reset sequence index
  currentSceneIndex = 0;
  
  isPlaying = true;
  document.getElementById('btn-play-video').innerHTML = '<span class="material-icons-round">pause</span>';
  document.getElementById('btn-record-video').innerHTML = '<span class="material-icons-round">fiber_manual_record</span> Đang Ghi...';
  document.getElementById('btn-record-video').disabled = true;
  document.getElementById('btn-play-video').disabled = true;
  
  // Start synthesis sound
  initSynthSound();
  
  // Combine canvas and audio stream if recordAudioDest is initialized
  let combinedStream = canvasStream;
  if (recordAudioDest && recordAudioDest.stream) {
    const audioTrack = recordAudioDest.stream.getAudioTracks()[0];
    if (audioTrack) {
      combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        audioTrack
      ]);
    }
  }
  
  // WebM codecs
  let options = { mimeType: 'video/webm;codecs=vp9,opus' };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    options = { mimeType: 'video/webm;codecs=vp8,opus' };
  }
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    options = { mimeType: 'video/webm' };
  }
  
  try {
    mediaRecorder = new MediaRecorder(combinedStream, options);
    mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'video-ai-agent.webm';
      a.click();
      
      isRecording = false;
      document.getElementById('btn-record-video').innerHTML = '<span class="material-icons-round">videocam</span> Ghi & Tải Video (WebM)';
      document.getElementById('btn-record-video').disabled = false;
      document.getElementById('btn-play-video').disabled = false;
    };
    
    mediaRecorder.start();
    
    // Start playing the scenes
    playSceneSequence();
  } catch (err) {
    console.error('Lỗi khi ghi video:', err);
    alert('Không thể ghi video trên trình duyệt này: ' + err.message);
    isRecording = false;
    pauseVideo();
  }
}
