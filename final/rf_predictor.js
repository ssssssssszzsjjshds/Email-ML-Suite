// Browser-side RandomForest predictor loader and small API that consumes common export shapes.
// - Supports sklearn-style export: { n_classes, trees: [...] }
// - Supports compact linear export: { featureWeights: [...], bias: number, threshold: number }
// - Exposes BrowserRF class and attaches predict helpers
//
// predictOne(features) returns { pred, probs } where probs = [p0, p1]

(function (global) {
  function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }

  function ensureArray(a) {
    return Array.isArray(a) ? a : [];
  }

  function numericDot(weights, features) {
    let s = 0;
    for (let i = 0; i < features.length; i++) {
      const w = weights[i] || 0;
      s += Number(features[i] || 0) * Number(w);
    }
    return s;
  }

  class BrowserRF {
    constructor() {
      this.trees = null; // sklearn-style trees array
      this.n_classes = 2;
      this.loaded = false;

      // For linear/compact model:
      this._isLinear = false;
      this._weights = null;
      this._bias = 0;
      this._threshold = 0.5;
      this.feature_importances = null;
    }

    // load from URL (fetches JSON)
    async load(url) {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load RF model ${res.status}`);
      const json = await res.json();
      this.loadFromObject(json);
      return true;
    }

    // Accept either sklearn-like or compact linear export
    loadFromObject(json) {
      if (!json || typeof json !== "object")
        throw new Error("Invalid model object");

      // Reset
      this.trees = null;
      this._isLinear = false;
      this._weights = null;
      this._bias = 0;
      this._threshold = 0.5;
      this.feature_importances = null;
      this.n_classes = json.n_classes || 2;

      if (Array.isArray(json.trees) && json.trees.length > 0) {
        // sklearn-style tree array -> use tree voting predictor
        this.trees = json.trees;
        this.n_classes = json.n_classes || 2;
        this.loaded = true;
        this.feature_importances = json.feature_importances || null;
        return true;
      }

      // compact linear-like model (optional)
      if (
        Array.isArray(json.featureWeights) &&
        json.featureWeights.length > 0
      ) {
        this._isLinear = true;
        this._weights = json.featureWeights.map(Number);
        this._bias = Number(json.bias || 0);
        this._threshold =
          typeof json.threshold === "number" ? json.threshold : 0.5;
        this.loaded = true;
        this.feature_importances = json.feature_importances || null;
        return true;
      }

      // If JSON contains a single "model" wrapper (common in some exports), try to unwrap
      if (json.model && typeof json.model === "object") {
        return this.loadFromObject(json.model);
      }

      throw new Error("Unrecognized RF model format");
    }

    // load from a File (FileReader)
    loadFromFile(file) {
      const self = this;
      return new Promise((resolve, reject) => {
        if (!file) return reject(new Error("No file provided"));
        const r = new FileReader();
        r.onload = function (ev) {
          try {
            const parsed = JSON.parse(ev.target.result);
            self.loadFromObject(parsed);
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        };
        r.onerror = (err) => reject(err);
        r.readAsText(file);
      });
    }

    // --- tree traversal helper (sklearn-style tree object expected) ---
    _traverseTree(treeObj, features) {
      // defensive checks
      if (!treeObj || !treeObj.children_left) {
        // return a fallback distribution
        return [1, 0];
      }

      const left = treeObj.children_left;
      const right = treeObj.children_right;
      const feat = treeObj.feature;
      const thresh = treeObj.threshold;
      const value = treeObj.value; // value[node] -> array of class counts

      let node = 0;
      let steps = 0;
      while (true) {
        steps++;
        if (steps > 10000) {
          // safety bail
          return Array.isArray(value[node]) ? value[node] : value[0] || [1, 0];
        }
        // leaf detection: in many sklearn JSONs, children_left[node] === -1 indicates leaf
        const isLeaf =
          feat[node] === undefined ||
          feat[node] === -2 ||
          left[node] === -1 ||
          right[node] === -1;
        if (isLeaf) {
          if (Array.isArray(value[node])) return value[node];
          // sometimes value[node] is nested like [[count0, count1]]
          if (Array.isArray(value[node]) && Array.isArray(value[node][0]))
            return value[node][0];
          // fallback
          return Array.isArray(value) ? value : [1, 0];
        }
        const f = feat[node];
        const t = thresh[node];
        const v =
          features[f] === undefined || features[f] === null ? 0 : features[f];
        if (v <= t) {
          node = left[node];
        } else {
          node = right[node];
        }
        if (node < 0 || node >= left.length) {
          // out-of-bounds safety
          return Array.isArray(
            value[Math.max(0, Math.min(node, value.length - 1))]
          )
            ? value[Math.max(0, Math.min(node, value.length - 1))]
            : value[0] || [1, 0];
        }
      }
    }

    // Predict a single feature vector. Always returns { pred, probs: [p0,p1] }
    predictOne(features) {
      features = ensureArray(features);

      if (!this.loaded)
        throw new Error("RF model not loaded (call load/loadFromObject)");

      // Linear/compact model path
      if (this._isLinear && Array.isArray(this._weights)) {
        const score = numericDot(this._weights, features) + Number(this._bias);
        // Use sigmoid to produce a pseudo-probability; threshold for class decision
        const p1 = sigmoid(score);
        const pred = p1 >= this._threshold ? 1 : 0;
        const p0 = 1 - p1;
        return { pred, probs: [Number(p0.toFixed(3)), Number(p1.toFixed(3))] };
      }

      // Tree-voting ensemble
      if (Array.isArray(this.trees) && this.trees.length > 0) {
        const votes = new Array(this.n_classes || 2).fill(0);
        for (const t of this.trees) {
          try {
            const dist = this._traverseTree(t, features);
            if (!Array.isArray(dist)) continue;
            // flatten nested arrays if necessary
            const flat = Array.isArray(dist[0]) ? dist[0] : dist;
            const clsIdx = flat.indexOf(Math.max(...flat));
            votes[clsIdx] = (votes[clsIdx] || 0) + 1;
          } catch (e) {
            // ignore tree errors, continue
            console.warn("tree traverse error:", e);
          }
        }
        const total = votes.reduce((s, v) => s + v, 0) || 1;
        const probs = votes.map((v) => Number((v / total).toFixed(3)));
        const pred = probs.indexOf(Math.max(...probs));
        return { pred, probs };
      }

      // As a last resort, fallback to a simple heuristic
      const sum = features.reduce((s, v) => s + Number(v || 0), 0);
      const pred = sum >= 3.5 ? 1 : 0;
      const p1 = pred ? 0.9 : 0.1;
      return {
        pred,
        probs: [Number((1 - p1).toFixed(3)), Number(p1.toFixed(3))],
      };
    }

    // batch
    predict(X) {
      return (X || []).map((x) => this.predictOne(x));
    }
  }

  // Expose
  global.BrowserRF = BrowserRF;
})(window);
