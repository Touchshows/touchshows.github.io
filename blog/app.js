const state = {
  key: null,
  manifest: null,
  selectedCategory: "全部",
  query: "",
  urls: new Map(),
};

const CONTENT_VERSION = "20260530-1";
const $ = (selector) => document.querySelector(selector);
const lockScreen = $("#lock-screen");
const app = $("#app");
const form = $("#unlock-form");
const passwordInput = $("#password");
const message = $("#unlock-message");
const gallery = $("#gallery");
const filters = $("#filters");
const overview = $("#overview");
const stats = $("#stats");
const search = $("#search");
const template = $("#item-template");
const viewer = $("#viewer");
const viewerTitle = $("#viewer-title");
const viewerCategory = $("#viewer-category");
const viewerContent = $("#viewer-content");

const decoder = new TextDecoder();
const encoder = new TextEncoder();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = passwordInput.value.normalize("NFKC").trim();
  if (!password) return;
  await unlock(password);
});

search.addEventListener("input", () => {
  state.query = search.value.trim().toLowerCase();
  renderGallery();
});

$("#viewer-close").addEventListener("click", () => viewer.close());

viewer.addEventListener("close", () => {
  viewerContent.replaceChildren();
});

async function unlock(password) {
  setMessage("正在解锁资料...");
  form.querySelector("button").disabled = true;

  try {
    const config = await fetchJson(withVersion("./content/index.json"));
    const key = await deriveKey(password, config.salt, config.iterations);
    const manifestBuffer = await fetchBuffer(withVersion("./content/manifest.enc"));
    const manifestText = decoder.decode(await decryptBuffer(key, manifestBuffer));

    state.key = key;
    state.manifest = JSON.parse(manifestText);
    setMessage("");
    lockScreen.hidden = true;
    app.hidden = false;
    document.title = state.manifest.site.title;
    renderApp();
  } catch (error) {
    console.error(error);
    setMessage("密码不正确，或浏览器缓存了旧资料。请刷新页面后再试。");
  } finally {
    form.querySelector("button").disabled = false;
  }
}

function renderApp() {
  renderStats();
  renderFilters();
  renderOverview();
  renderGallery();
}

function renderStats() {
  const { totals } = state.manifest;
  stats.replaceChildren(
    stat("材料", totals.items),
    stat("图片", totals.images),
    stat("PDF", totals.pdfs),
  );
}

function stat(label, value) {
  const element = document.createElement("div");
  element.className = "stat";
  element.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
  return element;
}

function renderFilters() {
  const categories = ["全部", ...state.manifest.categories.map((category) => category.name)];
  filters.replaceChildren(
    ...categories.map((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `filter-button${category === state.selectedCategory ? " active" : ""}`;
      button.textContent = category;
      button.addEventListener("click", () => {
        state.selectedCategory = category;
        renderFilters();
        renderGallery();
      });
      return button;
    }),
  );
}

function renderOverview() {
  overview.replaceChildren(
    ...state.manifest.categories.map((category) => {
      const card = document.createElement("article");
      card.className = "category-card";
      card.innerHTML = `<strong>${escapeHtml(category.name)}</strong><span>${category.count} 份材料</span>`;
      return card;
    }),
  );
}

function renderGallery() {
  const items = filteredItems();
  gallery.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "没有找到匹配的材料。";
    gallery.append(empty);
    return;
  }

  for (const item of items) {
    gallery.append(renderItem(item));
  }
}

function filteredItems() {
  return state.manifest.items.filter((item) => {
    const matchesCategory = state.selectedCategory === "全部" || item.category === state.selectedCategory;
    const haystack = `${item.title} ${item.category} ${item.subcategory ?? ""}`.toLowerCase();
    return matchesCategory && (!state.query || haystack.includes(state.query));
  });
}

function renderItem(item) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".item-card");
  const preview = fragment.querySelector(".preview-button");
  const meta = fragment.querySelector(".item-meta");
  const title = fragment.querySelector("h2");
  const open = fragment.querySelector(".open-button");

  meta.textContent = [item.category, item.subcategory].filter(Boolean).join(" / ");
  title.textContent = item.title;
  preview.ariaLabel = `查看 ${item.title}`;
  open.addEventListener("click", () => openViewer(item));
  preview.addEventListener("click", () => openViewer(item));

  if (item.kind === "image") {
    hydrateImage(preview, item);
  } else {
    const tile = document.createElement("div");
    tile.className = "pdf-tile";
    tile.textContent = "PDF";
    preview.append(tile);
  }

  return card;
}

async function hydrateImage(container, item) {
  try {
    const url = await getObjectUrl(item);
    const image = document.createElement("img");
    image.src = url;
    image.alt = item.title;
    image.loading = "lazy";
    container.append(image);
  } catch (error) {
    console.error(error);
    container.textContent = "预览失败";
  }
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
  if (state.urls.has(item.id)) {
    return state.urls.get(item.id);
  }

  const encrypted = await fetchBuffer(withVersion(`./content/files/${item.id}.enc`));
  const plain = await decryptBuffer(state.key, encrypted);
  const blob = new Blob([plain], { type: item.mime });
  const url = URL.createObjectURL(blob);
  state.urls.set(item.id, url);
  return url;
}

async function deriveKey(password, saltBase64, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBuffer(saltBase64),
      iterations,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

async function decryptBuffer(key, encrypted) {
  const iv = encrypted.slice(0, 12);
  const data = encrypted.slice(12);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
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
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${CONTENT_VERSION}`;
}

function setMessage(text) {
  message.textContent = text;
}

function base64ToBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char];
  });
}
