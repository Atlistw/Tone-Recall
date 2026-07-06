const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const artifactRoot = path.join(projectRoot, "mobile-loop-artifacts");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(artifactRoot, `check-${runId}`);
const reportPath = path.join(artifactRoot, "mobile-check-report.json");
const testPhotoPath = path.join(runDir, "test-photo.png");

const viewports = [
  { name: "iphone-se", width: 390, height: 844, mobile: true },
  { name: "iphone-large", width: 430, height: 932, mobile: true },
  { name: "tablet", width: 768, height: 1024, mobile: true },
  { name: "desktop", width: 1440, height: 900, mobile: false },
  { name: "desktop-1080p", width: 1920, height: 1080, mobile: false }
];

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"]
]);

function ensureArtifacts() {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    testPhotoPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAIklEQVR4nGNkaGBgYGBg+M+ABBgYGJgYGRgYGP4zAAAuVwIFL5n40QAAAABJRU5ErkJggg==",
      "base64"
    )
  );
}

function startServer() {
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.normalize(path.join(projectRoot, pathname));

    if (!filePath.startsWith(projectRoot)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }


    if (pathname === "/src/supabase-config.js") {
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end("window.TONE_RECALL_SUPABASE_CONFIG = { url: '', anonKey: '', redirectTo: '' };\n");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "content-type": mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
        "cache-control": "no-store"
      });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

async function deleteAppDatabase(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("tone-recall-capture");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  }));
}

async function overflowDetails(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0);
    const offenders = [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || "",
          className: typeof element.className === "string" ? element.className : "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          text: String(element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)
        };
      })
      .filter((item) => item.width > 1 && (item.right > viewportWidth + 1 || item.left < -1))
      .slice(0, 12);

    return {
      hasOverflow: scrollWidth > viewportWidth + 1,
      viewportWidth,
      scrollWidth,
      offenders
    };
  });
}

async function assertNoOverflow(page, label, failures) {
  const details = await overflowDetails(page);
  if (details.hasOverflow || details.offenders.length) {
    failures.push({
      check: "no-horizontal-overflow",
      label,
      details
    });
  }
}

async function screenshot(page, name) {
  const file = path.join(runDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function runViewportSmoke(browser, baseUrl, viewport, failures) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    deviceScaleFactor: viewport.mobile ? 2 : 1
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Tone Recall");
    await assertNoOverflow(page, `${viewport.name}:library-initial`, failures);
    await screenshot(page, `${viewport.name}-library`);

    if (viewport.name === "iphone-se") {
      await runFunctionalFlow(page, baseUrl, failures);
      await screenshot(page, `${viewport.name}-after-flow`);
    }
  } catch (error) {
    failures.push({
      check: "viewport-smoke",
      label: viewport.name,
      message: error.message
    });
    await screenshot(page, `${viewport.name}-error`).catch(() => {});
  } finally {
    await context.close();
  }
}

async function runFunctionalFlow(page, baseUrl, failures) {
  await deleteAppDatabase(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 2500 }).catch(() => null);
  await page.click("#saveToneButton");
  const chooser = await fileChooserPromise;
  if (chooser) {
    await chooser.setFiles(testPhotoPath);
  } else {
    await page.setInputFiles("#photoInput", testPhotoPath);
  }

  await page.waitForSelector("#detailView:not(.hidden)");
  await page.fill("#titleInput", "Mobile smoke tone");
  await page.fill("#descriptionInput", "Saved from mobile smoke test #mobile #smoke");
  await assertNoOverflow(page, "iphone-se:detail-after-entry", failures);

  await page.click("#doneButton");
  await page.waitForSelector("#libraryView:not(.hidden)");
  await page.reload({ waitUntil: "networkidle" });
  await page.fill("#searchInput", "mobile");
  await page.waitForSelector("text=Mobile smoke tone");
  await assertNoOverflow(page, "iphone-se:library-after-reload-search", failures);

  await page.click("text=Mobile smoke tone");
  await page.waitForSelector("#detailView:not(.hidden)");
  const title = await page.inputValue("#titleInput");
  const description = await page.inputValue("#descriptionInput");
  const hasPhoto = await page.locator("#tonePhoto:not(.hidden)").count();

  if (title !== "Mobile smoke tone") {
    failures.push({ check: "persistence", label: "title", expected: "Mobile smoke tone", actual: title });
  }
  if (!description.includes("#mobile")) {
    failures.push({ check: "persistence", label: "description", expected: "description contains #mobile", actual: description });
  }
  if (!hasPhoto) {
    failures.push({ check: "photo-upload", label: "tone photo visible after reload" });
  }

  await page.click("#addPedalButton");
  await page.fill("#pedalInput", "Test Pedal");
  await page.press("#pedalInput", "Enter");
  await assertNoOverflow(page, "iphone-se:detail-pedal-controls", failures);
}

async function main() {
  ensureArtifacts();
  const { server, url } = await startServer();
  const failures = [];
  const browser = await chromium.launch({ headless: true });

  try {
    for (const viewport of viewports) {
      await runViewportSmoke(browser, url, viewport, failures);
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  const report = {
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    runDir,
    viewports,
    failures
  };
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));

  if (failures.length) {
    console.error(`Mobile check failed with ${failures.length} failure(s). Report: ${reportPath}`);
    console.error(JSON.stringify(failures, null, 2));
    process.exit(1);
  }

  console.log(`Mobile check passed. Artifacts: ${runDir}`);
}

main().catch((error) => {
  fs.mkdirSync(artifactRoot, { recursive: true });
  const report = {
    ok: false,
    checkedAt: new Date().toISOString(),
    runDir,
    fatal: error.stack || error.message
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.error(error.stack || error.message);
  process.exit(1);
});
