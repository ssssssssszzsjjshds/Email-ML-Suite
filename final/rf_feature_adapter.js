// Build a numeric feature vector matching an RF model's feature_names (CSV-style) from plain email text.
// Exposes:
//   window.buildModelVectorForRF(modelFeatureNames, text, meta)
// The function handles many of the CSV column names you showed (NumDots, SubdomainLevel, UrlLength, NumDash, NoHttps, NumSensitiveWords, DomainInPaths, etc.)
// Use it when your rf_model.json contains feature_names that differ from the minimal spambase-like features.

(function (global) {
  // small helpers
  function norm(txt) {
    return (
      global.normalizeText ? global.normalizeText(txt) : String(txt || "")
    ).trim();
  }

  function firstUrl(text) {
    const t = norm(text);
    const m = t.match(/https?:\/\/[^\s'"]+/i);
    return m ? m[0] : "";
  }

  function parseUrlParts(url) {
    try {
      // Ensure ASCII hyphens normalized
      const u = url.replace(/[\u2010-\u2015\u2212]/g, "-");
      const parsed = new URL(u);
      return {
        hostname: parsed.hostname || "",
        pathname: parsed.pathname || "",
        search: parsed.search || "",
        href: parsed.href || "",
        protocol: parsed.protocol || "",
      };
    } catch (e) {
      // fallback: basic parse
      const withoutProto = url.replace(/^https?:\/\//i, "");
      const parts = withoutProto.split("/");
      const hostname = parts[0] || "";
      const pathname = "/" + (parts.slice(1).join("/") || "");
      return {
        hostname,
        pathname,
        search: "",
        href: url,
        protocol: url.startsWith("https:") ? "https:" : "http:",
      };
    }
  }

  function countDigits(s) {
    return (s.match(/\d/g) || []).length;
  }

  function countChars(s, ch) {
    if (!s) return 0;
    const re = new RegExp(escapeRegExp(ch), "g");
    return (s.match(re) || []).length;
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const sensitiveWords = [
    "password",
    "billing",
    "confirm",
    "bank",
    "account",
    "ssn",
    "verify",
    "login",
    "credential",
    "verification",
    "payment",
    "refund",
    "update",
  ];
  const brandWords = [
    "paypal",
    "amazon",
    "apple",
    "microsoft",
    "google",
    "bank",
    "billing",
    "service",
  ]; // simple list

  // Compute many common URL-based features used in your CSV
  function computeUrlFeatures(text, meta) {
    const url = firstUrl(text);
    const parts = parseUrlParts(url);
    const hostname = (parts.hostname || "").toLowerCase();
    const pathname = parts.pathname || "";
    const search = parts.search || "";
    const href = parts.href || "";

    const numDots = (hostname.match(/\./g) || []).length;
    const subdomainLevel = hostname
      ? Math.max(0, hostname.split(".").length - 2)
      : 0; // number of subdomains (approx)
    const pathLevel =
      pathname === "/" ? 0 : pathname.split("/").filter(Boolean).length;
    const urlLength = href.length;
    const numDash = (href.match(/-/g) || []).length;
    const numDashInHostname = (hostname.match(/-/g) || []).length;
    const atSymbol = href.includes("@") ? 1 : 0;
    const tildeSymbol = href.includes("~") ? 1 : 0;
    const numUnderscore = (href.match(/_/g) || []).length;
    const numPercent = (href.match(/%/g) || []).length;
    const numQueryComponents = search
      ? search.replace(/^\?/, "").split("&").filter(Boolean).length
      : 0;
    const numAmpersand = (search.match(/&/g) || []).length;
    const numHash = (href.match(/#/g) || []).length;
    const numNumericChars = countDigits(href);
    const noHttps =
      parts.protocol && parts.protocol.toLowerCase() === "https:" ? 0 : 1;
    // RandomString heuristic: long run of letters/digits without separators in path or hostname
    const randMatch = (href.match(/[a-z0-9]{12,}/i) || []).length;
    const randomString = randMatch ? 1 : 0;
    // IP in hostname?
    const ipAddress = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ? 1 : 0;
    // DomainInSubdomains: e.g., domain repeated inside subdomain parts
    const hostnameParts = hostname.split(".");
    const domainInSubdomains = hostnameParts
      .slice(0, -2)
      .some(
        (p) =>
          p &&
          hostnameParts[hostnameParts.length - 2] &&
          p.includes(hostnameParts[hostnameParts.length - 2])
      )
      ? 1
      : 0;
    const domainInPaths = pathname
      .toLowerCase()
      .includes((hostname.split(".")[0] || "").toLowerCase())
      ? 1
      : 0;
    const httpsInHostname = hostname.includes("https") ? 1 : 0;
    const hostnameLength = hostname.length;
    const pathLength = pathname.length;
    const queryLength = search.length;
    const doubleSlashInPath = pathname.includes("//") ? 1 : 0;

    const sensitiveCount = sensitiveWords.reduce(
      (s, w) =>
        s +
        (href.toLowerCase().includes(w) || pathname.toLowerCase().includes(w)
          ? 1
          : 0),
      0
    );
    const embeddedBrand = brandWords.reduce(
      (s, w) => s + (href.toLowerCase().includes(w) ? 1 : 0),
      0
    )
      ? 1
      : 0;

    // Simple heuristics for some boolean columns in your CSV
    const insecureForms =
      href.toLowerCase().includes("http://") &&
      href.toLowerCase().includes("form")
        ? 1
        : 0;
    const fakeLinkInStatusBar = href.includes("javascript:") ? 1 : 0;
    const rightClickDisabled = 0; // requires JS instrumentation on the page; set 0
    const popupWindow = href.toLowerCase().includes("popup") ? 1 : 0;
    const submitInfoToEmail = href.toLowerCase().includes("mailto:") ? 1 : 0;
    const iframeOrFrame =
      href.toLowerCase().includes("<iframe") ||
      href.toLowerCase().includes("iframe")
        ? 1
        : 0;
    const missingTitle = 0;
    const imagesOnlyInForm = 0;

    // Percent external hyperlinks etc cannot be computed reliably from a single email body w/o full DOM; set to 0
    const pctExtHyperlinks = 0;
    const pctExtResourceUrls = 0;
    const extFavicon = 0;
    const relativeFormAction = 0;
    const extFormAction = 0;
    const abnormalFormAction = 0;
    const pctNullSelfRedirectHyperlinks = 0;
    const frequentDomainNameMismatch = 0;
    const subdomainLevelRT = subdomainLevel;
    const urlLengthRT = urlLength;
    const pctExtResourceUrlsRT = pctExtResourceUrls;
    const abnormalExtFormActionR = abnormalFormAction;
    const extMetaScriptLinkRT = 0;
    const pctExtNullSelfRedirectHyperlinksRT = 0;

    return {
      url,
      numDots,
      subdomainLevel,
      pathLevel,
      urlLength,
      numDash,
      numDashInHostname,
      atSymbol,
      tildeSymbol,
      numUnderscore,
      numPercent,
      numQueryComponents,
      numAmpersand,
      numHash,
      numNumericChars,
      noHttps,
      randomString,
      ipAddress,
      domainInSubdomains,
      domainInPaths,
      httpsInHostname,
      hostnameLength,
      pathLength,
      queryLength,
      doubleSlashInPath,
      sensitiveCount,
      embeddedBrand,
      pctExtHyperlinks,
      pctExtResourceUrls,
      extFavicon,
      insecureForms,
      relativeFormAction,
      extFormAction,
      abnormalFormAction,
      pctNullSelfRedirectHyperlinks,
      frequentDomainNameMismatch,
      fakeLinkInStatusBar,
      rightClickDisabled,
      popupWindow,
      submitInfoToEmail,
      iframeOrFrame,
      missingTitle,
      imagesOnlyInForm,
      subdomainLevelRT,
      urlLengthRT,
      pctExtResourceUrlsRT,
      abnormalExtFormActionR,
      extMetaScriptLinkRT,
      pctExtNullSelfRedirectHyperlinksRT,
    };
  }

  // Build an ordered numeric vector that matches modelFeatureNames
  function buildModelVectorForRF(modelFeatureNames, text, meta) {
    const urlFeatures = computeUrlFeatures(text, meta);
    const ext = global.extractExtendedFeatures
      ? global.extractExtendedFeatures(text, meta)
      : [];
    // ext is spambase-like base + [url_count, domain_mismatch, has_attachment, sender_reputation]
    // build a dictionary of common keys -> values
    const dict = {};

    // Map spambase base features if available (we don't have labels for each, but ext[0..] correspond to featureNames in features.js)
    // For convenience, make available the 20 typical features by index (if ext length >= 24)
    // We also include common names from the CSV you provided
    dict.UrlLength = urlFeatures.urlLength;
    dict.NumDots = urlFeatures.numDots;
    dict.SubdomainLevel = urlFeatures.subdomainLevel;
    dict.PathLevel = urlFeatures.pathLevel;
    dict.NumDash = urlFeatures.numDash;
    dict.NumDashInHostname = urlFeatures.numDashInHostname;
    dict.AtSymbol = urlFeatures.atSymbol;
    dict.TildeSymbol = urlFeatures.tildeSymbol;
    dict.NumUnderscore = urlFeatures.numUnderscore;
    dict.NumPercent = urlFeatures.numPercent;
    dict.NumQueryComponents = urlFeatures.numQueryComponents;
    dict.NumAmpersand = urlFeatures.numAmpersand;
    dict.NumHash = urlFeatures.numHash;
    dict.NumNumericChars = urlFeatures.numNumericChars;
    dict.NoHttps = urlFeatures.noHttps;
    dict.RandomString = urlFeatures.randomString;
    dict.IpAddress = urlFeatures.ipAddress;
    dict.DomainInSubdomains = urlFeatures.domainInSubdomains;
    dict.DomainInPaths = urlFeatures.domainInPaths;
    dict.HttpsInHostname = urlFeatures.httpsInHostname;
    dict.HostnameLength = urlFeatures.hostnameLength;
    dict.PathLength = urlFeatures.pathLength;
    dict.QueryLength = urlFeatures.queryLength;
    dict.DoubleSlashInPath = urlFeatures.doubleSlashInPath;
    dict.NumSensitiveWords = urlFeatures.sensitiveCount;
    dict.EmbeddedBrandName = urlFeatures.embeddedBrand;
    dict.PctExtHyperlinks = urlFeatures.pctExtHyperlinks;
    dict.PctExtResourceUrls = urlFeatures.pctExtResourceUrls;
    dict.ExtFavicon = urlFeatures.extFavicon;
    dict.InsecureForms = urlFeatures.insecureForms;
    dict.RelativeFormAction = urlFeatures.relativeFormAction;
    dict.ExtFormAction = urlFeatures.extFormAction;
    dict.AbnormalFormAction = urlFeatures.abnormalFormAction;
    dict.PctNullSelfRedirectHyperlinks =
      urlFeatures.pctNullSelfRedirectHyperlinks;
    dict.FrequentDomainNameMismatch = urlFeatures.frequentDomainNameMismatch;
    dict.FakeLinkInStatusBar = urlFeatures.fakeLinkInStatusBar;
    dict.RightClickDisabled = urlFeatures.rightClickDisabled;
    dict.PopUpWindow = urlFeatures.popupWindow;
    dict.SubmitInfoToEmail = urlFeatures.submitInfoToEmail;
    dict.IframeOrFrame = urlFeatures.iframeOrFrame;
    dict.MissingTitle = urlFeatures.missingTitle;
    dict.ImagesOnlyInForm = urlFeatures.imagesOnlyInForm;
    dict.SubdomainLevelRT = urlFeatures.subdomainLevelRT;
    dict.UrlLengthRT = urlFeatures.urlLengthRT;
    dict.PctExtResourceUrlsRT = urlFeatures.pctExtResourceUrlsRT;
    dict.AbnormalExtFormActionR = urlFeatures.abnormalExtFormActionR;
    dict.ExtMetaScriptLinkRT = urlFeatures.extMetaScriptLinkRT;
    dict.PctExtNullSelfRedirectHyperlinksRT =
      urlFeatures.pctExtNullSelfRedirectHyperlinksRT;

    // Also include values that extractExtendedFeatures exposes at the end
    // ext: [...20 features..., url_count, domain_mismatch, has_attachment, sender_reputation]
    if (Array.isArray(ext) && ext.length >= 24) {
      dict.url_count = ext[20];
      dict.domain_mismatch = ext[21];
      dict.has_attachment = ext[22];
      dict.sender_reputation = ext[23];
    } else {
      // fallback
      dict.url_count = urlFeatures.url ? 1 : 0;
      dict.domain_mismatch =
        meta &&
        meta.fromDomain &&
        meta.replyToDomain &&
        meta.fromDomain !== meta.replyToDomain
          ? 1
          : 0;
      dict.has_attachment = meta && meta.hasAttachment ? 1 : 0;
      dict.sender_reputation =
        meta && typeof meta.senderReputation === "number"
          ? meta.senderReputation
          : 0.5;
    }

    // Build final vector in order of modelFeatureNames
    const vec = modelFeatureNames.map((fname) => {
      // accept different casing/variants
      if (fname in dict) return Number(dict[fname] || 0);
      const lower = fname.toLowerCase();
      if (lower in dict) return Number(dict[lower] || 0);
      // try some common alias mapping
      if (lower === "numdots" || lower === "num_dots" || lower === "num.dots")
        return Number(dict.NumDots || 0);
      if (lower === "urllength" || lower === "url_length")
        return Number(dict.UrlLength || 0);
      if (lower === "subdomainlevel" || lower === "subdomain_level")
        return Number(dict.SubdomainLevel || 0);
      if (lower === "numdash" || lower === "num_dash")
        return Number(dict.NumDash || 0);
      if (lower === "nohttps") return Number(dict.NoHttps || 0);
      if (lower === "num_sensitive_words" || lower === "numsensitivewords")
        return Number(dict.NumSensitiveWords || 0);
      if (lower === "url_count") return Number(dict.url_count || 0);
      if (lower === "domain_mismatch") return Number(dict.domain_mismatch || 0);
      if (lower === "sender_reputation")
        return Number(dict.sender_reputation || 0);
      // unknown feature: return 0
      return 0;
    });

    return vec;
  }

  global.buildModelVectorForRF = buildModelVectorForRF;
})(window);
