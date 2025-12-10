// features.js
// Single, cleaned feature extractor: normalized text, URL handling, and domain_mismatch heuristics.

(function (global) {
  // Ordered feature names expected by RandomForest export and DBSCAN flows:
  const featureNames = [
    "word_make",
    "word_address",
    "word_all",
    "word_3d",
    "word_our",
    "word_over",
    "word_remove",
    "word_internet",
    "word_order",
    "word_mail",
    "word_receive",
    "word_will",
    "word_people",
    "word_report",
    "word_addresses",
    "word_free",
    "word_credit",
    "word_money",
    "capital_run_length_longest",
    "capital_run_length_total",
    // extended
    "url_count",
    "domain_mismatch",
    "has_attachment",
    "sender_reputation",
  ];

  const spamWords = featureNames
    .filter((f) => f.startsWith("word_"))
    .map((f) => f.slice(5));

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Normalize text: convert various unicode hyphens/minus characters to ASCII '-'
  // and normalize other invisible chars that might break regex matching.
  function normalizeText(text) {
    if (!text) return "";
    return (
      String(text)
        // various hyphen/minus characters -> ASCII hyphen
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
        .replace(/\u00A0/g, " ") // NBSP -> space
        .replace(/\u200B/g, "") // zero-width space -> remove
        .replace(/\uFEFF/g, "")
    ); // BOM if present
  }

  // More permissive URL finder (works after normalization)
  const URL_REGEX = /https?:\/\/[^\s"'<>]+/gi;

  // Helper: extract hostnames from URLs found in text
  function extractUrlHostnames(text) {
    const t = normalizeText(text || "");
    const urls = t.match(URL_REGEX) || [];
    const hosts = [];
    for (const u of urls) {
      try {
        const parsed = new URL(u);
        if (parsed.hostname) hosts.push(parsed.hostname.toLowerCase());
      } catch (e) {
        // try a basic hostname extraction when URL is not strictly parseable
        const withoutProto = u.replace(/^https?:\/\//i, "");
        const host = withoutProto.split("/")[0].split(":")[0];
        if (host) hosts.push(host.toLowerCase());
      }
    }
    return hosts;
  }

  // Basic extractor matching spambase-like style: returns array matching featureNames[0..19]
  function extractFeaturesFromEmail(text) {
    const t0 = normalizeText(text || "");
    const features = [];

    // word counts
    spamWords.forEach((word) => {
      const regex = new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi");
      const matches = t0.match(regex);
      features.push(matches ? matches.length : 0);
    });

    // capitalization stats
    const caps = t0.match(/[A-Z]{2,}/g) || [];
    const longestRun = caps.reduce((max, s) => Math.max(max, s.length), 0);
    const totalCaps = (t0.match(/[A-Z]/g) || []).length;
    features.push(longestRun, totalCaps);

    return features;
  }

  // Extended feature builder: includes url_count, domain_mismatch, has_attachment, sender_reputation
  // meta is an object: { fromDomain, replyToDomain, hasAttachment (bool), senderReputation (0..1 default 0.5) }
  function extractExtendedFeatures(text, meta = {}) {
    const base = extractFeaturesFromEmail(text);
    const t0 = normalizeText(text || "");

    // count URLs
    const urls = t0.match(URL_REGEX) || [];
    const url_count = urls.length;

    const fromD = (meta.fromDomain || "").trim().toLowerCase();
    const replyD = (meta.replyToDomain || "").trim().toLowerCase();

    // domain_mismatch heuristics:
    // - If both fromD and replyD provided and differ -> 1
    // - Else, if fromD provided and any URL host differs from fromD -> 1
    // - Else 0
    let domain_mismatch = 0;
    if (fromD && replyD) {
      domain_mismatch = fromD !== replyD ? 1 : 0;
    } else if (fromD && urls.length) {
      const hosts = extractUrlHostnames(t0);
      domain_mismatch = hosts.some((h) => {
        // compare second-level domain when possible (strip subdomains)
        const sld = (host) => {
          const parts = host.split(".");
          if (parts.length >= 2) return parts.slice(-2).join(".");
          return host;
        };
        return sld(h) !== sld(fromD);
      })
        ? 1
        : 0;
    } else {
      domain_mismatch = 0;
    }

    const has_attachment = meta.hasAttachment ? 1 : 0;
    const sender_reputation =
      typeof meta.senderReputation === "number"
        ? Number(meta.senderReputation)
        : 0.5;

    return base.concat([
      url_count,
      domain_mismatch,
      has_attachment,
      sender_reputation,
    ]);
  }

  // Utility to build a feature vector object from an object row (CSV/JSON import)
  function featuresFromRow(row) {
    return featureNames.map((f) => {
      if (f in row) {
        const v = row[f];
        return Number(v === "" || v === undefined ? 0 : v);
      }
      if (f === "url_count" && "body" in row) {
        const t = normalizeText(String(row.body || ""));
        return (t.match(URL_REGEX) || []).length;
      }
      if (
        f === "domain_mismatch" &&
        ("fromDomain" in row || "replyDomain" in row || "replyToDomain" in row)
      ) {
        const fromD = (row.fromDomain || "").toLowerCase();
        const replyD = (
          row.replyDomain ||
          row.replyToDomain ||
          ""
        ).toLowerCase();
        if (fromD && replyD) return fromD !== replyD ? 1 : 0;
        // fallback: check link host vs fromD
        if (fromD && "body" in row) {
          const hosts = extractUrlHostnames(String(row.body || ""));
          const mismatch = hosts.some((h) => {
            const sld = (host) => {
              const parts = host.split(".");
              return parts.length >= 2 ? parts.slice(-2).join(".") : host;
            };
            return sld(h) !== sld(fromD);
          });
          return mismatch ? 1 : 0;
        }
        return 0;
      }
      if (f === "has_attachment") {
        return row.hasAttachment ? 1 : 0;
      }
      if (f === "sender_reputation") {
        return row.senderReputation ? Number(row.senderReputation) : 0.5;
      }
      return 0;
    });
  }

  // Expose to global
  global.featureNames = featureNames;
  global.extractFeaturesFromEmail = extractFeaturesFromEmail;
  global.extractExtendedFeatures = extractExtendedFeatures;
  global.featuresFromRow = featuresFromRow;
  global.normalizeText = normalizeText;
  global.extractUrlHostnames = extractUrlHostnames;
})(window);
