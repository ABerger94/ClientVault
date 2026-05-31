"use strict";

const portalState = {
  portal: null,
  auth: null,
  tab: "home",
  error: "",
  notice: "",
  loading: false,
};

const portalApp = document.querySelector("#portal-app");

window.addEventListener("load", () => {
  const cached = sessionStorage.getItem("clientvault.portal");
  if (cached) portalState.portal = JSON.parse(cached);
  const cachedAuth = sessionStorage.getItem("clientvault.portal.auth");
  if (cachedAuth) portalState.auth = JSON.parse(cachedAuth);
  renderPortal();
});

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

function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function renderPortal() {
  portalApp.innerHTML = portalState.portal ? portalShell() : loginScreen();
  const form = portalApp.querySelector("form[data-login]");
  if (form) form.addEventListener("submit", login);
  portalApp.querySelectorAll("[data-portal-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      portalState.tab = button.dataset.portalTab;
      renderPortal();
    });
  });
  const logout = portalApp.querySelector("[data-logout]");
  if (logout) {
    logout.addEventListener("click", () => {
      sessionStorage.removeItem("clientvault.portal");
      sessionStorage.removeItem("clientvault.portal.auth");
      portalState.portal = null;
      portalState.auth = null;
      portalState.tab = "home";
      renderPortal();
    });
  }
  portalApp.querySelectorAll("form[data-action-form]").forEach((form) => {
    form.addEventListener("submit", form.dataset.actionForm === "asset_upload" ? submitPortalAssetUpload : submitPortalAction);
  });
  portalApp.querySelectorAll("[data-add-brand-color]").forEach((button) => {
    button.addEventListener("click", () => addBrandColorField(button));
  });
  portalApp.querySelectorAll("[data-confirm-meeting]").forEach((button) => {
    button.addEventListener("click", () => submitPortalAction(null, {
      type: "meeting_confirm",
      payload: {
        meetingId: button.dataset.confirmMeeting,
        meetingType: button.dataset.meetingType,
        datetime: button.dataset.datetime,
      },
    }));
  });
  portalApp.querySelectorAll("[data-complete-step]").forEach((button) => {
    button.addEventListener("click", () => submitPortalAction(null, {
      type: "onboarding_step",
      payload: { step: button.dataset.completeStep, done: true },
    }));
  });
  portalApp.querySelectorAll("[data-open-asset]").forEach((button) => {
    button.addEventListener("click", () => openAssetFile(button.dataset.openAsset));
  });
}

function loginScreen() {
  return `
    <section class="lock-screen">
      <form class="lock-card" data-login>
        <div class="brand-row">
          ${brandMark()}
          <div>
            <div class="eyebrow">Client portal</div>
            <h1>ClientVault Portal</h1>
          </div>
        </div>
        <p class="muted">Sign in with the email and access code your provider shared with you.</p>
        <div class="field">
          <label>Email</label>
          <input name="email" type="email" autocomplete="email" required autofocus />
        </div>
        <div class="field">
          <label>Access code</label>
          <input name="accessCode" type="password" autocomplete="current-password" minlength="8" required />
        </div>
        <button class="btn" type="submit">${portalState.loading ? "Signing in..." : "Sign In"}</button>
        ${portalState.error ? `<p class="secure-note danger-note space-top">${escapeHtml(portalState.error)}</p>` : ""}
      </form>
    </section>
  `;
}

async function login(event) {
  event.preventDefault();
  portalState.loading = true;
  portalState.error = "";
  renderPortal();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const response = await fetch("/api/portal-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not sign in.");
    portalState.portal = data.portal;
    portalState.auth = {
      email: values.email,
      accessCode: values.accessCode,
    };
    sessionStorage.setItem("clientvault.portal", JSON.stringify(data.portal));
    sessionStorage.setItem("clientvault.portal.auth", JSON.stringify(portalState.auth));
  } catch (error) {
    portalState.error = error.message;
  } finally {
    portalState.loading = false;
    renderPortal();
  }
}

async function submitPortalAction(event, directAction = null) {
  if (event) event.preventDefault();
  const form = event?.currentTarget;
  const type = directAction?.type || form.dataset.actionForm;
  const formData = form ? new FormData(form) : null;
  const payload = directAction?.payload || Object.fromEntries(formData.entries());
  if (type === "brand_update" && formData) {
    const labels = formData.getAll("brandExtraLabel");
    payload.brandColors = formData.getAll("brandExtraColor").map((color, index) => ({
      color,
      label: labels[index] || "Brand color",
    }));
  }
  portalState.notice = "";
  portalState.error = "";
  try {
    const response = await fetch("/api/portal-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...portalState.auth,
        type,
        payload,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    portalState.notice = data.applied ? "Saved." : "Sent. Your provider will see this automatically.";
    if (type === "brand_update") {
      Object.assign(portalState.portal.client, payload);
      sessionStorage.setItem("clientvault.portal", JSON.stringify(portalState.portal));
    }
    if (form) form.reset();
  } catch (error) {
    portalState.error = error.message;
  } finally {
    renderPortal();
  }
}

function portalShell() {
  const { client } = portalState.portal;
  return `
    <section class="portal-public">
      <header class="portal-hero public-portal-hero" style="${portalBrandStyle(client)}">
        <div class="brand-row">
          ${brandMark()}
          <div>
            <div class="eyebrow">Client workspace</div>
            <h1>${escapeHtml(client.company || client.name)}</h1>
            <p>${escapeHtml(client.nextStep || "Project status, onboarding, meetings, and shared deliverables.")}</p>
          </div>
        </div>
        <button class="btn secondary" data-logout>Sign Out</button>
      </header>
      <nav class="portal-tabs">
        ${tabButton("home", "Home")}
        ${tabButton("projects", "Projects")}
        ${tabButton("onboarding", "Onboarding")}
        ${tabButton("schedule", "Schedule")}
        ${tabButton("questionnaire", "Questionnaire")}
        ${tabButton("support", "Support")}
        ${tabButton("files", "Files")}
      </nav>
      ${portalState.notice ? `<p class="secure-note">${escapeHtml(portalState.notice)}</p>` : ""}
      ${portalState.error ? `<p class="secure-note danger-note">${escapeHtml(portalState.error)}</p>` : ""}
      <div class="portal-body">${currentTab()}</div>
    </section>
  `;
}

function tabButton(tab, label) {
  return `<button class="${portalState.tab === tab ? "active" : ""}" data-portal-tab="${tab}">${label}</button>`;
}

function portalBrandStyle(client) {
  const primary = colorValue(client.brandPrimary);
  const secondary = colorValue(client.brandSecondary);
  if (!primary && !secondary) return "";
  return `background:linear-gradient(135deg, ${primary || "#101820"}, ${secondary || "#101820"});`;
}

function currentTab() {
  if (portalState.tab === "projects") return projectsView();
  if (portalState.tab === "onboarding") return onboardingView();
  if (portalState.tab === "schedule") return scheduleView();
  if (portalState.tab === "questionnaire") return questionnaireView();
  if (portalState.tab === "support") return supportView();
  if (portalState.tab === "files") return filesView();
  return homeView();
}

function homeView() {
  const portal = portalState.portal;
  const activeProjects = portal.projects.filter((project) => !["Delivered", "Approved"].includes(project.status));
  const nextMeeting = portal.meetings.find((meeting) => meeting.status !== "Canceled");
  return `
    <div class="portal-grid">
      ${metric("Active projects", activeProjects.length)}
      ${metric("Open support", portal.tasks.filter((task) => !task.done).length)}
      ${metric("Next meeting", nextMeeting ? formatDateTime(nextMeeting.datetime) : "None")}
    </div>
    <div class="layout-two">
      <section class="panel"><div class="panel-head"><h2>Project Snapshot</h2></div><div class="panel-body">${projectCards(portal.projects.slice(0, 3))}</div></section>
      <section class="panel"><div class="panel-head"><h2>Next Steps</h2></div><div class="panel-body">${nextSteps()}</div></section>
    </div>
    <section class="panel space-top">
      <div class="panel-head"><h2>Brand Profile</h2></div>
      <div class="panel-body">${brandProfileForm()}</div>
    </section>
  `;
}

function brandProfileForm() {
  const client = portalState.portal.client;
  return `
    <form data-action-form="brand_update" class="form-grid">
      ${brandColorRow("brandPrimary", "brandPrimaryLabel", client.brandPrimary || "#116466", client.brandPrimaryLabel || "Primary")}
      ${brandColorRow("brandSecondary", "brandSecondaryLabel", client.brandSecondary || "#101820", client.brandSecondaryLabel || "Secondary")}
      ${brandColorRow("brandAccent", "brandAccentLabel", client.brandAccent || "#a54f2a", client.brandAccentLabel || "Accent")}
      ${brandColorRow("brandNeutral", "brandNeutralLabel", client.brandNeutral || "#f5f7f9", client.brandNeutralLabel || "Neutral")}
      <div class="span-2 brand-extra-list" data-brand-extra-list>${brandExtraRows(client.brandColors || [])}</div>
      <button class="btn secondary span-2" type="button" data-add-brand-color>Add Color</button>
      <button class="btn span-2" type="submit">Send Brand Updates</button>
    </form>
  `;
}

function brandColorRow(colorName, labelName, color, label) {
  return `<div class="brand-color-row span-2">${field(colorName, "Color", color, "color")}${field(labelName, "Label", label)}</div>`;
}

function brandExtraRows(colors) {
  return colors.map((entry) => brandExtraRow(entry)).join("");
}

function brandExtraRow(entry = {}) {
  return `<div class="brand-extra-row">${field("brandExtraColor", "Color", colorValue(entry.color, "#116466"), "color")}${field("brandExtraLabel", "Label", entry.label || "")}</div>`;
}

function addBrandColorField(button) {
  const list = button.closest("form")?.querySelector("[data-brand-extra-list]");
  if (!list) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = brandExtraRow({ label: "Brand color", color: "#116466" }).trim();
  list.append(wrapper.firstElementChild);
}

function field(name, label, value = "", type = "text") {
  return `<div class="field"><label>${escapeHtml(label)}</label><input name="${name}" type="${type}" value="${escapeHtml(value)}" /></div>`;
}

function metric(label, value) {
  return `<div class="portal-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function nextSteps() {
  const items = portalState.portal.tasks.filter((task) => !task.done).slice(0, 5).map((task) => task.title);
  const checklist = portalState.portal.onboarding;
  if (checklist) {
    Object.entries(checklist.steps || {}).forEach(([label, done]) => {
      if (!done && items.length < 6) items.push(label);
    });
  }
  if (!items.length) return `<div class="empty">No open next steps.</div>`;
  return items.map((item) => `<article class="event-row"><strong>${escapeHtml(item)}</strong><span class="pill">Open</span></article>`).join("");
}

function projectsView() {
  return projectCards(portalState.portal.projects);
}

function projectCards(projects) {
  if (!projects.length) return `<div class="empty">No projects yet.</div>`;
  return projects.map((project) => `
    <article class="project-card">
      <div>
        <div class="row-title">${escapeHtml(project.name)}</div>
        <div class="row-sub">Due ${escapeHtml(project.dueDate || "unscheduled")}</div>
      </div>
      <span class="pill ${project.status === "Delivered" ? "active" : project.status === "Review" ? "hot" : ""}">${escapeHtml(project.status || "Not Started")}</span>
      ${project.description ? `<p>${escapeHtml(project.description)}</p>` : ""}
      ${project.scope ? `<p class="row-sub">${escapeHtml(project.scope)}</p>` : ""}
      ${project.roadmap ? `<pre class="roadmap">${escapeHtml(project.roadmap)}</pre>` : ""}
      ${project.feedback ? `<p class="secure-note">Feedback: ${escapeHtml(project.feedback)}</p>` : ""}
      ${project.deliverableUrl ? `<a class="btn secondary" href="${escapeHtml(project.deliverableUrl)}" target="_blank" rel="noreferrer">Open Deliverable</a>` : ""}
    </article>
  `).join("");
}

function onboardingView() {
  const checklist = portalState.portal.onboarding;
  if (!checklist) return `<div class="empty">No onboarding checklist has been shared yet.</div>`;
  const stages = checklist.stages || [];
  const allSteps = stages.flatMap((stage) => stage.steps || []);
  const complete = allSteps.filter((step) => step.done).length;
  const percent = allSteps.length ? Math.round((complete / allSteps.length) * 100) : 0;
  return `
    <section class="panel">
      <div class="panel-head"><h2>Onboarding Progress</h2><span class="pill active">${percent}%</span></div>
      <div class="panel-body">
        <div class="progress"><span style="width:${percent}%"></span></div>
        ${portalMeetingNotice(checklist, "welcome")}
        ${portalMeetingNotice(checklist, "strategy")}
        ${stages.map((stage) => `
          <div class="onboarding-stage">
            <div class="onboarding-stage-head">
              <div>
                <strong>${escapeHtml(stage.title)}</strong>
                <p class="row-sub">${escapeHtml(stage.description)}</p>
              </div>
              <span class="pill">${(stage.steps || []).filter((step) => step.done).length}/${(stage.steps || []).length}</span>
            </div>
            <div class="checklist">
              ${(stage.steps || []).map((step) => `
                <div class="check-row">
                  <input type="checkbox" disabled ${step.done ? "checked" : ""} />
                  <span>${escapeHtml(step.label)}</span>
                  ${!step.done ? `<button class="btn secondary mini-btn" data-complete-step="${escapeHtml(step.key)}">Mark Done</button>` : ""}
                </div>
              `).join("")}
            </div>
          </div>
        `).join("")}
        ${checklist.notes ? `<p class="secure-note">${escapeHtml(checklist.notes)}</p>` : ""}
      </div>
    </section>
  `;
}

function portalMeetingNotice(checklist, meetingType) {
  const config = meetingType === "welcome"
    ? {
        label: "Welcome call",
        date: checklist.welcomeCallDate,
        confirmed: checklist.welcomeCallConfirmed,
        proposedBy: checklist.welcomeCallProposedBy,
      }
    : {
        label: "Strategy meeting",
        date: checklist.strategyMeetingDate,
        confirmed: checklist.strategyMeetingConfirmed,
        proposedBy: checklist.strategyMeetingProposedBy,
      };
  if (!config.date) return "";
  const status = config.confirmed
    ? "confirmed"
    : config.proposedBy === "Client"
      ? "pending agency confirmation"
      : "awaiting your confirmation";
  return `<p class="secure-note">${escapeHtml(config.label)}: ${formatDateTime(config.date)} · ${escapeHtml(status)}</p>`;
}

function scheduleView() {
  const meetings = portalState.portal.meetings;
  return `
    <section class="panel">
      <div class="panel-head"><h2>Request Meeting</h2></div>
      <div class="panel-body">
        <form data-action-form="meeting_request" class="form-grid">
          <div class="field">
            <label>Meeting type</label>
            <select name="meetingType" required>
              <option>Welcome Call</option>
              <option>Strategy Meeting</option>
              <option>Check-in</option>
              <option>Review</option>
            </select>
          </div>
          <div class="field">
            <label>Date and time</label>
            <input name="datetime" type="datetime-local" required />
          </div>
          <div class="field span-2">
            <label>Notes</label>
            <textarea name="notes" placeholder="Topics, questions, or preferred meeting format"></textarea>
          </div>
          <button class="btn span-2" type="submit">Send Meeting Request</button>
        </form>
      </div>
    </section>
    ${meetings.length ? meetings.map((meeting) => `
    <article class="task-card">
      <strong>${escapeHtml(meeting.title || meeting.type)}</strong>
      <span class="row-sub">${formatDateTime(meeting.datetime)}</span>
      <span class="pill ${meeting.status === "Confirmed" ? "active" : meeting.status === "Canceled" ? "risk" : ""}">${escapeHtml(meeting.status || "Proposed")}</span>
      ${meeting.notes ? `<p class="row-sub">${escapeHtml(meeting.notes)}</p>` : ""}
      ${meeting.status !== "Confirmed" && meeting.status !== "Canceled" ? `<button class="btn secondary" data-confirm-meeting="${meeting.id}" data-meeting-type="${escapeHtml(meeting.type)}" data-datetime="${escapeHtml(meeting.datetime)}">Confirm This Time</button>` : ""}
    </article>
  `).join("") : `<div class="empty">No meetings scheduled.</div>`}
  `;
}

function questionnaireView() {
  const questionnaire = portalState.portal.questionnaire;
  return `
    <section class="panel">
      <div class="panel-head"><h2>Questionnaire</h2></div>
      <div class="panel-body qa-grid">
        ${questionnaire ? `
          ${qa("Primary goal", questionnaire.primaryGoal)}
          ${qa("Timeline", questionnaire.timeline)}
          ${qa("Budget", questionnaire.budgetRange ? money(questionnaire.budgetRange) : "")}
          ${qa("Design style", questionnaire.designStyle)}
          ${qa("Target audience", questionnaire.targetAudience)}
          ${qa("Services", questionnaire.mainServices)}
          ${qa("Unique value", questionnaire.uniqueValue)}
          ${qa("Additional notes", questionnaire.additionalNotes)}
        ` : `<div class="empty span-2">No questionnaire has been shared yet.</div>`}
        <form data-action-form="questionnaire_update" class="form-grid span-2">
          <div class="field">
            <label>Primary goal</label>
            <select name="primaryGoal">
              <option>Get more leads</option>
              <option>Increase online sales</option>
              <option>Build brand awareness</option>
              <option>Improve online reputation</option>
              <option>Other</option>
            </select>
          </div>
          <div class="field">
            <label>Timeline</label>
            <select name="timeline">
              <option>ASAP</option>
              <option>Within 1 month</option>
              <option>1-3 months</option>
              <option>3-6 months</option>
              <option>Flexible</option>
            </select>
          </div>
          <div class="field">
            <label>Budget</label>
            <input name="budgetRange" type="number" value="${escapeHtml(questionnaire?.budgetRange || "")}" />
          </div>
          <div class="field">
            <label>Design style</label>
            <input name="designStyle" value="${escapeHtml(questionnaire?.designStyle || "")}" />
          </div>
          <div class="field span-2"><label>Target audience</label><textarea name="targetAudience">${escapeHtml(questionnaire?.targetAudience || "")}</textarea></div>
          <div class="field span-2"><label>Services</label><textarea name="mainServices">${escapeHtml(questionnaire?.mainServices || "")}</textarea></div>
          <div class="field span-2"><label>Unique value</label><textarea name="uniqueValue">${escapeHtml(questionnaire?.uniqueValue || "")}</textarea></div>
          <div class="field span-2"><label>Additional notes</label><textarea name="additionalNotes">${escapeHtml(questionnaire?.additionalNotes || "")}</textarea></div>
          <button class="btn span-2" type="submit">Submit Questionnaire Update</button>
        </form>
      </div>
    </section>
  `;
}

function qa(label, value) {
  return `<div class="qa"><span class="row-sub">${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not provided")}</strong></div>`;
}

function supportView() {
  const tasks = portalState.portal.tasks;
  return `
    <section class="panel">
      <div class="panel-head"><h2>New Support Request</h2></div>
      <div class="panel-body">
        <form data-action-form="support_request" class="form-grid">
          <div class="field span-2">
            <label>Request</label>
            <input name="title" required placeholder="What do you need help with?" />
          </div>
          <div class="field">
            <label>Priority</label>
            <select name="priority"><option>Normal</option><option>High</option><option>Low</option></select>
          </div>
          <div class="field">
            <label>Due date</label>
            <input name="dueDate" type="date" />
          </div>
          <button class="btn span-2" type="submit">Send Support Request</button>
        </form>
      </div>
    </section>
    ${tasks.length ? tasks.map((task) => `
    <article class="task-card">
      <strong>${escapeHtml(task.title)}</strong>
      <span class="row-sub">Due ${escapeHtml(task.dueDate || "none")}</span>
      <span class="pill ${task.done ? "active" : task.priority === "High" ? "hot" : ""}">${task.done ? "Complete" : escapeHtml(task.priority || "Normal")}</span>
    </article>
  `).join("") : `<div class="empty">No support requests.</div>`}
  `;
}

function filesView() {
  const assets = portalState.portal.assets || [];
  const projects = portalState.portal.projects.filter((project) => project.deliverableUrl);
  return `
    <section class="panel">
      <div class="panel-head"><h2>Upload Asset</h2></div>
      <div class="panel-body">
        <form data-action-form="asset_upload" class="form-grid" novalidate>
          <div class="field">
            <label>Asset label</label>
            <input name="assetLabel" value="Reference" />
          </div>
          <div class="field">
            <label>Category</label>
            <select name="category">
              <option>Logo</option>
              <option>Brand Guide</option>
              <option>Palette</option>
              <option>Image</option>
              <option>Copy</option>
              <option>Contract</option>
              <option>Deliverable</option>
              <option selected>Reference</option>
              <option>Other</option>
            </select>
          </div>
          <div class="field span-2"><label>File</label><input name="assetFile" type="file" /></div>
          <div class="field span-2"><label>Display name</label><input name="displayName" /></div>
          <div class="field span-2"><label>Notes</label><textarea name="notes"></textarea></div>
          <button class="btn span-2" type="submit">Upload Asset</button>
        </form>
      </div>
    </section>
    ${!projects.length && !assets.length ? `<div class="empty">No deliverables, shared links, or files yet.</div>` : ""}
    ${assets.map((asset) => `
      <article class="asset-card">
        ${assetPreview(asset)}
        <div>
          <strong>${escapeHtml(assetTitle(asset))}</strong>
          <div class="row-sub">${escapeHtml(assetLabel(asset))} · ${formatBytes(asset.size)}</div>
          ${asset.notes ? `<p class="row-sub">${escapeHtml(asset.notes)}</p>` : ""}
        </div>
        ${assetOpenable(asset) ? `<button class="btn secondary" data-open-asset="${asset.id}">Open</button>` : ""}
      </article>
    `).join("")}
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

async function submitPortalAssetUpload(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.querySelector("input[type='file']").files[0];
  if (!file) {
    portalState.error = "Choose a file to upload.";
    renderPortal();
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    portalState.error = "File must be 15 MB or smaller.";
    renderPortal();
    return;
  }
  const formData = new FormData(form);
  formData.set("email", portalState.auth.email);
  formData.set("accessCode", portalState.auth.accessCode);
  formData.set("file", file, file.name);
  portalState.notice = "Uploading asset...";
  portalState.error = "";
  renderPortal();
  try {
    const response = await fetch("/api/portal-asset-upload", { method: "POST", body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Upload failed.");
    portalState.portal.assets = [...(portalState.portal.assets || []), data.asset];
    sessionStorage.setItem("clientvault.portal", JSON.stringify(portalState.portal));
    portalState.notice = "Asset uploaded.";
  } catch (error) {
    portalState.error = error.message || "Upload failed.";
  } finally {
    renderPortal();
  }
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
  return Boolean(asset.pathname || asset.url || asset.downloadUrl || asset.dataUrl);
}

function assetPreviewUrl(asset) {
  if (asset.pathname) return "";
  return asset.url || asset.downloadUrl || asset.dataUrl || "";
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!size) return "unknown size";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function openAssetFile(assetId) {
  const asset = (portalState.portal.assets || []).find((item) => item.id === assetId);
  if (!assetOpenable(asset)) {
    portalState.error = "This file is not available.";
    renderPortal();
    return;
  }
  try {
    if (asset.pathname) {
      const opened = window.open("about:blank", "_blank");
      const url = await fetchPortalAssetUrl(asset);
      if (opened) {
        opened.opener = null;
        opened.location.href = url;
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
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
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
    portalState.error = error.message || "Could not open this file.";
    renderPortal();
  }
}

async function fetchPortalAssetUrl(asset) {
  const response = await fetch("/api/asset-file", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: portalState.auth.email,
      accessCode: portalState.auth.accessCode,
      pathname: asset.pathname,
      filename: asset.originalName || asset.name || asset.displayName || "",
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Could not open this file.");
  }
  return URL.createObjectURL(await response.blob());
}

function createAssetObjectUrl(asset) {
  const [header, encoded] = String(asset.dataUrl || "").split(",");
  const mime = header.match(/^data:([^;]+);base64$/)?.[1] || asset.type || "application/octet-stream";
  if (!encoded) throw new Error("This file is not readable.");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

function formatDateTime(value) {
  if (!value) return "unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return value.includes("T")
    ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}
