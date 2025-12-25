import express from "express";
import cors from "cors";
import axios from "axios";
import multer from "multer";
import fs from "fs";
import fsp from "fs/promises";
import FormData from "form-data";
import path from "path";
import os from "os";
import serverless from "serverless-http";

const BOT_TOKEN = process.env.BOT_TOKEN || '8433844275:AAFRpIdSOi5NJs3pyUPVkKmzrq3O8VP118Y';
const CHAT_ID = process.env.CHAT_ID || '-1003383269388';

const app = express();
const router = express.Router(); // بنستخدم Router عشان المسارات

app.use(cors());
app.use(express.json());

const uploadDir = path.join(os.tmpdir(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

const escapeHTML = (text) => {
  if (!text) return "N/A";
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

async function uploadToTelegram(filePath, fileName, caption) {
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("document", fs.createReadStream(filePath), { filename: fileName });
  form.append("caption", caption || "ملف مرفوع");
  form.append("parse_mode", "HTML");

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form, {
      headers: form.getHeaders(),
    });
    return `✅ [تم رفع: ${escapeHTML(fileName)}]`;
  } catch (error) {
    return `❌ [فشل رفع: ${escapeHTML(fileName)}]`;
  }
}

// 1. خلى المسار بيبدأ بـ / مباشرة جوه الـ router
router.post("/send-lead", upload.fields([
  { name: "visaDocument", maxCount: 100 },
  { name: "passportImage", maxCount: 100 },
  { name: "RecruitmentForm", maxCount: 100 },
]), async (req, res) => {
  const leadData = req.body;
  const { source } = leadData;
  const files = req.files || {};

  if (!source) return res.status(400).json({ success: false, message: "Missing source" });

  const tempFilesToDelete = [];
  const filesLinks = { RecruitmentForm: [], passportImage: [], visaDocument: [] };

  try {
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

    let servicesList = "لا يوجد خدمات إضافية";
    if (leadData.selectedServices) {
      servicesList = leadData.selectedServices; // بسطناها للتجربة
    }

    const messageText = `🎉 <b>طلب جديد - ${escapeHTML(source)}</b> 🎉\n\n👤 <b>العميل:</b> ${escapeHTML(leadData.clientName || leadData.fullName)}\n📞 <b>واتساب:</b> ${escapeHTML(leadData.whatsappNumber || leadData.whatsapp)}`;

    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: messageText,
      parse_mode: "HTML",
    });

    res.json({ success: true, message: "Processed successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    for (const filePath of tempFilesToDelete) {
      try { await fsp.unlink(filePath); } catch (e) { }
    }
  }
});

// 2. ده الهيلث تشيك خليه يشتغل بس لو المسار فاضي
router.get("/", (req, res) => {
  res.send("API is working! Use POST /send-lead to send data.");
});

// 3. الربط السحري لـ Netlify
// لو ملفك اسمه api.js يبقى المسار هو /.netlify/functions/api
app.use("/.netlify/functions/api", router);

export const handler = serverless(app);