const { createWorker } = require("tesseract.js");
const path = require("path");
const fs = require("fs");

async function main() {
  const payload = JSON.parse(process.argv[2] || "{}");
  const langs = payload.langs || "chi_sim+eng";
  const image = payload.image;
  if (!image) throw new Error("没有可识别的图片");
  const worker = await createWorker(langs, 1, {
    langPath: path.join(__dirname, "vendor", "tessdata"),
    gzip: true,
    cachePath: payload.cachePath || path.join(__dirname, "smoke-out", "tess-cache"),
    logger: () => {}
  });
  try {
    const result = await worker.recognize(image);
    process.stdout.write(JSON.stringify({ ok: true, text: String(result?.data?.text || "").trim() }));
  } finally {
    await worker.terminate();
  }
}

main().catch(err => {
  process.stdout.write(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
  process.exit(1);
});
