const CONTENT_VERSION = "20260530-5";
const PUBLIC_PASSWORD = "touchshows";
const state = { key: null, manifest: null, category: "全部", query: "", urls: new Map() };
const $ = (selector) => document.querySelector(selector);
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const lockScreen = $("#lock-screen");
const app = $("#app");
const form = $("#unlock-form");
const passwordInput = $("#password");
const message = $("#unlock-message");
const stats = $("#stats");
const filters = $("#filters");
const overview = $("#overview");
const gallery = $("#gallery");
const search = $("#search");
const template = $("#item-template");
const viewer = $("#viewer");
const viewerTitle = $("#viewer-title");
const viewerCategory = $("#viewer-category");
const viewerContent = $("#viewer-content");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = passwordInput.value.normalize("NFKC").trim();
  if (password) await unlock(password);
});
window.addEventListener("DOMContentLoaded", () => unlock(PUBLIC_PASSWORD));
search.addEventListener("input", () => {
  state.query = search.value.trim().toLowerCase();
  renderGallery();
});
$("#viewer-close").addEventListener("click", () => viewer.close());
viewer.addEventListener("close", () => viewerContent.replaceChildren());

async function unlock(password) {
  const started = Date.now();
  setMessage("正在打开资料...");
  const button = form?.querySelector("button");
  if (button) button.disabled = true;
  try {
    const config = await fetchJson(withVersion("./content/index.json"));
    state.key = await deriveKey(password, config.salt, config.iterations);
    const encryptedManifest = await fetchBuffer(withVersion("./content/manifest.enc"));
    state.manifest = normalizeManifest(JSON.parse(decoder.decode(await decryptBuffer(state.key, encryptedManifest))));
    setMessage("");
    lockScreen.hidden = true;
    app.hidden = false;
    document.title = state.manifest.site.title;
    renderApp();
    document.documentElement.dataset.unlockMs = String(Date.now() - started);
  } catch (error) {
    console.error(error);
    setMessage("资料加载失败，请刷新页面后再试。");
  } finally {
    if (button) button.disabled = false;
  }
}

function renderApp() {
  renderStats();
  renderFilters();
  renderResume();
  renderOverview();
  renderGallery();
}
function renderStats() {
  const totals = state.manifest.totals;
  stats.replaceChildren(stat("材料", totals.items), stat("获奖", totals.awards), stat("项目支撑", totals.support));
}
function stat(label, value) {
  const el = document.createElement("div");
  el.className = "stat";
  el.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
  return el;
}
function renderFilters() {
  const names = ["全部", ...state.manifest.categories.map((category) => category.name)];
  filters.replaceChildren(...names.map((name) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-button${name === state.category ? " active" : ""}`;
    button.textContent = name;
    button.addEventListener("click", () => {
      state.category = name;
      renderFilters();
      renderGallery();
    });
    return button;
  }));
}
function renderResume() {
  document.querySelector(".resume-summary")?.remove();
  const section = document.createElement("section");
  section.className = "resume-summary";
  section.style.cssText = "display:grid;grid-template-columns:minmax(180px,260px) 1fr;gap:18px;align-items:center;border:1px solid var(--line);border-radius:8px;background:rgba(255,253,248,.82);padding:18px;margin-bottom:18px";
  section.innerHTML = `<div><p class="eyebrow">Resume summary</p><h2 style="margin:0;font-size:24px">简历获奖统计</h2></div><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">${state.manifest.resume.highlights.map((item) => `<div style="border-left:3px solid var(--accent-2);padding-left:12px"><strong style="display:block;font-size:24px">${item.value}</strong><span style="color:var(--muted);font-size:13px">${escapeHtml(item.label)}</span></div>`).join("")}</div>`;
  document.querySelector(".topbar").after(section);
}
function renderOverview() {
  overview.replaceChildren(resumeCard("奖项等级", state.manifest.resume.awardLevels), resumeCard("竞赛层级", state.manifest.resume.scopes), ...state.manifest.categories.map((category) => {
    const card = document.createElement("article");
    card.className = "category-card";
    card.innerHTML = `<strong>${escapeHtml(category.name)}</strong><span>${category.count} 份材料</span>`;
    return card;
  }));
}
function resumeCard(title, rows) {
  const card = document.createElement("article");
  card.className = "category-card";
  const details = rows.length ? rows.map((row) => `${escapeHtml(row.label)} ${row.count}`).join(" / ") : "暂无统计";
  card.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${details}</span>`;
  return card;
}
function renderGallery() {
  const items = state.manifest.items.filter((item) => {
    const matchesCategory = state.category === "全部" || item.category === state.category;
    const text = `${item.title} ${item.category} ${item.subcategory || ""}`.toLowerCase();
    return matchesCategory && (!state.query || text.includes(state.query));
  });
  gallery.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "没有找到匹配的材料。";
    gallery.append(empty);
    return;
  }
  gallery.append(...items.map(renderItem));
}
function renderItem(item) {
  const fragment = template.content.cloneNode(true);
  const preview = fragment.querySelector(".preview-button");
  fragment.querySelector(".item-meta").textContent = [item.category, item.subcategory].filter(Boolean).join(" / ");
  fragment.querySelector("h2").textContent = item.title;
  preview.ariaLabel = `查看 ${item.title}`;
  const tile = document.createElement("div");
  tile.className = "pdf-tile";
  tile.textContent = item.kind === "image" ? "IMG" : "PDF";
  preview.append(tile);
  preview.addEventListener("click", () => openViewer(item));
  fragment.querySelector(".open-button").addEventListener("click", () => openViewer(item));
  return fragment;
}
async function openViewer(item) {
  viewerTitle.textContent = item.title;
  viewerCategory.textContent = [item.category, item.subcategory].filter(Boolean).join(" / ");
  viewerContent.replaceChildren();
  const url = await getObjectUrl(item);
  if (item.kind === "image") {
    const image = document.createElement("img");
    image.src = url;
    image.alt = item.title;
    viewerContent.append(image);
  } else {
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.title = item.title;
    viewerContent.append(frame);
  }
  viewer.showModal();
}
async function getObjectUrl(item) {
  if (state.urls.has(item.id)) return state.urls.get(item.id);
  const encrypted = await fetchBuffer(withVersion(`./content/files/${item.id}.enc`));
  const plain = await decryptBuffer(state.key, encrypted);
  const url = URL.createObjectURL(new Blob([plain], { type: item.mime }));
  state.urls.set(item.id, url);
  return url;
}
async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: base64ToBuffer(salt), iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}
async function decryptBuffer(key, encrypted) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: encrypted.slice(0, 12) }, key, encrypted.slice(12));
}
async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot load ${url}`);
  return response.json();
}
async function fetchBuffer(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot load ${url}`);
  return response.arrayBuffer();
}
function withVersion(url) {
  return `${url}${url.includes("?") ? "&" : "?"}v=${CONTENT_VERSION}`;
}
function setMessage(text) {
  message.textContent = text;
}
function base64ToBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}
function normalizeManifest(manifest) {
  if (manifest.resume && typeof manifest.totals.awards === "number") return manifest;
  const resume = buildResume(manifest.items);
  return { ...manifest, totals: { ...manifest.totals, awards: resume.awards, support: resume.support }, resume };
}
function buildResume(items) {
  const awards = items.filter((item) => item.category !== "项目支撑材料类");
  const support = items.length - awards.length;
  const awardLevels = countByRules(awards, [["特等奖", /特等奖/], ["一等奖", /一等奖/], ["二等奖", /二等奖/], ["三等奖", /三等奖/], ["银奖", /银奖/], ["优秀奖", /优秀奖/], ["名次奖", /第[一二三四五六七八九十]+名/]]);
  const scopes = countByRules(awards, [["国家级", /全国|中国国际|中国大学生|国家级/], ["市级", /重庆市|市级/], ["校级", /重庆工商大学|重庆师范大学|校级/], ["院级", /人工智能学院|金融学院|院级/]]);
  const competitionAwards = awards.filter((item) => item.category.includes("竞赛")).length;
  const topAwards = awards.filter((item) => /特等奖|一等奖|二等奖|银奖/.test(item.title)).length;
  return { awards: awards.length, support, awardLevels, scopes, highlights: [{ label: "可写入简历的获奖材料", value: awards.length }, { label: "竞赛/项目类成果", value: competitionAwards }, { label: "二等奖及以上/银奖以上", value: topAwards }, { label: "项目与知识产权支撑", value: support }] };
}
function countByRules(items, rules) {
  return rules.map(([label, pattern]) => ({ label, count: items.filter((item) => pattern.test(item.title)).length })).filter((row) => row.count > 0);
}
