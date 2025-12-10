// RF loader: auto-load /rf_model.json if present, update UI, and still allow manual file input.
// Exposes window.rfLoadFrom(url) and window.rfLoadFromObject(obj) for programmatic usage.

(function () {
  const input = document.getElementById("rf-file-input");
  const rfStatus = document.getElementById("rf-status");
  const rfInfo = document.getElementById("rf-info");
  const rfFeatureImportances = document.getElementById("rf-featureImportances");

  function setStatus(txt) {
    if (rfStatus) rfStatus.textContent = txt;
  }
  function setInfo(txt) {
    if (rfInfo) rfInfo.textContent = txt;
  }
  function setImportances(obj) {
    if (!rfFeatureImportances) return;
    if (!obj) {
      rfFeatureImportances.textContent = "(feature importances not available)";
    } else {
      try {
        rfFeatureImportances.textContent = JSON.stringify(obj, null, 2);
      } catch (e) {
        rfFeatureImportances.textContent = String(obj);
      }
    }
  }

  // Ensure a BrowserRF instance exists on window.browserRF
  function ensureBrowserRF() {
    if (!window.browserRF) {
      if (window.BrowserRF) {
        window.browserRF = new window.BrowserRF();
      } else {
        // create a tiny shim that throws well-formed errors
        window.browserRF = {
          loaded: false,
          load: function () {
            throw new Error("BrowserRF not available");
          },
          loadFromFile: function () {
            throw new Error("BrowserRF not available");
          },
          predictOne: function () {
            throw new Error("BrowserRF not available");
          },
        };
      }
    }
    return window.browserRF;
  }

  // Programmatic loaders exposed globally
  window.rfLoadFrom = async function (url) {
    const rf = ensureBrowserRF();
    try {
      setStatus(`Loading ${url} ...`);
      if (typeof rf.load !== "function")
        throw new Error("browserRF.load() not available");
      await rf.load(url);
      setStatus(`RandomForest loaded from ${url}`);
      setInfo(`Model loaded from ${url}`);
      setImportances(rf.feature_importances || rf.featureImportances || null);
      return rf;
    } catch (err) {
      setStatus(`RF load failed: ${err.message || err}`);
      setInfo(`Failed to load model from ${url}: ${err.message || err}`);
      throw err;
    }
  };

  window.rfLoadFromObject = function (obj, label) {
    const rf = ensureBrowserRF();
    try {
      if (typeof rf.loadFromObject === "function") {
        rf.loadFromObject(obj);
      } else if (
        typeof rf.loadFromObject === "undefined" &&
        typeof rf.loadFromFile === "function"
      ) {
        // fallback: inject common props if we can
        rf.trees = obj.trees || null;
        rf.n_classes = obj.n_classes || rf.n_classes || 2;
        rf.loaded = !!rf.trees;
      } else {
        throw new Error("browserRF does not support loadFromObject");
      }
      setStatus(`RandomForest loaded${label ? " (" + label + ")" : ""}`);
      setInfo(`Model loaded${label ? " (" + label + ")" : ""}`);
      setImportances(obj.feature_importances || obj.featureImportances || null);
      return rf;
    } catch (err) {
      setStatus(`RF load failed: ${err.message || err}`);
      setInfo(`Failed to load model: ${err.message || err}`);
      throw err;
    }
  };

  // Attempt to auto-load from /rf_model.json at startup
  async function tryAutoLoadRoot() {
    if (!window.fetch) return;
    try {
      setStatus("Checking for /rf_model.json ...");
      const res = await fetch("/rf_model.json", {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) {
        setStatus("No /rf_model.json found (status " + res.status + ")");
        return;
      }
      const json = await res.json();
      // ensure BrowserRF available
      const rf = ensureBrowserRF();
      if (typeof rf.loadFromObject === "function") {
        rf.loadFromObject(json);
      } else if (typeof rf.load === "function") {
        // last resort: temporarily write a small tmp file and call load? Instead just set props
        rf.trees = json.trees || null;
        rf.n_classes = json.n_classes || rf.n_classes || 2;
        rf.loaded = !!rf.trees;
      }
      setStatus("RandomForest auto-loaded from /rf_model.json");
      setInfo("Model loaded from /rf_model.json");
      setImportances(
        json.feature_importances || json.featureImportances || null
      );
    } catch (err) {
      // silent fail; leave status unchanged or set a hint
      setStatus("Auto-load: no rf_model.json or failed to parse");
      setInfo("No model auto-loaded");
      console.warn("rf_loader auto-load failed:", err);
    }
  }

  // Wire file input if present
  if (input) {
    input.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      setStatus(`Reading ${file.name}...`);
      try {
        const text = await file.text();
        const json = JSON.parse(text);

        // prefer BrowserRF.loadFromObject if provided
        if (
          window.browserRF &&
          typeof window.browserRF.loadFromObject === "function"
        ) {
          window.browserRF.loadFromObject(json);
          setStatus(`RandomForest loaded from local file: ${file.name}`);
          setInfo(`Model loaded from ${file.name} (client-side)`);
          setImportances(
            json.feature_importances || json.featureImportances || null
          );
        } else if (
          window.browserRF &&
          typeof window.browserRF.loadFromFile === "function"
        ) {
          await window.browserRF.loadFromFile(file);
          setStatus(`RandomForest loaded from local file: ${file.name}`);
          setInfo(`Model loaded from ${file.name} (client-side)`);
          setImportances(window.browserRF.feature_importances || null);
        } else if (window.BrowserRF) {
          const inst = new window.BrowserRF();
          if (typeof inst.loadFromObject === "function") {
            inst.loadFromObject(json);
            window.browserRF = inst;
            setStatus(
              `RandomForest loaded into new instance from ${file.name}`
            );
            setInfo(`Model loaded from ${file.name} (client-side)`);
            setImportances(
              json.feature_importances || json.featureImportances || null
            );
          } else {
            throw new Error("BrowserRF does not support loadFromObject");
          }
        } else {
          throw new Error("No BrowserRF available on page");
        }
      } catch (err) {
        console.error("rf_loader: failed to load file:", err);
        setStatus(`Load failed: ${err.message || err}`);
        setInfo(`Failed to load model: ${err.message || err}`);
      }
    });
  }

  // start auto-load (non-blocking)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryAutoLoadRoot);
  } else {
    tryAutoLoadRoot();
  }
})();
