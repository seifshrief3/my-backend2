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
const router = express.Router();

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

// قاموس لترجمة الحقول للعربية عشان تظهر بشكل شيك في تيليجرام
const fieldLabels = {
  clientName: "اسم العميل",
  fullName: "الاسم الكامل",
  whatsappNumber: "رقم الواتساب",
  whatsapp: "واتساب",
  phoneNumber: "رقم الهاتف",
  phone: "الهاتف",
  visaType: "نوع التأشيرة",
  center: "المركز",
  serviceType: "نوع الخدمة",
  appointmentDate: "تاريخ الموعد",
  selectedServices: "الخدمات المختارة",
  source: "المصدر"
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
    return true;
  } catch (error) {
    console.error("Telegram Upload Error:", error.message);
    return false;
  }
}

router.post("/send-lead", upload.fields([
  { name: "visaDocument", maxCount: 10 },
  { name: "passportImage", maxCount: 10 },
  { name: "RecruitmentForm", maxCount: 10 },
]), async (req, res) => {
  const leadData = req.body;
  const files = req.files || {};
  const tempFilesToDelete = [];

  try {
    // 1. بناء نص الرسالة بشكل ديناميكي
    let messageBody = `🎉 <b>طلب جديد من: ${escapeHTML(leadData.source || "الموقع")}</b> 🎉\n\n`;

    for (const [key, value] of Object.entries(leadData)) {
      // تخطي حقل الـ source لأنه في العنوان
      if (key === "source") continue;

      let displayValue = value;
      // لو البيانات عبارة عن Array (زي الخدمات المختارة) نحولها لنص
      if (key === "selectedServices" && value) {
        try {
          const parsed = JSON.parse(value);
          displayValue = Array.isArray(parsed) ? parsed.join(" - ") : value;
        } catch (e) { displayValue = value; }
      }

      const label = fieldLabels[key] || key; // استخدم الترجمة أو اسم الحقل الأصلي
      messageBody += `👤 <b>${label}:</b> ${escapeHTML(displayValue)}\n`;
    }

    // 2. إرسال البيانات النصية أولاً
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: messageBody,
      parse_mode: "HTML",
    });

    // 3. إرسال الملفات (كل ملف برسالة منفصلة مع كابشن صغير)
    const clientDisplayName = leadData.clientName || leadData.fullName || "غير معروف";

    for (const fieldName of Object.keys(files)) {
      for (const file of files[fieldName]) {
        const fileLabel = fieldLabels[fieldName] || fieldName;
        const caption = `📄 <b>${fileLabel}</b>\n👤 عميل: ${escapeHTML(clientDisplayName)}`;

        await uploadToTelegram(file.path, file.originalname, caption);
        tempFilesToDelete.push(file.path);
      }
    }

    res.json({ success: true, message: "تم إرسال البيانات والملفات بنجاح ✅" });
  } catch (error) {
    console.error("Main Error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    // تنظيف الملفات المؤقتة
    for (const filePath of tempFilesToDelete) {
      try { await fsp.unlink(filePath); } catch (e) { }
    }
  }
});

router.get("/", (req, res) => {
  res.send("API is working! Use POST /send-lead to send data.");
});

app.use("/.netlify/functions/api", router);

export const handler = serverless(app);