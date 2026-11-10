const path = require("path");
const fs = require("fs");
const { createWorker } = require("tesseract.js");

async function main() {
  const root = __dirname;
  const png = path.join(root, "smoke-out", "ocr-test.png");
  if (!fs.existsSync(png)) {
    console.log("NO_PNG");
    process.exit(2);
  }
  const worker = await createWorker("eng", 1, {
    langPath: path.join(root, "vendor", "tessdata"),
    gzip: true,
    cachePath: path.join(root, "smoke-out", "tess-cache"),
    logger: m => {
      if (m && m.status) console.log("OCR_STATUS", m.status, m.progress || "");
    }
  });
  const result = await worker.recognize(png);
  await worker.terminate();
  const text = String(result && result.data && result.data.text || "").trim();
  console.log("OCR_TEXT", JSON.stringify(text));
  console.log(/hello/i.test(text) ? "OCR_PASS" : "OCR_FAIL");
  process.exit(/hello/i.test(text) ? 0 : 1);
}

main().catch(err => {
  console.error("OCR_ERROR", err);
  process.exit(1);
});
