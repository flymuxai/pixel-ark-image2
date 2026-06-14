#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SERVER_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.join(SERVER_ROOT, "assets");
const JOBS_DIR = path.join(SERVER_ROOT, "jobs");
const DEFAULT_ENV_FILE = path.join(os.homedir(), ".codex", "image2-mcp.env");
const CHROMA_KEY_HELPER = path.join(os.homedir(), ".codex", "skills", ".system", "imagegen", "scripts", "remove_chroma_key.py");
const CHROMA_KEY_COLOR = "#00ff00";
const PYTHON_BIN = process.env.IMAGE2_PYTHON || process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const IMAGE2_SIZES = new Set(["auto", "1024x1024", "1024x1536", "1536x1024"]);
const IMAGE2_QUALITIES = new Set(["auto", "high", "medium", "low"]);
const BACKGROUNDS = new Set(["auto", "transparent", "opaque"]);
const OUTPUT_FORMATS = new Set(["png", "jpeg", "webp"]);
const MODERATIONS = new Set(["auto", "low"]);
const MAX_PARTIAL_IMAGES = 3;
const jobs = new Map();

loadEnvFile(process.env.IMAGE2_ENV_FILE || DEFAULT_ENV_FILE);

const apiKey = process.env.IMAGE2_API_KEY || process.env.OPENAI_API_KEY;
const baseUrl = normalizeBaseUrl(process.env.IMAGE2_BASE_URL || "https://model.zhengshuyun.net");
const defaultModel = process.env.IMAGE2_MODEL || "gpt-image-2";
const defaultOutputDir = expandHome(process.env.IMAGE2_DEFAULT_OUTPUT_DIR || DEFAULT_OUTPUT_DIR);

fs.mkdirSync(defaultOutputDir, { recursive: true });
fs.mkdirSync(JOBS_DIR, { recursive: true });

const commonFields = {
  prompt: z.string().min(1).describe("Image prompt. Keep text-heavy content out of images when the asset will be placed into editable PPTX."),
  model: z.string().default(defaultModel).describe("Image model name. Default comes from IMAGE2_MODEL, normally gpt-image-2."),
  size: z.string().default("auto").describe("Output size. Official presets are auto, 1024x1024, 1024x1536, 1536x1024. Custom sizes may be accepted by compatible providers if they meet provider constraints."),
  quality: z.enum(["auto", "high", "medium", "low"]).default("auto").describe("Rendering quality. Higher quality can cost more and take longer."),
  background: z.enum(["auto", "transparent", "opaque"]).default("auto").describe("Background mode. Transparent is useful for icons/cutouts when supported by the selected output format/model."),
  output_format: z.enum(["png", "jpeg", "webp"]).default("png").describe("Output image format. Use png for PPT assets unless file size matters."),
  moderation: z.enum(["auto", "low"]).default("auto").describe("Moderation strictness where supported by the provider."),
  output_compression: z.number().int().min(0).max(100).optional().describe("Compression level for jpeg/webp where supported; ignored for png by many providers."),
  n: z.number().int().min(1).max(10).default(1).describe("Number of final images to request."),
  output_dir: z.string().optional().describe("Directory where generated images should be saved. Defaults to IMAGE2_DEFAULT_OUTPUT_DIR."),
  filename_prefix: z.string().regex(/^[a-zA-Z0-9._-]+$/).default("image2").describe("Safe prefix for saved image filenames."),
  stream: z.boolean().default(false).describe("Use streaming image generation when supported. Saves partial images and final images."),
  partial_images: z.number().int().min(0).max(MAX_PARTIAL_IMAGES).default(0).describe("Number of partial images to request with stream=true. Official range is 0-3."),
  extra: z.record(z.unknown()).optional().describe("Provider-specific passthrough parameters. Values here override matching top-level request fields.")
};

const generateSchema = z.object(commonFields);

const editSchema = z.object({
  ...commonFields,
  image_paths: z.array(z.string()).min(1).max(16).describe("Input image file paths to edit."),
  mask_path: z.string().optional().describe("Optional mask image path. Transparent areas are edited by compatible OpenAI-style APIs.")
});

const elementSpecSchema = z.union([
  z.string().min(1),
  z.object({
    name: z.string().min(1).describe("Short element name used in filenames."),
    description: z.string().optional().describe("How to identify this element in the source image."),
    prompt: z.string().optional().describe("Element-specific extraction instructions.")
  })
]);

const extractElementsSchema = z.object({
  image_path: z.string().min(1).describe("Flattened source design image to split into reusable assets."),
  elements: z.array(elementSpecSchema).min(1).max(24).describe("Elements to isolate. Provide names or objects with name/description/prompt."),
  include_background: z.boolean().default(false).describe("Also recreate the underlying background/backdrop as a separate asset."),
  prompt_prefix: z.string().optional().describe("Shared extra instructions applied to every element extraction."),
  model: z.string().default(defaultModel).describe("Image model name. Default comes from IMAGE2_MODEL, normally gpt-image-2."),
  size: z.string().default("auto").describe("Output size. Official presets are auto, 1024x1024, 1024x1536, 1536x1024. Custom sizes may be accepted by compatible providers if they meet provider constraints."),
  quality: z.enum(["auto", "high", "medium", "low"]).default("auto").describe("Rendering quality. Higher quality can cost more and take longer."),
  output_format: z.enum(["png", "webp"]).default("png").describe("Transparent-friendly output image format. Use png for PPT assets."),
  moderation: z.enum(["auto", "low"]).default("auto").describe("Moderation strictness where supported by the provider."),
  output_compression: z.number().int().min(0).max(100).optional().describe("Compression level for webp where supported; ignored for png by many providers."),
  n: z.number().int().min(1).max(4).default(1).describe("Number of variants to request for each extracted element."),
  output_dir: z.string().optional().describe("Directory where extracted assets should be saved. Defaults to IMAGE2_DEFAULT_OUTPUT_DIR."),
  filename_prefix: z.string().regex(/^[a-zA-Z0-9._-]+$/).default("image2-elements").describe("Safe prefix for saved image filenames."),
  extra: z.record(z.unknown()).optional().describe("Provider-specific passthrough parameters. Values here override matching top-level request fields.")
});

const startSchema = z.object({
  ...commonFields,
  job_name: z.string().regex(/^[a-zA-Z0-9._-]+$/).optional().describe("Optional human-readable job name for saved metadata.")
});

const getJobSchema = z.object({
  job_id: z.string().min(1).describe("Job id returned by image2_start_generation.")
});

const cancelJobSchema = z.object({
  job_id: z.string().min(1).describe("Job id returned by image2_start_generation.")
});

const server = new McpServer({
  name: "codex-image2",
  version: "0.1.0"
});

server.tool(
  "image2_generate",
  "Generate GPT Image compatible assets and save them to disk. Supports optional streaming partial images.",
  generateSchema.shape,
  async (args) => {
    const result = await generateImages(args);
    return jsonToolResult(result);
  }
);

server.tool(
  "image2_edit",
  "Edit one or more images with a GPT Image compatible API and save the outputs to disk.",
  editSchema.shape,
  async (args) => {
    const result = await editImages(args);
    return jsonToolResult(result);
  }
);

server.tool(
  "image2_extract_elements",
  "Split a flattened design image into named transparent PNG/WebP assets by running one edit per requested element.",
  extractElementsSchema.shape,
  async (args) => {
    const result = await extractDesignElements(args);
    return jsonToolResult(result);
  }
);

server.tool(
  "image2_start_generation",
  "Start a background image generation job. Use image2_get_job to poll status later.",
  startSchema.shape,
  async (args) => {
    const jobId = randomUUID();
    const controller = new AbortController();
    const now = new Date().toISOString();
    const record = {
      job_id: jobId,
      job_name: args.job_name || null,
      status: "running",
      created_at: now,
      updated_at: now,
      request: sanitizeForRecord(args),
      result: null,
      error: null,
      controller
    };

    jobs.set(jobId, record);
    writeJob(record);

    generateImages(args, controller.signal)
      .then((result) => {
        updateJob(jobId, { status: "completed", result });
      })
      .catch((error) => {
        updateJob(jobId, {
          status: controller.signal.aborted ? "cancelled" : "failed",
          error: errorToJson(error)
        });
      });

    return jsonToolResult({
      job_id: jobId,
      status: "running",
      message: "Generation started. Poll with image2_get_job."
    });
  }
);

server.tool(
  "image2_get_job",
  "Get the current state and saved output paths for a background image generation job.",
  getJobSchema.shape,
  async ({ job_id }) => {
    const record = jobs.get(job_id) || readJob(job_id);
    if (!record) {
      throw new Error(`Unknown job_id: ${job_id}`);
    }
    return jsonToolResult(publicJob(record));
  }
);

server.tool(
  "image2_cancel_job",
  "Cancel a running background image generation job.",
  cancelJobSchema.shape,
  async ({ job_id }) => {
    const record = jobs.get(job_id);
    if (!record) {
      const saved = readJob(job_id);
      if (!saved) throw new Error(`Unknown job_id: ${job_id}`);
      return jsonToolResult(publicJob(saved));
    }
    if (record.status === "running") {
      record.controller.abort();
      updateJob(job_id, { status: "cancelled" });
    }
    return jsonToolResult(publicJob(jobs.get(job_id)));
  }
);

if (!apiKey) {
  console.error("IMAGE2_API_KEY is not configured. Set IMAGE2_API_KEY or OPENAI_API_KEY in the environment or ~/.codex/image2-mcp.env.");
}

await server.connect(new StdioServerTransport());

async function generateImages(args, signal) {
  assertConfigured();
  const outputDir = ensureOutputDir(args.output_dir);
  const request = buildJsonRequest(args);
  const endpoint = `${baseUrl}/images/generations`;

  if (args.stream) {
    const streamResult = await requestImageStream(endpoint, request, outputDir, args.filename_prefix, args.output_format, signal);
    return {
      mode: "generation",
      endpoint,
      model: request.model,
      stream: true,
      ...streamResult
    };
  }

  const json = await requestJson(endpoint, request, signal);
  const saved = saveImagesFromResponse(json, outputDir, args.filename_prefix, args.output_format);
  return {
    mode: "generation",
    endpoint,
    model: request.model,
    stream: false,
    images: saved,
    raw_usage: json.usage || null
  };
}

async function extractDesignElements(args, signal) {
  assertConfigured();
  const outputDir = ensureOutputDir(args.output_dir);
  const elements = args.elements.map(normalizeElementSpec);
  const nativeTransparent = supportsNativeTransparent(args.model);
  const extracted = [];

  for (const element of elements) {
    const editArgs = {
      model: args.model,
      prompt: buildElementExtractionPrompt(element, args.prompt_prefix, { chromaKey: !nativeTransparent }),
      size: args.size,
      quality: args.quality,
      background: nativeTransparent ? "transparent" : "opaque",
      output_format: args.output_format,
      moderation: args.moderation,
      output_compression: args.output_compression,
      n: args.n,
      output_dir: outputDir,
      filename_prefix: `${args.filename_prefix}-${slugifyFilename(element.name)}`,
      image_paths: [args.image_path],
      extra: args.extra
    };

    const result = await editImages(editArgs, signal);
    const images = nativeTransparent
      ? result.images
      : removeChromaKeyFromImages(result.images, outputDir, `${args.filename_prefix}-${slugifyFilename(element.name)}`);
    extracted.push({
      name: element.name,
      description: element.description || null,
      prompt: editArgs.prompt,
      transparency_mode: nativeTransparent ? "native" : "chroma_key",
      images
    });
  }

  let background = null;
  if (args.include_background) {
    const backgroundArgs = {
      model: args.model,
      prompt: buildBackgroundExtractionPrompt(args.prompt_prefix),
      size: args.size,
      quality: args.quality,
      background: "opaque",
      output_format: args.output_format,
      moderation: args.moderation,
      output_compression: args.output_compression,
      n: 1,
      output_dir: outputDir,
      filename_prefix: `${args.filename_prefix}-background`,
      image_paths: [args.image_path],
      extra: args.extra
    };

    const result = await editImages(backgroundArgs, signal);
    background = {
      prompt: backgroundArgs.prompt,
      images: result.images
    };
  }

  return {
    mode: "element_extraction",
    source_image: expandHome(args.image_path),
    output_dir: outputDir,
    extraction_note: "This isolates or reconstructs named elements from a flattened source image. It does not recover original PSD/Figma layers. For models without native transparency, it generates a chroma-key plate and removes the key color locally.",
    elements: extracted,
    background
  };
}

async function editImages(args, signal) {
  assertConfigured();
  const outputDir = ensureOutputDir(args.output_dir);
  const endpoint = `${baseUrl}/images/edits`;
  const form = new FormData();
  const request = buildJsonRequest(args);

  for (const [key, value] of Object.entries(request)) {
    if (key === "extra" || value === undefined || value === null) continue;
    if (typeof value === "object") {
      form.append(key, JSON.stringify(value));
    } else {
      form.append(key, String(value));
    }
  }

  for (const imagePath of args.image_paths) {
    form.append("image", await fileBlob(imagePath), path.basename(imagePath));
  }
  if (args.mask_path) {
    form.append("mask", await fileBlob(args.mask_path), path.basename(args.mask_path));
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(),
    body: form,
    signal
  });
  const json = await parseJsonResponse(response);
  const saved = saveImagesFromResponse(json, outputDir, args.filename_prefix, args.output_format);
  return {
    mode: "edit",
    endpoint,
    model: request.model,
    images: saved,
    raw_usage: json.usage || null
  };
}

function buildJsonRequest(args) {
  validateImageArgs(args);
  const request = {
    model: args.model || defaultModel,
    prompt: args.prompt,
    size: args.size || "auto",
    quality: args.quality || "auto",
    background: args.background || "auto",
    output_format: args.output_format || "png",
    moderation: args.moderation || "auto",
    n: args.n || 1
  };

  if (Number.isInteger(args.output_compression)) {
    request.output_compression = args.output_compression;
  }
  if (args.stream) {
    request.stream = true;
    request.partial_images = args.partial_images || 0;
  }

  return {
    ...request,
    ...(args.extra || {})
  };
}

function normalizeElementSpec(element) {
  if (typeof element === "string") {
    return {
      name: element,
      description: "",
      prompt: ""
    };
  }
  return {
    name: element.name,
    description: element.description || "",
    prompt: element.prompt || ""
  };
}

function buildElementExtractionPrompt(element, promptPrefix, options = {}) {
  const parts = [
    "Use the source design image as visual reference.",
    `Isolate only this design element as a standalone asset: ${element.name}.`,
    element.description ? `Element identification: ${element.description}.` : "",
    element.prompt ? `Element-specific instruction: ${element.prompt}.` : "",
    promptPrefix ? `Shared instruction: ${promptPrefix}.` : "",
    options.chromaKey
      ? `Output only the selected element centered on a perfectly flat pure ${CHROMA_KEY_COLOR} background. The background must be a single solid color with no gradient, texture, shadows, reflections, or objects touching the image border.`
      : "Output only the selected element on a transparent background.",
    "Preserve the visible style, colors, lighting, texture, proportions, and edge quality from the source image.",
    "Remove the surrounding UI, background, unrelated objects, labels, captions, and any cropped neighboring elements.",
    "Do not add new text. If the element itself contains text, keep it only when it is visibly part of that element."
  ];
  return parts.filter(Boolean).join(" ");
}

function buildBackgroundExtractionPrompt(promptPrefix) {
  const parts = [
    "Use the source design image as visual reference.",
    "Recreate only the clean underlying background/backdrop as a standalone asset.",
    promptPrefix ? `Shared instruction: ${promptPrefix}.` : "",
    "Remove foreground characters, products, UI panels, icons, text, labels, and decorative elements that are not part of the background.",
    "Fill any removed areas naturally so the result works as a reusable background plate."
  ];
  return parts.filter(Boolean).join(" ");
}

function slugifyFilename(value) {
  const slug = String(value || "element")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "element";
}

function supportsNativeTransparent(model) {
  return !String(model || defaultModel).toLowerCase().includes("gpt-image-2");
}

function removeChromaKeyFromImages(images, outputDir, prefix) {
  if (!fs.existsSync(CHROMA_KEY_HELPER)) {
    throw new Error(`Chroma-key helper not found: ${CHROMA_KEY_HELPER}`);
  }

  return images.map((image, index) => {
    if (!image.path) return image;
    const inputPath = expandHome(image.path);
    const extension = image.format === "webp" ? "webp" : "png";
    const outputPath = path.join(
      outputDir,
      `${slugifyFilename(prefix)}-transparent-${index + 1}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`
    );
    const process = spawnSync(
      PYTHON_BIN,
      [
        CHROMA_KEY_HELPER,
        "--input",
        inputPath,
        "--out",
        outputPath,
        "--key-color",
        CHROMA_KEY_COLOR,
        "--soft-matte",
        "--transparent-threshold",
        "42",
        "--opaque-threshold",
        "120",
        "--edge-feather",
        "1",
        "--despill",
        "--force"
      ],
      { encoding: "utf8", timeout: 120000 }
    );

    if (process.error) {
      throw process.error;
    }
    if (process.status !== 0) {
      const message = process.stderr || process.stdout || `chroma-key removal exited with ${process.status}`;
      throw new Error(message.trim());
    }

    return {
      path: outputPath,
      kind: image.kind,
      format: extension,
      bytes: fs.statSync(outputPath).size,
      source_chroma_path: inputPath
    };
  });
}

function validateImageArgs(args) {
  if (!IMAGE2_SIZES.has(args.size) && !/^\d+x\d+$/.test(args.size)) {
    throw new Error(`Invalid size '${args.size}'. Use auto, 1024x1024, 1024x1536, 1536x1024, or a provider-supported WIDTHxHEIGHT.`);
  }
  if (!IMAGE2_QUALITIES.has(args.quality)) {
    throw new Error(`Invalid quality '${args.quality}'.`);
  }
  if (!BACKGROUNDS.has(args.background)) {
    throw new Error(`Invalid background '${args.background}'.`);
  }
  if (!OUTPUT_FORMATS.has(args.output_format)) {
    throw new Error(`Invalid output_format '${args.output_format}'.`);
  }
  if (!MODERATIONS.has(args.moderation)) {
    throw new Error(`Invalid moderation '${args.moderation}'.`);
  }
  if (args.partial_images > MAX_PARTIAL_IMAGES) {
    throw new Error("partial_images must be between 0 and 3.");
  }
}

async function requestJson(endpoint, request, signal) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "content-type": "application/json"
    },
    body: JSON.stringify(request),
    signal
  });
  return parseJsonResponse(response);
}

async function requestImageStream(endpoint, request, outputDir, prefix, outputFormat, signal) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "content-type": "application/json"
    },
    body: JSON.stringify(request),
    signal
  });

  if (!response.ok) {
    await parseJsonResponse(response);
  }
  if (!response.body) {
    throw new Error("Streaming response body is empty.");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  const partials = [];
  const finals = [];
  let rawUsage = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const event = parseSseChunk(chunk);
      if (!event || event.data === "[DONE]") continue;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        continue;
      }

      const b64 = findBase64Image(payload);
      if (!b64) {
        if (payload.usage) rawUsage = payload.usage;
        continue;
      }

      const kind = isPartialEvent(event.event, payload) ? "partial" : "final";
      const saved = saveBase64Image(b64, outputDir, prefix, outputFormat, kind);
      if (kind === "partial") partials.push(saved);
      else finals.push(saved);
      if (payload.usage) rawUsage = payload.usage;
    }
  }

  return {
    partial_images: partials,
    images: finals.length ? finals : partials.slice(-1),
    raw_usage: rawUsage
  };
}

function parseSseChunk(chunk) {
  const lines = chunk.split(/\r?\n/);
  const event = { event: null, data: "" };
  for (const line of lines) {
    if (line.startsWith("event:")) event.event = line.slice(6).trim();
    if (line.startsWith("data:")) event.data += line.slice(5).trim();
  }
  return event.data ? event : null;
}

function isPartialEvent(eventName, payload) {
  const name = `${eventName || ""} ${payload.type || ""}`.toLowerCase();
  return name.includes("partial");
}

function saveImagesFromResponse(json, outputDir, prefix, outputFormat) {
  const data = Array.isArray(json.data) ? json.data : [];
  const saved = [];
  for (const item of data) {
    const b64 = item.b64_json || item.image || item.data;
    if (b64) {
      saved.push(saveBase64Image(b64, outputDir, prefix, outputFormat, "final"));
    } else if (item.url) {
      saved.push({ url: item.url });
    }
  }
  if (!saved.length) {
    const b64 = findBase64Image(json);
    if (b64) saved.push(saveBase64Image(b64, outputDir, prefix, outputFormat, "final"));
  }
  return saved;
}

function findBase64Image(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.b64_json === "string") return value.b64_json;
  if (typeof value.image === "string" && looksLikeBase64(value.image)) return value.image;
  if (typeof value.data === "string" && looksLikeBase64(value.data)) return value.data;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findBase64Image(item);
        if (found) return found;
      }
    } else if (child && typeof child === "object") {
      const found = findBase64Image(child);
      if (found) return found;
    }
  }
  return null;
}

function looksLikeBase64(text) {
  return text.length > 100 && /^[A-Za-z0-9+/=_-]+$/.test(text);
}

function saveBase64Image(b64, outputDir, prefix, outputFormat, kind) {
  const safePrefix = String(prefix || "image2").replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${safePrefix}-${kind}-${Date.now()}-${randomUUID().slice(0, 8)}.${outputFormat}`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, Buffer.from(stripDataUrl(b64), "base64"));
  return {
    path: filePath,
    kind,
    format: outputFormat,
    bytes: fs.statSync(filePath).size
  };
}

function stripDataUrl(b64) {
  const comma = b64.indexOf(",");
  if (b64.startsWith("data:") && comma !== -1) return b64.slice(comma + 1);
  return b64;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const message = json?.error?.message || json?.message || text || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.status = response.status;
    error.response = json;
    throw error;
  }
  return json;
}

async function fileBlob(filePath) {
  const resolved = expandHome(filePath);
  const bytes = fs.readFileSync(resolved);
  return new Blob([bytes]);
}

function authHeaders() {
  return { authorization: `Bearer ${apiKey}` };
}

function assertConfigured() {
  if (!apiKey) throw new Error("IMAGE2_API_KEY is not configured. Set IMAGE2_API_KEY or OPENAI_API_KEY.");
}

function normalizeBaseUrl(url) {
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function ensureOutputDir(outputDir) {
  const resolved = expandHome(outputDir || defaultOutputDir);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function updateJob(jobId, patch) {
  const record = jobs.get(jobId);
  if (!record) return;
  Object.assign(record, patch, { updated_at: new Date().toISOString() });
  writeJob(record);
}

function writeJob(record) {
  const file = path.join(JOBS_DIR, `${record.job_id}.json`);
  fs.writeFileSync(file, JSON.stringify(publicJob(record), null, 2));
}

function readJob(jobId) {
  const file = path.join(JOBS_DIR, `${jobId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function publicJob(record) {
  if (!record) return null;
  const { controller, ...publicRecord } = record;
  return publicRecord;
}

function sanitizeForRecord(args) {
  const copy = { ...args };
  if (copy.extra && typeof copy.extra === "object") {
    copy.extra = { ...copy.extra };
    for (const key of Object.keys(copy.extra)) {
      if (/api[-_]?key|authorization|bearer|token|secret|password/i.test(key)) {
        copy.extra[key] = "<redacted>";
      }
    }
  }
  return copy;
}

function errorToJson(error) {
  return {
    message: error.message,
    status: error.status || null,
    response: error.response || null
  };
}

function jsonToolResult(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
