(function (global) {
  // --- Euclidean distance ---
  function euclidean(a, b) {
    let s = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const ai = Number(a[i] || 0);
      const bi = Number(b[i] || 0);
      const d = ai - bi;
      s += d * d;
    }
    return Math.sqrt(s);
  }
  // --- Z-score scaler ---
  function computeScaler(X) {
    if (!Array.isArray(X) || X.length === 0) return { mean: [], std: [] };
    const n = X.length,
      m = X[0].length;
    const mean = new Array(m).fill(0),
      std = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(X[i][j] || 0);
      mean[j] = s / n;
    }
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) {
        const v = Number(X[i][j] || 0) - mean[j];
        s += v * v;
      }
      std[j] = Math.sqrt(s / Math.max(1, n - 1));
      if (!isFinite(std[j]) || std[j] <= 1e-8) std[j] = 1;
    }
    return { mean, std };
  }
  function applyScalerToRow(row, scaler) {
    if (!scaler || !Array.isArray(scaler.mean) || !Array.isArray(scaler.std))
      return row.slice();
    return row.map(
      (v, j) => (Number(v || 0) - (scaler.mean[j] || 0)) / (scaler.std[j] || 1)
    );
  }
  function applyScaler(X, scaler) {
    return X.map((r) => applyScalerToRow(r, scaler));
  }
  // --- DBSCAN algorithm ---
  function dbscan(Xraw, eps = 2.0, minPts = 4) {
    if (!Array.isArray(Xraw) || Xraw.length === 0)
      return { labels: [], corePoints: [], scaler: null, Xscaled: [] };
    const scaler = computeScaler(Xraw);
    const X = applyScaler(Xraw, scaler);
    const n = X.length;
    const labels = new Array(n).fill(undefined);
    const visited = new Array(n).fill(false);
    let clusterId = 0;
    function regionQuery(i) {
      const neighbors = [];
      const xi = X[i];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (euclidean(xi, X[j]) <= eps) neighbors.push(j);
      }
      return neighbors;
    }
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      visited[i] = true;
      const neighbors = regionQuery(i);
      if (neighbors.length + 1 < minPts) labels[i] = -1;
      else {
        const stack = [...neighbors];
        labels[i] = clusterId;
        while (stack.length) {
          const j = stack.shift();
          if (!visited[j]) {
            visited[j] = true;
            const jNeighbors = regionQuery(j);
            if (jNeighbors.length + 1 >= minPts) {
              for (const nb of jNeighbors) {
                if (!stack.includes(nb)) stack.push(nb);
              }
            }
          }
          if (labels[j] === undefined || labels[j] === -1)
            labels[j] = clusterId;
        }
        clusterId++;
      }
    }
    const corePoints = [];
    for (let i = 0; i < n; i++) {
      const neighbors = regionQuery(i);
      if (neighbors.length + 1 >= minPts) corePoints.push(i);
    }
    const counts = {};
    labels.forEach((lbl) => (counts[lbl] = (counts[lbl] || 0) + 1));
    const summary = { counts };
    global.__dbscan = global.__dbscan || {};
    global.__dbscan._last = {
      Xraw,
      Xscaled: X,
      labels,
      corePoints,
      scaler,
      eps,
      minPts,
      summary,
    };
    return { labels, corePoints, scaler, Xscaled: X, summary };
  }
  // --- Assign new email to nearest core cluster ---
  function assignByNearestCore(Xraw, labels, corePoints, eps, newPoint) {
    let scaler = global.__dbscan?._last?.scaler || computeScaler(Xraw || []);
    const newPtScaled = applyScalerToRow(newPoint, scaler);
    const Xscaled =
      global.__dbscan?._last?.Xscaled || applyScaler(Xraw || [], scaler);
    let best = { idx: -1, dist: Infinity };
    for (const i of corePoints) {
      const xi = Xscaled[i];
      if (!xi) continue;
      const d = euclidean(xi, newPtScaled);
      if (d < best.dist) best = { idx: i, dist: d };
    }
    if (best.idx === -1 || best.dist > eps)
      return { cluster: -1, dist: best.dist };
    return { cluster: labels[best.idx], dist: best.dist };
  }
  // --- Preprocess emails to numeric features ---
  function preprocessEmails(emails) {
    const domainMap = {};
    let idx = 0;
    emails.forEach((e) => {
      if (!domainMap[e.fromDomain]) domainMap[e.fromDomain] = idx++;
    });

    const keywords = ["verify", "invoice", "payment", "meeting"];
    return emails.map((e) => {
      const featureArr = [
        e.body.length,
        domainMap[e.fromDomain],
        e.hasAttachment ? 1 : 0,
        e.senderReputation || 0,
      ];
      // add keyword counts
      const bodyLower = (e.body || "").toLowerCase();
      keywords.forEach((kw) => {
        featureArr.push(bodyLower.split(kw).length - 1);
      });
      return featureArr;
    });
  }

  // --- Determine meaningful label for a cluster based on content ---
  function determineClusterLabel(clusterEmails) {
    if (clusterEmails.length === 0) return "Other";
    let phishingScore = 0;
    let promoScore = 0;
    const phishingKeywords = [
      "verify",
      "action required",
      "payment issue",
      "suspicious activity",
      "login",
      "urgent",
      "account suspended",
    ];
    const promoKeywords = [
      "invoice",
      "offer",
      "meeting",
      "update",
      "newsletter",
      "promotion",
      "discount",
    ];
    for (let email of clusterEmails) {
      const bodyLower = (email.body || "").toLowerCase();
      phishingKeywords.forEach((kw) => {
        if (bodyLower.includes(kw)) phishingScore++;
      });
      promoKeywords.forEach((kw) => {
        if (bodyLower.includes(kw)) promoScore++;
      });
    }
    // Normalize by cluster size
    phishingScore /= clusterEmails.length;
    promoScore /= clusterEmails.length;
    if (phishingScore > promoScore && phishingScore > 0.5) return "Phishing";
    if (promoScore > phishingScore && promoScore > 0.5) return "Promo";
    return "Other";
  }
  // --- Render clusters in UI (with meaningful labels, improved previews) ---
  function renderDbscanClusters(emails, labels) {
    const container = document.getElementById("dbscan-clusters");
    container.innerHTML = "";

    if (!emails || emails.length === 0 || !labels) {
      container.textContent = "No clusters found";
      return;
    }

    // Group emails by cluster
    const clusters = {};
    labels.forEach((lbl, idx) => {
      clusters[lbl] = clusters[lbl] || [];
      clusters[lbl].push(emails[idx]);
    });

    // Assign meaningful labels
    const clusterLabels = {};
    Object.keys(clusters).forEach((cid) => {
      if (cid === "-1") clusterLabels[cid] = "Noise / Outlier";
      else clusterLabels[cid] = determineClusterLabel(clusters[cid]);
    });

    // Build summary string
    const summaryStr = Object.keys(clusters)
      .map((cid) => {
        const label = clusterLabels[cid];
        const size = clusters[cid].length;
        return `${label} (Cluster ${cid}): ${size}`;
      })
      .join(", ");

    container.textContent = summaryStr || "No clusters found";
  }

  global.__dbscan = global.__dbscan || {};
  global.__dbscan.dbscan = dbscan;
  global.__dbscan.assignByNearestCore = assignByNearestCore;
  global.__dbscan.euclidean = euclidean;
  global.__dbscan.computeScaler = computeScaler;
  global.__dbscan.applyScaler = applyScaler;
  global.__dbscan.preprocessEmails = preprocessEmails;
  global.__dbscan.renderDbscanClusters = renderDbscanClusters;
})(window);
// --- UI integration --- (unchanged, assuming it's fine)
(function () {
  const uploadInput = document.getElementById("dbscan-upload");
  const runBtn = document.getElementById("dbscan-run");
  const assignBtn = document.getElementById("dbscan-assign");
  const epsInput = document.getElementById("dbscan-eps");
  const minPtsInput = document.getElementById("dbscan-minPts");
  const resultTitle = document.querySelector("#dbscan-result .title");
  let emails = [];
  function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    if (!lines.length) return [];
    const headers = lines[0].split(",").map((h) => h.trim()); // <-- correct
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
      const obj = {};
      headers.forEach((h, idx) => {
        let val = parts[idx] || "";
        val = val.replace(/^"|"$/g, "");
        if (["hasAttachment"].includes(h))
          val = val === "1" || val.toLowerCase() === "true";
        if (["senderReputation"].includes(h)) val = parseFloat(val) || 0;
        obj[h] = val;
      });
      rows.push(obj);
    }
    return rows;
  }
  uploadInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (evt) {
      emails = parseCSV(evt.target.result);
    };
    reader.readAsText(file);
  });
  runBtn.addEventListener("click", () => {
    if (!emails || emails.length === 0) {
      alert("Please upload a dataset first.");
      return;
    }
    const eps = parseFloat(epsInput.value) || 2.0;
    const minPts = parseInt(minPtsInput.value) || 4;
    const X = window.__dbscan.preprocessEmails(emails);
    const result = window.__dbscan.dbscan(X, eps, minPts);
    window.__dbscan.renderDbscanClusters(emails, result.labels);
    resultTitle.textContent = "DBSCAN Clustering Complete!";
  });
  assignBtn.addEventListener("click", () => {
    if (!emails || emails.length === 0) {
      alert("Upload dataset and run clustering first.");
      return;
    }

    const emailObj = {
      body: document.getElementById("sharedEmailInput").value || "",
      fromDomain: document.getElementById("meta-fromDomain").value || "",
      replyToDomain: document.getElementById("meta-replyDomain").value || "",
      hasAttachment: document.getElementById("meta-hasAttachment").checked,
      senderReputation:
        parseFloat(document.getElementById("meta-senderRep").value) || 0,
    };

    const eps = parseFloat(document.getElementById("dbscan-eps").value) || 2.0;

    const assigned = window.__dbscan.assignByNearestCore(
      window.__dbscan._last.Xraw,
      window.__dbscan._last.labels,
      window.__dbscan._last.corePoints,
      eps,
      window.__dbscan.preprocessEmails([emailObj])[0]
    );

    const cid = assigned.cluster;

    // ---- Insert new cluster label + size calculation here ----
    let clusterLabel = "Noise";
    let clusterSize = 0;
    if (cid !== -1) {
      const clusterEmails = window.__dbscan._last.Xraw.filter(
        (_, idx) => window.__dbscan._last.labels[idx] === cid
      );
      clusterSize = clusterEmails.length;
      clusterLabel = window.__dbscan.determineClusterLabel(clusterEmails);
    }

    // ---- Update UI with full info ----
    const resultTitle = document.querySelector("#dbscan-result .title");
    resultTitle.textContent = `Assigned: Cluster ${cid} (${clusterLabel})`;

    const resultSub = document.querySelector("#dbscan-result .sub");
    resultSub.textContent = `Distance to nearest core: ${assigned.dist.toFixed(
      3
    )} — Cluster size: ${clusterSize}`;
  });

  const senderRepSlider = document.getElementById("meta-senderRep");
  const senderRepVal = document.getElementById("meta-senderRepVal");
  senderRepSlider.addEventListener("input", () => {
    senderRepVal.textContent = parseFloat(senderRepSlider.value).toFixed(2);
  });
})();
