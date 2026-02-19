/* ──────────────────────────────────
   i18n Engine
────────────────────────────────── */
/* __I18N_EN__ */
let _i18nCurrentLang = "en";
let _i18nStrings = {};
const _i18nCache = {};

const LANGUAGES = [
  {
    code: "ar",
    flag: "\uD83C\uDDF8\uD83C\uDDE6",
    native: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629",
    english: "Arabic",
  },
  { code: "zh", flag: "\uD83C\uDDE8\uD83C\uDDF3", native: "\u4E2D\u6587", english: "Chinese" },
  { code: "en", flag: "\uD83C\uDDFA\uD83C\uDDF8", native: "English", english: "English" },
  { code: "fr", flag: "\uD83C\uDDEB\uD83C\uDDF7", native: "Fran\u00E7ais", english: "French" },
  { code: "de", flag: "\uD83C\uDDE9\uD83C\uDDEA", native: "Deutsch", english: "German" },
  {
    code: "hi",
    flag: "\uD83C\uDDEE\uD83C\uDDF3",
    native: "\u0939\u093F\u0928\u094D\u0926\u0940",
    english: "Hindi",
  },
  { code: "it", flag: "\uD83C\uDDEE\uD83C\uDDF9", native: "Italiano", english: "Italian" },
  {
    code: "ja",
    flag: "\uD83C\uDDEF\uD83C\uDDF5",
    native: "\u65E5\u672C\u8A9E",
    english: "Japanese",
  },
  { code: "ko", flag: "\uD83C\uDDF0\uD83C\uDDF7", native: "\uD55C\uAD6D\uC5B4", english: "Korean" },
  { code: "pl", flag: "\uD83C\uDDF5\uD83C\uDDF1", native: "Polski", english: "Polish" },
  { code: "pt", flag: "\uD83C\uDDE7\uD83C\uDDF7", native: "Portugu\u00EAs", english: "Portuguese" },
  {
    code: "ru",
    flag: "\uD83C\uDDF7\uD83C\uDDFA",
    native: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",
    english: "Russian",
  },
  { code: "es", flag: "\uD83C\uDDEA\uD83C\uDDF8", native: "Espa\u00F1ol", english: "Spanish" },
  { code: "tr", flag: "\uD83C\uDDF9\uD83C\uDDF7", native: "T\u00FCrk\u00E7e", english: "Turkish" },
  {
    code: "uk",
    flag: "\uD83C\uDDFA\uD83C\uDDE6",
    native: "\u0423\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u0430",
    english: "Ukrainian",
  },
];

function t(key, vars) {
  let str = _i18nStrings[key] || _i18nEnStrings?.[key] || key;
  if (vars) {
    for (const k in vars) {
      if (Object.hasOwn(vars, k)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
      }
    }
  }
  return str;
}

function applyTranslations() {
  const els = document.querySelectorAll("[data-i18n]");
  for (let i = 0; i < els.length; i++) {
    const key = els[i].getAttribute("data-i18n");
    els[i].textContent = t(key);
  }

  const htmlEls = document.querySelectorAll("[data-i18n-html]");
  for (let j = 0; j < htmlEls.length; j++) {
    const htmlKey = htmlEls[j].getAttribute("data-i18n-html");
    htmlEls[j].innerHTML = t(htmlKey);
  }

  const phEls = document.querySelectorAll("[data-i18n-placeholder]");
  for (let k = 0; k < phEls.length; k++) {
    const phKey = phEls[k].getAttribute("data-i18n-placeholder");
    phEls[k].placeholder = t(phKey);
  }

  document.documentElement.lang = _i18nCurrentLang;
  document.documentElement.dir = _i18nCurrentLang === "ar" ? "rtl" : "ltr";
  document.title = t("header.title");
}

function loadLanguage(code, callback) {
  if (code === "en") {
    _i18nStrings = _i18nEnStrings || {};
    _i18nCurrentLang = "en";
    if (callback) callback();
    return;
  }

  if (_i18nCache[code]) {
    _i18nStrings = _i18nCache[code];
    _i18nCurrentLang = code;
    if (callback) callback();
    return;
  }

  fetch(`/api/lang/${code}`)
    .then((r) => {
      if (!r.ok) throw new Error("Language not found");
      return r.json();
    })
    .then((data) => {
      _i18nCache[code] = data;
      _i18nStrings = data;
      _i18nCurrentLang = code;
      if (callback) callback();
    })
    .catch(() => {
      _i18nStrings = _i18nEnStrings || {};
      _i18nCurrentLang = "en";
      if (callback) callback();
    });
}

function switchLanguage(code) {
  loadLanguage(code, () => {
    applyTranslations();
    updateLangDropdown(code);
    localStorage.setItem("justdobot-setup-lang", code);
  });
}

function toggleLangDropdown() {
  document.getElementById("lang-switcher").classList.toggle("open");
}

function buildLangDropdown() {
  let html = "";
  for (let i = 0; i < LANGUAGES.length; i++) {
    const lang = LANGUAGES[i];
    const activeClass = lang.code === _i18nCurrentLang ? " active" : "";
    html +=
      '<div class="lang-option' +
      activeClass +
      '" onclick="switchLanguage(\'' +
      lang.code +
      "')\">";
    html += `<span class="lang-option-flag">${lang.flag}</span>`;
    html += '<div class="lang-option-labels">';
    html += `<span class="lang-option-native">${lang.native}</span>`;
    html += `<span class="lang-option-english">${lang.english}</span>`;
    html += "</div></div>";
  }
  document.getElementById("lang-dropdown").innerHTML = html;
}

function updateLangDropdown(code) {
  let lang = null;
  for (let i = 0; i < LANGUAGES.length; i++) {
    if (LANGUAGES[i].code === code) {
      lang = LANGUAGES[i];
      break;
    }
  }
  if (!lang) return;

  document.getElementById("lang-current-flag").textContent = lang.flag;
  document.getElementById("lang-current-name").textContent = lang.native;
  document.getElementById("lang-switcher").classList.remove("open");
  buildLangDropdown();
}

/* ──────────────────────────────────
   State
────────────────────────────────── */
let currentStep = 1;
const totalSteps = 6;
let _tokenVerified = false;
let _tokenExistsOnServer = false;
let _maskedToken = "";
let _openaiKeyExistsOnServer = false;
let _maskedOpenaiKey = "";
let _claudeAuthDetected = false;
let _googlePollId = null;
let _googleConnected = false;
let verifiedBotUsername = "";

const state = {
  token: "",
  userId: "",
  language: "en",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  model: "claude-sonnet-4-6",
  embeddingsEnabled: false,
  openaiKey: "",
  vaultEnabled: false,
  vaultPath: "",
  proactiveEnabled: false,
  proactiveInterval: 5,
  proactiveCooldown: 15,
  reminderCooldown: 180,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  googleEnabled: false,
  googleClientId: "",
  googleClientSecret: "",
  voiceSttEnabled: false,
  geminiApiKey: "",
  voiceTtsEnabled: false,
  voiceTtsType: "elevenlabs",
  elevenlabsApiKey: "",
  elevenlabsVoiceId: "",
  voiceAutoReply: true,
  codeAgentEnabled: false,
  codeAgentModel: "sonnet",
  codeAgentMaxTurns: 50,
  codeAgentTimeout: 10,
};

/* ──────────────────────────────────
   Initialization
────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  /* i18n init */
  buildLangDropdown();
  const savedLang = localStorage.getItem("justdobot-setup-lang") || "en";
  loadLanguage(savedLang, () => {
    applyTranslations();
    updateLangDropdown(_i18nCurrentLang);
  });

  /* Close lang dropdown on outside click */
  document.addEventListener("click", (e) => {
    const switcher = document.getElementById("lang-switcher");
    if (!switcher.contains(e.target)) {
      switcher.classList.remove("open");
    }
  });

  bindInputListeners();
  loadStatus();
});

function bindInputListeners() {
  const tokenInput = document.getElementById("token");
  const userIdInput = document.getElementById("user-id");

  tokenInput.addEventListener("input", function () {
    state.token = this.value.trim();
    _tokenVerified = false;
    verifiedBotUsername = "";
    clearFieldState("token");
    document.getElementById("btn-verify").disabled = this.value.trim().length === 0;
    validateStep1();
  });

  userIdInput.addEventListener("input", function () {
    state.userId = this.value.trim();
    clearFieldState("user-id");
    validateStep1();
  });

  document.getElementById("language").addEventListener("change", function () {
    state.language = this.value;
  });

  document.getElementById("openai-key").addEventListener("input", function () {
    state.openaiKey = this.value.trim();
  });

  document.getElementById("vault-path").addEventListener("input", function () {
    state.vaultPath = this.value.trim();
  });

  document.getElementById("proactive-interval").addEventListener("input", function () {
    state.proactiveInterval = parseInt(this.value, 10) || 5;
  });

  document.getElementById("proactive-cooldown").addEventListener("input", function () {
    state.proactiveCooldown = parseInt(this.value, 10) || 15;
  });

  document.getElementById("proactive-reminder-cooldown").addEventListener("input", function () {
    state.reminderCooldown = parseInt(this.value, 10) || 180;
  });

  document.getElementById("quiet-start").addEventListener("input", function () {
    state.quietHoursStart = this.value || "22:00";
  });

  document.getElementById("quiet-end").addEventListener("input", function () {
    state.quietHoursEnd = this.value || "08:00";
  });

  document.getElementById("google-client-id").addEventListener("input", function () {
    state.googleClientId = this.value.trim();
  });

  document.getElementById("google-client-secret").addEventListener("input", function () {
    state.googleClientSecret = this.value.trim();
  });

  document.getElementById("code-agent-model").addEventListener("change", function () {
    state.codeAgentModel = this.value;
  });

  document.getElementById("code-agent-turns").addEventListener("input", function () {
    state.codeAgentMaxTurns = parseInt(this.value, 10) || 50;
  });

  document.getElementById("code-agent-timeout").addEventListener("input", function () {
    state.codeAgentTimeout = parseInt(this.value, 10) || 10;
  });
}

function validateStep1() {
  const tokenOk = state.token.length > 0 || (_tokenExistsOnServer && state.token.length === 0);
  const valid = tokenOk && state.userId.length > 0 && _claudeAuthDetected;
  document.getElementById("btn-next-1").disabled = !valid;
}

/* ──────────────────────────────────
   Claude Auth Status (Step 1)
────────────────────────────────── */
function updateClaudeAuthStatus() {
  var el = document.getElementById("claude-auth-status");
  var textEl = document.getElementById("claude-auth-text");
  var helpLink = document.getElementById("claude-auth-help");

  el.style.display = "flex";

  if (_claudeAuthDetected) {
    el.className = "claude-auth-status claude-auth-ok";
    textEl.textContent = t("claudeAuth.detected");
    helpLink.style.display = "none";
  } else {
    el.className = "claude-auth-status claude-auth-missing";
    textEl.textContent = t("claudeAuth.missing");
    helpLink.style.display = "inline";
  }
}

function showClaudeAuthHelp(event) {
  event.preventDefault();
  document.getElementById("claude-auth-modal").classList.add("visible");
}

function closeClaudeAuthHelp() {
  document.getElementById("claude-auth-modal").classList.remove("visible");
}

function recheckClaudeAuth() {
  var btn = document.getElementById("btn-recheck-claude");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${t("claudeAuth.checking")}`;

  fetch("/api/status")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      _claudeAuthDetected = data.existingState?.claudeAuthDetected || false;
      updateClaudeAuthStatus();
      validateStep1();
      btn.disabled = false;
      btn.textContent = t("claudeAuth.recheck");
      if (_claudeAuthDetected) {
        showToast(t("claudeAuth.nowDetected"), "success");
        closeClaudeAuthHelp();
      } else {
        showToast(t("claudeAuth.stillMissing"), "error");
      }
    })
    .catch(() => {
      btn.disabled = false;
      btn.textContent = t("claudeAuth.recheck");
    });
}

/* ──────────────────────────────────
   API: Status
────────────────────────────────── */
function loadStatus() {
  fetch("/api/status")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      if (data.existingState) {
        populateFromState(data.existingState);
      }
    })
    .catch(() => {
      /* Setup server not running or error — user fills manually */
    });
}

function populateFromState(s) {
  // Token: masked — show as placeholder, don't store as real value
  if (s.tokenSet) {
    _tokenExistsOnServer = true;
    _maskedToken = s.token;
    const tokenInput = document.getElementById("token");
    tokenInput.placeholder = t("status.alreadyConfigured", { value: s.token });
    // Don't set state.token — user must re-enter to change
  }
  if (s.userId) {
    document.getElementById("user-id").value = s.userId;
    state.userId = s.userId;
  }
  if (s.language) {
    document.getElementById("language").value = s.language;
    state.language = s.language;
  }
  // timezone: always use Intl detect from line 188 (user's TZ may change)
  if (s.model) {
    state.model = s.model;
    const cards = document.querySelectorAll(".model-card");
    for (let i = 0; i < cards.length; i++) {
      cards[i].classList.toggle("selected", cards[i].getAttribute("data-model") === s.model);
    }
  }
  if (s.embeddingsEnabled) {
    document.getElementById("toggle-embeddings").checked = true;
    toggleSection("embeddings");
    state.embeddingsEnabled = true;
  }
  // OpenAI key: masked — show as placeholder
  if (s.openaiKeySet) {
    _openaiKeyExistsOnServer = true;
    _maskedOpenaiKey = s.openaiKey;
    document.getElementById("openai-key").placeholder = t("status.alreadyConfigured", {
      value: s.openaiKey,
    });
  }
  if (s.vaultEnabled) {
    document.getElementById("toggle-vault").checked = true;
    toggleSection("vault");
    state.vaultEnabled = true;
  }
  if (s.vaultPath) {
    document.getElementById("vault-path").value = s.vaultPath;
    state.vaultPath = s.vaultPath;
  }
  if (s.proactiveEnabled) {
    document.getElementById("toggle-proactive").checked = true;
    toggleSection("proactive");
    state.proactiveEnabled = true;
  }
  if (s.proactiveInterval) {
    document.getElementById("proactive-interval").value = s.proactiveInterval;
    state.proactiveInterval = s.proactiveInterval;
  }
  if (s.proactiveCooldown) {
    document.getElementById("proactive-cooldown").value = s.proactiveCooldown;
    state.proactiveCooldown = s.proactiveCooldown;
  }
  if (s.reminderCooldown) {
    document.getElementById("proactive-reminder-cooldown").value = s.reminderCooldown;
    state.reminderCooldown = s.reminderCooldown;
  }
  if (s.quietHoursStart) {
    document.getElementById("quiet-start").value = s.quietHoursStart;
    state.quietHoursStart = s.quietHoursStart;
  }
  if (s.quietHoursEnd) {
    document.getElementById("quiet-end").value = s.quietHoursEnd;
    state.quietHoursEnd = s.quietHoursEnd;
  }
  if (s.googleEnabled) {
    document.getElementById("toggle-google").checked = true;
    toggleSection("google");
    state.googleEnabled = true;
  }
  if (s.voiceSttEnabled) {
    document.getElementById("toggle-voice").checked = true;
    toggleSection("voice");
    state.voiceSttEnabled = true;
    state.voiceTtsEnabled = true;
  }
  if (s.voiceTtsType) {
    document.getElementById("voice-tts-type").value = s.voiceTtsType;
    state.voiceTtsType = s.voiceTtsType;
    toggleVoiceTtsType();
  }
  if (s.geminiKeySet) {
    document.getElementById("gemini-api-key").placeholder = t("status.alreadyConfigured", {
      value: s.geminiKey || "(configured)",
    });
  }
  if (s.elevenlabsKeySet) {
    document.getElementById("elevenlabs-api-key").placeholder = t("status.alreadyConfigured", {
      value: s.elevenlabsKey || "(configured)",
    });
  }
  if (s.elevenlabsVoiceId) {
    document.getElementById("elevenlabs-voice-id").value = s.elevenlabsVoiceId;
    state.elevenlabsVoiceId = s.elevenlabsVoiceId;
  }
  if (s.voiceAutoReply !== undefined) {
    document.getElementById("voice-auto-reply").checked = s.voiceAutoReply;
    state.voiceAutoReply = s.voiceAutoReply;
  }
  if (s.codeAgentEnabled) {
    document.getElementById("toggle-codeAgent").checked = true;
    toggleSection("codeAgent");
    state.codeAgentEnabled = true;
  }
  if (s.codeAgentModel) {
    document.getElementById("code-agent-model").value = s.codeAgentModel;
    state.codeAgentModel = s.codeAgentModel;
  }
  if (s.codeAgentMaxTurns) {
    document.getElementById("code-agent-turns").value = s.codeAgentMaxTurns;
    state.codeAgentMaxTurns = s.codeAgentMaxTurns;
  }
  if (s.codeAgentTimeout) {
    document.getElementById("code-agent-timeout").value = s.codeAgentTimeout;
    state.codeAgentTimeout = s.codeAgentTimeout;
  }
  _claudeAuthDetected = s.claudeAuthDetected || false;
  updateClaudeAuthStatus();
  validateStep1();

  // Update run commands with project directory
  var cmdStart = document.querySelector("#success-panel .cmd-text");
  var cmdDocker = document.querySelectorAll("#success-panel .cmd-text")[1];
  if (s.projectDir) {
    if (cmdStart) cmdStart.textContent = `cd ${s.projectDir} && bun run start`;
    if (cmdDocker) cmdDocker.textContent = `cd ${s.projectDir} && bun run docker`;
  }
}

/* ──────────────────────────────────
   API: Verify Token
────────────────────────────────── */
function verifyToken() {
  const token = state.token;
  if (!token) {
    showFieldError("token", t("error.token.enterFirst"));
    return;
  }

  const btn = document.getElementById("btn-verify");
  const origText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  clearFieldState("token");

  fetch("/api/validate-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token }),
  })
    .then((r) => {
      if (!r.ok) {
        return r.text().then((text) => {
          try {
            return JSON.parse(text);
          } catch (_e) {
            return { error: t("error.token.serverError", { status: r.status }) };
          }
        });
      }
      return r.json();
    })
    .then((data) => {
      btn.disabled = false;
      btn.textContent = origText;

      if (data.error && !data.valid) {
        showFieldError("token", data.error);
        return;
      }

      if (data.valid) {
        _tokenVerified = true;
        verifiedBotUsername = data.botUsername || "";
        const input = document.getElementById("token");
        input.classList.remove("error");
        input.classList.add("success");
        const successEl = document.getElementById("token-success");
        successEl.textContent = t("success.token.valid", { username: verifiedBotUsername });
        successEl.classList.add("visible");
      } else {
        showFieldError("token", data.error || t("error.token.invalid"));
      }
    })
    .catch((_err) => {
      btn.disabled = false;
      btn.textContent = origText;
      showFieldError("token", t("error.token.serverDown"));
    });
}

/* ──────────────────────────────────
   API: Save
────────────────────────────────── */
function saveConfig() {
  var btn = document.getElementById("btn-save");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${t("presave.validating")}`;

  collectState();

  // First: pre-validate
  fetch("/api/pre-validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      renderPreValidation(data);

      if (data.canSave) {
        doSave(btn);
      } else {
        btn.disabled = false;
        btn.textContent = t("btn.save");
      }
    })
    .catch(() => {
      btn.disabled = false;
      btn.textContent = t("btn.save");
      showToast(t("error.presave.serverDown"), "error");
    });
}

function doSave(btn) {
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${t("status.saving")}`;

  fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  })
    .then((r) => {
      if (!r.ok) {
        return r.text().then((text) => {
          try {
            const d = JSON.parse(text);
            return { success: false, message: d.error || d.message || t("error.save.failed") };
          } catch (_e) {
            return { success: false, message: t("error.save.serverError", { status: r.status }) };
          }
        });
      }
      return r.json();
    })
    .then((data) => {
      btn.disabled = false;
      btn.textContent = t("btn.save");

      if (data.success) {
        document.getElementById("save-section").style.display = "none";
        document.getElementById("success-panel").classList.add("visible");
        document.getElementById("nav-step-6").style.display = "none";
        showToast(t("success.save"), "success");
      } else {
        showToast(data.message || t("error.save.failed"), "error");
      }
    })
    .catch(() => {
      btn.disabled = false;
      btn.textContent = t("btn.save");
      showToast(t("error.save.serverDown"), "error");
    });
}

function renderPreValidation(data) {
  var el = document.getElementById("presave-results");
  var html = "";

  var statusLabels = {
    ok: t("doctor.ok"),
    warn: t("doctor.warn"),
    fail: t("doctor.fail"),
  };

  var checks = data.checks || [];
  var c, badge;
  for (let i = 0; i < checks.length; i++) {
    c = checks[i];
    badge = statusLabels[c.status] || c.status.toUpperCase();
    html += '<div class="doctor-item">';
    html += `<span class="doctor-badge ${escapeAttr(c.status)}">${escapeHtml(badge)}</span>`;
    html += `<span>${escapeHtml(c.name)}`;
    if (c.message) html += ` &mdash; ${escapeHtml(c.message)}`;
    html += "</span>";
    html += "</div>";
  }

  if (!data.canSave) {
    html += '<div class="presave-blocker">';
    html += `<p>${escapeHtml(t("presave.blockMessage"))}</p>`;
    html += "</div>";
  }

  el.innerHTML = html;
  el.classList.add("visible");
}

/* ──────────────────────────────────
   API: Doctor
────────────────────────────────── */
function runDoctor() {
  const btn = document.getElementById("btn-doctor");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner dark"></span> ${t("status.checking")}`;

  const resultsEl = document.getElementById("doctor-results");
  resultsEl.classList.remove("visible");

  fetch("/api/doctor")
    .then((r) => {
      if (!r.ok) {
        return r.text().then((text) => {
          try {
            return JSON.parse(text);
          } catch (_e) {
            return { checks: [], summary: `Server error: ${r.status}` };
          }
        });
      }
      return r.json();
    })
    .then((data) => {
      btn.disabled = false;
      btn.textContent = t("btn.doctor");
      renderDoctorResults(data);
    })
    .catch(() => {
      btn.disabled = false;
      btn.textContent = t("btn.doctor");
      showToast(t("error.doctor.serverDown"), "error");
    });
}

function renderDoctorResults(data) {
  const el = document.getElementById("doctor-results");
  let html = "";

  const statusLabels = {
    ok: t("doctor.ok"),
    warn: t("doctor.warn"),
    fail: t("doctor.fail"),
    skip: t("doctor.skip"),
  };
  const checks = data.checks || [];

  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const badge = statusLabels[c.status] || c.status.toUpperCase();
    html += '<div class="doctor-item">';
    html += `<span class="doctor-badge ${escapeAttr(c.status)}">${escapeHtml(badge)}</span>`;
    html += `<span>${escapeHtml(c.name)}${c.message ? ` &mdash; ${escapeHtml(c.message)}` : ""}</span>`;
    html += "</div>";
  }

  if (data.summary) {
    html += `<div class="doctor-summary">${escapeHtml(data.summary)}</div>`;
  }

  el.innerHTML = html;
  el.classList.add("visible");
}

/* ──────────────────────────────────
   Vault Detection
────────────────────────────────── */
function selectVaultPath(path) {
  document.getElementById("vault-path").value = path;
  state.vaultPath = path;
}

function toggleVoiceTtsType() {
  const type = document.getElementById("voice-tts-type").value;
  const elevenlabsDetail = document.getElementById("detail-elevenlabs");
  if (elevenlabsDetail) {
    elevenlabsDetail.style.display = type === "elevenlabs" ? "block" : "none";
  }
  state.voiceTtsType = type;
}

function detectVaults() {
  fetch("/api/detect-vaults")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      const vaults = data.vaults || [];
      if (vaults.length === 0) return;
      const el = document.getElementById("detected-vaults");
      let html = `<div class="detected-vaults-label">${t("step3.vault.detected")}</div>`;
      for (let i = 0; i < vaults.length; i++) {
        const v = vaults[i];
        const name = v.split("/").pop() || v;
        const isActive = v === state.vaultPath;
        html +=
          '<span class="vault-chip' +
          (isActive ? " active" : "") +
          '" onclick="selectVaultPath(\'' +
          escapeAttr(v) +
          '\')" title="' +
          escapeAttr(v) +
          '">';
        html += escapeHtml(name);
        html += "</span>";
      }
      el.innerHTML = html;
      el.style.display = "block";
    })
    .catch(() => {
      /* no vaults detected */
    });
}

/* ──────────────────────────────────
   Google OAuth
────────────────────────────────── */
function connectGoogle() {
  const clientId = document.getElementById("google-client-id").value.trim();
  const clientSecret = document.getElementById("google-client-secret").value.trim();

  if (!clientId || !clientSecret) {
    showToast(t("step4.google.credentialsRequired"), "error");
    return;
  }

  const btn = document.getElementById("btn-google-connect");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  fetch("/api/google-auth-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.url) {
        window.open(data.url, "_blank");
        startGooglePoll();
      } else {
        showToast(data.error || t("error.google.authFailed"), "error");
        btn.disabled = false;
        btn.textContent = t("step4.google.connect");
      }
    })
    .catch(() => {
      btn.disabled = false;
      btn.textContent = t("step4.google.connect");
      showToast(t("error.google.authFailed"), "error");
    });
}

function startGooglePoll() {
  if (_googlePollId) clearInterval(_googlePollId);
  _googlePollId = setInterval(() => {
    fetch("/api/google-status")
      .then((r) => r.json())
      .then((data) => {
        if (data.connected) {
          clearInterval(_googlePollId);
          _googlePollId = null;
          _googleConnected = true;
          updateGoogleUI(true);
        }
      })
      .catch(() => {});
  }, 2000);
}

function updateGoogleUI(connected) {
  const btn = document.getElementById("btn-google-connect");
  const statusEl = document.getElementById("google-status");
  const servicesEl = document.getElementById("google-services");

  if (connected) {
    btn.disabled = false;
    btn.textContent = t("step4.google.connect");
    statusEl.textContent = t("step4.google.connected");
    statusEl.className = "status-indicator connected";
    servicesEl.style.display = "block";
  } else {
    statusEl.textContent = t("step4.google.notConnected");
    statusEl.className = "status-indicator";
    servicesEl.style.display = "none";
  }
}

/* ──────────────────────────────────
   Navigation
────────────────────────────────── */
function goToStep(step) {
  if (step < 1 || step > totalSteps) return;

  /* Validate step 1 before advancing */
  if (currentStep === 1 && step > 1) {
    if (!validateStep1Fields()) return;
  }

  collectState();

  /* Update step panels */
  for (let i = 1; i <= totalSteps; i++) {
    const panel = document.getElementById(`step-${i}`);
    panel.classList.toggle("active", i === step);
  }

  /* Update indicators */
  for (let j = 1; j <= totalSteps; j++) {
    const circle = document.getElementById(`circle-${j}`);
    const label = document.getElementById(`label-${j}`);

    circle.classList.remove("active", "completed");
    label.classList.remove("active", "completed");

    if (j < step) {
      circle.classList.add("completed");
      label.classList.add("completed");
    } else if (j === step) {
      circle.classList.add("active");
      label.classList.add("active");
    }
  }

  /* Update lines */
  for (let k = 1; k < totalSteps; k++) {
    const line = document.getElementById(`line-${k}-${k + 1}`);
    if (line) {
      line.classList.toggle("completed", k < step);
    }
  }

  /* Build config summary on step 6 */
  if (step === 6) {
    buildConfigSummary();
  }

  currentStep = step;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function validateStep1Fields() {
  let valid = true;

  if (!state.token && !_tokenExistsOnServer) {
    showFieldError("token", t("error.token.required"));
    valid = false;
  }

  if (!state.userId) {
    showFieldError("user-id", t("error.userid.required"));
    valid = false;
  } else if (!/^\d+$/.test(state.userId)) {
    showFieldError("user-id", t("error.userid.numeric"));
    valid = false;
  }

  return valid;
}

/* ──────────────────────────────────
   Model Selection
────────────────────────────────── */
function selectModel(card) {
  const cards = document.querySelectorAll(".model-card");
  for (let i = 0; i < cards.length; i++) {
    cards[i].classList.remove("selected");
  }
  card.classList.add("selected");
  state.model = card.getAttribute("data-model");
}

/* ──────────────────────────────────
   Toggle Sections
────────────────────────────────── */
function toggleSection(section) {
  const checkbox = document.getElementById(`toggle-${section}`);
  const detail = document.getElementById(`detail-${section}`);
  const isOpen = checkbox.checked;

  detail.classList.toggle("open", isOpen);

  if (section === "embeddings") {
    state.embeddingsEnabled = isOpen;
  } else if (section === "vault") {
    state.vaultEnabled = isOpen;
    if (isOpen) detectVaults();
  } else if (section === "proactive") {
    state.proactiveEnabled = isOpen;
  } else if (section === "google") {
    state.googleEnabled = isOpen;
  } else if (section === "voice") {
    state.voiceSttEnabled = isOpen;
    state.voiceTtsEnabled = isOpen;
  } else if (section === "codeAgent") {
    state.codeAgentEnabled = isOpen;
    if (isOpen) checkDockerStatus();
  }
}

function checkDockerStatus() {
  var statusEl = document.getElementById("docker-status");
  statusEl.innerHTML = `<span class="spinner dark"></span> ${t("step5.codeAgent.dockerStatus.checking")}`;
  statusEl.className = "status-indicator";

  fetch("/api/docker-status")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      if (data.available) {
        statusEl.textContent = t("step5.codeAgent.dockerStatus.available", {
          version: data.version,
        });
        statusEl.className = "status-indicator connected";
        hideDockerInstallGuide();
      } else {
        statusEl.textContent = t("step5.codeAgent.dockerStatus.notAvailable");
        statusEl.className = "status-indicator not-available";
        showDockerInstallGuide();
      }
    })
    .catch(() => {
      statusEl.textContent = t("step5.codeAgent.dockerStatus.notAvailable");
      statusEl.className = "status-indicator not-available";
      showDockerInstallGuide();
    });
}

function showDockerInstallGuide() {
  fetch("/api/platform-info")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((info) => {
      var guideEl = document.getElementById("docker-install-guide");
      var html = `<h4>${escapeHtml(t("step5.docker.guide.title"))}</h4>`;

      if (info.platform === "darwin") {
        html += `<p>${escapeHtml(t("step5.docker.guide.mac.text"))}</p>`;
        html += '<div class="cmd-block"><div>';
        html += `<div class="cmd-label">${escapeHtml(t("step5.docker.guide.mac.brewLabel"))}</div>`;
        html += '<span class="cmd-text">brew install --cask docker</span>';
        html += "</div></div>";
        html += '<p style="margin-top:10px;font-size:13px;color:var(--text-secondary)">';
        html += `${escapeHtml(t("step5.docker.guide.mac.altText"))} `;
        html +=
          '<a href="https://docs.docker.com/desktop/install/mac-install/" target="_blank" rel="noopener">';
        html += `${escapeHtml(t("step5.docker.guide.mac.downloadLink"))}</a></p>`;
      } else {
        html += `<p>${escapeHtml(t("step5.docker.guide.linux.text"))}</p>`;
        html += '<div class="cmd-block"><div>';
        html +=
          '<div class="cmd-label">' +
          escapeHtml(t("step5.docker.guide.linux.scriptLabel")) +
          "</div>";
        html += '<span class="cmd-text">curl -fsSL https://get.docker.com | sh</span>';
        html += "</div></div>";
        html += '<p style="margin-top:10px;font-size:13px;color:var(--text-secondary)">';
        html += `${escapeHtml(t("step5.docker.guide.linux.altText"))} `;
        html += '<a href="https://docs.docker.com/engine/install/" target="_blank" rel="noopener">';
        html += `${escapeHtml(t("step5.docker.guide.linux.downloadLink"))}</a></p>`;
      }

      html +=
        '<button class="btn btn-secondary btn-sm" style="margin-top:12px" onclick="checkDockerStatus()">';
      html += `${escapeHtml(t("step5.docker.guide.recheck"))}</button>`;

      guideEl.innerHTML = html;
      guideEl.style.display = "block";
    })
    .catch(() => {
      /* cannot determine platform */
    });
}

function hideDockerInstallGuide() {
  var guideEl = document.getElementById("docker-install-guide");
  if (guideEl) guideEl.style.display = "none";
}

/* ──────────────────────────────────
   Config Summary
────────────────────────────────── */
function buildConfigSummary() {
  collectState();

  const modelNames = {
    "claude-sonnet-4-6": t("step2.sonnet.name"),
    "claude-opus-4-6": t("step2.opus.name"),
    "claude-haiku-4-5": t("step2.haiku.name"),
  };

  const langNames = {};
  for (const lang of LANGUAGES) {
    langNames[lang.code] = t(`step1.language.${lang.code}`);
  }

  const notSetHtml = `<span style="color:var(--accent-orange)">${escapeHtml(t("status.notSet"))}</span>`;
  const tokenDisplay = state.token
    ? maskToken(state.token)
    : _tokenExistsOnServer
      ? `<code>${escapeHtml(_maskedToken)}</code>`
      : notSetHtml;

  const rows = [
    { key: t("summary.botToken"), val: tokenDisplay },
    { key: t("summary.userId"), val: state.userId },
    { key: t("summary.language"), val: langNames[state.language] || state.language },
    {
      key: t("summary.aiModel"),
      val: `${modelNames[state.model] || state.model} <code>${escapeHtml(state.model)}</code>`,
    },
  ];

  if (verifiedBotUsername) {
    rows.splice(1, 0, {
      key: t("summary.botUsername"),
      val: `@${escapeHtml(verifiedBotUsername)}`,
    });
  }

  if (state.embeddingsEnabled) {
    rows.push({ key: t("summary.semanticSearch"), val: t("status.enabled") });
    const openaiDisplay = state.openaiKey
      ? maskKey(state.openaiKey)
      : _openaiKeyExistsOnServer
        ? `<code>${escapeHtml(_maskedOpenaiKey)}</code>`
        : notSetHtml;
    rows.push({ key: t("summary.openaiKey"), val: openaiDisplay });
  }

  if (state.vaultEnabled) {
    rows.push({ key: t("summary.obsidianVault"), val: t("status.enabled") });
    rows.push({
      key: t("summary.vaultPath"),
      val: state.vaultPath ? `<code>${escapeHtml(state.vaultPath)}</code>` : notSetHtml,
    });
  }

  if (state.proactiveEnabled) {
    rows.push({ key: t("summary.proactive"), val: t("status.enabled") });
    rows.push({
      key: t("summary.checkInterval"),
      val: `${state.proactiveInterval} min`,
    });
    rows.push({
      key: t("summary.quietHours"),
      val: `${state.quietHoursStart} — ${state.quietHoursEnd}`,
    });
  }

  if (state.googleEnabled) {
    rows.push({
      key: t("summary.google"),
      val: _googleConnected ? t("step4.google.connected") : t("step4.google.notConnected"),
    });
  }

  if (state.voiceSttEnabled) {
    rows.push({ key: t("summary.voice"), val: t("status.enabled") });
    const ttsType = state.voiceTtsType === "elevenlabs" ? "ElevenLabs" : "Gemini";
    rows.push({ key: t("summary.voiceTts"), val: ttsType });
  }

  if (state.codeAgentEnabled) {
    const codeModelNames = {
      sonnet: t("step5.codeAgent.model.sonnet"),
      opus: t("step5.codeAgent.model.opus"),
      haiku: t("step5.codeAgent.model.haiku"),
    };
    rows.push({ key: t("summary.codeAgent"), val: t("status.enabled") });
    rows.push({
      key: t("summary.codeAgentModel"),
      val: codeModelNames[state.codeAgentModel] || state.codeAgentModel,
    });
    rows.push({ key: t("summary.codeAgentTurns"), val: String(state.codeAgentMaxTurns) });
    rows.push({
      key: t("summary.codeAgentTimeout"),
      val: `${state.codeAgentTimeout} min`,
    });
  }

  const claudeAuthVal = _claudeAuthDetected
    ? `<span style="color:var(--accent-green)">${escapeHtml(t("status.detected"))}</span>`
    : `<span style="color:var(--accent-orange)">${escapeHtml(t("status.notDetected"))}</span>`;
  rows.push({ key: t("summary.claudeAuth"), val: claudeAuthVal });

  let html = `<h4>${escapeHtml(t("step6.summary.heading"))}</h4>`;
  for (let i = 0; i < rows.length; i++) {
    html += '<div class="config-row">';
    html += `<span class="config-key">${escapeHtml(rows[i].key)}</span>`;
    html += `<span class="config-val">${rows[i].val}</span>`;
    html += "</div>";
  }

  document.getElementById("config-summary").innerHTML = html;
}

/* ──────────────────────────────────
   Helpers
────────────────────────────────── */
function collectState() {
  state.token = document.getElementById("token").value.trim();
  state.userId = document.getElementById("user-id").value.trim();
  state.language = document.getElementById("language").value;
  state.openaiKey = document.getElementById("openai-key").value.trim();
  state.vaultPath = document.getElementById("vault-path").value.trim();
  state.embeddingsEnabled = document.getElementById("toggle-embeddings").checked;
  state.vaultEnabled = document.getElementById("toggle-vault").checked;
  state.proactiveEnabled = document.getElementById("toggle-proactive").checked;
  state.proactiveInterval = parseInt(document.getElementById("proactive-interval").value, 10) || 5;
  state.proactiveCooldown = parseInt(document.getElementById("proactive-cooldown").value, 10) || 15;
  state.reminderCooldown =
    parseInt(document.getElementById("proactive-reminder-cooldown").value, 10) || 180;
  state.quietHoursStart = document.getElementById("quiet-start").value || "22:00";
  state.quietHoursEnd = document.getElementById("quiet-end").value || "08:00";
  state.googleEnabled = document.getElementById("toggle-google").checked;
  state.googleClientId = document.getElementById("google-client-id").value.trim();
  state.googleClientSecret = document.getElementById("google-client-secret").value.trim();
  const voiceToggle = document.getElementById("toggle-voice");
  if (voiceToggle) {
    state.voiceSttEnabled = voiceToggle.checked;
    state.voiceTtsEnabled = voiceToggle.checked;
    state.geminiApiKey = document.getElementById("gemini-api-key").value.trim();
    state.voiceTtsType = document.getElementById("voice-tts-type").value;
    state.elevenlabsApiKey = document.getElementById("elevenlabs-api-key").value.trim();
    state.elevenlabsVoiceId = document.getElementById("elevenlabs-voice-id").value.trim();
    state.voiceAutoReply = document.getElementById("voice-auto-reply").checked;
  }
  var codeAgentToggle = document.getElementById("toggle-codeAgent");
  if (codeAgentToggle) {
    state.codeAgentEnabled = codeAgentToggle.checked;
    state.codeAgentModel = document.getElementById("code-agent-model").value;
    state.codeAgentMaxTurns = parseInt(document.getElementById("code-agent-turns").value, 10) || 50;
    state.codeAgentTimeout =
      parseInt(document.getElementById("code-agent-timeout").value, 10) || 10;
  }
}

function maskToken(token) {
  if (!token || token.length < 10) return "<code>***</code>";
  return `<code>${escapeHtml(token.substring(0, 6))}...${escapeHtml(token.slice(-4))}</code>`;
}

function maskKey(key) {
  if (!key || key.length < 8) return "<code>***</code>";
  return `<code>${escapeHtml(key.substring(0, 5))}...${escapeHtml(key.slice(-4))}</code>`;
}

function showFieldError(fieldId, message) {
  const input = document.getElementById(fieldId);
  input.classList.add("error");
  input.classList.remove("success");

  const errEl = document.getElementById(
    fieldId === "user-id" ? "userid-error" : `${fieldId}-error`,
  );
  if (errEl) {
    errEl.textContent = message;
    errEl.classList.add("visible");
  }
}

function clearFieldState(fieldId) {
  const input = document.getElementById(fieldId);
  input.classList.remove("error", "success");

  const errEl = document.getElementById(
    fieldId === "user-id" ? "userid-error" : `${fieldId}-error`,
  );
  if (errEl) {
    errEl.textContent = "";
    errEl.classList.remove("visible");
  }

  const succEl = document.getElementById(`${fieldId}-success`);
  if (succEl) {
    succEl.textContent = "";
    succEl.classList.remove("visible");
  }
}

function showToast(message, type) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;

  /* Force reflow to restart animation if already visible */
  void toast.offsetWidth;
  toast.classList.add("visible");

  setTimeout(() => {
    toast.classList.remove("visible");
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}
