import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

// ----------------------------------------------------
// Agent 1: Ingestion Specialist (PDF, Word, Web Reader)
// ----------------------------------------------------
export class IngestionAgent {
  constructor(logCallback) {
    this.log = logCallback || console.log;
  }

  async readWeb(url) {
    this.log(`[Ingestion Agent] Bắt đầu cào dữ liệu từ URL: ${url}`);
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      const $ = cheerio.load(response.data);
      
      // Remove scripts, styles, navs, footers
      $('script, style, nav, footer, header, iframe, noscript').remove();
      
      // Extract text from main content tags
      let text = $('article, main, .content, .post-content').text().trim();
      if (!text) {
        text = $('body').text().trim();
      }
      
      // Clean up whitespace
      text = text.replace(/\s+/g, ' ');
      this.log(`[Ingestion Agent] Đọc thành công web URL (${text.length} ký tự).`);
      return text;
    } catch (error) {
      this.log(`[Ingestion Agent] Lỗi khi đọc web URL: ${error.message}`);
      throw error;
    }
  }

  async readDocx(filePath) {
    this.log(`[Ingestion Agent] Đọc tài liệu Word: ${path.basename(filePath)}`);
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      this.log(`[Ingestion Agent] Đọc thành công file Word (${result.value.length} ký tự).`);
      return result.value;
    } catch (error) {
      this.log(`[Ingestion Agent] Lỗi khi đọc Word: ${error.message}`);
      throw error;
    }
  }

  async readPdf(filePath) {
    this.log(`[Ingestion Agent] Đọc tài liệu PDF: ${path.basename(filePath)}`);
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      this.log(`[Ingestion Agent] Đọc thành công PDF (${data.text.length} ký tự).`);
      return data.text;
    } catch (error) {
      this.log(`[Ingestion Agent] Lỗi khi đọc PDF: ${error.message}`);
      throw error;
    }
  }

  async processInput(inputType, inputData) {
    if (inputType === 'url') {
      return await this.readWeb(inputData);
    } else if (inputType === 'file') {
      const ext = path.extname(inputData).toLowerCase();
      if (ext === '.pdf') {
        return await this.readPdf(inputData);
      } else if (ext === '.docx') {
        return await this.readDocx(inputData);
      } else {
        // Plain text fallback
        this.log(`[Ingestion Agent] Đọc file text thô: ${path.basename(inputData)}`);
        return fs.readFileSync(inputData, 'utf-8');
      }
    } else {
      this.log(`[Ingestion Agent] Nhận dữ liệu text trực tiếp.`);
      return inputData;
    }
  }
}

// ----------------------------------------------------
// Unified LLM Requester Helper supporting Gemini, Groq, and OpenRouter
// ----------------------------------------------------
async function callLLM(provider, apiKey, modelName, prompt, logCallback = console.log) {
  if (!apiKey) throw new Error("Khóa API Key trống!");
  
  const prov = (provider || 'gemini').toLowerCase().trim();

  if (prov === 'gemini') {
    const model = modelName || 'gemini-2.5-flash';
    logCallback(`[LLM Request] Gọi Gemini API với model: ${model}`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }]
    });
    if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return response.data.candidates[0].content.parts[0].text;
    }
    throw new Error("Không nhận được câu trả lời từ Gemini API.");
  } else if (prov === 'groq') {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const model = modelName || 'llama-3.3-70b-versatile';
    logCallback(`[LLM Request] Gọi Groq API với model: ${model}`);
    const response = await axios.post(url, {
      model: model,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: { 
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    if (response.data?.choices?.[0]?.message?.content) {
      return response.data.choices[0].message.content;
    }
    throw new Error("Không nhận được câu trả lời từ Groq API.");
  } else if (prov === 'openrouter') {
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const model = modelName || 'google/gemini-2.5-flash';
    logCallback(`[LLM Request] Gọi OpenRouter API với model: ${model}`);
    const response = await axios.post(url, {
      model: model,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'AgentTeam Studio'
      }
    });
    if (response.data?.choices?.[0]?.message?.content) {
      return response.data.choices[0].message.content;
    }
    throw new Error("Không nhận được câu trả lời từ OpenRouter API.");
  }
  throw new Error(`Nhà cung cấp API không hợp lệ: ${provider}`);
}

// ----------------------------------------------------
// Agent 2: Synthesis Engine (Summarizer)
// ----------------------------------------------------
export class SummarizerAgent {
  constructor(provider, apiKey, modelName, logCallback) {
    this.provider = provider || 'gemini';
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.log = logCallback || console.log;
  }

  async summarize(rawText) {
    this.log(`[Summarizer Agent] Đang phân tích và tóm tắt tài liệu bằng ${this.provider.toUpperCase()} (${rawText.length} ký tự)...`);
    
    if (this.apiKey) {
      try {
        const prompt = `Bạn là một AI Agent chuyên tóm tắt tin tức và tài liệu. 
Hãy phân tích tài liệu sau đây và tóm tắt thành một bản báo cáo ngắn gọn bằng tiếng Việt bao gồm các phần:
1. Ý tưởng chính (Key Summary)
2. 5 thông tin quan trọng nhất (Top 5 Takeaways)
3. Đối tượng khán giả phù hợp (Target Audience)
4. Giọng điệu đề xuất cho nội dung (Proposed Tone)

Tài liệu cần tóm tắt:
${rawText.slice(0, 15000)}`;

        const text = await callLLM(this.provider, this.apiKey, this.modelName, prompt, this.log);
        this.log(`[Summarizer Agent] Đã tóm tắt thành công bằng ${this.provider.toUpperCase()} API.`);
        return text;
      } catch (error) {
        this.log(`[Summarizer Agent] Lỗi khi gọi ${this.provider.toUpperCase()} API: ${error.message}. Chuyển sang thuật toán dự phòng.`);
      }
    } else {
      this.log(`[Summarizer Agent] Không phát hiện API Key. Sử dụng thuật toán dự phòng.`);
    }

    // Fallback Mock Summarizer
    return this.fallbackSummarize(rawText);
  }

  fallbackSummarize(text) {
    const lines = text.split(/[.\n]/).map(l => l.trim()).filter(l => l.length > 20);
    const keyPoints = lines.slice(0, 5);
    
    let summary = `### 1. Ý tưởng chính (Key Summary)\n`;
    summary += `Dữ liệu phân tích chứa thông tin tổng hợp về chủ đề bài viết, bao gồm nội dung tài liệu gốc (${text.slice(0, 150)}...).\n\n`;
    summary += `### 2. 5 thông tin quan trọng nhất\n`;
    keyPoints.forEach((point, i) => {
      summary += `- ${point}.\n`;
    });
    if (keyPoints.length === 0) {
      summary += `- Nội dung tài liệu thô được cung cấp trực tiếp.\n`;
    }
    summary += `\n### 3. Đối tượng khán giả phù hợp\n`;
    summary += `- Độc giả quan tâm đến tin tức tổng hợp và kiến thức đời sống.\n`;
    summary += `- Người xem video ngắn gọn, súc tích.\n\n`;
    summary += `### 4. Giọng điệu đề xuất\n`;
    summary += `- Chuyên nghiệp, tràn đầy năng lượng và dễ tiếp thu.`;
    
    this.log(`[Summarizer Agent] Đã hoàn thành tóm tắt bằng chế độ dự phòng offline.`);
    return summary;
  }
}

// ----------------------------------------------------
// Agent 3: Creative Writer (Copywriter & Scriptwriter)
// ----------------------------------------------------
export class CopywriterAgent {
  constructor(provider, apiKey, modelName, logCallback) {
    this.provider = provider || 'gemini';
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.log = logCallback || console.log;
  }

  async writeContent(summary, templateType = 'educational') {
    this.log(`[Copywriter Agent] Đang lên kịch bản video bằng ${this.provider.toUpperCase()} theo mẫu: ${templateType}...`);
    
    if (this.apiKey) {
      try {
        const prompt = `Bạn là một biên kịch chuyên nghiệp cho các kênh video triệu view.
Dựa trên bản tóm tắt sau:
${summary}

Hãy viết một bộ tài liệu kịch bản bằng tiếng Việt gồm 2 phần:
PHẦN 1: BÀI VIẾT CONTENT TRUYỀN THÔNG (Dùng để đăng mạng xã hội, website)
PHẦN 2: KỊCH BẢN VIDEO YOUTUBE CHI TIẾT. Kịch bản video phải chia rõ thành các Cảnh (Scenes). Mỗi cảnh viết dưới dạng:
[CẢNH X]
- Thời lượng: [Số giây, ví dụ 10]
- Visual: [Mô tả hình ảnh/slide sẽ hiển thị chi tiết]
- Script: [Lời thoại MC/Voiceover sẽ đọc]
- Background Music: [Gợi ý nhạc nền, ví dụ: Lofi, Epic, Happy]

Kịch bản tối thiểu 4 cảnh.`;

        const text = await callLLM(this.provider, this.apiKey, this.modelName, prompt, this.log);
        this.log(`[Copywriter Agent] Đã viết kịch bản thành công bằng ${this.provider.toUpperCase()} API.`);
        return text;
      } catch (error) {
        this.log(`[Copywriter Agent] Lỗi khi viết kịch bản bằng ${this.provider.toUpperCase()} API: ${error.message}. Chuyển sang mẫu dự phòng.`);
      }
    } else {
      this.log(`[Copywriter Agent] Không phát hiện API Key. Sử dụng mẫu dự phòng.`);
    }

    return this.fallbackWriteContent(summary, templateType);
  }

  fallbackWriteContent(summary, templateType) {
    const textSnippet = summary.replace(/[#\-\d\.]/g, '').slice(0, 100);
    const scenes = [
      {
        id: 1,
        duration: 8,
        visual: 'Hình ảnh tiêu đề nổi bật với hiệu ứng chữ neon nhấp nháy trên nền vũ trụ sâu thẳm.',
        script: 'Chào mừng các bạn đã quay trở lại! Hôm nay chúng ta sẽ cùng khám phá một chủ đề cực kỳ thú vị đang được rất nhiều người quan tâm: ' + textSnippet.trim() + '. Hãy cùng xem ngay nhé!',
        bgMusic: 'Chill Lofi'
      },
      {
        id: 2,
        duration: 12,
        visual: 'Một bảng phân tích dữ liệu dạng lưới 3D, các con số và biểu đồ cột đang tăng trưởng ấn tượng.',
        script: 'Điểm cốt lõi đầu tiên chúng ta cần chú ý là sự tác động mạnh mẽ của thông tin này đối với cuộc sống hàng ngày. Các số liệu thống kê cho thấy sự thay đổi rõ rệt qua từng ngày.',
        bgMusic: 'Tech Ambient'
      },
      {
        id: 3,
        duration: 10,
        visual: 'Slide so sánh 2 cột chia đôi màn hình, một bên là Thử thách, một bên là Giải pháp thiết thực.',
        script: 'Mặc dù có không ít khó khăn ban đầu, giải pháp được đưa ra lại vô cùng đơn giản và ai cũng có thể tự thực hành ngay tại nhà để tối ưu hóa hiệu suất của mình.',
        bgMusic: 'Upbeat Corporate'
      },
      {
        id: 4,
        duration: 8,
        visual: 'Nút Like, Share, Subscribe khổng lồ bay ra cùng lời kêu gọi bấm đăng ký kênh.',
        script: 'Đó là những kiến thức quan trọng nhất hôm nay! Đừng quên bấm Like, Đăng ký kênh và chia sẻ suy nghĩ của bạn dưới phần bình luận nhé. Hẹn gặp lại!',
        bgMusic: 'Happy Acoustic'
      }
    ];

    let content = `PHẦN 1: BÀI VIẾT CONTENT TRUYỀN THÔNG\n\n`;
    content += `🔥 KHÁM PHÁ NGAY CHỦ ĐỀ HOT: ${textSnippet.trim()}! 🔥\n\n`;
    content += `Bạn đã sẵn sàng nâng cấp kiến thức hôm nay chưa? Dưới đây là những điểm cốt lõi bạn không thể bỏ qua:\n`;
    content += `✅ Ý tưởng đột phá mang tính ứng dụng cao.\n`;
    content += `✅ Giải pháp tháo gỡ khó khăn nhanh chóng.\n\n`;
    content += `👉 Đọc chi tiết bài viết và xem video hướng dẫn cụ thể trên kênh của chúng tôi nhé! #knowledge #learn #trending\n\n`;
    content += `=========================================\n`;
    content += `PHẦN 2: KỊCH BẢN VIDEO YOUTUBE CHI TIẾT\n\n`;

    scenes.forEach(scene => {
      content += `[CẢNH ${scene.id}]\n`;
      content += `- Thời lượng: ${scene.duration}\n`;
      content += `- Visual: ${scene.visual}\n`;
      content += `- Script: ${scene.script}\n`;
      content += `- Background Music: ${scene.bgMusic}\n\n`;
    });

    this.log(`[Copywriter Agent] Đã tạo kịch bản kịch mẫu thành công ở chế độ offline.`);
    return content;
  }
}

// ----------------------------------------------------
// Agent 4: Video Director (Storyboard & Preview Compiler)
// ----------------------------------------------------
export class VideoDirectorAgent {
  constructor(logCallback) {
    this.log = logCallback || console.log;
  }

  parseStoryboard(writerOutput) {
    this.log(`[Video Director Agent] Đang trích xuất cấu trúc phân cảnh để tạo Storyboard...`);
    const scenes = [];
    
    // Regular expression to match scenes from writer output
    const sceneBlockRegex = /\[CẢNH\s*(\d+)\]([\s\S]*?)(?=\[CẢNH|$)/gi;
    let match;
    
    while ((match = sceneBlockRegex.exec(writerOutput)) !== null) {
      const id = match[1];
      const content = match[2];
      
      const durationMatch = content.match(/Thời lượng:\s*(\d+)/i);
      const visualMatch = content.match(/Visual:\s*([^\n]+)/i);
      const scriptMatch = content.match(/Script:\s*([^\n]+)/i);
      const musicMatch = content.match(/Background Music:\s*([^\n]+)/i);
      
      scenes.push({
        id: parseInt(id),
        duration: durationMatch ? parseInt(durationMatch[1]) : 8,
        visual: visualMatch ? visualMatch[1].trim() : 'Hình ảnh mô tả cảnh quay mặc định.',
        script: scriptMatch ? scriptMatch[1].trim() : 'Xin chào các bạn đã xem video.',
        bgMusic: musicMatch ? musicMatch[1].trim() : 'No Music'
      });
    }

    if (scenes.length === 0) {
      this.log(`[Video Director Agent] Không nhận diện được cấu trúc chuẩn. Đang tự tạo storyboard 4 phân cảnh cơ bản.`);
      return [
        { id: 1, duration: 6, visual: 'Màn hình giới thiệu tiêu đề rực rỡ.', script: 'Xin kính chào toàn thể quý vị độc giả!', bgMusic: 'Acoustic' },
        { id: 2, duration: 8, visual: 'Hình ảnh sơ đồ phân tích thông tin.', script: 'Chúng ta hãy cùng đi sâu vào tìm hiểu cốt lõi của thông tin.', bgMusic: 'Ambient' },
        { id: 3, duration: 8, visual: 'Slide tổng hợp các bước giải quyết vấn đề.', script: 'Dưới đây là các giải pháp khả thi nhất dành cho bạn.', bgMusic: 'Tech' },
        { id: 4, duration: 6, visual: 'Nút Subscribe kênh lung linh.', script: 'Cảm ơn quý vị đã dành thời gian theo dõi.', bgMusic: 'Happy' }
      ];
    }

    this.log(`[Video Director Agent] Tạo thành công Storyboard gồm ${scenes.length} cảnh.`);
    return scenes;
  }
}

// ----------------------------------------------------
// Agent 5: YouTube Publisher (Metadata & Upload Builder)
// ----------------------------------------------------
export class YouTubePublisherAgent {
  constructor(logCallback) {
    this.log = logCallback || console.log;
  }

  generateMetadata(summary, scriptText) {
    this.log(`[YouTube Publisher Agent] Đang tối ưu hóa tiêu đề, thẻ mô tả và hashtag SEO...`);
    
    // Extract a catchy title
    let title = "Bí Quyết Khám Phá Kiến Thức Mới Cực Kỳ Hấp Dẫn";
    const titleMatch = scriptText.match(/KHÁM PHÁ NGAY CHỦ ĐỀ HOT:\s*([^\n!]+)/i);
    if (titleMatch) {
      title = titleMatch[1].trim().toUpperCase();
      if (title.length > 70) {
        title = title.substring(0, 67) + "...";
      }
    }

    const tags = ["aiagent", "automation", "kienthuc", "tintuc", "videohuongdan", "hocsu"];
    
    let description = `🎬 Hướng dẫn chi tiết: ${title}\n\n`;
    description += `Chào mừng các bạn đến với video tự động hóa ngày hôm nay! Nội dung chính bao gồm:\n`;
    description += `- Tóm tắt các điểm quan trọng trong tài liệu gốc.\n`;
    description += `- Phân tích chuyên sâu từ các chuyên gia AI.\n\n`;
    description += `📌 Đăng ký theo dõi kênh để nhận thông báo về những video mới nhất mỗi ngày!\n\n`;
    description += `#learning #automated #youtube #news #ai`;

    this.log(`[YouTube Publisher Agent] Đã tạo xong metadata cho video.`);
    return {
      title,
      description,
      tags: tags.join(', '),
      category: '27', // Education
      privacyStatus: 'unlisted'
    };
  }
}
