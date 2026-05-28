"use strict";

const portalState = {
  portal: null,
  tab: "home",
  error: "",
  loading: false,
};

const portalApp = document.querySelector("#portal-app");

window.addEventListener("load", () => {
  const cached = sessionStorage.getItem("clientvault.portal");
  if (cached) portalState.portal = JSON.parse(cached);
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
      portalState.portal = null;
      portalState.tab = "home";
      renderPortal();
    });
  }
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
    sessionStorage.setItem("clientvault.portal", JSON.stringify(data.portal));
  } catch (error) {
    portalState.error = error.message;
  } finally {
    portalState.loading = false;
    renderPortal();
  }
}

function portalShell() {
  const { client } = portalState.portal;
  return `
    <section class="portal-public">
      <header class="portal-hero public-portal-hero">
        <div>
          <div class="eyebrow">Client workspace</div>
          <h1>${escapeHtml(client.company || client.name)}</h1>
          <p>${escapeHtml(client.nextStep || "Project status, onboarding, meetings, and shared deliverables.")}</p>
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
      <div class="portal-body">${currentTab()}</div>
    </section>
  `;
}

function tabButton(tab, label) {
  return `<button class="${portalState.tab === tab ? "active" : ""}" data-portal-tab="${tab}">${label}</button>`;
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
  `;
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
              ${(stage.steps || []).map((step) => `<div class="check-row"><input type="checkbox" disabled ${step.done ? "checked" : ""} /><span>${escapeHtml(step.label)}</span></div>`).join("")}
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
  if (!meetings.length) return `<div class="empty">No meetings scheduled.</div>`;
  return meetings.map((meeting) => `
    <article class="task-card">
      <strong>${escapeHtml(meeting.title || meeting.type)}</strong>
      <span class="row-sub">${formatDateTime(meeting.datetime)}</span>
      <span class="pill ${meeting.status === "Confirmed" ? "active" : meeting.status === "Canceled" ? "risk" : ""}">${escapeHtml(meeting.status || "Proposed")}</span>
      ${meeting.notes ? `<p class="row-sub">${escapeHtml(meeting.notes)}</p>` : ""}
    </article>
  `).join("");
}

function questionnaireView() {
  const questionnaire = portalState.portal.questionnaire;
  if (!questionnaire) return `<div class="empty">No questionnaire has been shared yet.</div>`;
  return `
    <section class="panel">
      <div class="panel-head"><h2>Questionnaire</h2></div>
      <div class="panel-body qa-grid">
        ${qa("Primary goal", questionnaire.primaryGoal)}
        ${qa("Timeline", questionnaire.timeline)}
        ${qa("Budget", questionnaire.budgetRange ? money(questionnaire.budgetRange) : "")}
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

function supportView() {
  const tasks = portalState.portal.tasks;
  if (!tasks.length) return `<div class="empty">No support requests.</div>`;
  return tasks.map((task) => `
    <article class="task-card">
      <strong>${escapeHtml(task.title)}</strong>
      <span class="row-sub">Due ${escapeHtml(task.dueDate || "none")}</span>
      <span class="pill ${task.done ? "active" : task.priority === "High" ? "hot" : ""}">${task.done ? "Complete" : escapeHtml(task.priority || "Normal")}</span>
    </article>
  `).join("");
}

function filesView() {
  const projects = portalState.portal.projects.filter((project) => project.deliverableUrl);
  if (!projects.length) return `<div class="empty">No deliverables or shared links yet.</div>`;
  return projects.map((project) => `
    <article class="event-row">
      <div>
        <strong>${escapeHtml(project.name)}</strong>
        <div class="row-sub">${escapeHtml(project.deliverableUrl)}</div>
      </div>
      <a class="btn secondary" href="${escapeHtml(project.deliverableUrl)}" target="_blank" rel="noreferrer">Open</a>
    </article>
  `).join("");
}

function formatDateTime(value) {
  if (!value) return "unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return value.includes("T")
    ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}
