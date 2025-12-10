// main_models.js
// Wires the feature extractor, BrowserRF, and DBSCAN code to your UI.
// - Listens for the 'predict' event fired by main_multi.js and runs the active model
// - Loads rf_model.json automatically if present and updates RF UI status
// - Handles DBSCAN dataset upload, run clustering, and assign current email to clusters
// - Uses the shared extractors from features.js
//
// Requires: features.js, rf_predictor.js, dbscan.js to be loaded beforehand.

(function () {
  // UI elements
  const rfStatusEl = document.getElementById("rf-status");
  const rfInfoEl = document.getElementById("rf-info");
  const rfResultEl = document.getElementById("rf-result");
  const rfFeatureImportancesEl = document.getElementById(
    "rf-featureImportances"
  );
  const rfThresholdEl = document.getElementById("rf-threshold");
  const rfThresholdVal = document.getElementById("rf-thresholdVal");

  const svmResultEl = document.getElementById("svm-result");
  const svmStatusEl = document.getElementById("svm-status");
  const svmFeaturePreview = document.getElementById("svm-featurePreview");

  const dbscanStatusEl = document.getElementById("dbscan-status");
  const dbscanClustersEl = document.getElementById("dbscan-clusters");
  const dbscanResultEl = document.getElementById("dbscan-result");
  const dbscanUploadEl = document.getElementById("dbscan-upload");
  const dbscanRunBtn = document.getElementById("dbscan-run");
  const dbscanAssignBtn = document.getElementById("dbscan-assign");
  const dbscanEpsInput = document.getElementById("dbscan-eps");
  const dbscanMinPtsInput = document.getElementById("dbscan-minPts");

  const sharedInput = document.getElementById("sharedEmailInput");
  const pasteSpamBtn = document.getElementById("pasteSpamExample");
  const pasteHamBtn = document.getElementById("pasteHamExample");

  const metaFrom = document.getElementById("meta-fromDomain");
  const metaReply = document.getElementById("meta-replyDomain");
  const metaHasAttach = document.getElementById("meta-hasAttachment");
  const metaSenderRep = document.getElementById("meta-senderRep");
  const metaSenderRepVal = document.getElementById("meta-senderRepVal");

  // Local state for DBSCAN dataset
  let dbscan_X = null;
  let dbscan_labels = null;
  let dbscan_corePoints = null;
  let dbscan_lastFileName = null;

  // Browser RF instance
  const rf = new (window.BrowserRF ||
    (function () {
      return function () {};
    })())();
  window.browserRF = rf;

  // Update RF threshold UI value display
  if (rfThresholdEl && rfThresholdVal) {
    rfThresholdVal.textContent = Number(rfThresholdEl.value).toFixed(2);
    rfThresholdEl.addEventListener("input", () => {
      rfThresholdVal.textContent = Number(rfThresholdEl.value).toFixed(2);
    });
  }

  // Sender reputation slider display
  if (metaSenderRep && metaSenderRepVal) {
    metaSenderRepVal.textContent = Number(metaSenderRep.value).toFixed(2);
    metaSenderRep.addEventListener("input", () => {
      metaSenderRepVal.textContent = Number(metaSenderRep.value).toFixed(2);
    });
  }

  // Populate example paste buttons
  if (pasteSpamBtn) {
    pasteSpamBtn.addEventListener("click", () => {
      sharedInput.value = `Subject: Congratulations — YOU WON $10,000 FREE!!!

Dear winner,

CONGRATULATIONS! You are selected to receive FREE credit and MONEY now. To claim your prize, reply with your address and billing information. We will REMOVE the hold on your order once we receive confirmation. This is a limited-time offer — people who respond fast will receive the full amount. SEND YOUR DETAILS NOW to claim your free money.

Best regards,
Prize Department`;
    });
  }
  if (pasteHamBtn) {
    pasteHamBtn.addEventListener("click", () => {
      sharedInput.value = `Subject: Project meeting next week

Salam Leyla,

Ümid edirəm yaxşısan. Növbəti həftə layihə iclası üçün uyğun vaxtlarını mənə bildirə bilərsən? Mən bazar ertəsi və çərşənbə axşamı boşam. Gələn həftə görüşkən sənə yeni təqdimat fayllarını göndərəcəyəm.

Hörmətlə,
Aydın`;
    });
  }

  // Small SVG icons used in result panels
  function spamIconSVG() {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <rect rx="6" height="24" width="24" fill="#3b1f25" opacity="0.06"></rect>
      <path d="M4 8l8 4 8-4" stroke="#b91c1c" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 16l8-4 8 4" stroke="#991b1b" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  function hamIconSVG() {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <rect rx="6" height="24" width="24" fill="#0f172a" opacity="0.04"></rect>
      <path d="M20 6L9 17l-5-5" stroke="#059669" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  function pendingIconSVG() {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <rect rx="6" height="24" width="24" fill="#fff" opacity="0.02"></rect>
      <path d="M12 6v6l4 2" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  // Helper to set result element state
  function setResult(el, kind, title, sub, iconHtml) {
    if (!el) return;
    el.classList.remove("is-spam", "is-ham");
    const iconWrap = el.querySelector(".icon-wrap");
    if (iconWrap) iconWrap.innerHTML = iconHtml || "";
    const titleEl = el.querySelector(".title");
    const subEl = el.querySelector(".sub");
    if (titleEl) titleEl.textContent = title || "";
    if (subEl) subEl.textContent = sub || "";
    if (kind === "spam") el.classList.add("is-spam");
    else if (kind === "ham") el.classList.add("is-ham");
  }

  // Heuristic fallback used when SVM/RF unavailable: simple scoring
  function heuristicPredict(features) {
    const longestRun = features.length >= 2 ? features[features.length - 2] : 0;
    const totalCaps = features.length >= 1 ? features[features.length - 1] : 0;
    const wordCounts = features.slice(0, Math.max(0, features.length - 2));
    const wordScore = wordCounts.reduce((s, v) => s + v, 0);
    const capsScore = longestRun * 0.25 + totalCaps * 0.02;
    const score = wordScore + capsScore;
    return score >= 3.5 ? 1 : 0;
  }

  // Try to auto-load rf_model.json at startup (if present)
  async function tryLoadRF() {
    if (!window.BrowserRF) {
      rfStatusEl && (rfStatusEl.textContent = "RandomForest loader missing");
      return;
    }
    try {
      rfStatusEl && (rfStatusEl.textContent = "Loading rf_model.json ...");
      await rf.load("/rf_model.json");
      rfStatusEl &&
        (rfStatusEl.textContent = `RandomForest loaded (${rf.trees.length} trees)`);
      rfInfoEl && (rfInfoEl.textContent = "Model loaded from /rf_model.json");
    } catch (e) {
      console.warn("RF load failed:", e);
      rfStatusEl &&
        (rfStatusEl.textContent =
          "RandomForest model not found (put rf_model.json in site root)");
      rfInfoEl &&
        (rfInfoEl.textContent =
          "No RF model loaded. You can still use heuristic or train/export a model and drop rf_model.json into site root.");
    }
  }

  // Bind predict behavior triggered by main_multi.js (document 'predict' event)
  document.addEventListener("predict", async (ev) => {
    const model =
      ev && ev.detail && ev.detail.model
        ? ev.detail.model
        : window.app &&
          window.app.getActiveModel &&
          window.app.getActiveModel();
    if (!model) return;
    // Gather input and metadata
    const text = sharedInput ? sharedInput.value || "" : "";
    const meta = {
      fromDomain: metaFrom ? metaFrom.value : "",
      replyToDomain: metaReply ? metaReply.value : "",
      hasAttachment: metaHasAttach ? metaHasAttach.checked : false,
      senderReputation: metaSenderRep ? Number(metaSenderRep.value) : 0.5,
    };

    if (model === "svm") {
      // Try to use a pre-trained svmModel if available (window.svmModel), otherwise use heuristic
      // If you previously trained svmModel in another script and attached it to window.svmModel, it will be used.
      // Else we show heuristic result using extractFeaturesFromEmail
      const features = window.extractFeaturesFromEmail
        ? window.extractFeaturesFromEmail(text)
        : window.extractExtendedFeatures(text, meta).slice(0, 20);
      if (window.svmModel && typeof window.svmModel.predict === "function") {
        try {
          const out = window.svmModel.predict([features]);
          const pred = Array.isArray(out) ? Number(out[0]) : Number(out);
          if (pred === 1) {
            setResult(
              svmResultEl,
              "spam",
              "Bu e-poçt: SPAM",
              "SVM nəticəsinə əsasən e-poçt spam kimi qiymətləndirildi.",
              spamIconSVG()
            );
          } else {
            setResult(
              svmResultEl,
              "ham",
              "Bu e-poçt: Genuine / Ham",
              "SVM nəticəsinə əsasən e-poçt təhlükəsiz görünür.",
              hamIconSVG()
            );
          }
        } catch (err) {
          console.warn("SVM predict failed, falling back to heuristic:", err);
          const pred = heuristicPredict(features);
          setResult(
            svmResultEl,
            pred === 1 ? "spam" : "ham",
            pred === 1 ? "Bu e-poçt: SPAM" : "Bu e-poçt: Genuine / Ham",
            "Heuristic fallback used.",
            pred === 1 ? spamIconSVG() : hamIconSVG()
          );
        }
      } else {
        // no SVM model available; show heuristic
        const pred = heuristicPredict(features);
        setResult(
          svmResultEl,
          pred === 1 ? "spam" : "ham",
          pred === 1 ? "Bu e-poçt: SPAM" : "Bu e-poçt: Genuine / Ham",
          "Heuristic fallback (no SVM loaded).",
          pred === 1 ? spamIconSVG() : hamIconSVG()
        );
      }
      // feature preview for SVM (first 20)
      if (svmFeaturePreview) {
        const preview = (
          window.extractFeaturesFromEmail
            ? window.extractFeaturesFromEmail(text)
            : features
        ).slice(0, 20);
        svmFeaturePreview.textContent = JSON.stringify(preview, null, 2);
      }
    } else if (model === "rf") {
      // Build the extended features and call RF predictor if available
      const features = window.extractExtendedFeatures
        ? window.extractExtendedFeatures(text, meta)
        : [];
      if (rf && rf.loaded) {
        try {
          const { pred, probs } = rf.predictOne(features);
          const conf =
            probs && probs.length > 1
              ? Number(probs[1]).toFixed(2)
              : Number(Math.max(...(probs || [0]))).toFixed(2);
          const kind = pred === 1 ? "spam" : "ham";
          const title =
            pred === 1
              ? `Bu e-poçt: Phishing (pred=${conf})`
              : `Bu e-poçt: Not Phishing (pred=${conf})`;
          setResult(
            rfResultEl,
            kind,
            title,
            `Probabilities: ${JSON.stringify(
              probs.map((p) => Number(p.toFixed(3)))
            )}`,
            pred === 1 ? spamIconSVG() : hamIconSVG()
          );
        } catch (err) {
          console.warn("RF predict failed:", err);
          setResult(
            rfResultEl,
            "ham",
            "Model error",
            "Failed to predict with RF model.",
            pendingIconSVG()
          );
        }
      } else {
        // Not loaded: show heuristic info and hint
        setResult(
          rfResultEl,
          "ham",
          "No RF model",
          "RandomForest not loaded; drop rf_model.json into site root or train/load it.",
          pendingIconSVG()
        );
      }
    } else if (model === "dbscan") {
      // If we have an existing clustering, assign the new email to a cluster via nearest core point
      if (!dbscan_X || !dbscan_labels) {
        setResult(
          dbscanResultEl,
          null,
          "No clustering available",
          "Upload a dataset and run clustering first.",
          pendingIconSVG()
        );
        return;
      }
      const features = window.extractExtendedFeatures
        ? window.extractExtendedFeatures(text, meta)
        : [];
      const eps = Number(dbscanEpsInput ? dbscanEpsInput.value : 2.0);
      const assign =
        window.__dbscan && window.__dbscan.assignByNearestCore
          ? window.__dbscan.assignByNearestCore(
              dbscan_X,
              dbscan_labels,
              dbscan_corePoints,
              eps,
              features
            )
          : { cluster: -1, dist: null };
      if (assign.cluster === -1) {
        setResult(
          dbscanResultEl,
          "spam",
          "Assigned: Noise / Outlier",
          `Nearest-core distance: ${
            assign.dist === null ? "n/a" : assign.dist.toFixed(3)
          }`,
          spamIconSVG()
        );
      } else {
        setResult(
          dbscanResultEl,
          "ham",
          `Assigned: Cluster ${assign.cluster}`,
          `Distance to nearest core: ${assign.dist.toFixed(
            3
          )} — Cluster size: ${
            dbscan_labels.filter((l) => l === assign.cluster).length
          }`,
          hamIconSVG()
        );
      }
    }
  });

  // DBSCAN: parse uploaded file (JSON array or CSV). Build feature matrix using featuresFromRow or extractors.
  function parseUploadedFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error("No file"));
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target.result;
        // Try JSON first
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed))
            return resolve({ type: "json", data: parsed });
        } catch (e) {
          // not JSON
        }
        // Try CSV basic parse
        try {
          const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
          if (lines.length < 2) throw new Error("CSV: Too few lines");
          const header = lines[0].split(",").map((h) => h.trim());
          const rows = lines.slice(1).map((ln) => {
            const cols = ln.split(",").map((c) => c.trim());
            const obj = {};
            for (let i = 0; i < header.length; i++)
              obj[header[i]] = cols[i] === undefined ? "" : cols[i];
            return obj;
          });
          return resolve({ type: "csv", data: rows, header });
        } catch (e) {
          return reject(new Error("Unsupported file format"));
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsText(file);
    });
  }

  // Build feature matrix X and optional texts array for UI examples
  function buildXFromDataArray(arr) {
    // arr: array of objects; prefer fields matching featureNames, otherwise try to use "body" or "text" fields
    const X = [];
    const texts = [];
    for (const row of arr) {
      let features;
      try {
        // if object has numeric features already, use featuresFromRow
        features = window.featuresFromRow ? window.featuresFromRow(row) : null;
        if (!features || features.every((v) => v === 0)) {
          // fallback: use body/text with metadata if present
          const text = row.body || row.text || row.email || "";
          const meta = {
            fromDomain: row.fromDomain || row.from || "",
            replyToDomain: row.replyToDomain || row.replyTo || "",
            hasAttachment: !!row.hasAttachment,
            senderReputation: row.senderReputation
              ? Number(row.senderReputation)
              : 0.5,
          };
          features = window.extractExtendedFeatures
            ? window.extractExtendedFeatures(text, meta)
            : [];
          texts.push(text);
        } else {
          // we might still want a text preview
          const text =
            row.body ||
            row.text ||
            row.email ||
            JSON.stringify(row).slice(0, 300);
          texts.push(text);
        }
      } catch (e) {
        features = [];
        texts.push("");
      }
      X.push(features);
    }
    return { X, texts };
  }

  // Hook DBSCAN upload button
  if (dbscanRunBtn && dbscanUploadEl) {
    dbscanRunBtn.addEventListener("click", async () => {
      const f = dbscanUploadEl.files && dbscanUploadEl.files[0];
      if (!f) {
        dbscanStatusEl &&
          (dbscanStatusEl.textContent = "Choose a .json or .csv file first.");
        return;
      }
      dbscanStatusEl && (dbscanStatusEl.textContent = `Parsing ${f.name} ...`);
      try {
        const parsed = await parseUploadedFile(f);
        const arr = parsed.data;
        const { X, texts } = buildXFromDataArray(arr);
        // Run DBSCAN
        const eps = Number(dbscanEpsInput ? dbscanEpsInput.value : 2.0);
        const minPts = Number(dbscanMinPtsInput ? dbscanMinPtsInput.value : 4);
        dbscanStatusEl &&
          (dbscanStatusEl.textContent = `Running DBSCAN (eps=${eps}, minPts=${minPts}) on ${X.length} rows...`);
        const out = window.__dbscan.dbscan(X, eps, minPts);
        dbscan_X = X;
        dbscan_labels = out.labels;
        dbscan_corePoints = out.corePoints;
        dbscan_lastFileName = f.name;

        // Build summary
        const counts = {};
        for (const lbl of dbscan_labels) counts[lbl] = (counts[lbl] || 0) + 1;
        const clusterSummary = Object.keys(counts)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => `${k}: ${counts[k]} items`)
          .join("\n");

        // show small representative examples per cluster (up to 2)
        const clusterExamples = {};
        dbscan_labels.forEach((lbl, idx) => {
          clusterExamples[lbl] = clusterExamples[lbl] || [];
          if (clusterExamples[lbl].length < 2)
            clusterExamples[lbl].push(texts[idx] || "(no text)");
        });
        let examplesText = "";
        for (const k of Object.keys(clusterExamples)) {
          examplesText += `Cluster ${k} (${counts[k]}):\n`;
          clusterExamples[k].forEach((ex, i) => {
            examplesText += ` - ${ex.slice(0, 140).replace(/\n/g, " ")}\n`;
          });
          examplesText += "\n";
        }

        dbscanClustersEl.textContent = `File: ${f.name}\nClusters summary:\n${clusterSummary}\n\nExamples:\n${examplesText}`;
        dbscanStatusEl &&
          (dbscanStatusEl.textContent = `DBSCAN finished — ${
            Object.keys(counts).length
          } distinct labels (including -1 noise).`);
      } catch (err) {
        console.warn("DBSCAN upload/run failed:", err);
        dbscanStatusEl &&
          (dbscanStatusEl.textContent = `Failed to parse or cluster: ${String(
            err.message || err
          )}`);
      }
    });
  }

  // Assign current email to cluster button
  if (dbscanAssignBtn) {
    dbscanAssignBtn.addEventListener("click", () => {
      // trigger predict event with model=dbscan so main predict handler will perform assignment
      const ev = new CustomEvent("predict", { detail: { model: "dbscan" } });
      document.dispatchEvent(ev);
    });
  }

  // Try to load RF automatically at startup
  tryLoadRF();

  // Expose small helper to manually (re)load RF model from a provided path
  window.rfLoadFrom = async function (path) {
    if (!window.BrowserRF) throw new Error("BrowserRF not available");
    try {
      rfStatusEl && (rfStatusEl.textContent = `Loading ${path} ...`);
      await rf.load(path);
      rfStatusEl &&
        (rfStatusEl.textContent = `RandomForest loaded from ${path}`);
      rfInfoEl && (rfInfoEl.textContent = `Model loaded from ${path}`);
    } catch (e) {
      rfStatusEl && (rfStatusEl.textContent = `RF load failed: ${e.message}`);
      throw e;
    }
  };

  // Expose a small API to run RF predict manually
  window.rfPredict = function (text, meta) {
    const features = window.extractExtendedFeatures
      ? window.extractExtendedFeatures(text, meta)
      : [];
    if (rf && rf.loaded) return rf.predictOne(features);
    return { pred: heuristicPredict(features), probs: [1, 0] };
  };

  // Initial cosmetic setup for result cards
  setResult(
    svmResultEl,
    null,
    "SVM nəticəsi gözlənilir",
    'SVM istifadə edərək spam/ham təyini üçün "Yoxla" düyməsini basın.',
    pendingIconSVG()
  );
  setResult(
    rfResultEl,
    null,
    "RandomForest nəticəsi gözlənilir",
    'Phishing aşkarlanması üçün "Yoxla" düyməsini basın.',
    pendingIconSVG()
  );
  setResult(
    dbscanResultEl,
    null,
    "DBSCAN nəticəsi gözlənilir",
    "Batch clustering üçün dataset yükləyin və ya mövcud datasetə əsaslanaraq test edin.",
    pendingIconSVG()
  );
})();
