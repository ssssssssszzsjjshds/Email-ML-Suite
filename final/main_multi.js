// main_multi.js
// Tab switching, keyboard navigation, and small app API for the Email ML Suite tabs.
//
// Responsibilities:
// - Sync tab buttons and panels (class "active" on buttons, "hidden" on panels).
// - Maintain aria-selected and aria-hidden for accessibility.
// - Keyboard navigation: ArrowLeft/ArrowRight/Home/End among tabs.
// - Persist selected tab in localStorage ('ems:lastModel').
// - Dispatch a custom 'modelchange' event on document when active model changes.
// - Expose window.app.getActiveModel() and window.app.onModelChange(cb).

(function () {
  const TAB_BTN_SELECTOR = ".model-tabs .tab-btn";
  const PANEL_SELECTOR = ".model-panel";
  const LOCAL_KEY = "ems:lastModel"; // Email ML Suite last active model

  const tabButtons = Array.from(document.querySelectorAll(TAB_BTN_SELECTOR));
  const panels = Array.from(document.querySelectorAll(PANEL_SELECTOR));
  const predictSwitchBtn = document.getElementById("predict-switch");

  if (!tabButtons.length || !panels.length) {
    console.warn("Tabs: no tab buttons or panels found");
    return;
  }

  // Map of tab button id -> panel id (aria-controls)
  const tabs = tabButtons.map((btn, idx) => {
    const panelId = btn.getAttribute("aria-controls");
    return {
      id: btn.id,
      btn,
      panelId,
      panel: document.getElementById(panelId),
      index: idx,
    };
  });

  // Ensure panels exist for each tab; hide ones not active
  function initPanels() {
    tabs.forEach((t) => {
      if (!t.panel) {
        console.warn(`Tabs: panel ${t.panelId} (for ${t.id}) not found`);
        return;
      }
      // If panel has no explicit hidden attribute/class, leave as-is; we'll sync on activation
      t.panel.setAttribute("role", "tabpanel");
      t.panel.setAttribute("aria-labelledby", t.id);
    });
  }

  // Determine initial active tab:
  function determineInitialTab() {
    // 1) If a tab button already has .active class, use it
    const pre = tabs.find((t) => t.btn.classList.contains("active"));
    if (pre) return pre;

    // 2) Try localStorage
    try {
      const last = localStorage.getItem(LOCAL_KEY);
      if (last) {
        const byId = tabs.find((t) => t.id === last || t.panelId === last);
        if (byId) return byId;
      }
    } catch (e) {
      // ignore storage errors
    }

    // 3) Fallback to first tab (prefer tab whose id contains 'svm' if present)
    return tabs.find((t) => t.id.toLowerCase().includes("svm")) || tabs[0];
  }

  // Activate a tab object
  function activateTab(tabObj, focus = false) {
    if (!tabObj || !tabObj.btn || !tabObj.panel) return;
    // Deactivate others
    tabs.forEach((t) => {
      const isActive = t.id === tabObj.id;
      t.btn.classList.toggle("active", isActive);
      t.btn.setAttribute("aria-selected", isActive ? "true" : "false");
      t.btn.setAttribute("tabindex", isActive ? "0" : "-1");
      if (t.panel) {
        if (isActive) {
          t.panel.classList.remove("hidden");
          t.panel.removeAttribute("aria-hidden");
        } else {
          t.panel.classList.add("hidden");
          t.panel.setAttribute("aria-hidden", "true");
        }
      }
    });

    // Update predict button label to indicate active model
    updatePredictButtonLabel(tabObj);

    // Persist selection
    try {
      localStorage.setItem(LOCAL_KEY, tabObj.id);
    } catch (e) {
      // ignore
    }

    // Emit custom event so other code can respond to model changes
    const ev = new CustomEvent("modelchange", {
      detail: { model: getModelKeyFromTab(tabObj) },
    });
    document.dispatchEvent(ev);
  }

  function getModelKeyFromTab(tabObj) {
    // Normalize to small keys: 'svm', 'rf', 'dbscan'
    const id = tabObj.id.toLowerCase();
    if (id.includes("svm")) return "svm";
    if (id.includes("rf") || id.includes("random")) return "rf";
    if (id.includes("dbscan")) return "dbscan";
    // fallback: use panel id
    if (tabObj.panelId) {
      if (tabObj.panelId.toLowerCase().includes("svm")) return "svm";
      if (tabObj.panelId.toLowerCase().includes("rf")) return "rf";
      if (tabObj.panelId.toLowerCase().includes("dbscan")) return "dbscan";
    }
    return tabObj.id;
  }

  function updatePredictButtonLabel(tabObj) {
    if (!predictSwitchBtn) return;
    const modelKey = getModelKeyFromTab(tabObj);
    const mapping = {
      svm: "Yoxla — SVM (Spam)",
      rf: "Yoxla — RandomForest (Phishing)",
      dbscan: "Yoxla — DBSCAN (Assign/Cluster)",
    };
    predictSwitchBtn.textContent =
      mapping[modelKey] || `Yoxla — ${tabObj.btn.textContent.trim()}`;
  }

  // Click handler
  function onTabClick(e) {
    const btn = e.currentTarget;
    const t = tabs.find((x) => x.btn === btn);
    if (t) {
      activateTab(t, true);
      btn.focus();
    }
  }

  // Keyboard navigation among tabs
  function onTabKeyDown(e) {
    const key = e.key;
    const current = tabs.find((t) => t.btn === e.currentTarget);
    if (!current) return;
    let targetIndex = null;

    if (key === "ArrowRight") {
      targetIndex = (current.index + 1) % tabs.length;
    } else if (key === "ArrowLeft") {
      targetIndex = (current.index - 1 + tabs.length) % tabs.length;
    } else if (key === "Home") {
      targetIndex = 0;
    } else if (key === "End") {
      targetIndex = tabs.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    const target = tabs[targetIndex];
    if (target) {
      activateTab(target, true);
      target.btn.focus();
    }
  }

  // Public helpers
  function getActiveModel() {
    const activeTab = tabs.find((t) => t.btn.classList.contains("active"));
    return activeTab ? getModelKeyFromTab(activeTab) : null;
  }

  function onModelChange(cb) {
    if (typeof cb !== "function") return;
    document.addEventListener("modelchange", (ev) =>
      cb(ev.detail && ev.detail.model)
    );
  }

  // Initialize event listeners
  function bindEvents() {
    tabs.forEach((t) => {
      t.btn.addEventListener("click", onTabClick);
      t.btn.addEventListener("keydown", onTabKeyDown);
    });

    // Allow predict-switch to trigger model-specific action via event 'predict'
    if (predictSwitchBtn) {
      predictSwitchBtn.addEventListener("click", () => {
        const model = getActiveModel();
        // Dispatch a 'predict' event on document with model info. Other scripts should listen.
        const ev = new CustomEvent("predict", { detail: { model } });
        document.dispatchEvent(ev);
      });
    }
  }

  // Initial setup
  function init() {
    initPanels();
    bindEvents();
    const initial = determineInitialTab();
    activateTab(initial, false);

    // Expose a tiny app API for other modules
    window.app = window.app || {};
    window.app.getActiveModel = getActiveModel;
    window.app.onModelChange = onModelChange;

    // If other scripts are loaded after this, they can query and listen
    // Fire initial modelchange so listeners can initialize themselves
    setTimeout(() => {
      const ev = new CustomEvent("modelchange", {
        detail: { model: getActiveModel() },
      });
      document.dispatchEvent(ev);
    }, 0);
  }

  // Kick off when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
