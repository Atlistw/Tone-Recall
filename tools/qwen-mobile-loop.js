const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const artifactRoot = path.join(projectRoot, "mobile-loop-artifacts");
const model = process.env.QWEN_MODEL || "qwen3.6";
const maxAttempts = Number.parseInt(process.env.LOOP_ATTEMPTS || "5", 10);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    ...options
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error
  };
}

function ensureArtifacts() {
  fs.mkdirSync(artifactRoot, { recursive: true });
}

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function gitStatus() {
  return run("git", ["status", "--short"]).stdout.trim();
}

function gitDiff() {
  return run("git", ["diff", "--", "index.html", "src/app.js", "src/styles.css", "sw.js", "README.md", "package.json", ".gitignore", "tools/mobile-check.js", "tools/qwen-mobile-loop.js"]).stdout;
}

function trackedFileContents() {
  const files = [
    "index.html",
    "src/styles.css",
    "src/app.js",
    "sw.js",
    "manifest.webmanifest",
    "package.json",
    ".gitignore"
  ];
  return files.map((file) => {
    const absolute = path.join(projectRoot, file);
    return `--- FILE: ${file} ---\n${readIfExists(absolute)}`;
  }).join("\n\n");
}

function latestReport() {
  const reportPath = path.join(artifactRoot, "mobile-check-report.json");
  return readIfExists(reportPath) || "No mobile-check-report.json was written.";
}

function runMobileCheck(attemptDir) {
  const result = run("node", ["tools/mobile-check.js"]);
  fs.writeFileSync(path.join(attemptDir, "mobile-check.stdout.txt"), result.stdout);
  fs.writeFileSync(path.join(attemptDir, "mobile-check.stderr.txt"), result.stderr);
  fs.writeFileSync(path.join(attemptDir, "mobile-check-report.json"), latestReport());
  return result;
}

function buildPrompt(attempt, report, diff) {
  return `You are repairing ProjectToner, a static local-first web app.

Repository path:
${projectRoot}

Current branch:
qwen-mobile-compat

Attempt:
${attempt} of ${maxAttempts}

Goal:
Make the existing Tone Recall app pass the mobile check while preserving the current design and desktop behavior.

Hard constraints:
- Do not redesign the app.
- Do not change visual direction, colors, typography, copy, product flow, or feature scope unless a test failure absolutely requires a tiny compatibility fix.
- Keep it a static web app.
- Prefer CSS-only fixes for layout problems.
- Only change JavaScript for real mobile behavior bugs.
- Do not add dependencies.
- Do not edit generated files, node_modules, package-lock.json, or mobile-loop-artifacts.
- Make the smallest practical patch.

Required output:
Return one unified diff only, suitable for git apply.
Do not wrap it in Markdown fences.
Do not include explanation before or after the diff.
If no code change is possible, return exactly:
NO_PATCH

Mobile check report:
${report}

Current uncommitted diff:
${diff || "(none)"}

Relevant project files:
${trackedFileContents()}
`;
}

function askQwen(prompt, attemptDir) {
  const result = spawnSync("ollama", ["run", model], {
    cwd: projectRoot,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024,
    timeout: 20 * 60 * 1000
  });
  const output = [result.stdout || "", result.stderr || ""].join("\n").trim();
  fs.writeFileSync(path.join(attemptDir, "qwen-output.txt"), output);
  if (result.error) {
    throw new Error(`Failed to run ollama: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`ollama exited with code ${result.status}. See ${path.join(attemptDir, "qwen-output.txt")}`);
  }
  return output;
}

function extractPatch(output) {
  const trimmed = output.trim();
  if (trimmed === "NO_PATCH") return "";

  const fenced = trimmed.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const diffIndex = candidate.indexOf("diff --git ");
  if (diffIndex >= 0) return candidate.slice(diffIndex).trim() + "\n";

  const oldNewIndex = candidate.search(/^---\s+/m);
  if (oldNewIndex >= 0) return candidate.slice(oldNewIndex).trim() + "\n";

  return "";
}

function applyPatch(patch, attemptDir) {
  const patchPath = path.join(attemptDir, "qwen.patch");
  fs.writeFileSync(patchPath, patch);

  const check = run("git", ["apply", "--check", patchPath]);
  fs.writeFileSync(path.join(attemptDir, "git-apply-check.stdout.txt"), check.stdout);
  fs.writeFileSync(path.join(attemptDir, "git-apply-check.stderr.txt"), check.stderr);
  if (check.status !== 0) {
    throw new Error(`Qwen returned a patch that git could not apply. See ${patchPath}`);
  }

  const apply = run("git", ["apply", patchPath]);
  fs.writeFileSync(path.join(attemptDir, "git-apply.stdout.txt"), apply.stdout);
  fs.writeFileSync(path.join(attemptDir, "git-apply.stderr.txt"), apply.stderr);
  if (apply.status !== 0) {
    throw new Error(`git apply failed after check passed. See ${patchPath}`);
  }
}

function main() {
  ensureArtifacts();
  console.log(`Qwen mobile loop starting with model ${model}; max attempts: ${maxAttempts}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptDir = path.join(artifactRoot, `loop-attempt-${String(attempt).padStart(2, "0")}`);
    fs.mkdirSync(attemptDir, { recursive: true });

    console.log(`\nAttempt ${attempt}: running mobile check...`);
    const check = runMobileCheck(attemptDir);
    if (check.status === 0) {
      console.log("Mobile check passed. Loop complete.");
      console.log("Final git status:");
      console.log(gitStatus() || "(clean)");
      return;
    }

    console.log("Mobile check failed. Asking Qwen for a minimal patch...");
    const prompt = buildPrompt(attempt, latestReport(), gitDiff());
    fs.writeFileSync(path.join(attemptDir, "qwen-prompt.txt"), prompt);
    const output = askQwen(prompt, attemptDir);
    const patch = extractPatch(output);

    if (!patch) {
      console.error("Qwen did not return a usable patch. Loop stopped.");
      console.error(`See ${path.join(attemptDir, "qwen-output.txt")}`);
      process.exit(1);
    }

    applyPatch(patch, attemptDir);
    console.log("Patch applied. Continuing to next check.");
  }

  console.error(`Mobile loop stopped after ${maxAttempts} attempts without a passing check.`);
  console.error("Review mobile-loop-artifacts and git diff.");
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
