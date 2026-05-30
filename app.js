"use strict";

const LEGACY_STORAGE_KEYS = ["clientvault.crm.encrypted.v1"];
const STORAGE_KEY = "clientvault.crm.encrypted.v2";
const LEGACY_PORTAL_ADMIN_SECRET_KEYS = ["clientvault.portal.adminSecret"];
const PORTAL_ADMIN_SECRET_KEY = "clientvault.portal.adminSecret.v2";
const AUTO_LOCK_MS = 15 * 60 * 1000;
const STAGES = ["Lead", "Qualified", "Proposal", "Won"];
const PRIORITIES = ["Low", "Normal", "High"];
const PROJECT_STATUSES = ["Not Started", "In Progress", "Review", "Approved", "Delivered"];
const MEETING_TYPES = ["Welcome Call", "Strategy Meeting", "Check-in", "Review"];
const ONBOARDING_STAGES = [
  {
    id: "welcome",
    title: "Welcome",
    description: "Give the client access and align on kickoff.",
    steps: [
      ["welcomeEmailSent", "Welcome email sent"],
      ["portalAccessGranted", "Portal access granted"],
      ["welcomeCallScheduled", "Welcome/kickoff call scheduled"],
    ],
  },
  {
    id: "discovery",
    title: "Discovery",
    description: "Collect context before planning the work.",
    steps: [
      ["brandAssetsCollected", "Brand assets collected"],
      ["businessGoalsDocumented", "Business goals documented"],
      ["questionnaireCompleted", "Questionnaire completed"],
    ],
  },
  {
    id: "strategy",
    title: "Strategy",
    description: "Confirm the plan, scope, and communication path.",
    steps: [
      ["strategyMeetingHeld", "Strategy planning meeting held"],
      ["projectPlanCreated", "Project plan and scope created"],
      ["communicationChannelsSet", "Communication channels set"],
    ],
  },
  {
    id: "launch",
    title: "Launch",
    description: "Move from onboarding into active delivery.",
    steps: [
      ["firstProjectCreated", "First project created"],
      ["initialInvoiceSent", "Initial setup invoice sent"],
      ["retainerAgreementSigned", "Retainer agreement signed"],
    ],
  },
];
const ONBOARDING_STEPS = ONBOARDING_STAGES.flatMap((stage) => stage.steps);

const state = {
  entry: "",
  unlocked: false,
  loading: true,
  sessionEmail: "",
  key: null,
  salt: null,
  data: null,
  view: "dashboard",
  portalClientId: "",
  portalTab: "home",
  query: "",
  drawer: null,
  toast: "",
  timer: null,
  syncing: false,
};

const blankData = () => ({
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  clients: [],
  contacts: [],
  deals: [],
  projects: [],
  tasks: [],
  onboarding: [],
  questionnaires: [],
  meetings: [],
  notes: [],
  clientAssets: [],
  portalUpdateIds: [],
  audit: [],
});

const app = document.querySelector("#app");

LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
LEGACY_PORTAL_ADMIN_SECRET_KEYS.forEach((key) => localStorage.removeItem(key));

window.addEventListener("load", initialize);
window.addEventListener("mousemove", scheduleAutoLock);
window.addEventListener("keydown", scheduleAutoLock);
window.addEventListener("click", scheduleAutoLock);

function id() {
  return crypto.randomUUID();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function colorValue(value, fallback = "") {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function brandMark() {
  return `
    <div class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" role="img">
        <rect x="9" y="17" width="30" height="23" rx="4"></rect>
        <path d="M16 17v-4a8 8 0 0 1 16 0v4"></path>
        <circle cx="24" cy="28" r="4"></circle>
        <path d="M24 32v4"></path>
      </svg>
    </div>
  `;
}

function getClient(clientId) {
  return state.data.clients.find((client) => client.id === clientId);
}

function hydrateData(data) {
  const next = { ...blankData(), ...data };
  next.clients ||= [];
  next.contacts ||= [];
  next.deals ||= [];
  next.projects ||= [];
  next.tasks ||= [];
  next.onboarding ||= [];
  next.questionnaires ||= [];
  next.meetings ||= [];
  next.notes ||= [];
  next.clientAssets ||= [];
  next.portalUpdateIds ||= [];
  next.audit ||= [];
  return next;
}

function visibleClients() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.data.clients;
  return state.data.clients.filter((client) => {
    const contacts = state.data.contacts
      .filter((contact) => contact.clientId === client.id)
      .map((contact) => `${contact.name} ${contact.email}`)
      .join(" ");
    const projects = state.data.projects
      .filter((project) => project.clientId === client.id)
      .map((project) => `${project.name} ${project.status}`)
      .join(" ");
    const assets = state.data.clientAssets
      .filter((asset) => asset.clientId === client.id)
      .map((asset) => `${assetTitle(asset)} ${assetLabel(asset)} ${asset.notes}`)
      .join(" ");
    const brandLabels = brandColorEntries(client).map((entry) => `${entry.label} ${entry.color}`).join(" ");
    return `${client.name} ${client.company} ${client.email} ${client.phone} ${client.segment} ${client.tags} ${contacts} ${projects} ${assets} ${brandLabels}`
      .toLowerCase()
      .includes(query);
  });
}

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 310000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function bytesToBase64(bytes) {
  const array = new Uint8Array(bytes);
  let binary = "";
  for (let index = 0; index < array.length; index += 0x8000) {
    binary += String.fromCharCode(...array.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function encryptData(data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, state.key, encoded);
  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: 310000,
    salt: bytesToBase64(state.salt),
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(cipher),
    savedAt: new Date().toISOString(),
  };
}

async function decryptData(key, payload) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.cipher),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

async function initialize() {
  LEGACY_STORAGE_KEYS.concat(STORAGE_KEY).forEach((key) => localStorage.removeItem(key));
  try {
    const response = await fetch("/api/admin-session", { credentials: "same-origin" });
    if (response.ok) {
      const payload = await response.json();
      state.data = hydrateData(payload.data);
      state.sessionEmail = payload.email || "";
      state.unlocked = true;
      state.entry = "admin";
      scheduleAutoLock();
      await autoSyncPortalUpdates();
    }
  } catch {
    state.unlocked = false;
  } finally {
    state.loading = false;
    render();
  }
}

async function saveData(action = "Saved") {
  if (!state.unlocked) return;
  state.data.updatedAt = new Date().toISOString();
  state.data.audit.unshift({
    id: id(),
    action,
    at: new Date().toISOString(),
  });
  state.data.audit = state.data.audit.slice(0, 100);
  const response = await fetch("/api/crm-data", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action, data: state.data }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Could not save CRM data");
  state.data = hydrateData(payload.data);
}

async function unlock(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const email = String(form.get("email") || "");
  const password = String(form.get("password") || "");
  try {
    const response = await fetch("/api/admin-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not sign in");
    state.data = hydrateData(payload.data);
    state.sessionEmail = email.trim().toLowerCase();
    state.unlocked = true;
    state.entry = "admin";
    showToast("Signed in.");
    scheduleAutoLock();
    render();
    await autoSyncPortalUpdates();
  } catch (error) {
    showToast(error.message || "Could not sign in.");
  }
}

async function lock() {
  try {
    await fetch("/api/admin-logout", { method: "POST", credentials: "same-origin" });
  } catch {}
  state.unlocked = false;
  state.key = null;
  state.data = null;
  state.drawer = null;
  state.sessionEmail = "";
  clearTimeout(state.timer);
  render();
}

function scheduleAutoLock() {
  if (!state.unlocked) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    showToast("Vault locked after inactivity.");
    lock();
  }, AUTO_LOCK_MS);
}

function showToast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    if (state.toast === message) {
      state.toast = "";
      render();
    }
  }, 3200);
}

function render() {
  if (state.loading) {
    app.innerHTML = `
      <section class="lock-screen">
        <div class="lock-card">
          <div class="brand-row">${brandMark()}<div><div class="eyebrow">ClientVault</div><h1>Loading CRM</h1></div></div>
          <p class="muted">Checking your secure admin session.</p>
        </div>
      </section>
    `;
    return;
  }
  if (!state.unlocked && state.entry !== "admin") {
    app.innerHTML = landingScreen();
    app.querySelector("[data-entry='admin']").addEventListener("click", () => {
      state.entry = "admin";
      render();
    });
    return;
  }
  if (!state.unlocked) {
    app.innerHTML = lockScreen();
    app.querySelector("form").addEventListener("submit", unlock);
    return;
  }
  app.innerHTML = shell();
  bindShell();
}

function landingScreen() {
  return `
    <section class="landing-screen">
      <div class="landing-panel">
        <div class="brand-row">
          ${brandMark()}
          <div>
            <div class="eyebrow">Private client operating system</div>
            <h1>ClientVault</h1>
          </div>
        </div>
        <p class="landing-copy">Secure CRM, project delivery, onboarding, scheduling, and client portal access in one workspace.</p>
        <div class="login-choice-grid">
          <button class="login-choice" data-entry="admin">
            <span>Admin Login</span>
            <strong>Manage clients, deals, projects, onboarding, and portal publishing.</strong>
          </button>
          <a class="login-choice" href="./portal.html">
            <span>Client Login</span>
            <strong>Access your shared projects, meetings, onboarding, and files.</strong>
          </a>
        </div>
      </div>
    </section>
  `;
}

function lockScreen() {
  return `
    <section class="lock-screen">
      <form class="lock-card">
        <div class="brand-row">
          ${brandMark()}
          <div>
            <div class="eyebrow">Secure admin CRM</div>
            <h1>ClientVault CRM</h1>
          </div>
        </div>
        <p class="muted">Sign in to your database-backed CRM workspace.</p>
        <div class="field">
          <label for="email">Admin email</label>
          <input id="email" name="email" type="email" autocomplete="username" required autofocus />
        </div>
        <div class="field">
          <label for="password">Admin password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button class="btn" type="submit">Sign In</button>
        <p class="secure-note space-top">Client records are stored server-side. Production admin login and secure storage are configured in Vercel.</p>
      </form>
      ${toast()}
    </section>
  `;
}

function shell() {
  return `
    <section class="app-grid">
      <aside class="sidebar">
        <div class="brand-row">
          ${brandMark()}
          <div>
            <strong>ClientVault</strong>
            <div class="muted">Private CRM</div>
          </div>
        </div>
        <nav class="nav">
          ${navButton("dashboard", "Dashboard")}
          ${navButton("clients", "Clients")}
          ${navButton("contacts", "Contacts")}
          ${navButton("onboarding", "Onboarding")}
          ${navButton("projects", "Projects")}
          ${navButton("assets", "Assets")}
          ${navButton("schedule", "Schedule")}
          ${navButton("pipeline", "Pipeline")}
          ${navButton("tasks", "Tasks")}
          ${navButton("insights", "Insights")}
          ${navButton("portal", "Client Portal")}
          ${navButton("notes", "Notes")}
          ${navButton("settings", "Settings")}
        </nav>
        <div class="sidebar-footer">
          <button class="btn secondary" data-action="export">Export Backup</button>
          <button class="btn secondary" data-action="lock">Lock</button>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <input class="search" data-action="search" placeholder="Search clients, contacts, tags, email, phone..." value="${escapeHtml(state.query)}" />
          <div class="top-actions">
          <button class="btn" data-open="client">New Client</button>
          <button class="btn secondary" data-open="project">New Project</button>
          <button class="btn secondary" data-open="task">New Task</button>
        </div>
        </div>
        ${view()}
      </main>
      ${state.drawer ? drawer() : ""}
      ${toast()}
    </section>
  `;
}

function navButton(view, label) {
  return `<button class="${state.view === view ? "active" : ""}" data-view="${view}">${label}</button>`;
}

function bindShell() {
  app.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      render();
    });
  });
  app.querySelectorAll("[data-portal-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.portalTab = button.dataset.portalTab;
      render();
    });
  });
  app.querySelectorAll("[data-portal-client]").forEach((button) => {
    button.addEventListener("click", () => {
      state.portalClientId = button.dataset.portalClient;
      state.view = "portal";
      state.portalTab = "home";
      render();
    });
  });
  app.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      state.drawer = {
        type: button.dataset.open,
        clientId: button.dataset.client || "",
        meetingType: button.dataset.meetingType || "",
      };
      render();
    });
  });
  app.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      state.drawer = { type: button.dataset.edit, id: button.dataset.id, clientId: button.dataset.client || "" };
      render();
    });
  });
  app.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteRecord(button.dataset.delete, button.dataset.id));
  });
  app.querySelectorAll("[data-stage]").forEach((button) => {
    button.addEventListener("click", () => moveDeal(button.dataset.id, button.dataset.stage));
  });
  app.querySelectorAll("[data-done]").forEach((button) => {
    button.addEventListener("click", () => toggleTask(button.dataset.id));
  });
  app.querySelectorAll("[data-onboarding]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => toggleOnboardingStep(checkbox.dataset.onboarding, checkbox.dataset.step, checkbox.checked));
  });
  app.querySelectorAll("[data-confirm-meeting]").forEach((button) => {
    button.addEventListener("click", () => confirmMeeting(button.dataset.confirmMeeting));
  });
  app.querySelectorAll("[data-open-asset]").forEach((button) => {
    button.addEventListener("click", () => openAssetFile(button.dataset.openAsset));
  });
  app.querySelectorAll("[data-add-brand-color]").forEach((button) => {
    button.addEventListener("click", () => addBrandColorField(button));
  });
  app.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      state.drawer = null;
      render();
    });
  });
  app.querySelectorAll("form[data-form]").forEach((form) => {
    form.addEventListener("submit", submitForm);
  });
  const search = app.querySelector("[data-action='search']");
  if (search) {
    search.addEventListener("input", (event) => {
      const cursor = event.target.selectionStart;
      state.query = event.target.value;
      render();
      const nextSearch = app.querySelector("[data-action='search']");
      nextSearch.focus();
      nextSearch.setSelectionRange(cursor, cursor);
    });
  }
  const lockButton = app.querySelector("[data-action='lock']");
  if (lockButton) lockButton.addEventListener("click", lock);
  const exportButton = app.querySelector("[data-action='export']");
  if (exportButton) exportButton.addEventListener("click", exportBackup);
  const importInput = app.querySelector("[data-action='import']");
  if (importInput) importInput.addEventListener("change", importBackup);
  const syncButton = app.querySelector("[data-action='sync-portal']");
  if (syncButton) syncButton.addEventListener("click", () => syncPortalUpdates());
  const portalClient = app.querySelector("[data-action='portal-client']");
  if (portalClient) {
    portalClient.addEventListener("change", (event) => {
      state.portalClientId = event.target.value;
      render();
    });
  }
}

function view() {
  if (state.view === "clients") return clientsView();
  if (state.view === "contacts") return contactsView();
  if (state.view === "onboarding") return onboardingView();
  if (state.view === "projects") return projectsView();
  if (state.view === "assets") return assetsView();
  if (state.view === "schedule") return scheduleView();
  if (state.view === "pipeline") return pipelineView();
  if (state.view === "tasks") return tasksView();
  if (state.view === "insights") return insightsView();
  if (state.view === "portal") return portalView();
  if (state.view === "notes") return notesView();
  if (state.view === "settings") return settingsView();
  return dashboardView();
}

function dashboardView() {
  const clients = state.data.clients;
  const openDeals = state.data.deals.filter((deal) => deal.stage !== "Won");
  const totalPipeline = openDeals.reduce((sum, deal) => sum + Number(deal.value || 0), 0);
  const overdue = state.data.tasks.filter((task) => !task.done && task.dueDate < today()).length;
  const activeProjects = state.data.projects.filter((project) => !["Delivered", "Approved"].includes(project.status)).length;
  return `
    <div class="section-head">
      <div>
        <h1>Dashboard</h1>
        <p class="muted">Today’s client work, project delivery, pipeline value, and relationship health.</p>
      </div>
      <div class="section-actions">
        <button class="btn secondary" data-open="meeting">Schedule Meeting</button>
        <button class="btn secondary" data-open="project">New Project</button>
        <button class="btn secondary" data-open="deal">New Deal</button>
        <button class="btn secondary" data-open="note">New Note</button>
      </div>
    </div>
    <div class="stats-grid">
      ${stat("Clients", clients.length)}
      ${stat("Open pipeline", money(totalPipeline))}
      ${stat("Active projects", activeProjects)}
      ${stat("Open tasks", state.data.tasks.filter((task) => !task.done).length)}
      ${stat("Overdue", overdue)}
    </div>
    <div class="layout-two">
      <section class="panel">
        <div class="panel-head"><h2>Priority Clients</h2><button class="btn secondary" data-open="client">Add</button></div>
        <div class="list">${clientRows(clients.slice(0, 8))}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Due Next</h2><button class="btn secondary" data-open="task">Add</button></div>
        <div class="panel-body">${taskCards(dueTasks().slice(0, 6))}</div>
      </section>
      <section class="panel span-2">
        <div class="panel-head"><h2>Upcoming Events</h2><button class="btn secondary" data-open="meeting">Schedule</button></div>
        <div class="panel-body">${eventCards(upcomingEvents().slice(0, 8))}</div>
      </section>
    </div>
  `;
}

function stat(label, value) {
  return `<div class="stat"><span class="muted">${label}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function clientsView() {
  const clients = visibleClients();
  return `
    <div class="section-head">
      <div>
        <h1>Clients</h1>
        <p class="muted">${clients.length} matching client${clients.length === 1 ? "" : "s"}.</p>
      </div>
      <div class="section-actions">
        <button class="btn" data-open="client">New Client</button>
        <button class="btn secondary" data-open="contact">New Contact</button>
      </div>
    </div>
    <section class="panel"><div class="list">${clientRows(clients)}</div></section>
  `;
}

function clientRows(clients) {
  if (!clients.length) return `<div class="empty">No clients yet.</div>`;
  return clients
    .map((client) => {
      const contacts = state.data.contacts.filter((contact) => contact.clientId === client.id);
      const assets = clientAssets(client.id);
      return `
        <article class="row">
          <div>
            <div class="row-title">${escapeHtml(client.name)}</div>
            <div class="row-sub">${escapeHtml(client.company || client.email || "No company")}</div>
          </div>
          <div><span class="pill ${client.status === "Active" ? "active" : ""}">${escapeHtml(client.status)}</span></div>
          <div>
            <div class="row-sub">Health · Value</div>
            <strong>${clientHealthScore(client)} · ${money(client.value)}</strong>
          </div>
          <div>
            <div class="row-sub">Last touch</div>
            <strong>${escapeHtml(client.lastTouch || "none")}</strong>
          </div>
          <div class="inline-actions">
            <button class="btn secondary" data-edit="client" data-id="${client.id}">Edit</button>
            <button class="btn secondary" data-open="contact" data-client="${client.id}">Contact</button>
          <button class="btn secondary" data-open="deal" data-client="${client.id}">Deal</button>
          <button class="btn secondary" data-open="project" data-client="${client.id}">Project</button>
          <button class="btn secondary" data-open="clientAsset" data-client="${client.id}">Asset</button>
          <button class="btn secondary" data-portal-client="${client.id}">Portal</button>
          <button class="btn secondary" data-open="portalAccess" data-client="${client.id}">Publish</button>
        </div>
          <div class="client-profile-summary">
            ${clientProfileBrandBlock(client)}
            ${contacts.length ? `<div class="row-sub">${contacts.map((contact) => escapeHtml(`${contact.name} <${contact.email}>`)).join(" · ")}</div>` : ""}
            ${clientProfileAssetsBlock(client, assets)}
          </div>
        </article>
      `;
    })
    .join("");
}

function clientBrandSwatches(client) {
  const colors = brandColorEntries(client).map((entry) => entry.color);
  if (!colors.length) return "";
  return `<span class="swatch-strip">${colors.map((color) => `<span class="color-swatch" style="background:${colorValue(color, "#ffffff")}"></span>`).join("")}</span>`;
}

function clientProfileBrandBlock(client) {
  const colors = brandColorEntries(client);
  if (!colors.length) return "";
  return `
    <div class="profile-block">
      <div class="row-sub">Brand colors</div>
      <div class="profile-color-list">
        ${colors.map((entry) => `
          <span class="profile-color">
            <span class="color-swatch" style="background:${colorValue(entry.color, "#ffffff")}"></span>
            ${escapeHtml(entry.label)}
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function clientProfileAssetsBlock(client, assets = clientAssets(client.id)) {
  if (!assets.length) return "";
  return `
    <div class="profile-block">
      <div class="profile-block-head">
        <div class="row-sub">Assets</div>
        <button class="btn secondary mini-btn" data-open="clientAsset" data-client="${client.id}">Add Asset</button>
      </div>
      <div class="profile-asset-list">
        ${assets.map((asset) => `
          <article class="profile-asset">
            ${assetPreview(asset)}
            <div>
              <strong>${escapeHtml(assetTitle(asset))}</strong>
              <div class="row-sub">${escapeHtml(assetLabel(asset))} · ${formatBytes(asset.size)}</div>
            </div>
            ${assetOpenable(asset) ? `<button class="btn secondary mini-btn" data-open-asset="${asset.id}">Open</button>` : ""}
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function contactsView() {
  const clients = visibleClients();
  const clientIds = new Set(clients.map((client) => client.id));
  const contacts = state.data.contacts
    .filter((contact) => clientIds.has(contact.clientId))
    .sort((a, b) => a.name.localeCompare(b.name));
  return `
    <div class="section-head">
      <div>
        <h1>Contacts</h1>
        <p class="muted">${contacts.length} matching contact${contacts.length === 1 ? "" : "s"}.</p>
      </div>
      <button class="btn" data-open="contact">New Contact</button>
    </div>
    <section class="panel"><div class="list">${contactRows(contacts)}</div></section>
  `;
}

function contactRows(contacts) {
  if (!contacts.length) return `<div class="empty">No contacts yet.</div>`;
  return contacts
    .map((contact) => {
      const client = getClient(contact.clientId);
      return `
        <article class="row contact-row">
          <div>
            <div class="row-title">${escapeHtml(contact.name)}</div>
            <div class="row-sub">${escapeHtml(contact.role || "No role")}</div>
          </div>
          <div>
            <div class="row-sub">Client</div>
            <strong>${escapeHtml(client?.name || "Unassigned")}</strong>
          </div>
          <div>
            <div class="row-sub">${escapeHtml(contact.email || "No email")}</div>
            <div class="row-sub">${escapeHtml(contact.phone || "No phone")}</div>
          </div>
          <div class="inline-actions">
            <button class="btn secondary" data-edit="contact" data-id="${contact.id}">Edit</button>
            <button class="btn secondary" data-delete="contact" data-id="${contact.id}">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function insightsView() {
  const totalValue = state.data.clients.reduce((sum, client) => sum + Number(client.value || 0), 0);
  const weightedPipeline = state.data.deals
    .filter((deal) => deal.stage !== "Won")
    .reduce((sum, deal) => sum + Number(deal.value || 0) * (Number(deal.probability || 0) / 100), 0);
  const avgHealth = state.data.clients.length
    ? Math.round(state.data.clients.reduce((sum, client) => sum + clientHealthScore(client), 0) / state.data.clients.length)
    : 0;
  return `
    <div class="section-head">
      <div>
        <h1>Insights</h1>
        <p class="muted">Account health, forecast, delivery risk, and next-best actions.</p>
      </div>
    </div>
    <div class="stats-grid">
      ${stat("Client value", money(totalValue))}
      ${stat("Weighted forecast", money(weightedPipeline))}
      ${stat("Average health", `${avgHealth}/100`)}
      ${stat("Projects at risk", state.data.projects.filter((project) => project.dueDate && project.dueDate < today() && project.status !== "Delivered").length)}
      ${stat("Unconfirmed meetings", state.data.meetings.filter((meeting) => meeting.status === "Proposed").length)}
    </div>
    <div class="layout-two">
      <section class="panel">
        <div class="panel-head"><h2>Account Health</h2></div>
        <div class="panel-body">${healthRows()}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Automation Cues</h2></div>
        <div class="panel-body">${automationCards()}</div>
      </section>
    </div>
  `;
}

function healthRows() {
  if (!state.data.clients.length) return `<div class="empty">No clients yet.</div>`;
  return [...state.data.clients]
    .sort((a, b) => clientHealthScore(a) - clientHealthScore(b))
    .map((client) => {
      const score = clientHealthScore(client);
      return `
        <article class="event-row">
          <div>
            <strong>${escapeHtml(client.name)}</strong>
            <div class="row-sub">${escapeHtml(client.nextStep || "No next step")} · Last touch ${escapeHtml(client.lastTouch || "none")}</div>
          </div>
          <span class="pill ${score < 50 ? "risk" : score >= 80 ? "active" : ""}">${score}/100</span>
        </article>
      `;
    })
    .join("");
}

function automationCards() {
  const cues = [];
  state.data.clients.forEach((client) => {
    if (client.status === "Lead" && !state.data.deals.some((deal) => deal.clientId === client.id)) {
      cues.push({ title: "Create first opportunity", client, detail: "Lead has no pipeline deal." });
    }
    if (daysSince(client.lastTouch) > 14 && client.status !== "Former") {
      cues.push({ title: "Follow up", client, detail: `${daysSince(client.lastTouch)} days since last touch.` });
    }
    if (!getOnboarding(client.id) && client.status === "Active") {
      cues.push({ title: "Start onboarding", client, detail: "Active client has no onboarding checklist." });
    }
  });
  state.data.projects
    .filter((project) => project.dueDate && project.dueDate < today() && project.status !== "Delivered")
    .forEach((project) => cues.push({ title: "Project overdue", client: getClient(project.clientId), detail: project.name }));
  state.data.meetings
    .filter((meeting) => meeting.status === "Proposed")
    .forEach((meeting) => cues.push({ title: "Confirm meeting", client: getClient(meeting.clientId), detail: `${meeting.title || meeting.type} · ${formatDateTime(meeting.datetime)}` }));
  if (!cues.length) return `<div class="empty">No automation cues right now.</div>`;
  return cues.slice(0, 12).map((cue) => `
    <article class="task-card">
      <strong>${escapeHtml(cue.title)}</strong>
      <span class="row-sub">${escapeHtml(cue.client?.name || "No client")} · ${escapeHtml(cue.detail)}</span>
    </article>
  `).join("");
}

function clientHealthScore(client) {
  let score = 70;
  if (client.status === "Active") score += 10;
  if (client.status === "At Risk") score -= 25;
  if (client.status === "Former") score -= 40;
  const days = daysSince(client.lastTouch);
  if (days > 30) score -= 25;
  else if (days > 14) score -= 12;
  if (state.data.tasks.some((task) => task.clientId === client.id && !task.done && task.dueDate < today())) score -= 15;
  if (state.data.projects.some((project) => project.clientId === client.id && project.status === "In Progress")) score += 8;
  if (state.data.meetings.some((meeting) => meeting.clientId === client.id && meeting.status === "Confirmed")) score += 5;
  return Math.max(0, Math.min(100, score));
}

function daysSince(dateValue) {
  if (!dateValue) return 999;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 999;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.floor((now - date) / (1000 * 60 * 60 * 24));
}

function portalView() {
  if (!state.portalClientId && state.data.clients.length) {
    state.portalClientId = state.data.clients[0].id;
  }
  const client = getClient(state.portalClientId);
  if (!client) {
    return `
      <div class="section-head">
        <div>
          <h1>Client Portal</h1>
          <p class="muted">Add a client before opening the client-facing portal.</p>
        </div>
      </div>
      <section class="panel"><div class="empty">No clients available.</div></section>
    `;
  }
  return `
    <div class="section-head">
      <div>
        <h1>Client Portal</h1>
        <p class="muted">Client-facing workspace preview for projects, onboarding, meetings, and support.</p>
      </div>
      <div class="section-actions portal-select">
        <select data-action="portal-client" aria-label="Portal client">
          ${state.data.clients.map((item) => `<option value="${item.id}" ${item.id === client.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
        </select>
      </div>
    </div>
    <section class="portal-shell">
      <header class="portal-hero" style="${portalBrandStyle(client)}">
        <div class="brand-row">
          ${brandMark()}
          <div>
            <div class="eyebrow">Client workspace</div>
            <h2>${escapeHtml(client.company || client.name)}</h2>
            <p>${escapeHtml(client.nextStep || "Track project progress, meetings, and onboarding from one place.")}</p>
          </div>
        </div>
        <div class="portal-health">
          <span class="muted">Account health</span>
          <strong>${clientHealthScore(client)}/100</strong>
        </div>
      </header>
      <nav class="portal-tabs">
        ${portalTab("home", "Home")}
        ${portalTab("projects", "Projects")}
        ${portalTab("onboarding", "Onboarding")}
        ${portalTab("schedule", "Schedule")}
        ${portalTab("questionnaire", "Questionnaire")}
        ${portalTab("support", "Support")}
        ${portalTab("files", "Files")}
      </nav>
      <div class="portal-body">${portalTabView(client)}</div>
    </section>
  `;
}

function portalTab(tab, label) {
  return `<button class="${state.portalTab === tab ? "active" : ""}" data-portal-tab="${tab}">${label}</button>`;
}

function portalBrandStyle(client) {
  const primary = colorValue(client.brandPrimary);
  const secondary = colorValue(client.brandSecondary);
  if (!primary && !secondary) return "";
  const start = primary || "#101820";
  const end = secondary || "#101820";
  return `background:linear-gradient(135deg, ${start}, ${end});`;
}

function portalTabView(client) {
  if (state.portalTab === "projects") return portalProjects(client);
  if (state.portalTab === "onboarding") return portalOnboarding(client);
  if (state.portalTab === "schedule") return portalSchedule(client);
  if (state.portalTab === "questionnaire") return portalQuestionnaire(client);
  if (state.portalTab === "support") return portalSupport(client);
  if (state.portalTab === "files") return portalFiles(client);
  return portalHome(client);
}

function portalHome(client) {
  const projects = clientProjects(client.id);
  const meetings = clientMeetings(client.id).filter((meeting) => meeting.status !== "Canceled");
  const nextMeeting = meetings.find((meeting) => meeting.datetime >= new Date().toISOString().slice(0, 16));
  return `
    <div class="portal-grid">
      ${portalMetric("Active projects", projects.filter((project) => !["Delivered", "Approved"].includes(project.status)).length)}
      ${portalMetric("Open tasks", state.data.tasks.filter((task) => task.clientId === client.id && !task.done).length)}
      ${portalMetric("Next meeting", nextMeeting ? formatDateTime(nextMeeting.datetime) : "None")}
    </div>
    <div class="layout-two">
      <section class="panel">
        <div class="panel-head"><h2>Project Snapshot</h2></div>
        <div class="panel-body">${projectCards(projects.slice(0, 3))}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Next Steps</h2></div>
        <div class="panel-body">${clientPortalNextSteps(client)}</div>
      </section>
    </div>
  `;
}

function portalMetric(label, value) {
  return `<div class="portal-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function clientPortalNextSteps(client) {
  const items = [];
  const checklist = getOnboarding(client.id);
  if (checklist) {
    ONBOARDING_STEPS.forEach(([key, label]) => {
      if (!checklist[key] && items.length < 5) items.push(label);
    });
  }
  state.data.tasks
    .filter((task) => task.clientId === client.id && !task.done)
    .slice(0, 5)
    .forEach((task) => items.push(task.title));
  if (!items.length) return `<div class="empty">No open next steps.</div>`;
  return items.map((item) => `<article class="event-row"><strong>${escapeHtml(item)}</strong><span class="pill">Open</span></article>`).join("");
}

function portalProjects(client) {
  return projectCards(clientProjects(client.id));
}

function portalOnboarding(client) {
  const checklist = getOnboarding(client.id);
  if (!checklist) return `<div class="empty">No onboarding checklist has been shared yet.</div>`;
  const completeCount = ONBOARDING_STEPS.filter(([key]) => Boolean(checklist[key])).length;
  const percent = Math.round((completeCount / ONBOARDING_STEPS.length) * 100);
  return `
    <section class="panel">
      <div class="panel-head"><h2>Onboarding Progress</h2><span class="pill active">${percent}%</span></div>
      <div class="panel-body">
        <div class="progress"><span style="width:${percent}%"></span></div>
        <div class="checklist">
          ${ONBOARDING_STEPS.map(([key, label]) => `
            <div class="check-row">
              <input type="checkbox" disabled ${checklist[key] ? "checked" : ""} />
              <span>${escapeHtml(label)}</span>
            </div>
          `).join("")}
        </div>
        ${checklist.notes ? `<p class="secure-note">${escapeHtml(checklist.notes)}</p>` : ""}
      </div>
    </section>
  `;
}

function portalSchedule(client) {
  const meetings = clientMeetings(client.id);
  return `
    <div class="section-actions settings-actions">
      <button class="btn" data-open="meeting" data-client="${client.id}">Request Meeting</button>
    </div>
    ${meetingCards(meetings)}
  `;
}

function portalQuestionnaire(client) {
  const questionnaire = state.data.questionnaires.find((item) => item.clientId === client.id);
  if (!questionnaire) {
    return `
      <section class="panel">
        <div class="panel-body">
          <div class="empty">No questionnaire has been completed yet.</div>
          <button class="btn" data-open="questionnaire" data-client="${client.id}">Complete Questionnaire</button>
        </div>
      </section>
    `;
  }
  return `
    <section class="panel">
      <div class="panel-head"><h2>Questionnaire</h2><button class="btn secondary" data-open="questionnaire" data-client="${client.id}">Update</button></div>
      <div class="panel-body qa-grid">
        ${qa("Primary goal", questionnaire.primaryGoal)}
        ${qa("Timeline", questionnaire.timeline)}
        ${qa("Budget", money(questionnaire.budgetRange))}
        ${qa("Design style", questionnaire.designStyle)}
        ${qa("Target audience", questionnaire.targetAudience)}
        ${qa("Services", questionnaire.mainServices)}
        ${qa("Unique value", questionnaire.uniqueValue)}
        ${qa("Additional notes", questionnaire.additionalNotes)}
      </div>
    </section>
  `;
}

function qa(label, value) {
  return `<div class="qa"><span class="row-sub">${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not provided")}</strong></div>`;
}

function portalSupport(client) {
  const clientTasks = state.data.tasks.filter((task) => task.clientId === client.id);
  return `
    <div class="section-actions settings-actions">
      <button class="btn" data-open="task" data-client="${client.id}">New Support Request</button>
    </div>
    ${taskCards(clientTasks)}
  `;
}

function portalFiles(client) {
  const projects = clientProjects(client.id).filter((project) => project.deliverableUrl);
  const assets = clientAssets(client.id);
  if (!projects.length && !assets.length) return `<div class="empty">No deliverables, shared links, or files yet.</div>`;
  return `
    ${assets.length ? assetCards(assets) : ""}
    ${projects.map((project) => `
    <article class="event-row">
      <div>
        <strong>${escapeHtml(project.name)}</strong>
        <div class="row-sub">${escapeHtml(project.deliverableUrl)}</div>
      </div>
      <a class="btn secondary" href="${escapeHtml(project.deliverableUrl)}" target="_blank" rel="noreferrer">Open</a>
    </article>
  `).join("")}
  `;
}

function clientProjects(clientId) {
  return state.data.projects
    .filter((project) => project.clientId === clientId)
    .sort((a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31"));
}

function clientMeetings(clientId) {
  return state.data.meetings
    .filter((meeting) => meeting.clientId === clientId)
    .sort((a, b) => (a.datetime || "").localeCompare(b.datetime || ""));
}

function clientAssets(clientId) {
  return state.data.clientAssets
    .filter((asset) => asset.clientId === clientId)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function assetsView() {
  const clients = visibleClients();
  const clientIds = new Set(clients.map((client) => client.id));
  const assets = state.data.clientAssets.filter((asset) => clientIds.has(asset.clientId));
  return `
    <div class="section-head">
      <div>
        <h1>Assets</h1>
        <p class="muted">${assets.length} saved asset${assets.length === 1 ? "" : "s"} across matching clients.</p>
      </div>
      <button class="btn" data-open="clientAsset">Upload Asset</button>
    </div>
    <div class="layout-two">
      <section class="panel">
        <div class="panel-head"><h2>Client Files</h2></div>
        <div class="panel-body">${assetCards(assets)}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Brand Palettes</h2></div>
        <div class="panel-body">${brandPaletteCards(clients)}</div>
      </section>
    </div>
  `;
}

function assetCards(assets) {
  if (!assets.length) return `<div class="empty">No client assets yet.</div>`;
  return assets.map((asset) => {
    const client = getClient(asset.clientId);
    return `
      <article class="asset-card">
        ${assetPreview(asset)}
        <div>
          <div class="row-title">${escapeHtml(assetTitle(asset))}</div>
          <div class="row-sub">${escapeHtml(client?.name || "No client")} · ${escapeHtml(assetLabel(asset))} · ${formatBytes(asset.size)}</div>
          ${asset.notes ? `<p>${escapeHtml(asset.notes)}</p>` : ""}
        </div>
        <div class="inline-actions">
          ${assetOpenable(asset) ? `<button class="btn secondary" data-open-asset="${asset.id}">Open</button>` : ""}
          <button class="btn secondary" data-edit="clientAsset" data-id="${asset.id}" data-client="${asset.clientId}">Edit</button>
          <button class="btn secondary" data-delete="clientAsset" data-id="${asset.id}">Delete</button>
        </div>
      </article>
    `;
  }).join("");
}

function assetPreview(asset) {
  const source = assetPreviewUrl(asset);
  if (asset.type?.startsWith("image/") && source) {
    return `<img class="asset-thumb" src="${escapeHtml(source)}" alt="" />`;
  }
  const label = (asset.name || "file").split(".").pop()?.slice(0, 4).toUpperCase() || "FILE";
  return `<div class="asset-thumb file-thumb">${escapeHtml(label)}</div>`;
}

function assetTitle(asset) {
  return asset.displayName || asset.name || asset.originalName || "Untitled file";
}

function assetLabel(asset) {
  return asset.assetLabel || asset.category || "File";
}

function assetOpenable(asset) {
  return Boolean(asset.url || asset.downloadUrl || asset.dataUrl);
}

function assetPreviewUrl(asset) {
  return asset.url || asset.downloadUrl || asset.dataUrl || "";
}

function brandPaletteCards(clients) {
  const brandedClients = clients.filter((client) => [client.brandPrimary, client.brandSecondary, client.brandAccent, client.brandNeutral].some(Boolean));
  if (!brandedClients.length) return `<div class="empty">No brand colors saved yet.</div>`;
  return brandedClients.map((client) => `
    <article class="brand-card">
      <div>
        <strong>${escapeHtml(client.name)}</strong>
        <div class="row-sub">${escapeHtml(client.company || "No company")}</div>
      </div>
      <div class="palette-grid">
        ${brandColorEntries(client).map((entry) => brandColor(entry.label, entry.color)).join("")}
      </div>
      <button class="btn secondary" data-edit="client" data-id="${client.id}">Edit Colors</button>
    </article>
  `).join("");
}

function brandColorEntries(client) {
  const fixedColors = [
    { label: client.brandPrimaryLabel || "Primary", color: client.brandPrimary },
    { label: client.brandSecondaryLabel || "Secondary", color: client.brandSecondary },
    { label: client.brandAccentLabel || "Accent", color: client.brandAccent },
    { label: client.brandNeutralLabel || "Neutral", color: client.brandNeutral },
  ];
  const customColors = Array.isArray(client.brandColors) ? client.brandColors : [];
  return fixedColors.concat(customColors).filter((entry) => colorValue(entry.color));
}

function brandColor(label, color) {
  const value = colorValue(color);
  if (!value) return "";
  return `<div class="palette-color"><span style="background:${value}"></span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(value)}</small></div>`;
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!size) return "unknown size";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function openAssetFile(assetId) {
  const asset = state.data.clientAssets.find((item) => item.id === assetId);
  if (!assetOpenable(asset)) {
    showToast("This asset does not have a file attached.");
    return;
  }
  try {
    const url = asset.url || asset.downloadUrl || createAssetObjectUrl(asset);
    const shouldRevoke = !asset.url && !asset.downloadUrl;
    const opened = window.open(url, "_blank");
    if (opened) {
      opened.opener = null;
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.download = asset.name || "client-asset";
      document.body.append(link);
      link.click();
      link.remove();
    }
    if (shouldRevoke) setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    showToast(error.message || "Could not open this asset.");
  }
}

function createAssetObjectUrl(asset) {
  const [header, encoded] = String(asset.dataUrl || "").split(",");
  const mime = header.match(/^data:([^;]+);base64$/)?.[1] || asset.type || "application/octet-stream";
  if (!encoded) throw new Error("This asset file is not readable.");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

function addBrandColorField(button) {
  const form = button.closest("form");
  const list = form?.querySelector("[data-brand-extra-list]");
  if (!list) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = brandExtraColorField({ label: "Brand color", color: "#116466" }).trim();
  list.append(wrapper.firstElementChild);
}

function onboardingView() {
  const clients = visibleClients();
  return `
    <div class="section-head">
      <div>
        <h1>Onboarding</h1>
        <p class="muted">Track kickoff readiness, questionnaires, and planning meetings.</p>
      </div>
      <button class="btn" data-open="onboarding">New Checklist</button>
    </div>
    <div class="onboarding-grid">
      ${clients.length ? clients.map(onboardingCard).join("") : `<section class="panel"><div class="empty">No active clients yet.</div></section>`}
    </div>
  `;
}

function onboardingCard(client) {
  const checklist = getOnboarding(client.id);
  const questionnaire = state.data.questionnaires.find((item) => item.clientId === client.id);
  const completeCount = ONBOARDING_STEPS.filter(([key]) => Boolean(checklist?.[key])).length;
  const percent = Math.round((completeCount / ONBOARDING_STEPS.length) * 100);
  return `
    <section class="panel onboarding-card">
      <div class="panel-head">
        <div>
          <h2>${escapeHtml(client.name)}</h2>
          <p class="row-sub">${completeCount}/${ONBOARDING_STEPS.length} steps complete</p>
        </div>
        <span class="pill ${percent >= 80 ? "active" : percent < 40 ? "risk" : ""}">${percent}%</span>
      </div>
      <div class="panel-body">
        <div class="progress"><span style="width:${percent}%"></span></div>
        ${onboardingStageBlocks(client, checklist)}
        ${meetingProposalNotice(checklist, "welcome")}
        ${meetingProposalNotice(checklist, "strategy")}
        ${questionnaire ? `<p class="row-sub">Questionnaire: ${escapeHtml(questionnaire.primaryGoal || "Goal not set")} · ${escapeHtml(questionnaire.timeline || "Timeline not set")}</p>` : `<p class="row-sub">No questionnaire captured yet.</p>`}
        <div class="inline-actions">
          <button class="btn secondary" data-open="meeting" data-client="${client.id}" data-meeting-type="Welcome Call">Welcome Call</button>
          <button class="btn secondary" data-open="meeting" data-client="${client.id}" data-meeting-type="Strategy Meeting">Strategy Meeting</button>
          <button class="btn secondary" data-open="questionnaire" data-client="${client.id}">Questionnaire</button>
          <button class="btn secondary" data-edit="onboarding" data-id="${checklist?.id || ""}" data-client="${client.id}">${checklist ? "Edit" : "Create"}</button>
        </div>
      </div>
    </section>
  `;
}

function onboardingStageBlocks(client, checklist) {
  return ONBOARDING_STAGES.map((stage) => {
    const done = stage.steps.filter(([key]) => Boolean(checklist?.[key])).length;
    return `
      <div class="onboarding-stage">
        <div class="onboarding-stage-head">
          <div>
            <strong>${escapeHtml(stage.title)}</strong>
            <p class="row-sub">${escapeHtml(stage.description)}</p>
          </div>
          <span class="pill">${done}/${stage.steps.length}</span>
        </div>
        <div class="checklist">
          ${stage.steps.map(([key, label]) => `
            <label class="check-row">
              <input type="checkbox" data-onboarding="${client.id}" data-step="${key}" ${checklist?.[key] ? "checked" : ""} />
              <span>${escapeHtml(label)}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function meetingProposalNotice(checklist, meetingType) {
  if (!checklist) return "";
  const config = meetingType === "welcome"
    ? {
        label: "Welcome call",
        date: checklist.welcomeCallDate,
        proposedBy: checklist.welcomeCallProposedBy,
        confirmed: checklist.welcomeCallConfirmed,
      }
    : {
        label: "Strategy meeting",
        date: checklist.strategyMeetingDate,
        proposedBy: checklist.strategyMeetingProposedBy,
        confirmed: checklist.strategyMeetingConfirmed,
      };
  if (!config.date) return "";
  const status = config.confirmed
    ? "confirmed"
    : config.proposedBy === "Client"
      ? "awaiting your confirmation"
      : "awaiting client confirmation";
  return `<p class="secure-note">${config.label}: ${formatDateTime(config.date)} · ${escapeHtml(status)}</p>`;
}

function projectsView() {
  const query = state.query.trim().toLowerCase();
  const projects = state.data.projects
    .filter((project) => {
      const client = getClient(project.clientId);
      return !query || `${project.name} ${project.description} ${project.status} ${client?.name}`.toLowerCase().includes(query);
    })
    .sort((a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31"));
  const counts = PROJECT_STATUSES.map((status) => [status, state.data.projects.filter((project) => project.status === status).length]);
  return `
    <div class="section-head">
      <div>
        <h1>Projects</h1>
        <p class="muted">Track delivery scope, roadmap, status, due dates, and feedback.</p>
      </div>
      <button class="btn" data-open="project">New Project</button>
    </div>
    <div class="status-strip">${counts.map(([label, count]) => stat(label, count)).join("")}</div>
    <section class="panel"><div class="panel-body project-list">${projectCards(projects)}</div></section>
  `;
}

function projectCards(projects) {
  if (!projects.length) return `<div class="empty">No projects yet.</div>`;
  return projects
    .map((project) => {
      const client = getClient(project.clientId);
      return `
        <article class="project-card">
          <div>
            <div class="row-title">${escapeHtml(project.name)}</div>
            <div class="row-sub">${escapeHtml(client?.name || "Unassigned")} · Due ${escapeHtml(project.dueDate || "unscheduled")}</div>
          </div>
          <span class="pill ${project.status === "Delivered" ? "active" : project.status === "Review" ? "hot" : ""}">${escapeHtml(project.status || "Not Started")}</span>
          ${project.description ? `<p>${escapeHtml(project.description)}</p>` : ""}
          ${project.scope ? `<p class="row-sub">${escapeHtml(project.scope)}</p>` : ""}
          ${project.roadmap ? `<pre class="roadmap">${escapeHtml(project.roadmap)}</pre>` : ""}
          ${project.feedback ? `<p class="secure-note">Feedback: ${escapeHtml(project.feedback)}</p>` : ""}
          <div class="inline-actions">
            ${project.deliverableUrl ? `<a class="btn secondary" href="${escapeHtml(project.deliverableUrl)}" target="_blank" rel="noreferrer">Deliverable</a>` : ""}
            <button class="btn secondary" data-edit="project" data-id="${project.id}">Edit</button>
            <button class="btn secondary" data-delete="project" data-id="${project.id}">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function scheduleView() {
  const meetings = [...state.data.meetings].sort((a, b) => (a.datetime || "").localeCompare(b.datetime || ""));
  return `
    <div class="section-head">
      <div>
        <h1>Schedule</h1>
        <p class="muted">Propose, confirm, and track client meetings.</p>
      </div>
      <button class="btn" data-open="meeting">Schedule Meeting</button>
    </div>
    <div class="layout-two">
      <section class="panel">
        <div class="panel-head"><h2>Meetings</h2></div>
        <div class="panel-body">${meetingCards(meetings)}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Upcoming Events</h2></div>
        <div class="panel-body">${eventCards(upcomingEvents())}</div>
      </section>
    </div>
  `;
}

function meetingCards(meetings) {
  if (!meetings.length) return `<div class="empty">No meetings scheduled.</div>`;
  return meetings
    .map((meeting) => {
      const client = getClient(meeting.clientId);
      return `
        <article class="task-card">
          <strong>${escapeHtml(meeting.title || meeting.type)}</strong>
          <span class="row-sub">${escapeHtml(client?.name || "No client")} · ${formatDateTime(meeting.datetime)}</span>
          <span class="pill ${meeting.status === "Confirmed" ? "active" : meeting.status === "Canceled" ? "risk" : ""}">${escapeHtml(meeting.status || "Proposed")}</span>
          ${meeting.notes ? `<p class="row-sub">${escapeHtml(meeting.notes)}</p>` : ""}
          <div class="inline-actions">
            ${meeting.status !== "Confirmed" ? `<button class="btn secondary" data-confirm-meeting="${meeting.id}">Confirm</button>` : ""}
            <button class="btn secondary" data-edit="meeting" data-id="${meeting.id}">Edit</button>
            <button class="btn secondary" data-delete="meeting" data-id="${meeting.id}">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function upcomingEvents() {
  const meetingEvents = state.data.meetings
    .filter((meeting) => meeting.datetime && meeting.status !== "Canceled")
    .map((meeting) => ({
      type: "Meeting",
      title: meeting.title || meeting.type,
      date: meeting.datetime,
      clientName: getClient(meeting.clientId)?.name || "",
      notes: meeting.status || "",
    }));
  const projectEvents = state.data.projects
    .filter((project) => project.dueDate && project.status !== "Delivered")
    .map((project) => ({
      type: "Project Due",
      title: project.name,
      date: project.dueDate,
      clientName: getClient(project.clientId)?.name || "",
      notes: project.status || "",
    }));
  return [...meetingEvents, ...projectEvents].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function eventCards(events) {
  if (!events.length) return `<div class="empty">No upcoming events.</div>`;
  return events
    .map((event) => `
      <article class="event-row">
        <div>
          <strong>${escapeHtml(event.title)}</strong>
          <div class="row-sub">${escapeHtml(event.clientName || "No client")} · ${escapeHtml(event.type)}${event.notes ? ` · ${escapeHtml(event.notes)}` : ""}</div>
        </div>
        <span class="pill">${formatDateTime(event.date)}</span>
      </article>
    `)
    .join("");
}

function getOnboarding(clientId) {
  return state.data.onboarding.find((item) => item.clientId === clientId);
}

function formatDateTime(value) {
  if (!value) return "unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hasTime = value.includes("T");
  return hasTime
    ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function pipelineView() {
  return `
    <div class="section-head">
      <div>
        <h1>Pipeline</h1>
        <p class="muted">Move opportunities forward and keep close dates visible.</p>
      </div>
      <button class="btn" data-open="deal">New Deal</button>
    </div>
    <div class="kanban">
      ${STAGES.map(stageColumn).join("")}
    </div>
  `;
}

function stageColumn(stage) {
  const deals = state.data.deals.filter((deal) => deal.stage === stage);
  const total = deals.reduce((sum, deal) => sum + Number(deal.value || 0), 0);
  return `
    <section class="stage">
      <h3>${stage}<span class="money">${money(total)}</span></h3>
      ${deals.length ? deals.map(dealCard).join("") : `<div class="empty">No deals</div>`}
    </section>
  `;
}

function dealCard(deal) {
  const client = getClient(deal.clientId);
  const currentIndex = STAGES.indexOf(deal.stage);
  const prev = STAGES[currentIndex - 1];
  const next = STAGES[currentIndex + 1];
  return `
    <article class="deal-card">
      <strong>${escapeHtml(deal.name)}</strong>
      <span class="row-sub">${escapeHtml(client?.name || "Unassigned")}</span>
      <span class="money">${money(deal.value)} · ${Number(deal.probability || 0)}%</span>
      <span class="row-sub">Close ${escapeHtml(deal.closeDate || "unscheduled")}</span>
      <div class="inline-actions">
        ${prev ? `<button class="btn secondary" data-stage="${prev}" data-id="${deal.id}">Back</button>` : ""}
        ${next ? `<button class="btn secondary" data-stage="${next}" data-id="${deal.id}">Next</button>` : ""}
        <button class="btn secondary" data-edit="deal" data-id="${deal.id}">Edit</button>
      </div>
    </article>
  `;
}

function tasksView() {
  const open = dueTasks();
  const done = state.data.tasks
    .filter((task) => task.done)
    .sort((a, b) => (b.dueDate || "").localeCompare(a.dueDate || ""));
  return `
    <div class="section-head">
      <div>
        <h1>Tasks</h1>
        <p class="muted">A practical follow-up queue tied to clients.</p>
      </div>
      <button class="btn" data-open="task">New Task</button>
    </div>
    <div class="task-grid">
      <section class="panel"><div class="panel-head"><h2>Open</h2></div><div class="panel-body">${taskCards(open)}</div></section>
      <section class="panel"><div class="panel-head"><h2>Completed</h2></div><div class="panel-body">${taskCards(done)}</div></section>
      <section class="panel"><div class="panel-head"><h2>Activity</h2></div><div class="panel-body">${auditCards()}</div></section>
    </div>
  `;
}

function dueTasks() {
  return state.data.tasks
    .filter((task) => !task.done)
    .sort((a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31"));
}

function taskCards(tasks) {
  if (!tasks.length) return `<div class="empty">Nothing here.</div>`;
  return tasks
    .map((task) => {
      const client = getClient(task.clientId);
      const risk = !task.done && task.dueDate < today();
      return `
        <article class="task-card">
          <strong>${escapeHtml(task.title)}</strong>
          <span class="row-sub">${escapeHtml(client?.name || "No client")} · Due ${escapeHtml(task.dueDate || "none")}</span>
          <span class="pill ${risk ? "risk" : task.priority === "High" ? "hot" : ""}">${escapeHtml(task.priority || "Normal")}</span>
          <div class="inline-actions">
            <button class="btn secondary" data-done="${task.id}">${task.done ? "Reopen" : "Done"}</button>
            <button class="btn secondary" data-edit="task" data-id="${task.id}">Edit</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function notesView() {
  return `
    <div class="section-head">
      <div>
        <h1>Notes</h1>
        <p class="muted">Chronological relationship notes and decisions.</p>
      </div>
      <button class="btn" data-open="note">New Note</button>
    </div>
    <section class="panel"><div class="panel-body">${noteCards()}</div></section>
  `;
}

function noteCards() {
  const notes = [...state.data.notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!notes.length) return `<div class="empty">No notes yet.</div>`;
  return notes
    .map((note) => {
      const client = getClient(note.clientId);
      return `
        <article class="note-card">
          <strong>${escapeHtml(client?.name || "No client")}</strong>
          <p>${escapeHtml(note.body)}</p>
          <span class="row-sub">${new Date(note.createdAt).toLocaleString()}</span>
          <div class="inline-actions">
            <button class="btn secondary" data-edit="note" data-id="${note.id}">Edit</button>
            <button class="btn secondary" data-delete="note" data-id="${note.id}">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function settingsView() {
  return `
    <div class="section-head">
      <div>
        <h1>Settings</h1>
        <p class="muted">Backup, restore, sync, and account metadata.</p>
      </div>
    </div>
    <section class="panel">
      <div class="panel-body">
        <p class="secure-note">CRM records are saved server-side. Exports are plain JSON for portability, so store downloaded backups carefully.</p>
        <div class="section-actions settings-actions">
          <button class="btn" data-action="export">Export JSON Backup</button>
          <label class="btn secondary">Import Backup<input data-action="import" type="file" accept="application/json" hidden /></label>
          <button class="btn secondary" data-action="sync-portal">Sync Portal Updates</button>
        </div>
        <form data-form="portalSecret" class="form-grid portal-secret-form">
          ${input("adminSecret", "Portal admin secret for automatic sync", localStorage.getItem(PORTAL_ADMIN_SECRET_KEY) || "", true, "password", "span-2")}
          <button class="btn span-2" type="submit">Save Sync Secret</button>
        </form>
        <p><strong>Records:</strong> ${state.data.clients.length} clients, ${state.data.contacts.length} contacts, ${state.data.deals.length} deals, ${state.data.tasks.length} tasks, ${state.data.clientAssets.length} assets, ${state.data.notes.length} notes.</p>
        <p><strong>Signed in:</strong> ${escapeHtml(state.sessionEmail || "Admin")}</p>
        <p><strong>Last saved:</strong> ${escapeHtml(state.data.updatedAt || "Unknown")}</p>
        <p><strong>Auto-lock:</strong> 15 minutes of inactivity.</p>
      </div>
    </section>
  `;
}

function auditCards() {
  if (!state.data.audit.length) return `<div class="empty">No activity yet.</div>`;
  return state.data.audit
    .slice(0, 10)
    .map((item) => `<p><strong>${escapeHtml(item.action)}</strong><br><span class="row-sub">${new Date(item.at).toLocaleString()}</span></p>`)
    .join("");
}

function drawer() {
  const title = drawerTitle();
  return `
    <div class="drawer" role="dialog" aria-modal="true">
      <aside class="drawer-panel">
        <div class="drawer-head">
          <h2>${title}</h2>
          <button class="btn secondary icon" data-close title="Close">X</button>
        </div>
        <div class="drawer-body">
          ${drawerForm()}
          ${state.drawer.id ? `<button class="btn danger space-top" data-delete="${state.drawer.type}" data-id="${state.drawer.id}">Delete ${escapeHtml(state.drawer.type)}</button>` : ""}
        </div>
      </aside>
    </div>
  `;
}

function drawerTitle() {
  const isEdit = Boolean(state.drawer.id);
  const labels = {
    client: "Client",
    contact: "Contact",
    onboarding: "Onboarding Checklist",
    questionnaire: "Questionnaire",
    clientAsset: "Client Asset",
    portalAccess: "Portal Access",
    project: "Project",
    meeting: "Meeting",
    deal: "Deal",
    task: "Task",
    note: "Note",
  };
  return `${isEdit ? "Edit" : "New"} ${labels[state.drawer.type]}`;
}

function drawerForm() {
  const type = state.drawer.type;
  if (type === "client") return clientForm();
  if (type === "contact") return contactForm();
  if (type === "onboarding") return onboardingForm();
  if (type === "questionnaire") return questionnaireForm();
  if (type === "clientAsset") return clientAssetForm();
  if (type === "portalAccess") return portalAccessForm();
  if (type === "project") return projectForm();
  if (type === "meeting") return meetingForm();
  if (type === "deal") return dealForm();
  if (type === "task") return taskForm();
  return noteForm();
}

function record(collection) {
  return state.drawer.id ? state.data[collection].find((item) => item.id === state.drawer.id) : {};
}

function clientForm() {
  const client = record("clients");
  return `
    <form data-form="client" class="form-grid">
      ${input("name", "Client name", client.name, true)}
      ${input("company", "Company", client.company)}
      ${input("email", "Email", client.email, false, "email")}
      ${input("phone", "Phone", client.phone)}
      ${input("website", "Website", client.website, false, "url")}
      ${input("segment", "Segment", client.segment)}
      ${select("status", "Status", ["Lead", "Active", "At Risk", "Former"], client.status || "Lead")}
      ${input("value", "Annual value", client.value || 0, false, "number")}
      ${input("owner", "Owner", client.owner)}
      ${input("lastTouch", "Last touch", client.lastTouch || today(), false, "date")}
      ${input("tags", "Tags", client.tags, false, "text", "span-2")}
      <div class="span-2 form-section-title">Brand colors</div>
      <div class="span-2 brand-color-list">
        ${brandFixedColorField("brandPrimary", "brandPrimaryLabel", client.brandPrimary || "#116466", client.brandPrimaryLabel || "Primary")}
        ${brandFixedColorField("brandSecondary", "brandSecondaryLabel", client.brandSecondary || "#101820", client.brandSecondaryLabel || "Secondary")}
        ${brandFixedColorField("brandAccent", "brandAccentLabel", client.brandAccent || "#a54f2a", client.brandAccentLabel || "Accent")}
        ${brandFixedColorField("brandNeutral", "brandNeutralLabel", client.brandNeutral || "#f5f7f9", client.brandNeutralLabel || "Neutral")}
      </div>
      <div class="span-2 form-section-title">Additional brand colors</div>
      <div class="span-2 brand-extra-list" data-brand-extra-list>
        ${brandExtraColorFields(client.brandColors)}
      </div>
      <button class="btn secondary span-2" type="button" data-add-brand-color>Add Color</button>
      ${textarea("nextStep", "Next step", client.nextStep, "span-2")}
      <button class="btn span-2" type="submit">Save Client</button>
    </form>
  `;
}

function brandFixedColorField(colorName, labelName, color, label) {
  return `
    <div class="brand-color-row">
      ${input(colorName, "Color", color, false, "color")}
      ${input(labelName, "Label", label)}
    </div>
  `;
}

function brandExtraColorFields(colors = []) {
  const entries = Array.isArray(colors) ? colors : [];
  return entries.map((entry) => brandExtraColorField(entry)).join("");
}

function brandExtraColorField(entry = {}) {
  return `
    <div class="brand-extra-row">
      ${input("brandExtraColor", "Color", colorValue(entry.color, "#116466"), false, "color")}
      ${input("brandExtraLabel", "Label", entry.label || "")}
    </div>
  `;
}

function clientAssetForm() {
  const asset = { clientId: state.drawer.clientId, ...record("clientAssets") };
  return `
    <form data-form="clientAsset" class="form-grid" novalidate>
      ${select("clientId", "Client", state.data.clients.map((c) => [c.id, c.name]), asset.clientId)}
      ${select("category", "Category", ["Logo", "Brand Guide", "Palette", "Image", "Copy", "Contract", "Deliverable", "Reference", "Other"], asset.category || "Reference")}
      ${input("assetLabel", "Asset label", asset.assetLabel || asset.category || "Reference")}
      <div class="field span-2">
        <label>File${asset.id ? " replacement" : ""}</label>
        <input name="assetFiles" type="file" ${asset.id ? "" : "multiple"} />
      </div>
      ${asset.id ? `<div class="secure-note span-2">Current file: ${escapeHtml(asset.name || "Untitled")} · ${formatBytes(asset.size)}</div>` : ""}
      ${input("displayName", "Display name", asset.displayName || asset.name || "", false, "text", "span-2")}
      ${textarea("notes", "Notes", asset.notes, "span-2")}
      <button class="btn span-2" type="submit">${asset.id ? "Save Asset" : "Upload Asset"}</button>
    </form>
  `;
}

function contactForm() {
  const contact = { clientId: state.drawer.clientId, ...record("contacts") };
  return `
    <form data-form="contact" class="form-grid">
      ${select("clientId", "Client", state.data.clients.map((c) => [c.id, c.name]), contact.clientId)}
      ${input("name", "Name", contact.name, true)}
      ${input("role", "Role", contact.role)}
      ${input("email", "Email", contact.email, false, "email")}
      ${input("phone", "Phone", contact.phone)}
      <button class="btn span-2" type="submit">Save Contact</button>
    </form>
  `;
}

function onboardingForm() {
  const existing = state.drawer.id ? record("onboarding") : getOnboarding(state.drawer.clientId) || {};
  const checklist = { clientId: state.drawer.clientId, ...existing };
  return `
    <form data-form="onboarding" class="form-grid">
      ${select("clientId", "Client", state.data.clients.map((c) => [c.id, c.name]), checklist.clientId)}
      ${input("welcomeCallDate", "Welcome call", checklist.welcomeCallDate || "", false, "datetime-local")}
      ${select("welcomeCallProposedBy", "Welcome call proposed by", ["Agency", "Client"], checklist.welcomeCallProposedBy || "Agency")}
      ${select("welcomeCallConfirmed", "Welcome call confirmed", [["false", "No"], ["true", "Yes"]], String(Boolean(checklist.welcomeCallConfirmed)))}
      ${input("strategyMeetingDate", "Strategy meeting", checklist.strategyMeetingDate || "", false, "datetime-local")}
      ${select("strategyMeetingProposedBy", "Strategy meeting proposed by", ["Agency", "Client"], checklist.strategyMeetingProposedBy || "Agency")}
      ${select("strategyMeetingConfirmed", "Strategy meeting confirmed", [["false", "No"], ["true", "Yes"]], String(Boolean(checklist.strategyMeetingConfirmed)))}
      ${textarea("notes", "Internal onboarding notes", checklist.notes, "span-2")}
      ${textarea("welcomeCallHistory", "Welcome call proposal history", checklist.welcomeCallHistory || "[]", "span-2")}
      ${textarea("meetingProposalHistory", "Strategy meeting proposal history", checklist.meetingProposalHistory || "[]", "span-2")}
      <div class="span-2 form-checks">
        ${ONBOARDING_STAGES.map((stage) => `
          <div class="onboarding-stage">
            <div class="onboarding-stage-head"><strong>${escapeHtml(stage.title)}</strong><span class="pill">${stage.steps.length} steps</span></div>
            ${stage.steps.map(([key, label]) => `
              <label class="check-row">
                <input type="checkbox" name="${key}" value="true" ${checklist[key] ? "checked" : ""} />
                <span>${escapeHtml(label)}</span>
              </label>
            `).join("")}
          </div>
        `).join("")}
      </div>
      <button class="btn span-2" type="submit">Save Checklist</button>
    </form>
  `;
}

function questionnaireForm() {
  const existing = state.drawer.id
    ? record("questionnaires")
    : state.data.questionnaires.find((item) => item.clientId === state.drawer.clientId) || {};
  const questionnaire = { clientId: state.drawer.clientId, ...existing };
  return `
    <form data-form="questionnaire" class="form-grid">
      ${select("clientId", "Client", state.data.clients.map((c) => [c.id, c.name]), questionnaire.clientId)}
      ${input("websiteUrl", "Current website", questionnaire.websiteUrl, false, "url")}
      ${select("primaryGoal", "Primary goal", ["Get more leads", "Increase online sales", "Build brand awareness", "Improve online reputation", "Other"], questionnaire.primaryGoal || "Get more leads")}
      ${select("timeline", "Timeline", ["ASAP", "Within 1 month", "1-3 months", "3-6 months", "Flexible"], questionnaire.timeline || "Flexible")}
      ${input("budgetRange", "Budget", questionnaire.budgetRange || 0, false, "number")}
      ${select("designStyle", "Design style", ["Modern & minimal", "Bold & colorful", "Professional & corporate", "Warm & friendly", "Other"], questionnaire.designStyle || "Modern & minimal")}
      ${textarea("targetAudience", "Target audience", questionnaire.targetAudience, "span-2")}
      ${textarea("mainServices", "Products or services", questionnaire.mainServices, "span-2")}
      ${textarea("uniqueValue", "Unique value", questionnaire.uniqueValue, "span-2")}
      ${textarea("competitors", "Competitors", questionnaire.competitors, "span-2")}
      ${textarea("socialMedia", "Social media handles", questionnaire.socialMedia, "span-2")}
      ${textarea("additionalNotes", "Additional notes", questionnaire.additionalNotes, "span-2")}
      <button class="btn span-2" type="submit">Save Questionnaire</button>
    </form>
  `;
}

function portalAccessForm() {
  const client = getClient(state.drawer.clientId);
  const contact = state.data.contacts.find((item) => item.clientId === state.drawer.clientId);
  return `
    <form data-form="portalAccess" class="form-grid">
      <div class="secure-note span-2">Publish a client portal snapshot and send the client an invite email with their portal link and access code when Resend is configured.</div>
      ${input("adminSecret", "Portal admin secret", "", true, "password", "span-2")}
      ${input("email", "Client login email", contact?.email || client?.email || "", true, "email")}
      ${input("accessCode", "Client access code", "", true, "text")}
      <button class="btn span-2" type="submit">Publish Portal Access</button>
    </form>
  `;
}

function projectForm() {
  const project = { clientId: state.drawer.clientId, ...record("projects") };
  return `
    <form data-form="project" class="form-grid">
      ${select("clientId", "Client", state.data.clients.map((c) => [c.id, c.name]), project.clientId)}
      ${input("name", "Project name", project.name, true)}
      ${select("status", "Status", PROJECT_STATUSES, project.status || "Not Started")}
      ${input("dueDate", "Due date", project.dueDate || "", false, "date")}
      ${input("deliverableUrl", "Deliverable URL", project.deliverableUrl, false, "url", "span-2")}
      ${textarea("description", "Description", project.description, "span-2")}
      ${textarea("scope", "Scope and deliverables", project.scope, "span-2")}
      ${textarea("roadmap", "Roadmap milestones", project.roadmap, "span-2")}
      ${textarea("feedback", "Client feedback", project.feedback, "span-2")}
      <button class="btn span-2" type="submit">Save Project</button>
    </form>
  `;
}

function meetingForm() {
  const meeting = { clientId: state.drawer.clientId, ...record("meetings") };
  const defaultType = state.drawer.meetingType || meeting.type || "Strategy Meeting";
  return `
    <form data-form="meeting" class="form-grid">
      ${select("clientId", "Client", state.data.clients.map((c) => [c.id, c.name]), meeting.clientId)}
      ${select("type", "Type", MEETING_TYPES, defaultType)}
      ${input("title", "Title", meeting.title, true)}
      ${input("datetime", "Date and time", meeting.datetime || "", true, "datetime-local")}
      ${select("status", "Status", ["Proposed", "Confirmed", "Completed", "Canceled"], meeting.status || "Proposed")}
      ${select("proposedBy", "Proposed by", ["Agency", "Client"], meeting.proposedBy || "Agency")}
      ${textarea("notes", "Agenda or notes", meeting.notes, "span-2")}
      <button class="btn span-2" type="submit">Save Meeting</button>
    </form>
  `;
}

function dealForm() {
  const deal = { clientId: state.drawer.clientId, ...record("deals") };
  return `
    <form data-form="deal" class="form-grid">
      ${select("clientId", "Client", state.data.clients.map((c) => [c.id, c.name]), deal.clientId)}
      ${input("name", "Deal name", deal.name, true)}
      ${select("stage", "Stage", STAGES, deal.stage || "Lead")}
      ${input("value", "Value", deal.value || 0, false, "number")}
      ${input("probability", "Probability", deal.probability || 50, false, "number")}
      ${input("closeDate", "Close date", deal.closeDate || addDays(30), false, "date")}
      <button class="btn span-2" type="submit">Save Deal</button>
    </form>
  `;
}

function taskForm() {
  const task = { clientId: state.drawer.clientId, ...record("tasks") };
  return `
    <form data-form="task" class="form-grid">
      ${select("clientId", "Client", state.data.clients.map((c) => [c.id, c.name]), task.clientId)}
      ${input("title", "Task", task.title, true)}
      ${input("dueDate", "Due date", task.dueDate || today(), false, "date")}
      ${select("priority", "Priority", PRIORITIES, task.priority || "Normal")}
      <button class="btn span-2" type="submit">Save Task</button>
    </form>
  `;
}

function noteForm() {
  const note = { clientId: state.drawer.clientId, ...record("notes") };
  return `
    <form data-form="note" class="form-grid">
      ${select("clientId", "Client", state.data.clients.map((c) => [c.id, c.name]), note.clientId)}
      ${textarea("body", "Note", note.body, "span-2", true)}
      <button class="btn span-2" type="submit">Save Note</button>
    </form>
  `;
}

function input(name, label, value = "", required = false, type = "text", className = "") {
  return `
    <div class="field ${className}">
      <label>${label}</label>
      <input name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? "required" : ""} />
    </div>
  `;
}

function textarea(name, label, value = "", className = "", required = false) {
  return `
    <div class="field ${className}">
      <label>${label}</label>
      <textarea name="${name}" ${required ? "required" : ""}>${escapeHtml(value)}</textarea>
    </div>
  `;
}

function select(name, label, options, selected = "") {
  const needsPlaceholder = name === "clientId" && !selected;
  const normalizedOptions = options.map((option) => ({
    value: Array.isArray(option) ? option[0] : option,
    text: Array.isArray(option) ? option[1] : option,
  }));
  const optionHtml = options
    .map((option) => {
      const value = Array.isArray(option) ? option[0] : option;
      const text = Array.isArray(option) ? option[1] : option;
      return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(text)}</option>`;
    })
    .join("");
  const placeholder = name === "clientId"
    ? `<option value="" disabled ${needsPlaceholder ? "selected" : ""}>${normalizedOptions.length ? "Choose client" : "Add a client first"}</option>`
    : "";
  return `
    <div class="field">
      <label>${label}</label>
      <select name="${name}" required>${placeholder}${optionHtml}</select>
    </div>
  `;
}

async function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const type = form.dataset.form;
  if (type === "clientAsset") {
    await submitClientAsset(form);
    return;
  }
  const formData = new FormData(form);
  const values = Object.fromEntries(formData.entries());
  if (type === "client") {
    values.brandExtraColors = formData.getAll("brandExtraColor");
    values.brandExtraLabels = formData.getAll("brandExtraLabel");
  }
  if (type === "portalSecret") {
    savePortalAdminSecret(event);
    return;
  }
  if (type === "portalAccess") {
    await publishPortalAccess(values);
    return;
  }
  const collections = {
    client: "clients",
    contact: "contacts",
    onboarding: "onboarding",
    questionnaire: "questionnaires",
    clientAsset: "clientAssets",
    project: "projects",
    meeting: "meetings",
    deal: "deals",
    task: "tasks",
    note: "notes",
  };
  const collection = collections[type];
  const existing = state.drawer.id
    ? state.data[collection].find((item) => item.id === state.drawer.id)
    : null;
  const next = normalizeRecord(type, values, existing);
  if (existing) Object.assign(existing, next);
  else if (type === "onboarding") {
    const duplicate = getOnboarding(next.clientId);
    if (duplicate) Object.assign(duplicate, next);
    else state.data[collection].push(next);
  } else if (type === "questionnaire") {
    const duplicate = state.data.questionnaires.find((item) => item.clientId === next.clientId);
    if (duplicate) Object.assign(duplicate, next);
    else state.data[collection].push(next);
  } else state.data[collection].push(next);
  syncWorkflowFlags(type, next);
  state.drawer = null;
  await saveData(`${existing ? "Updated" : "Created"} ${type}`);
  showToast(`${type[0].toUpperCase() + type.slice(1)} saved.`);
  render();
}

function normalizeRecord(type, values, existing = {}) {
  const base = { ...existing, ...values };
  if (!base.id) base.id = id();
  if (type === "client") {
    base.value = Number(base.value || 0);
    base.createdAt = base.createdAt || new Date().toISOString();
    base.brandPrimary = colorValue(base.brandPrimary);
    base.brandSecondary = colorValue(base.brandSecondary);
    base.brandAccent = colorValue(base.brandAccent);
    base.brandNeutral = colorValue(base.brandNeutral);
    base.brandPrimaryLabel = base.brandPrimaryLabel || "Primary";
    base.brandSecondaryLabel = base.brandSecondaryLabel || "Secondary";
    base.brandAccentLabel = base.brandAccentLabel || "Accent";
    base.brandNeutralLabel = base.brandNeutralLabel || "Neutral";
    base.brandColors = (values.brandExtraColors || [])
      .map((color, index) => ({
        color: colorValue(color),
        label: String(values.brandExtraLabels?.[index] || "").trim() || "Brand color",
      }))
      .filter((entry) => entry.color);
  }
  if (type === "deal") {
    base.value = Number(base.value || 0);
    base.probability = Math.max(0, Math.min(100, Number(base.probability || 0)));
  }
  if (type === "onboarding") {
    ONBOARDING_STEPS.forEach(([key]) => {
      base[key] = values[key] === "true";
    });
    base.welcomeCallConfirmed = values.welcomeCallConfirmed === "true";
    base.strategyMeetingConfirmed = values.strategyMeetingConfirmed === "true";
    base.welcomeCallHistory = safeHistoryJson(base.welcomeCallHistory);
    base.meetingProposalHistory = safeHistoryJson(base.meetingProposalHistory);
  }
  if (type === "questionnaire") {
    base.budgetRange = Number(base.budgetRange || 0);
  }
  if (type === "project") {
    base.createdAt = base.createdAt || new Date().toISOString();
  }
  if (type === "meeting") {
    base.status = base.status || "Proposed";
    base.proposedBy = base.proposedBy || "Agency";
  }
  if (type === "task") {
    base.done = Boolean(existing.done);
  }
  if (type === "note") {
    base.createdAt = base.createdAt || new Date().toISOString();
  }
  return base;
}

async function submitClientAsset(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const files = [...form.querySelector("input[type='file']").files];
  const existing = state.drawer.id
    ? state.data.clientAssets.find((asset) => asset.id === state.drawer.id)
    : null;
  if (!values.clientId) {
    showToast("Choose a client before uploading an asset.");
    return;
  }
  if (!existing && !files.length) {
    showToast("Choose at least one file to upload.");
    return;
  }
  if (files.some((file) => file.size > 15 * 1024 * 1024)) {
    showToast("Each asset must be 15 MB or smaller.");
    return;
  }
  try {
    showToast(files.length ? `Uploading ${files.length} asset${files.length === 1 ? "" : "s"}...` : "Saving asset...");
    if (existing) {
      Object.assign(existing, {
        clientId: values.clientId,
        category: values.category,
        assetLabel: values.assetLabel || values.category || "Reference",
        displayName: values.displayName,
        notes: values.notes,
        updatedAt: new Date().toISOString(),
      });
      if (files[0]) Object.assign(existing, await fileRecord(files[0], values, existing.id));
      state.drawer = null;
      await saveData("Updated client asset");
      showToast("Asset saved.");
      render();
      return;
    }
    const records = await Promise.all(files.map((file) => fileRecord(file, values)));
    state.data.clientAssets.push(...records);
    const uniqueClientIds = new Set(records.map((asset) => asset.clientId));
    uniqueClientIds.forEach((clientId) => {
      const checklist = ensureOnboarding(clientId);
      checklist.brandAssetsCollected = true;
    });
    state.drawer = null;
    await saveData(`Uploaded ${records.length} client asset${records.length === 1 ? "" : "s"}`);
    showToast(`${records.length} asset${records.length === 1 ? "" : "s"} uploaded.`);
    render();
  } catch (error) {
    showToast(error.message || "Asset upload failed.");
  }
}

async function fileRecord(file, values, existingId = "") {
  const formData = new FormData();
  formData.append("clientId", values.clientId);
  formData.append("file", file, file.name);
  const response = await fetch("/api/client-asset-upload", {
    method: "POST",
    credentials: "same-origin",
    body: formData,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Could not upload ${file.name}`);
  return {
    id: existingId || id(),
    clientId: values.clientId,
    category: values.category || "Reference",
    assetLabel: values.assetLabel || values.category || "Reference",
    name: values.displayName || file.name,
    displayName: values.displayName || file.name,
    originalName: file.name,
    type: result.contentType || file.type || "application/octet-stream",
    size: result.size || file.size,
    url: result.url,
    downloadUrl: result.downloadUrl || result.url,
    pathname: result.pathname,
    notes: values.notes || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function publishPortalAccess(values) {
  const client = getClient(state.drawer.clientId);
  if (!client) {
    showToast("Choose a client before publishing portal access.");
    return;
  }
  try {
    const response = await fetch("/api/portal-publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        adminSecret: values.adminSecret,
        email: values.email,
        accessCode: values.accessCode,
        snapshot: buildPortalSnapshot(client.id),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Portal publish failed.");
    localStorage.setItem(PORTAL_ADMIN_SECRET_KEY, values.adminSecret);
    state.drawer = null;
    await saveData(`Published portal for ${client.name}`);
    const inviteMessage = result.invite?.sent
      ? "Invite email sent."
      : `Invite email not sent: ${result.invite?.reason || "Resend is not configured."}`;
    showToast(`Portal published. ${inviteMessage}`);
    render();
  } catch (error) {
    showToast(error.message);
  }
}

async function savePortalAdminSecret(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  localStorage.setItem(PORTAL_ADMIN_SECRET_KEY, values.adminSecret);
  showToast("Portal sync secret saved locally.");
  await syncPortalUpdates();
}

async function autoSyncPortalUpdates() {
  if (!localStorage.getItem(PORTAL_ADMIN_SECRET_KEY)) return;
  await syncPortalUpdates({ silent: true });
}

async function syncPortalUpdates(options = {}) {
  const adminSecret = localStorage.getItem(PORTAL_ADMIN_SECRET_KEY);
  if (!adminSecret) {
    if (!options.silent) showToast("Save your portal admin secret in Settings before syncing.");
    return;
  }
  if (state.syncing) return;
  state.syncing = true;
  try {
    const response = await fetch("/api/portal-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adminSecret }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Portal sync failed.");
    const { appliedIds, clearIds } = applyPortalUpdates(result.updates || []);
    if (appliedIds.length) {
      await saveData(`Synced ${appliedIds.length} portal update${appliedIds.length === 1 ? "" : "s"}`);
    }
    if (clearIds.length) {
      const clearResponse = await fetch("/api/portal-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminSecret, clearIds }),
      });
      const clearResult = await clearResponse.json().catch(() => ({}));
      if (!clearResponse.ok) throw new Error(clearResult.error || "Portal updates applied but could not be cleared.");
    }
    if (appliedIds.length) {
      render();
      showToast(`Synced ${appliedIds.length} portal update${appliedIds.length === 1 ? "" : "s"}.`);
    } else if (!options.silent) {
      showToast("No portal updates to sync.");
    }
  } catch (error) {
    if (!options.silent) showToast(error.message);
  } finally {
    state.syncing = false;
  }
}

function applyPortalUpdates(updates) {
  const applied = [];
  const clearIds = [];
  const processed = new Set(state.data.portalUpdateIds || []);
  updates.forEach((update) => {
    if (!update.id) return;
    if (processed.has(update.id)) {
      clearIds.push(update.id);
      return;
    }
    const clientId = update.portalId;
    if (!getClient(clientId)) return;
    if (update.type === "meeting_request") {
      const meeting = normalizeRecord("meeting", {
        clientId,
        type: update.payload.meetingType || "Strategy Meeting",
        title: update.payload.title || `${update.payload.meetingType || "Strategy Meeting"} request`,
        datetime: update.payload.datetime,
        status: "Proposed",
        proposedBy: "Client",
        notes: update.payload.notes || "",
      });
      state.data.meetings.push(meeting);
      syncWorkflowFlags("meeting", meeting);
      applied.push(update.id);
      clearIds.push(update.id);
    }
    if (update.type === "meeting_confirm") {
      const meeting = state.data.meetings.find((item) => item.id === update.payload.meetingId || (
        item.clientId === clientId &&
        item.type === update.payload.meetingType &&
        item.datetime === update.payload.datetime
      ));
      if (meeting) {
        meeting.status = "Confirmed";
        syncWorkflowFlags("meeting", meeting);
        applied.push(update.id);
        clearIds.push(update.id);
      }
    }
    if (update.type === "questionnaire_update") {
      const existing = state.data.questionnaires.find((item) => item.clientId === clientId);
      const next = normalizeRecord("questionnaire", { clientId, ...update.payload }, existing || {});
      if (existing) Object.assign(existing, next);
      else state.data.questionnaires.push(next);
      syncWorkflowFlags("questionnaire", next);
      applied.push(update.id);
      clearIds.push(update.id);
    }
    if (update.type === "support_request") {
      state.data.tasks.push(normalizeRecord("task", {
        clientId,
        title: update.payload.title || "Client support request",
        dueDate: update.payload.dueDate || today(),
        priority: update.payload.priority || "Normal",
      }));
      applied.push(update.id);
      clearIds.push(update.id);
    }
    if (update.type === "onboarding_step") {
      const checklist = ensureOnboarding(clientId);
      if (update.payload.step) {
        checklist[update.payload.step] = Boolean(update.payload.done);
        applied.push(update.id);
        clearIds.push(update.id);
      }
    }
  });
  if (applied.length) {
    state.data.portalUpdateIds = [...new Set([...(state.data.portalUpdateIds || []), ...applied])].slice(-500);
  }
  return { appliedIds: applied, clearIds };
}

function buildPortalSnapshot(clientId) {
  const client = getClient(clientId);
  const checklist = getOnboarding(clientId);
  return {
    client: {
      id: client.id,
      name: client.name,
      company: client.company,
      status: client.status,
      email: client.email,
      phone: client.phone,
      website: client.website,
      nextStep: client.nextStep,
      brandPrimary: client.brandPrimary,
      brandSecondary: client.brandSecondary,
      brandAccent: client.brandAccent,
      brandNeutral: client.brandNeutral,
      brandPrimaryLabel: client.brandPrimaryLabel,
      brandSecondaryLabel: client.brandSecondaryLabel,
      brandAccentLabel: client.brandAccentLabel,
      brandNeutralLabel: client.brandNeutralLabel,
      brandColors: client.brandColors || [],
    },
    contacts: state.data.contacts.filter((item) => item.clientId === clientId),
    projects: clientProjects(clientId),
    meetings: clientMeetings(clientId),
    tasks: state.data.tasks.filter((item) => item.clientId === clientId),
    notes: state.data.notes.filter((item) => item.clientId === clientId),
    assets: clientAssets(clientId),
    questionnaire: state.data.questionnaires.find((item) => item.clientId === clientId) || null,
    onboarding: checklist
      ? {
          notes: checklist.notes || "",
          welcomeCallDate: checklist.welcomeCallDate || "",
          welcomeCallConfirmed: Boolean(checklist.welcomeCallConfirmed),
          welcomeCallProposedBy: checklist.welcomeCallProposedBy || "",
          welcomeCallHistory: safeHistoryJson(checklist.welcomeCallHistory),
          strategyMeetingDate: checklist.strategyMeetingDate || "",
          strategyMeetingConfirmed: Boolean(checklist.strategyMeetingConfirmed),
          strategyMeetingProposedBy: checklist.strategyMeetingProposedBy || "",
          meetingProposalHistory: safeHistoryJson(checklist.meetingProposalHistory),
          stages: ONBOARDING_STAGES.map((stage) => ({
            id: stage.id,
            title: stage.title,
            description: stage.description,
            steps: stage.steps.map(([key, label]) => ({
              key,
              label,
              done: Boolean(checklist[key]),
            })),
          })),
          steps: Object.fromEntries(ONBOARDING_STEPS.map(([key, label]) => [label, Boolean(checklist[key])])),
        }
      : null,
  };
}

function safeHistoryJson(value) {
  if (!value) return "[]";
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(Array.isArray(parsed) ? parsed : []);
  } catch {
    return "[]";
  }
}

function appendMeetingHistory(checklist, meetingType, entry) {
  const field = meetingType === "Welcome Call" ? "welcomeCallHistory" : "meetingProposalHistory";
  let history = [];
  try {
    history = JSON.parse(checklist[field] || "[]");
  } catch {
    history = [];
  }
  history.push({
    proposedBy: entry.proposedBy || "Agency",
    datetime: entry.datetime,
    notes: entry.notes || "",
    confirmed: Boolean(entry.confirmed),
    timestamp: new Date().toISOString(),
  });
  checklist[field] = JSON.stringify(history);
}

function confirmLatestMeetingHistory(checklist, meetingType) {
  const field = meetingType === "Welcome Call" ? "welcomeCallHistory" : "meetingProposalHistory";
  let history = [];
  try {
    history = JSON.parse(checklist[field] || "[]");
  } catch {
    history = [];
  }
  if (history.length) history[history.length - 1].confirmed = true;
  checklist[field] = JSON.stringify(history);
}

function syncWorkflowFlags(type, record) {
  if (!record.clientId) return;
  if (type === "questionnaire") {
    const checklist = ensureOnboarding(record.clientId);
    checklist.questionnaireCompleted = true;
  }
  if (type === "project") {
    const checklist = ensureOnboarding(record.clientId);
    checklist.firstProjectCreated = true;
  }
  if (type === "meeting") {
    const checklist = ensureOnboarding(record.clientId);
    if (record.type === "Welcome Call") {
      checklist.welcomeCallScheduled = record.status !== "Canceled";
      checklist.welcomeCallDate = record.datetime;
      checklist.welcomeCallProposedBy = record.proposedBy || "Agency";
      checklist.welcomeCallConfirmed = record.status === "Confirmed" || record.status === "Completed";
      appendMeetingHistory(checklist, record.type, {
        proposedBy: checklist.welcomeCallProposedBy,
        datetime: record.datetime,
        notes: record.notes,
        confirmed: checklist.welcomeCallConfirmed,
      });
    }
    if (record.type === "Strategy Meeting") {
      checklist.strategyMeetingDate = record.datetime;
      checklist.strategyMeetingProposedBy = record.proposedBy || "Agency";
      checklist.strategyMeetingConfirmed = record.status === "Confirmed" || record.status === "Completed";
      checklist.strategyMeetingHeld = record.status === "Completed";
      appendMeetingHistory(checklist, record.type, {
        proposedBy: checklist.strategyMeetingProposedBy,
        datetime: record.datetime,
        notes: record.notes,
        confirmed: checklist.strategyMeetingConfirmed,
      });
    }
  }
}

function ensureOnboarding(clientId) {
  let checklist = getOnboarding(clientId);
  if (!checklist) {
    checklist = normalizeRecord("onboarding", { clientId });
    state.data.onboarding.push(checklist);
  }
  return checklist;
}

async function deleteRecord(type, itemId) {
  const message =
    type === "client"
      ? "Delete this client and all related contacts, deals, tasks, notes, and assets?"
      : "Delete this record?";
  if (!confirm(message)) return;
  if (type === "client") {
    state.data.clients = state.data.clients.filter((item) => item.id !== itemId);
    state.data.contacts = state.data.contacts.filter((item) => item.clientId !== itemId);
    state.data.deals = state.data.deals.filter((item) => item.clientId !== itemId);
    state.data.projects = state.data.projects.filter((item) => item.clientId !== itemId);
    state.data.tasks = state.data.tasks.filter((item) => item.clientId !== itemId);
    state.data.onboarding = state.data.onboarding.filter((item) => item.clientId !== itemId);
    state.data.questionnaires = state.data.questionnaires.filter((item) => item.clientId !== itemId);
    state.data.meetings = state.data.meetings.filter((item) => item.clientId !== itemId);
    state.data.notes = state.data.notes.filter((item) => item.clientId !== itemId);
    state.data.clientAssets = state.data.clientAssets.filter((item) => item.clientId !== itemId);
  } else {
    const collections = {
      contact: "contacts",
      onboarding: "onboarding",
      questionnaire: "questionnaires",
      clientAsset: "clientAssets",
      project: "projects",
      meeting: "meetings",
      deal: "deals",
      task: "tasks",
      note: "notes",
    };
    state.data[collections[type]] = state.data[collections[type]].filter((item) => item.id !== itemId);
  }
  state.drawer = null;
  await saveData(`Deleted ${type}`);
  showToast("Record deleted.");
  render();
}

async function moveDeal(dealId, stage) {
  const deal = state.data.deals.find((item) => item.id === dealId);
  if (!deal) return;
  deal.stage = stage;
  await saveData("Moved deal");
  render();
}

async function toggleTask(taskId) {
  const task = state.data.tasks.find((item) => item.id === taskId);
  if (!task) return;
  task.done = !task.done;
  await saveData(task.done ? "Completed task" : "Reopened task");
  render();
}

async function toggleOnboardingStep(clientId, step, checked) {
  const checklist = ensureOnboarding(clientId);
  checklist[step] = checked;
  if (step === "questionnaireCompleted" && checked && !state.data.questionnaires.some((item) => item.clientId === clientId)) {
    state.data.questionnaires.push(normalizeRecord("questionnaire", { clientId }));
  }
  await saveData(`${checked ? "Completed" : "Reopened"} onboarding step`);
  render();
}

async function confirmMeeting(meetingId) {
  const meeting = state.data.meetings.find((item) => item.id === meetingId);
  if (!meeting) return;
  meeting.status = "Confirmed";
  syncWorkflowFlags("meeting", meeting);
  const checklist = getOnboarding(meeting.clientId);
  if (checklist && (meeting.type === "Welcome Call" || meeting.type === "Strategy Meeting")) {
    confirmLatestMeetingHistory(checklist, meeting.type);
  }
  await saveData("Confirmed meeting");
  render();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `clientvault-backup-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importBackup(event) {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!payload || !Array.isArray(payload.clients)) throw new Error("Invalid backup");
    state.data = hydrateData(payload);
    await saveData("Imported CRM backup");
    showToast("Backup imported.");
    render();
  } catch (error) {
    showToast(error.message || "Import failed. Choose a valid ClientVault JSON backup.");
  }
}

function toast() {
  return state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : "";
}
