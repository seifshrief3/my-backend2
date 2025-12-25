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

// ================= ENV =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// ================= APP =================
const app = express();

// ================= TEMP UPLOAD DIR =================
const uploadDir = path.join(os.tmpdir(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

// ================= HELPERS =================
const escapeHTML = (text) => {
  if (text === null || text === undefined) return "N/A";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

// ================= TELEGRAM UPLOAD =================
async function uploadToTelegram(filePath, fileName, caption) {
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("document", fs.createReadStream(filePath), {
    filename: fileName,
  });
  form.append("caption", caption || "ملف مرفوع");
  form.append("parse_mode", "HTML");

  try {
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`,
      form,
      {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );
    return `✅ [تم رفع: ${escapeHTML(fileName)}]`;
  } catch (error) {
    console.error(
      "Telegram upload error:",
      error.response?.data || error.message
    );
    return `❌ [فشل رفع: ${escapeHTML(fileName)}]`;
  }
}

// ================= MESSAGE BUILDER =================
const buildMessageText = ({ source, leadData, filesLinks, servicesList }) => {
  let text = `🎉 <b>طلب جديد - ${escapeHTML(source)}</b> 🎉\n\n`;

  if (source === "نموذج الاستقدام" || source === "نموذج إنجاز") {
    text +=
      `👤 <b>العميل:</b> ${escapeHTML(leadData.clientName)}\n` +
      `📞 <b>واتساب:</b> ${escapeHTML(leadData.whatsappNumber)}\n`;

    if (leadData.phoneNumber) {
      text += `☎️ <b>هاتف:</b> ${escapeHTML(leadData.phoneNumber)}\n`;
    }

    text +=
      `\n🛠️ <b>الخدمات:</b>\n${servicesList}\n\n` +
      `📂 <b>المستندات:</b>\n` +
      `• الاستقدام/إنجاز: ${filesLinks.RecruitmentForm.length > 0 ||
        filesLinks.visaDocument.length > 0
        ? "مرفق"
        : "لا يوجد"
      }\n` +
      `• صور الجوازات: ${filesLinks.passportImage.length > 0 ? "مرفق" : "لا يوجد"
      }`;
  } else if (source === "حجز موعد تساهيل") {
    text +=
      `👤 <b>العميل:</b> ${escapeHTML(leadData.fullName)}\n` +
      `📞 <b>واتساب:</b> ${escapeHTML(leadData.whatsapp)}\n` +
      `📅 <b>الموعد:</b> ${escapeHTML(leadData.appointmentDate)}\n` +
      `📍 <b>المركز:</b> ${escapeHTML(leadData.center)}\n` +
      `🏷️ <b>التأشيرة:</b> ${escapeHTML(leadData.visaType)}`;
  }

  return text;
};

// ================= ROUTES =================

// health check
app.use((req, res) => {
  res.send("API is running on Netlify ✅");
});


// main endpoint
app.post(
  "/send-lead",
  upload.fields([
    { name: "visaDocument", maxCount: 100 },
    { name: "passportImage", maxCount: 100 },
    { name: "RecruitmentForm", maxCount: 100 },
  ]),
  async (req, res) => {
    const leadData = req.body;
    const { source } = leadData;
    const files = req.files || {};

    if (!source) {
      return res
        .status(400)
        .json({ success: false, message: "Missing source field" });
    }

    const tempFilesToDelete = [];
    const filesLinks = {
      RecruitmentForm: [],
      passportImage: [],
      visaDocument: [],
    };

    try {
      // 1️⃣ upload files
      for (const field of Object.keys(filesLinks)) {
        if (files[field]) {
          for (const file of files[field]) {
            const caption = `📄 ${field}\n👤 عميل: ${leadData.clientName || leadData.fullName
              }`;
            const status = await uploadToTelegram(
              file.path,
              file.originalname,
              caption
            );
            filesLinks[field].push(status);
            tempFilesToDelete.push(file.path);
          }
        }
      }

      // 2️⃣ services
      let servicesList = "لا يوجد خدمات إضافية";
      if (leadData.selectedServices) {
        try {
          const parsed = JSON.parse(leadData.selectedServices);
          servicesList = Array.isArray(parsed)
            ? parsed.map((s) => `• ${escapeHTML(s)}`).join("\n")
            : escapeHTML(leadData.selectedServices);
        } catch {
          servicesList = `• ${escapeHTML(leadData.selectedServices)}`;
        }
      }

      // 3️⃣ send summary message
      const messageText = buildMessageText({
        source,
        leadData,
        filesLinks,
        servicesList,
      });

      await axios.post(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          chat_id: CHAT_ID,
          text: messageText,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }
      );

      res.json({ success: true, message: "Processed successfully" });
    } catch (error) {
      console.error("Main handler error:", error.message);
      res.status(500).json({ success: false, error: error.message });
    } finally {
      // 4️⃣ cleanup temp files
      for (const filePath of tempFilesToDelete) {
        try {
          await fsp.unlink(filePath);
        } catch { }
      }
    }
  }
);

// ================= EXPORT =================
export const handler = serverless(app);
