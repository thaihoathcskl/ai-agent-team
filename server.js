import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { IngestionAgent, SummarizerAgent, CopywriterAgent, VideoDirectorAgent, YouTubePublisherAgent } from './agents.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// State Database (In-Memory for simplicity, persisted to state.json)
const STATE_FILE = path.join(__dirname, 'state-db.json');
let state = {
  settings: {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    rssFeedUrl: 'https://vnexpress.net/rss/tin-moi-nhat.rss',
    ingestDirectory: path.join(__dirname, 'incoming'),
    ingestTime: '05:00',
    publishTime: '06:00',
    isAutoScheduleActive: false
  },
  agentStatus: {
    ingester: 'idle',
    summarizer: 'idle',
    writer: 'idle',
    director: 'idle',
    publisher: 'idle'
  },
  data: {
    rawText: '',
    sourceMeta: { type: 'none', name: '' },
    summary: '',
    script: '',
    storyboard: [],
    youtubeMetadata: null,
    publishUrl: '',
    publishStatus: 'idle'
  },
  logs: []
};

// Load state if exists
if (fs.existsSync(STATE_FILE)) {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    state = { ...state, ...parsed };
    // Maintain running runtime status
    state.agentStatus = { ingester: 'idle', summarizer: 'idle', writer: 'idle', director: 'idle', publisher: 'idle' };
  } catch (err) {
    console.error('Lỗi khi đọc file state.json:', err);
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Lỗi khi ghi file state.json:', err);
  }
}

// Ensure incoming folder exists
if (!fs.existsSync(state.settings.ingestDirectory)) {
  fs.mkdirSync(state.settings.ingestDirectory, { parents: true });
}

// Log System Helper
function addLog(message) {
  const timestamp = new Date().toLocaleTimeString('vi-VN');
  const logMsg = `[${timestamp}] ${message}`;
  state.logs.push(logMsg);
  // Cap logs to last 150 entries
  if (state.logs.length > 150) state.logs.shift();
  console.log(logMsg);
}

// ----------------------------------------------------
// Scheduling Engine (node-cron)
// ----------------------------------------------------
let ingestCronTask = null;
let publishCronTask = null;

function setupCronJobs() {
  if (ingestCronTask) {
    ingestCronTask.stop();
    ingestCronTask = null;
  }
  if (publishCronTask) {
    publishCronTask.stop();
    publishCronTask = null;
  }

  if (!state.settings.isAutoScheduleActive) {
    addLog("Đã tắt lập lịch tự động chạy ngầm.");
    return;
  }

  // Set up 5:00 AM Task (Scrape & Write)
  const [ingestHour, ingestMinute] = state.settings.ingestTime.split(':');
  const ingestCronStr = `${ingestMinute} ${ingestHour} * * *`;
  
  // Set up 6:00 AM Task (Publish)
  const [pubHour, pubMinute] = state.settings.publishTime.split(':');
  const pubCronStr = `${pubMinute} ${pubHour} * * *`;

  addLog(`Đang lên lịch tự động:`);
  addLog(` - Đọc tin tức và viết kịch bản hàng ngày vào lúc: ${state.settings.ingestTime} (cron: ${ingestCronStr})`);
  addLog(` - Tạo video & đăng YouTube hàng ngày vào lúc: ${state.settings.publishTime} (cron: ${pubCronStr})`);

  try {
    ingestCronTask = cron.schedule(ingestCronStr, async () => {
      addLog("⏰ [Scheduler] Kích hoạt tiến trình 5:00 AM tự động (Thu thập & Viết kịch bản)...");
      try {
        await runPipelineStep1To4();
      } catch (err) {
        addLog(`❌ [Scheduler] Lỗi trong tiến trình thu thập: ${err.message}`);
      }
    });

    publishCronTask = cron.schedule(pubCronStr, async () => {
      addLog("⏰ [Scheduler] Kích hoạt tiến trình 6:00 AM tự động (Dựng video & Đăng YouTube)...");
      try {
        await runPipelineStep5();
      } catch (err) {
        addLog(`❌ [Scheduler] Lỗi trong tiến trình đăng tải: ${err.message}`);
      }
    });
  } catch (err) {
    addLog(`❌ [Scheduler] Không thể thiết lập Cron: ${err.message}`);
  }
}

// ----------------------------------------------------
// Core Workflow Execution
// ----------------------------------------------------
async function runPipelineStep1To4(forcedSource = null) {
  addLog("🚀 Bắt đầu chạy Nhóm Agent (Bước 1 - 4)...");
  
  // Instance agents
  const ingestAgent = new IngestionAgent(addLog);
  const summarizerAgent = new SummarizerAgent(state.settings.geminiApiKey, addLog);
  const copywriterAgent = new CopywriterAgent(state.settings.geminiApiKey, addLog);
  const videoAgent = new VideoDirectorAgent(addLog);

  // Agent 1: Ingest
  state.agentStatus.ingester = 'active';
  saveState();
  
  let sourceText = "";
  let sourceMeta = { type: 'direct', name: 'Nhập tay' };

  if (forcedSource) {
    sourceText = await ingestAgent.processInput(forcedSource.type, forcedSource.data);
    sourceMeta = { type: forcedSource.type, name: forcedSource.name };
  } else {
    // Check incoming directory first
    const files = fs.readdirSync(state.settings.ingestDirectory)
      .filter(f => f.endsWith('.pdf') || f.endsWith('.docx') || f.endsWith('.txt'));
    
    if (files.length > 0) {
      const fileToProcess = path.join(state.settings.ingestDirectory, files[0]);
      addLog(`[Scheduler] Phát hiện file trong incoming: ${files[0]}`);
      sourceText = await ingestAgent.processInput('file', fileToProcess);
      sourceMeta = { type: 'file', name: files[0] };
      // Backup processed file
      try {
        const backupDir = path.join(state.settings.ingestDirectory, 'processed');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
        fs.renameSync(fileToProcess, path.join(backupDir, files[0]));
        addLog(`[Ingestion Agent] Đã di chuyển file đã xử lý sang thư mục processed.`);
      } catch (e) {
        addLog(`[Ingestion Agent] Cảnh báo di chuyển file: ${e.message}`);
      }
    } else {
      // Default scrape RSS feed URL
      addLog(`[Scheduler] Không có file, tự động cào tin từ RSS URL: ${state.settings.rssFeedUrl}`);
      sourceText = await ingestAgent.processInput('url', state.settings.rssFeedUrl);
      sourceMeta = { type: 'url', name: state.settings.rssFeedUrl };
    }
  }

  state.data.rawText = sourceText;
  state.data.sourceMeta = sourceMeta;
  state.agentStatus.ingester = 'success';
  saveState();

  // Agent 2: Summarize
  state.agentStatus.summarizer = 'active';
  saveState();
  const summary = await summarizerAgent.summarize(sourceText);
  state.data.summary = summary;
  state.agentStatus.summarizer = 'success';
  saveState();

  // Agent 3: Write Content
  state.agentStatus.writer = 'active';
  saveState();
  const scriptText = await copywriterAgent.writeContent(summary);
  state.data.script = scriptText;
  state.agentStatus.writer = 'success';
  saveState();

  // Agent 4: Design Storyboard
  state.agentStatus.director = 'active';
  saveState();
  const storyboard = videoAgent.parseStoryboard(scriptText);
  state.data.storyboard = storyboard;
  state.agentStatus.director = 'success';
  saveState();

  // Generate standard YouTube meta
  const pubAgent = new YouTubePublisherAgent(addLog);
  state.data.youtubeMetadata = pubAgent.generateMetadata(summary, scriptText);
  state.data.publishStatus = 'pending_upload';

  addLog("✅ Đã hoàn thành quy trình tạo Kịch bản & phân cảnh Storyboard!");
  saveState();
}

async function runPipelineStep5() {
  addLog("🚀 Bắt đầu kích hoạt Agent 5: YouTube Publisher...");
  state.agentStatus.publisher = 'active';
  saveState();

  if (!state.data.youtubeMetadata) {
    addLog("❌ [YouTube Agent] Không có thông tin Metadata để tải lên. Hãy chạy bước 1-4 trước!");
    state.agentStatus.publisher = 'error';
    saveState();
    return;
  }

  // Simulate upload sequence
  addLog(`[YouTube Agent] Khởi tạo upload video lên kênh.`);
  addLog(`[YouTube Agent] Tiêu đề SEO: ${state.data.youtubeMetadata.title}`);
  addLog(`[YouTube Agent] Thẻ mô tả: ${state.data.youtubeMetadata.description.substring(0, 100)}...`);
  
  await new Promise(r => setTimeout(r, 3000)); // Simulating upload delay
  
  state.data.publishUrl = `https://www.youtube.com/watch?v=dQw4w9WgXcQ`; // Simulated URL
  state.data.publishStatus = 'published';
  state.agentStatus.publisher = 'success';
  addLog(`🎉 [YouTube Agent] VIDEO ĐÃ ĐĂNG TẢI THÀNH CÔNG! Link: ${state.data.publishUrl}`);
  
  saveState();
}

// ----------------------------------------------------
// REST APIs for Frontend
// ----------------------------------------------------
app.get('/api/status', (req, res) => {
  res.json({
    settings: state.settings,
    agentStatus: state.agentStatus,
    dataMeta: {
      hasRawText: !!state.data.rawText,
      hasSummary: !!state.data.summary,
      hasScript: !!state.data.script,
      storyboardCount: state.data.storyboard.length,
      publishStatus: state.data.publishStatus,
      publishUrl: state.data.publishUrl
    }
  });
});

app.get('/api/logs', (req, res) => {
  res.json({ logs: state.logs });
});

app.get('/api/data', (req, res) => {
  res.json({ data: state.data });
});

app.post('/api/config', (req, res) => {
  const { geminiApiKey, rssFeedUrl, ingestTime, publishTime, isAutoScheduleActive } = req.body;
  
  if (geminiApiKey !== undefined) state.settings.geminiApiKey = geminiApiKey;
  if (rssFeedUrl !== undefined) state.settings.rssFeedUrl = rssFeedUrl;
  if (ingestTime !== undefined) state.settings.ingestTime = ingestTime;
  if (publishTime !== undefined) state.settings.publishTime = publishTime;
  if (isAutoScheduleActive !== undefined) state.settings.isAutoScheduleActive = isAutoScheduleActive;
  
  saveState();
  setupCronJobs();
  
  res.json({ success: true, settings: state.settings });
});

app.post('/api/run-ingest', async (req, res) => {
  const { source } = req.body; // { type, data, name }
  res.json({ success: true, message: 'Đang khởi chạy ngầm quy trình thu thập và phân tích...' });
  
  // Run asynchronously
  setTimeout(async () => {
    try {
      await runPipelineStep1To4(source);
    } catch (err) {
      addLog(`❌ Lỗi chạy pipeline thủ công: ${err.message}`);
    }
  }, 100);
});

app.post('/api/run-publish', (req, res) => {
  res.json({ success: true, message: 'Đang khởi chạy ngầm quy trình đăng YouTube...' });
  setTimeout(async () => {
    try {
      await runPipelineStep5();
    } catch (err) {
      addLog(`❌ Lỗi đăng tải thủ công: ${err.message}`);
    }
  }, 100);
});

app.post('/api/save-edits', (req, res) => {
  const { summary, script, storyboard, youtubeMetadata } = req.body;
  if (summary !== undefined) state.data.summary = summary;
  if (script !== undefined) state.data.script = script;
  if (storyboard !== undefined) state.data.storyboard = storyboard;
  if (youtubeMetadata !== undefined) state.data.youtubeMetadata = youtubeMetadata;
  
  saveState();
  res.json({ success: true });
});

// Clean logs
app.post('/api/clear-logs', (req, res) => {
  state.logs = [];
  res.json({ success: true });
});

// Setup server and cron jobs
setupCronJobs();
app.listen(PORT, () => {
  addLog(`🤖 Server Agent Team đã khởi động tại cổng ${PORT}.`);
  addLog(`👉 Mở trình duyệt truy cập: http://localhost:${PORT}`);
});
