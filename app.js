const PARAM_NAMES = {
  data: "wallpaper_data_json",
  liveCategories: "live_wallpaper_categories_json",
  fourKCategories: "wallpaper_4k_categories_json",
  version: "wallpaper_config_version",
};

const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "m4v"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);
const THUMB_HINTS = new Set(["thumb", "thumbs", "thumbnail", "thumbnails"]);

const els = {
  jsonInput: document.getElementById("jsonInput"),
  folderButton: document.getElementById("folderButton"),
  folderInput: document.getElementById("folderInput"),
  packageRootInput: document.getElementById("packageRootInput"),
  dataRootInput: document.getElementById("dataRootInput"),

  categoryTargetInput: document.getElementById("categoryTargetInput"),
  iconRootInput: document.getElementById("iconRootInput"),
  versionInput: document.getElementById("versionInput"),
  itemSearchInput: document.getElementById("itemSearchInput"),
  newDataButton: document.getElementById("newDataButton"),
  generateButton: document.getElementById("generateButton"),
  healthPill: document.getElementById("healthPill"),
  statsGrid: document.getElementById("statsGrid"),
  overviewBody: document.getElementById("overviewBody"),
  planBody: document.getElementById("planBody"),
  itemsBody: document.getElementById("itemsBody"),
  indexSummary: document.getElementById("indexSummary"),
  logList: document.getElementById("logList"),
  logCountLabel: document.getElementById("logCountLabel"),
  jsonNameLabel: document.getElementById("jsonNameLabel"),
  folderNameLabel: document.getElementById("folderNameLabel"),
  generateTitle: document.getElementById("generateTitle"),
  generateSubtitle: document.getElementById("generateSubtitle"),
};

const state = {
  remoteConfig: null,
  jsonFileName: "",
  folderLabel: "",
  items: [],
  liveCategories: [],
  fourKCategories: [],
  paramPaths: {},
  analysis: null,
  scanned: null,
  plan: [],
  logs: [],
  busy: false,
};

const textEncoder = new TextEncoder();

function addLog(type, message) {
  state.logs.unshift({
    type,
    message,
    time: new Date().toLocaleTimeString(),
  });
  renderLogs();
}

function setHealth(type, message) {
  els.healthPill.className = `health-pill ${type || ""}`.trim();
  els.healthPill.textContent = message;
}

function getExt(name) {
  const clean = String(name || "").split("?")[0].split("#")[0];
  const index = clean.lastIndexOf(".");
  return index >= 0 ? clean.slice(index + 1).toLowerCase() : "";
}

function stripExt(name) {
  const base = String(name || "").split("/").pop() || "";
  const index = base.lastIndexOf(".");
  return index >= 0 ? base.slice(0, index) : base;
}

function getParentPath(path) {
  const clean = normalizeSlashes(path);
  const index = clean.lastIndexOf("/");
  return index >= 0 ? clean.slice(0, index) : "";
}

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

function joinPath(...parts) {
  return normalizeSlashes(parts.filter((part) => String(part || "").trim() !== "").join("/"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(value) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "category";
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findParam(remoteConfig, paramName) {
  const groups = remoteConfig?.parameterGroups || {};
  for (const [groupName, group] of Object.entries(groups)) {
    const params = group?.parameters || {};
    if (Object.prototype.hasOwnProperty.call(params, paramName)) {
      return {
        groupName,
        paramName,
        param: params[paramName],
      };
    }
  }
  return null;
}

function parseNestedJsonParam(remoteConfig, paramName, fallback = []) {
  const ref = findParam(remoteConfig, paramName);
  if (!ref) {
    return { ref: null, value: fallback };
  }
  const rawValue = ref.param?.defaultValue?.value;
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { ref, value: fallback };
  }
  return { ref, value: JSON.parse(rawValue) };
}

function parseAssetPath(assetPath) {
  const path = normalizeSlashes(assetPath);
  const parts = path.split("/").filter(Boolean);
  const markerIndex = parts.findIndex((part) =>
    ["background", "resize", "thumbnails", "thumbnail", "thumbs", "thumb"].includes(part.toLowerCase())
  );
  const fileName = parts[parts.length - 1] || "";
  const baseName = stripExt(fileName);
  const match = baseName.match(/^(.*?)(\d+)$/);
  return {
    path,
    root: markerIndex >= 0 ? parts.slice(0, markerIndex).join("/") : parts.slice(0, -1).join("/"),
    fileName,
    prefix: match ? match[1] : "",
    index: match ? Number(match[2]) : null,
  };
}

function analyzeItems(items) {
  const byCategory = new Map();
  const ids = [];
  const idCounts = new Map();
  const allPaths = new Map();

  for (const item of items) {
    const id = Number(item.id);
    if (Number.isFinite(id)) {
      ids.push(id);
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }

    const category = String(item.category || "Uncategorized");
    if (!byCategory.has(category)) {
      byCategory.set(category, {
        name: category,
        count: 0,
        maxItemId: null,
        maxFileIndex: 0,
        pathRoot: "",
        filePrefix: "",
        rootCandidates: new Map(),
        prefixCandidates: new Map(),
        typeCandidates: new Map(),
      });
    }
    const stat = byCategory.get(category);
    stat.count += 1;
    stat.maxItemId = stat.maxItemId === null ? id : Math.max(stat.maxItemId, id);

    for (const key of ["thumbnail", "path"]) {
      const value = item[key];
      if (!value) continue;
      allPaths.set(normalizeSlashes(value), (allPaths.get(normalizeSlashes(value)) || 0) + 1);
      const parsed = parseAssetPath(value);
      if (parsed.index !== null) {
        if (parsed.index >= stat.maxFileIndex) {
          stat.maxFileIndex = parsed.index;
          if (parsed.root) stat.pathRoot = parsed.root;
          if (parsed.prefix) stat.filePrefix = parsed.prefix;
        }
        if (parsed.root) {
          stat.rootCandidates.set(parsed.root, (stat.rootCandidates.get(parsed.root) || 0) + 1);
        }
        if (parsed.prefix) {
          stat.prefixCandidates.set(parsed.prefix, (stat.prefixCandidates.get(parsed.prefix) || 0) + 1);
        }
      }
    if (item.type) {
      stat.typeCandidates.set(item.type, (stat.typeCandidates.get(item.type) || 0) + 1);
    }
  }

  const stats = [...byCategory.values()].sort((a, b) => naturalCompare(a.name, b.name));
  for (const stat of stats) {
    if (!stat.pathRoot && stat.rootCandidates.size) {
      stat.pathRoot = mostCommon(stat.rootCandidates);
    }
    if (!stat.filePrefix && stat.prefixCandidates.size) {
      stat.filePrefix = mostCommon(stat.prefixCandidates);
    }
    stat.commonType = mostCommon(stat.typeCandidates);
    stat.nextFileIndex = stat.maxFileIndex + 1;
  }

  const maxId = ids.length ? Math.max(...ids) : 0;
  const missingIds = [];
  for (let id = 1; id <= maxId; id += 1) {
    if (!idCounts.has(id)) missingIds.push(id);
  }
  const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const duplicatePaths = [...allPaths.entries()].filter(([, count]) => count > 1).map(([path]) => path);

  return {
    maxId,
    total: items.length,
    categories: stats,
    categoryMap: byCategory,
    missingIds,
    duplicateIds,
    duplicatePaths,
  };
}

function mostCommon(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || naturalCompare(a[0], b[0]))[0]?.[0] || "";
}

async function handleJsonImport(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const remoteConfig = JSON.parse(text);
    const data = parseNestedJsonParam(remoteConfig, PARAM_NAMES.data);
    if (!data.ref) {
      throw new Error(`Không tìm thấy ${PARAM_NAMES.data} trong Remote Config.`);
    }

    const liveCategories = parseNestedJsonParam(remoteConfig, PARAM_NAMES.liveCategories);
    const fourKCategories = parseNestedJsonParam(remoteConfig, PARAM_NAMES.fourKCategories);
    const versionRef = findParam(remoteConfig, PARAM_NAMES.version);

    state.remoteConfig = remoteConfig;
    state.jsonFileName = file.name;
    state.items = Array.isArray(data.value) ? data.value : [];
    state.liveCategories = Array.isArray(liveCategories.value) ? liveCategories.value : [];
    state.fourKCategories = Array.isArray(fourKCategories.value) ? fourKCategories.value : [];
    state.paramPaths = {
      data: data.ref,
      liveCategories: liveCategories.ref,
      fourKCategories: fourKCategories.ref,
      version: versionRef,
    };
    state.analysis = analyzeItems(state.items);

    addLog("info", `Đã import ${file.name}: ${state.items.length} item, max id ${state.analysis.maxId}.`);
    if (state.analysis.duplicateIds.length) {
      addLog("warn", `JSON đang có ID trùng: ${state.analysis.duplicateIds.join(", ")}.`);
    }
    if (state.analysis.duplicatePaths.length) {
      addLog("warn", `JSON đang có path trùng: ${state.analysis.duplicatePaths.length} path.`);
    }
    rebuildPlan();
    render();
  } catch (error) {
    addLog("error", error.message);
    setHealth("warn", "JSON lỗi");
  }
}

function scanFolderFiles(files, packageRoot = "") {
  const supported = [];
  const ignored = [];
  for (const file of files) {
    const ext = getExt(file.name);
    const kind = VIDEO_EXTS.has(ext) ? "video" : IMAGE_EXTS.has(ext) ? "image" : "";
    if (!kind) {
      ignored.push(file.webkitRelativePath || file.name);
      continue;
    }
    supported.push({
      file,
      ext,
      kind,
      relativePath: normalizeSlashes(file.webkitRelativePath || file.name),
    });
  }

  const pathParts = supported.map((entry) => entry.relativePath.split("/").filter(Boolean));
  const firstSegment = pathParts[0]?.[0] || "";
  const packageRootSlug = slugify(packageRoot);
  const firstSegmentSlug = slugify(firstSegment);
  const shouldStripOuterRoot =
    firstSegment &&
    packageRootSlug &&
    firstSegmentSlug === packageRootSlug &&
    pathParts.length > 0 &&
    pathParts.every((parts) => parts[0] === firstSegment && parts.length >= 3);

  const groups = new Map();
  for (const entry of supported) {
    const parts = entry.relativePath.split("/").filter(Boolean);
    const normalizedParts = shouldStripOuterRoot ? parts.slice(1) : parts;
    const category = normalizedParts[0];
    if (!category || category.startsWith(".")) continue;
    const rest = normalizedParts.slice(1);
    const bucket = groups.get(category) || {
      category,
      files: [],
      videos: [],
      images: [],
    };
    const normalizedEntry = {
      ...entry,
      category,
      restPath: rest.join("/"),
      parentPath: rest.length > 1 ? rest.slice(0, -1).join("/") : "",
      baseName: stripExt(entry.file.name),
      isThumbHint: rest.some((part) => THUMB_HINTS.has(part.toLowerCase())),
    };
    bucket.files.push(normalizedEntry);
    bucket[entry.kind === "video" ? "videos" : "images"].push(normalizedEntry);
    groups.set(category, bucket);
  }

  const categories = [...groups.values()].sort((a, b) => naturalCompare(a.category, b.category));
  return {
    sourceRoot: shouldStripOuterRoot ? firstSegment : "",
    categories,
    ignored,
    supportedCount: supported.length,
  };
}

function handleFolderImport(files) {
  if (!files || !files.length) return;
  state.scanned = scanFolderFiles([...files], readSettings().packageRoot);
  state.folderLabel = state.scanned.sourceRoot || "Folder đã chọn";
  if (state.scanned.ignored.length) {
    addLog("warn", `Bỏ qua ${state.scanned.ignored.length} file không hỗ trợ.`);
  }
  addLog(
    "info",
    `Đã import folder: ${state.scanned.categories.length} category, ${state.scanned.supportedCount} file media.`
  );
  rebuildPlan();
  render();
}

function rebuildPlan() {
  if (!state.remoteConfig || !state.analysis || !state.scanned) {
    state.plan = [];
    return;
  }

  const settings = readSettings();
  let nextId = state.analysis.maxId + 1;
  const nextIndexByCategory = new Map();
  const plan = [];

  for (const stat of state.analysis.categories) {
    nextIndexByCategory.set(stat.name.toLowerCase(), stat.maxFileIndex + 1);
  }

  for (const group of state.scanned.categories) {
    const assets = buildAssetsForCategory(group);
    for (const asset of assets) {
      const stat = findCategoryStat(group.category);
      const categoryName = stat?.name || group.category;
      const categoryKey = categoryName.toLowerCase();
      const index = nextIndexByCategory.get(categoryKey) || 1;
      nextIndexByCategory.set(categoryKey, index + 1);

      const existingRoot = stat?.pathRoot || slugify(group.category);
      const categoryRoot = settings.dataRoot ? joinPath(settings.dataRoot, existingRoot) : existingRoot;
      const filePrefix = stat?.filePrefix || `${slugify(group.category)}_`;
      const backgroundExt = asset.kind === "video" ? asset.background.ext : "png";
      const backgroundPath = joinPath(categoryRoot, "background", `${filePrefix}${index}.${backgroundExt}`);
      const thumbnailPath = joinPath(categoryRoot, "thumbnails", `${filePrefix}${index}.webp`);
      let itemType = "";
      const stat = findCategoryStat(group.category);
      if (stat && stat.commonType) {
        itemType = stat.commonType;
      } else {
        const fullPath = asset.background.relativePath.toLowerCase();
        if (fullPath.includes("silly smile") || fullPath.includes("emoji")) {
          itemType = "silly smile";
        } else if (fullPath.includes("live wallpaper") || asset.kind === "video") {
          itemType = "live wallpaper";
        } else {
          itemType = "wallpaper 4k";
        }
      }

      plan.push({
        id: nextId,
        category: categoryName,
        index,
        kind: asset.kind,
        background: asset.background,
        thumbnailSource: asset.thumbnailSource,
        item: {
          id: nextId,
          type: itemType,
          category: categoryName,
          thumbnail: thumbnailPath,
          path: backgroundPath,
        },
      });
      nextId += 1;
    }
  }

  state.plan = plan;
}

function buildAssetsForCategory(group) {
  const images = [...group.images].sort((a, b) => naturalCompare(a.relativePath, b.relativePath));
  const videos = [...group.videos].sort((a, b) => naturalCompare(a.relativePath, b.relativePath));
  const usedImages = new Set();
  const assets = [];

  for (const video of videos) {
    const thumbnail = findThumbnailForVideo(video, images, usedImages);
    if (thumbnail) usedImages.add(thumbnail.relativePath);
    assets.push({
      kind: "video",
      background: video,
      thumbnailSource: thumbnail || null,
    });
  }

  const imagesByFolder = new Map();
  for (const image of images) {
    if (usedImages.has(image.relativePath)) continue;
    const key = image.parentPath || "";
    if (!imagesByFolder.has(key)) imagesByFolder.set(key, []);
    imagesByFolder.get(key).push(image);
  }

  for (const folderImages of imagesByFolder.values()) {
    const sorted = folderImages.sort((a, b) => naturalCompare(a.relativePath, b.relativePath));
    const thumbImages = sorted.filter(isLikelyThumbnailImage);
    const backgroundImages = sorted.filter((image) => !isLikelyThumbnailImage(image));
    const usableBackgrounds = backgroundImages.length ? backgroundImages : sorted;
    const fallbackThumb = thumbImages[0] || null;

    for (const image of usableBackgrounds) {
      if (usedImages.has(image.relativePath)) continue;
      usedImages.add(image.relativePath);
      if (fallbackThumb) usedImages.add(fallbackThumb.relativePath);
      assets.push({
        kind: "image",
        background: image,
        thumbnailSource: fallbackThumb || image,
      });
    }
  }

  return assets.sort((a, b) => naturalCompare(a.background.relativePath, b.background.relativePath));
}

function isLikelyThumbnailImage(image) {
  const base = slugify(image.baseName);
  return image.isThumbHint || base.includes("thumb") || base.includes("thumbnail");
}

function findThumbnailForVideo(video, images, usedImages) {
  const videoBase = slugify(video.baseName);
  const candidates = images.filter((image) => !usedImages.has(image.relativePath));
  const scored = candidates
    .map((image) => {
      const imageBase = slugify(image.baseName);
      let score = 0;
      if (imageBase === videoBase) score += 100;
      if (image.parentPath && image.parentPath === video.parentPath) score += 70;
      if (imageBase.includes(videoBase) || videoBase.includes(imageBase)) score += 30;
      if (isLikelyThumbnailImage(image)) score += 40;
      return { image, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || naturalCompare(a.image.relativePath, b.image.relativePath));

  return scored[0]?.image || null;
}

function findCategoryStat(category) {
  const lower = String(category || "").toLowerCase();
  return state.analysis?.categories.find((stat) => stat.name.toLowerCase() === lower) || null;
}

function readSettings() {
  return {
    packageRoot: normalizeSlashes(els.packageRootInput.value.trim()),
    dataRoot: normalizeSlashes(els.dataRootInput.value.trim()),
    categoryTarget: els.categoryTargetInput.value,
    iconRoot: normalizeSlashes(els.iconRootInput.value.trim()) || "ic_category",
    incrementVersion: els.versionInput.checked,
  };
}

function packageAssetPath(jsonPath, settings = readSettings()) {
  return settings.packageRoot ? joinPath(settings.packageRoot, jsonPath) : normalizeSlashes(jsonPath);
}

function buildUpdatedOutput() {
  const settings = readSettings();
  const remoteConfig = deepClone(state.remoteConfig);
  const dataParam = findParam(remoteConfig, PARAM_NAMES.data);
  const liveParam = findParam(remoteConfig, PARAM_NAMES.liveCategories);
  const fourKParam = findParam(remoteConfig, PARAM_NAMES.fourKCategories);
  const versionParam = findParam(remoteConfig, PARAM_NAMES.version);
  const finalItems = [...state.items, ...state.plan.map((entry) => entry.item)];
  const finalLiveCategories = deepClone(state.liveCategories);
  const finalFourKCategories = deepClone(state.fourKCategories);
  const categoryAdds = {
    live: [],
    fourK: [],
  };

  for (const planned of state.plan) {
    const target = resolveCategoryTarget(planned.kind, settings.categoryTarget);
    if (target === "live") {
      maybeAddCategory(finalLiveCategories, planned.category, settings.iconRoot, categoryAdds.live);
    }
    if (target === "4k") {
      maybeAddCategory(finalFourKCategories, planned.category, settings.iconRoot, categoryAdds.fourK);
    }
  }

  dataParam.param.defaultValue.value = JSON.stringify(finalItems);
  if (liveParam) liveParam.param.defaultValue.value = JSON.stringify(finalLiveCategories);
  if (fourKParam) fourKParam.param.defaultValue.value = JSON.stringify(finalFourKCategories);

  let versionBefore = null;
  let versionAfter = null;
  if (settings.incrementVersion && versionParam?.param?.defaultValue) {
    versionBefore = versionParam.param.defaultValue.value;
    const numeric = Number(versionBefore);
    versionAfter = Number.isFinite(numeric) ? String(numeric + 1) : versionBefore;
    versionParam.param.defaultValue.value = versionAfter;
  }

  const validation = validateFinalOutput(finalItems, finalLiveCategories, finalFourKCategories);
  return {
    remoteConfig,
    finalItems,
    finalLiveCategories,
    finalFourKCategories,
    categoryAdds,
    versionBefore,
    versionAfter,
    validation,
  };
}

function resolveCategoryTarget(kind, mode) {
  if (mode === "none") return "";
  if (mode === "live") return "live";
  if (mode === "4k") return "4k";
  return kind === "video" ? "live" : "4k";
}

function maybeAddCategory(categoryList, category, iconRoot, addedList) {
  const exists = categoryList.some((entry) => String(entry.name || "").toLowerCase() === category.toLowerCase());
  if (exists) return;
  const maxId = categoryList.reduce((max, entry) => Math.max(max, Number(entry.id) || 0), 0);
  const newCategory = {
    id: maxId + 1,
    name: category,
    category_icon: joinPath(iconRoot, `ic_${slugify(category)}.png`),
  };
  categoryList.push(newCategory);
  addedList.push(newCategory);
}

function validateFinalOutput() {
  const existingIds = new Set(state.items.map((item) => Number(item.id)).filter(Number.isFinite));
  const existingPaths = new Set();
  const duplicateIds = [];
  const duplicatePaths = [];
  const newIds = new Set();
  const newPaths = new Set();

  for (const item of state.items) {
    for (const key of ["thumbnail", "path"]) {
      const value = normalizeSlashes(item[key]);
      if (value) existingPaths.add(value);
    }
  }

  for (const entry of state.plan) {
    if (existingIds.has(entry.id) || newIds.has(entry.id)) {
      duplicateIds.push(entry.id);
    }
    newIds.add(entry.id);

    for (const key of ["thumbnail", "path"]) {
      const value = normalizeSlashes(entry.item[key]);
      if (!value) continue;
      if (existingPaths.has(value) || newPaths.has(value)) {
        duplicatePaths.push(value);
      }
      newPaths.add(value);
    }
  }

  const expectedIds = state.plan.map((entry, offset) => state.analysis.maxId + 1 + offset);
  const actualIds = state.plan.map((entry) => entry.id);
  const idSequenceOk = expectedIds.every((id, index) => actualIds[index] === id);
  const indexOk = state.plan.every((entry) => {
    const stat = findCategoryStat(entry.category);
    return entry.index > (stat?.maxFileIndex || 0);
  });

  return {
    ok: duplicateIds.length === 0 && duplicatePaths.length === 0 && idSequenceOk && indexOk,
    duplicateIds,
    duplicatePaths,
    existingDuplicatePaths: state.analysis.duplicatePaths,
    idSequenceOk,
    indexOk,
  };
}

async function handleGenerate() {
  if (!state.remoteConfig || state.busy) return;
  state.busy = true;
  renderGenerateState("Đang generate ZIP...", "Đang convert thumbnail WebP 99% và build JSON.");

  try {
    const settings = readSettings();
    const output = buildUpdatedOutput();
    if (!output.validation.ok) {
      throw new Error("Index/path validation chưa pass. Xem log để kiểm tra.");
    }

    const zip = new ZipWriter();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const report = buildReport(output);

    await zip.addText(`json/remote_config_silly_updated_${stamp}.json`, JSON.stringify(output.remoteConfig, null, 2));
    await zip.addText("json/wallpaper_data_json.json", JSON.stringify(output.finalItems, null, 2));
    await zip.addText("json/live_wallpaper_categories_json.json", JSON.stringify(output.finalLiveCategories, null, 2));
    await zip.addText("json/wallpaper_4k_categories_json.json", JSON.stringify(output.finalFourKCategories, null, 2));
    await zip.addText("report/index_check_report.json", JSON.stringify(report, null, 2));

    await addPlannedMediaToZip(zip, settings);

    const blob = zip.finish();
    downloadBlob(blob, `silly_data_package_${stamp}.zip`);
    addLog("info", `Generate xong: ${output.finalItems.length} item, thêm ${state.plan.length} item mới.`);
    renderGenerateState("Generate xong", "ZIP đã được tạo với JSON mới, report index và package data.");
  } catch (error) {
    addLog("error", error.message);
    renderGenerateState("Generate lỗi", error.message);
  } finally {
    state.busy = false;
    render();
  }
}

async function handleGenerateNewData() {
  if (!state.remoteConfig || !state.plan.length || state.busy) return;
  state.busy = true;
  renderGenerateState("Đang gen new data...", "Chỉ xuất media mới theo đúng folder path file.");

  try {
    const settings = readSettings();
    const output = buildUpdatedOutput();
    if (!output.validation.ok) {
      throw new Error("Index/path validation chưa pass. Xem log để kiểm tra.");
    }

    const zip = new ZipWriter();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const report = buildReport(output);
    await zip.addText("report/new_data_plan.json", JSON.stringify(report.generated.plannedByCategory, null, 2));
    await zip.addText("report/index_check_report.json", JSON.stringify(report, null, 2));
    await addPlannedMediaToZip(zip, settings);

    const blob = zip.finish();
    downloadBlob(blob, `new_data_${settings.packageRoot || "package"}_${stamp}.zip`);
    addLog("info", `Gen new data xong: ${state.plan.length} item mới, folder root ${settings.packageRoot || "(none)"}.`);
    renderGenerateState("Gen new data xong", "ZIP chỉ chứa media mới và report index.");
  } catch (error) {
    addLog("error", error.message);
    renderGenerateState("Gen new data lỗi", error.message);
  } finally {
    state.busy = false;
    render();
  }
}

async function addPlannedMediaToZip(zip, settings) {
  for (let index = 0; index < state.plan.length; index += 1) {
    const entry = state.plan[index];
    const zipPath = packageAssetPath(entry.item.path, settings);
    renderGenerateState(
      `Đang xử lý ${index + 1}/${state.plan.length}`,
      `${entry.category} #${entry.index} -> ${zipPath}`
    );

    if (entry.kind === "video") {
      await zip.addBlob(zipPath, entry.background.file);
      const thumbnailBlob = entry.thumbnailSource
        ? await imageToWebp(entry.thumbnailSource.file, 0.99)
        : await captureVideoFrameToWebp(entry.background.file, 0.99);
      await zip.addBlob(packageAssetPath(entry.item.thumbnail, settings), thumbnailBlob);
    } else {
      const backgroundBlob = await imageToPng(entry.background.file);
      const thumbnailBlob = await imageToWebp(entry.thumbnailSource.file, 0.99);
      await zip.addBlob(zipPath, backgroundBlob);
      await zip.addBlob(packageAssetPath(entry.item.thumbnail, settings), thumbnailBlob);
    }
  }
}

function buildReport(output) {
  const plannedByCategory = {};
  const settings = readSettings();
  for (const entry of state.plan) {
    if (!plannedByCategory[entry.category]) plannedByCategory[entry.category] = [];
    plannedByCategory[entry.category].push({
      id: entry.id,
      index: entry.index,
      path: entry.item.path,
      thumbnail: entry.item.thumbnail,
      zipPath: packageAssetPath(entry.item.path, settings),
      zipThumbnail: packageAssetPath(entry.item.thumbnail, settings),
      source: entry.background.relativePath,
      thumbnailSource: entry.thumbnailSource?.relativePath || "video_first_frame",
    });
  }

  return {
    sourceJson: state.jsonFileName,
    sourceFolder: state.folderLabel,
    packageRoot: settings.packageRoot,
    jsonPathPrefix: settings.dataRoot,
    existing: {
      itemCount: state.items.length,
      maxId: state.analysis.maxId,
      missingIds: state.analysis.missingIds,
      duplicateIds: state.analysis.duplicateIds,
      duplicatePaths: state.analysis.duplicatePaths,
    },
    generated: {
      newItemCount: state.plan.length,
      finalItemCount: output.finalItems.length,
      versionBefore: output.versionBefore,
      versionAfter: output.versionAfter,
      addedLiveCategories: output.categoryAdds.live,
      addedFourKCategories: output.categoryAdds.fourK,
      validation: output.validation,
      plannedByCategory,
    },
  };
}

function render() {
  rebuildPlan();
  renderStats();
  renderOverview();
  renderPlan();
  renderItems();
  renderIndexSummary();
  renderLogs();
  renderGenerateAvailability();
}

function renderStats() {
  const analysis = state.analysis;
  const metrics = [
    ["Items", analysis?.total ?? 0],
    ["Max ID", analysis?.maxId || "-"],
    ["Category", analysis?.categories.length ?? 0],
    ["New plan", state.plan.length],
  ];
  els.statsGrid.innerHTML = metrics
    .map(
      ([label, value]) => `
        <div class="metric">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `
    )
    .join("");
}

function renderOverview() {
  els.jsonNameLabel.textContent = state.jsonFileName || "Chưa có JSON";
  const rows = state.analysis?.categories || [];
  if (!rows.length) {
    els.overviewBody.innerHTML = `<tr><td class="empty-row" colspan="6">Import JSON để xem overview.</td></tr>`;
    return;
  }
  els.overviewBody.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td><strong>${escapeHtml(row.name)}</strong></td>
        <td>${row.count}</td>
        <td>${row.maxItemId ?? "-"}</td>
        <td>${row.maxFileIndex || 0}</td>
        <td class="path-cell">${escapeHtml(row.pathRoot || "-")}</td>
        <td class="path-cell">${escapeHtml(row.filePrefix || "-")}</td>
      </tr>
    `
    )
    .join("");
}

function renderPlan() {
  const settings = readSettings();
  els.folderNameLabel.textContent = state.scanned
    ? `${state.folderLabel || "Folder"} - ${state.scanned.supportedCount} file`
    : "Chưa import folder";
  if (!state.plan.length) {
    els.planBody.innerHTML = `<tr><td class="empty-row" colspan="6">Import folder data để tạo plan.</td></tr>`;
    return;
  }
  els.planBody.innerHTML = state.plan
    .map(
      (entry) => `
      <tr>
        <td><strong>${entry.id}</strong></td>
        <td>${escapeHtml(entry.category)}</td>
        <td>${entry.index}</td>
        <td>${entry.kind === "video" ? "Video background" : "PNG background"}</td>
        <td>${escapeHtml(entry.thumbnailSource?.relativePath || "Capture first frame")}</td>
        <td class="path-cell">${escapeHtml(entry.item.path)}<br>${escapeHtml(entry.item.thumbnail)}<br>ZIP: ${escapeHtml(
        packageAssetPath(entry.item.path, settings)
      )}</td>
      </tr>
    `
    )
    .join("");
}

function renderItems() {
  const query = els.itemSearchInput.value.trim().toLowerCase();
  const items = query
    ? state.items.filter((item) =>
        [item.id, item.type, item.category, item.thumbnail, item.path].join(" ").toLowerCase().includes(query)
      )
    : state.items;

  if (!items.length) {
    els.itemsBody.innerHTML = `<tr><td class="empty-row" colspan="5">Không có item nào để hiển thị.</td></tr>`;
    return;
  }

  els.itemsBody.innerHTML = items
    .slice(0, 1000)
    .map(
      (item) => `
      <tr>
        <td><strong>${escapeHtml(item.id)}</strong></td>
        <td>${escapeHtml(item.type)}</td>
        <td>${escapeHtml(item.category)}</td>
        <td class="path-cell">${escapeHtml(item.thumbnail)}</td>
        <td class="path-cell">${escapeHtml(item.path)}</td>
      </tr>
    `
    )
    .join("");
}

function renderIndexSummary() {
  if (!state.analysis) {
    els.indexSummary.textContent = "Import JSON để xem max id và index từng category.";
    return;
  }

  const nextId = state.analysis.maxId + 1;
  const plannedCategories = [...new Set(state.plan.map((entry) => entry.category))];
  const categoryLines = plannedCategories.length
    ? plannedCategories
        .map((category) => {
          const stat = findCategoryStat(category);
          const planned = state.plan.filter((entry) => entry.category === category);
          const from = planned[0]?.index;
          const to = planned[planned.length - 1]?.index;
          return `<div><strong>${escapeHtml(category)}</strong>: hiện tại ${
            stat?.maxFileIndex || 0
          }, tạo mới ${from}${to !== from ? `-${to}` : ""}</div>`;
        })
        .join("")
    : "<div>Chưa có folder mới để check index.</div>";

  els.indexSummary.innerHTML = `
    <div><strong>Next item id:</strong> ${nextId}</div>
    <div><strong>ID missing hiện có:</strong> ${
      state.analysis.missingIds.length ? state.analysis.missingIds.slice(0, 20).join(", ") : "không có"
    }</div>
    ${categoryLines}
  `;
}

function renderLogs() {
  els.logCountLabel.textContent = `${state.logs.length} log`;
  if (!state.logs.length) {
    els.logList.innerHTML = `<div class="log-entry info">Chưa có log.</div>`;
    return;
  }
  els.logList.innerHTML = state.logs
    .slice(0, 80)
    .map(
      (log) => `
      <div class="log-entry ${escapeHtml(log.type)}">
        <strong>${escapeHtml(log.time)}</strong> ${escapeHtml(log.message)}
      </div>
    `
    )
    .join("");
}

function renderGenerateAvailability() {
  if (state.busy) return;
  const ready = Boolean(state.remoteConfig);
  els.generateButton.disabled = !ready;
  els.newDataButton.disabled = !ready || !state.plan.length;
  if (!ready) {
    setHealth("", "Chưa import JSON");
    els.generateTitle.textContent = "Sẵn sàng khi đã import JSON";
    els.generateSubtitle.textContent = "ZIP sẽ giữ folder đúng theo path file, ví dụ sillysmiles2025/emoji/...";
    return;
  }
  if (state.plan.length) {
    setHealth("ok", "Index đã plan");
    els.generateTitle.textContent = `Sẽ thêm ${state.plan.length} item mới`;
    els.generateSubtitle.textContent = "Gen new data chỉ xuất media mới; Generate all json xuất JSON mới kèm media.";
    return;
  }
  setHealth("ok", "JSON đã import");
  els.generateTitle.textContent = "Có thể export JSON hiện tại";
  els.generateSubtitle.textContent = "Import thêm folder nếu cần tạo data mới.";
}

function renderGenerateState(title, subtitle) {
  els.generateButton.disabled = true;
  els.newDataButton.disabled = true;
  els.generateTitle.textContent = title;
  els.generateSubtitle.textContent = subtitle;
  setHealth("warn", "Đang xử lý");
}

async function imageToWebp(file, quality) {
  const canvas = await imageFileToCanvas(file);
  return canvasToBlob(canvas, "image/webp", quality);
}

async function imageToPng(file) {
  const canvas = await imageFileToCanvas(file);
  return canvasToBlob(canvas, "image/png", 1);
}

async function imageFileToCanvas(file) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return canvas;
    } catch {
      // Fallback below.
    }
  }
  const img = await loadImageFromFile(file);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(img.src);
  return canvas;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Không đọc được ảnh ${file.name}.`));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Không convert được ${type}.`));
      },
      type,
      quality
    );
  });
}

function captureVideoFrameToWebp(file, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;

    const clean = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };

    const fail = () => {
      if (done) return;
      done = true;
      clean();
      reject(new Error(`Không capture được thumbnail từ video ${file.name}. Hãy thêm ảnh thumb cùng basename.`));
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = Math.min(0.2, Math.max(0, duration / 8));
    };
    video.onseeked = async () => {
      if (done) return;
      done = true;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 720;
        canvas.height = video.videoHeight || 1280;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas, "image/webp", quality);
        clean();
        resolve(blob);
      } catch (error) {
        clean();
        reject(error);
      }
    };
    video.onerror = fail;
    window.setTimeout(fail, 15000);
    video.src = url;
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

class ZipWriter {
  constructor() {
    this.entries = [];
  }

  async addText(path, text) {
    this.entries.push({
      path: normalizeSlashes(path),
      bytes: textEncoder.encode(text),
      date: new Date(),
    });
  }

  async addBlob(path, blob) {
    const buffer = await blob.arrayBuffer();
    this.entries.push({
      path: normalizeSlashes(path),
      bytes: new Uint8Array(buffer),
      date: new Date(),
    });
  }

  finish() {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of this.entries) {
      const nameBytes = textEncoder.encode(entry.path);
      const crc = crc32(entry.bytes);
      const dos = toDosDateTime(entry.date);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, dos.time, true);
      localView.setUint16(12, dos.date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, entry.bytes.length, true);
      localView.setUint32(22, entry.bytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localHeader.set(nameBytes, 30);
      localParts.push(localHeader, entry.bytes);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, dos.time, true);
      centralView.setUint16(14, dos.date, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, entry.bytes.length, true);
      centralView.setUint32(24, entry.bytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint32(42, offset, true);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);

      offset += localHeader.length + entry.bytes.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const centralOffset = offset;
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, this.entries.length, true);
    endView.setUint16(10, this.entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralOffset, true);

    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

els.jsonInput.addEventListener("change", (event) => {
  handleJsonImport(event.target.files?.[0]);
});

els.folderButton.addEventListener("click", () => {
  els.folderInput.click();
});

els.folderInput.addEventListener("change", (event) => {
  handleFolderImport(event.target.files);
});

for (const input of [
  els.packageRootInput,
  els.dataRootInput,
  els.typeInput,
  els.categoryTargetInput,
  els.iconRootInput,
  els.versionInput,
]) {
  input.addEventListener("input", render);
  input.addEventListener("change", render);
}

els.itemSearchInput.addEventListener("input", renderItems);
els.newDataButton.addEventListener("click", handleGenerateNewData);
els.generateButton.addEventListener("click", handleGenerate);

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((entry) => entry.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((entry) => entry.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(`${button.dataset.tab}Panel`).classList.add("active");
  });
});

render();
