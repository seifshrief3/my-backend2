import express from 'express';
import cors from 'cors';
import axios from 'axios';
import multer from 'multer';
import fs from 'fs';
import fsp from 'fs/promises';
import FormData from 'form-data';
import path from 'path';
import os from 'os';

// قراءة البيانات من البيئة (Environment Variables) في Render
const BOT_TOKEN = process.env.BOT_TOKEN || '8433844275:AAFRpIdSOi5NJs3pyUPVkKmzrq3O8VP118Y';
const CHAT_ID = process.env.CHAT_ID || '-1003383269388';

const app = express();
// Render يحدد البورت تلقائياً
const port = process.env.PORT || 3001;

// استخدام مجلد التخزين المؤقت الخاص بنظام التشغيل لضمان الصلاحيات
const uploadDir = path.join(os.tmpdir(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

// دالة لتجنب مشاكل HTML في النصوص
const escapeHTML = (text) => {
  if (text === null || text === undefined) return 'N/A';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

// CORS - السماح للكل في حالة الـ Production لتقليل المشاكل
app.use(cors());
app.use(express.json());

// رفع ملف لتلجرام
async function uploadToTelegram(filePath, fileName, caption) {
  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  form.append('document', fs.createReadStream(filePath), { filename: fileName });
  form.append('caption', caption || 'ملف مرفوع');
  form.append('parse_mode', 'HTML');

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    return `✅ [تم رفع: ${escapeHTML(fileName)}]`;
  } catch (error) {
    console.error(`Error uploading ${fileName}:`, error.response?.data || error.message);
    return `❌ [فشل رفع: ${escapeHTML(fileName)}]`;
  }
}

// بناء رسالة نصية نهائية
const buildMessageText = ({ source, leadData, filesLinks, servicesList }) => {
  const escape = escapeHTML;
  let text = `🎉 <b>طلب جديد - ${escape(source)}</b> 🎉\n\n`;

  if (source === "نموذج الاستقدام" || source === "نموذج إنجاز") {
    text += `👤 <b>العميل:</b> ${escape(leadData.clientName)}\n` +
      `📞 <b>واتساب:</b> ${escape(leadData.whatsappNumber)}\n`;

    if (leadData.phoneNumber) text += `☎️ <b>هاتف:</b> ${escape(leadData.phoneNumber)}\n`;

    text += `\n🛠️ <b>الخدمات:</b>\n${servicesList}\n` +
      `\n📂 <b>المستندات المرفقة:</b>\n` +
      `• الاستقدام/إنجاز: ${filesLinks.RecruitmentForm.length > 0 || filesLinks.visaDocument.length > 0 ? 'مرفق' : 'لا يوجد'}\n` +
      `• صور الجوازات: ${filesLinks.passportImage.length > 0 ? 'مرفق' : 'لا يوجد'}`;
  }
  else if (source === "حجز موعد تساهيل") {
    text += `👤 <b>العميل:</b> ${escape(leadData.fullName)}\n` +
      `📞 <b>واتساب:</b> ${escape(leadData.whatsapp)}\n` +
      `📅 <b>الموعد:</b> ${escape(leadData.appointmentDate)}\n` +
      `📍 <b>المركز:</b> ${escape(leadData.center)}\n` +
      `🏷️ <b>التأشيرة:</b> ${escape(leadData.visaType)}`;
  }

  return text;
};

// POST endpoint
app.post('/api/send-lead', upload.fields([
  { name: 'visaDocument', maxCount: 100 },
  { name: 'passportImage', maxCount: 100 },
  { name: 'RecruitmentForm', maxCount: 100 },
]), async (req, res) => {
  const leadData = req.body;
  const { source } = leadData;
  const files = req.files;

  if (!source) return res.status(400).json({ success: false, message: 'Missing source field.' });

  const tempFilesToDelete = [];
  const filesLinks = { RecruitmentForm: [], passportImage: [], visaDocument: [] };

  try {
    // 1. معالجة ورفع الملفات
    for (const field of Object.keys(filesLinks)) {
      if (files[field]) {
        for (const file of files[field]) {
          const caption = `📄 ${field}\n👤 عميل: ${leadData.clientName || leadData.fullName}`;
          const status = await uploadToTelegram(file.path, file.originalname, caption);
          filesLinks[field].push(status);
          tempFilesToDelete.push(file.path);
        }
      }
    }

    // 2. تجهيز الخدمات
    let servicesList = 'لا يوجد خدمات إضافية';
    if (leadData.selectedServices) {
      try {
        const parsed = JSON.parse(leadData.selectedServices);
        servicesList = Array.isArray(parsed) ? parsed.map(s => `• ${escapeHTML(s)}`).join('\n') : escapeHTML(leadData.selectedServices);
      } catch (e) {
        servicesList = `• ${escapeHTML(leadData.selectedServices)}`;
      }
    }

    // 3. إرسال ملخص الطلب
    const messageText = buildMessageText({ source, leadData, filesLinks, servicesList });
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: messageText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    res.json({ success: true, message: 'Processed successfully' });

  } catch (error) {
    console.error("Main Handler Error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    // 4. حذف الملفات المؤقتة دائماً
    for (const filePath of tempFilesToDelete) {
      try { await fsp.unlink(filePath); } catch (e) { /* ignore */ }
    }
  }
});

app.get('/', (req, res) => res.send('API is running... ✅'));

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});