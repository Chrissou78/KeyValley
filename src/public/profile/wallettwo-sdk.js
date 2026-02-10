import re, { useEffect as M } from "react";
import { jsx as B, Fragment as Ot } from "react/jsx-runtime";
import './main.css';function Qe(e, t) {
  return function() {
    return e.apply(t, arguments);
  };
}
const { toString: Tt } = Object.prototype, { getPrototypeOf: Oe } = Object, { iterator: le, toStringTag: Ze } = Symbol, ue = /* @__PURE__ */ ((e) => (t) => {
  const n = Tt.call(t);
  return e[n] || (e[n] = n.slice(8, -1).toLowerCase());
})(/* @__PURE__ */ Object.create(null)), N = (e) => (e = e.toLowerCase(), (t) => ue(t) === e), fe = (e) => (t) => typeof t === e, { isArray: J } = Array, z = fe("undefined");
function X(e) {
  return e !== null && !z(e) && e.constructor !== null && !z(e.constructor) && T(e.constructor.isBuffer) && e.constructor.isBuffer(e);
}
const Ye = N("ArrayBuffer");
function At(e) {
  let t;
  return typeof ArrayBuffer < "u" && ArrayBuffer.isView ? t = ArrayBuffer.isView(e) : t = e && e.buffer && Ye(e.buffer), t;
}
const xt = fe("string"), T = fe("function"), et = fe("number"), G = (e) => e !== null && typeof e == "object", Ct = (e) => e === !0 || e === !1, oe = (e) => {
  if (ue(e) !== "object")
    return !1;
  const t = Oe(e);
  return (t === null || t === Object.prototype || Object.getPrototypeOf(t) === null) && !(Ze in e) && !(le in e);
}, Lt = (e) => {
  if (!G(e) || X(e))
    return !1;
  try {
    return Object.keys(e).length === 0 && Object.getPrototypeOf(e) === Object.prototype;
  } catch {
    return !1;
  }
}, _t = N("Date"), Nt = N("File"), Pt = N("Blob"), Ut = N("FileList"), kt = (e) => G(e) && T(e.pipe), Ft = (e) => {
  let t;
  return e && (typeof FormData == "function" && e instanceof FormData || T(e.append) && ((t = ue(e)) === "formdata" || // detect form-data instance
  t === "object" && T(e.toString) && e.toString() === "[object FormData]"));
}, Bt = N("URLSearchParams"), [Dt, jt, It, qt] = ["ReadableStream", "Request", "Response", "Headers"].map(N), Ht = (e) => e.trim ? e.trim() : e.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "");
function Q(e, t, { allOwnKeys: n = !1 } = {}) {
  if (e === null || typeof e > "u")
    return;
  let r, s;
  if (typeof e != "object" && (e = [e]), J(e))
    for (r = 0, s = e.length; r < s; r++)
      t.call(null, e[r], r, e);
  else {
    if (X(e))
      return;
    const i = n ? Object.getOwnPropertyNames(e) : Object.keys(e), o = i.length;
    let a;
    for (r = 0; r < o; r++)
      a = i[r], t.call(null, e[a], a, e);
  }
}
function tt(e, t) {
  if (X(e))
    return null;
  t = t.toLowerCase();
  const n = Object.keys(e);
  let r = n.length, s;
  for (; r-- > 0; )
    if (s = n[r], t === s.toLowerCase())
      return s;
  return null;
}
const q = typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : typeof window < "u" ? window : global, nt = (e) => !z(e) && e !== q;
function be() {
  const { caseless: e, skipUndefined: t } = nt(this) && this || {}, n = {}, r = (s, i) => {
    const o = e && tt(n, i) || i;
    oe(n[o]) && oe(s) ? n[o] = be(n[o], s) : oe(s) ? n[o] = be({}, s) : J(s) ? n[o] = s.slice() : (!t || !z(s)) && (n[o] = s);
  };
  for (let s = 0, i = arguments.length; s < i; s++)
    arguments[s] && Q(arguments[s], r);
  return n;
}
const Mt = (e, t, n, { allOwnKeys: r } = {}) => (Q(t, (s, i) => {
  n && T(s) ? e[i] = Qe(s, n) : e[i] = s;
}, { allOwnKeys: r }), e), $t = (e) => (e.charCodeAt(0) === 65279 && (e = e.slice(1)), e), vt = (e, t, n, r) => {
  e.prototype = Object.create(t.prototype, r), e.prototype.constructor = e, Object.defineProperty(e, "super", {
    value: t.prototype
  }), n && Object.assign(e.prototype, n);
}, zt = (e, t, n, r) => {
  let s, i, o;
  const a = {};
  if (t = t || {}, e == null) return t;
  do {
    for (s = Object.getOwnPropertyNames(e), i = s.length; i-- > 0; )
      o = s[i], (!r || r(o, e, t)) && !a[o] && (t[o] = e[o], a[o] = !0);
    e = n !== !1 && Oe(e);
  } while (e && (!n || n(e, t)) && e !== Object.prototype);
  return t;
}, Jt = (e, t, n) => {
  e = String(e), (n === void 0 || n > e.length) && (n = e.length), n -= t.length;
  const r = e.indexOf(t, n);
  return r !== -1 && r === n;
}, Wt = (e) => {
  if (!e) return null;
  if (J(e)) return e;
  let t = e.length;
  if (!et(t)) return null;
  const n = new Array(t);
  for (; t-- > 0; )
    n[t] = e[t];
  return n;
}, Vt = /* @__PURE__ */ ((e) => (t) => e && t instanceof e)(typeof Uint8Array < "u" && Oe(Uint8Array)), Kt = (e, t) => {
  const r = (e && e[le]).call(e);
  let s;
  for (; (s = r.next()) && !s.done; ) {
    const i = s.value;
    t.call(e, i[0], i[1]);
  }
}, Xt = (e, t) => {
  let n;
  const r = [];
  for (; (n = e.exec(t)) !== null; )
    r.push(n);
  return r;
}, Gt = N("HTMLFormElement"), Qt = (e) => e.toLowerCase().replace(
  /[-_\s]([a-z\d])(\w*)/g,
  function(n, r, s) {
    return r.toUpperCase() + s;
  }
), ke = (({ hasOwnProperty: e }) => (t, n) => e.call(t, n))(Object.prototype), Zt = N("RegExp"), rt = (e, t) => {
  const n = Object.getOwnPropertyDescriptors(e), r = {};
  Q(n, (s, i) => {
    let o;
    (o = t(s, i, e)) !== !1 && (r[i] = o || s);
  }), Object.defineProperties(e, r);
}, Yt = (e) => {
  rt(e, (t, n) => {
    if (T(e) && ["arguments", "caller", "callee"].indexOf(n) !== -1)
      return !1;
    const r = e[n];
    if (T(r)) {
      if (t.enumerable = !1, "writable" in t) {
        t.writable = !1;
        return;
      }
      t.set || (t.set = () => {
        throw Error("Can not rewrite read-only method '" + n + "'");
      });
    }
  });
}, en = (e, t) => {
  const n = {}, r = (s) => {
    s.forEach((i) => {
      n[i] = !0;
    });
  };
  return J(e) ? r(e) : r(String(e).split(t)), n;
}, tn = () => {
}, nn = (e, t) => e != null && Number.isFinite(e = +e) ? e : t;
function rn(e) {
  return !!(e && T(e.append) && e[Ze] === "FormData" && e[le]);
}
const sn = (e) => {
  const t = new Array(10), n = (r, s) => {
    if (G(r)) {
      if (t.indexOf(r) >= 0)
        return;
      if (X(r))
        return r;
      if (!("toJSON" in r)) {
        t[s] = r;
        const i = J(r) ? [] : {};
        return Q(r, (o, a) => {
          const d = n(o, s + 1);
          !z(d) && (i[a] = d);
        }), t[s] = void 0, i;
      }
    }
    return r;
  };
  return n(e, 0);
}, on = N("AsyncFunction"), an = (e) => e && (G(e) || T(e)) && T(e.then) && T(e.catch), st = ((e, t) => e ? setImmediate : t ? ((n, r) => (q.addEventListener("message", ({ source: s, data: i }) => {
  s === q && i === n && r.length && r.shift()();
}, !1), (s) => {
  r.push(s), q.postMessage(n, "*");
}))(`axios@${Math.random()}`, []) : (n) => setTimeout(n))(
  typeof setImmediate == "function",
  T(q.postMessage)
), cn = typeof queueMicrotask < "u" ? queueMicrotask.bind(q) : typeof process < "u" && process.nextTick || st, ln = (e) => e != null && T(e[le]), c = {
  isArray: J,
  isArrayBuffer: Ye,
  isBuffer: X,
  isFormData: Ft,
  isArrayBufferView: At,
  isString: xt,
  isNumber: et,
  isBoolean: Ct,
  isObject: G,
  isPlainObject: oe,
  isEmptyObject: Lt,
  isReadableStream: Dt,
  isRequest: jt,
  isResponse: It,
  isHeaders: qt,
  isUndefined: z,
  isDate: _t,
  isFile: Nt,
  isBlob: Pt,
  isRegExp: Zt,
  isFunction: T,
  isStream: kt,
  isURLSearchParams: Bt,
  isTypedArray: Vt,
  isFileList: Ut,
  forEach: Q,
  merge: be,
  extend: Mt,
  trim: Ht,
  stripBOM: $t,
  inherits: vt,
  toFlatObject: zt,
  kindOf: ue,
  kindOfTest: N,
  endsWith: Jt,
  toArray: Wt,
  forEachEntry: Kt,
  matchAll: Xt,
  isHTMLForm: Gt,
  hasOwnProperty: ke,
  hasOwnProp: ke,
  // an alias to avoid ESLint no-prototype-builtins detection
  reduceDescriptors: rt,
  freezeMethods: Yt,
  toObjectSet: en,
  toCamelCase: Qt,
  noop: tn,
  toFiniteNumber: nn,
  findKey: tt,
  global: q,
  isContextDefined: nt,
  isSpecCompliantForm: rn,
  toJSONObject: sn,
  isAsyncFn: on,
  isThenable: an,
  setImmediate: st,
  asap: cn,
  isIterable: ln
};
function g(e, t, n, r, s) {
  Error.call(this), Error.captureStackTrace ? Error.captureStackTrace(this, this.constructor) : this.stack = new Error().stack, this.message = e, this.name = "AxiosError", t && (this.code = t), n && (this.config = n), r && (this.request = r), s && (this.response = s, this.status = s.status ? s.status : null);
}
c.inherits(g, Error, {
  toJSON: function() {
    return {
      // Standard
      message: this.message,
      name: this.name,
      // Microsoft
      description: this.description,
      number: this.number,
      // Mozilla
      fileName: this.fileName,
      lineNumber: this.lineNumber,
      columnNumber: this.columnNumber,
      stack: this.stack,
      // Axios
      config: c.toJSONObject(this.config),
      code: this.code,
      status: this.status
    };
  }
});
const ot = g.prototype, it = {};
[
  "ERR_BAD_OPTION_VALUE",
  "ERR_BAD_OPTION",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ERR_NETWORK",
  "ERR_FR_TOO_MANY_REDIRECTS",
  "ERR_DEPRECATED",
  "ERR_BAD_RESPONSE",
  "ERR_BAD_REQUEST",
  "ERR_CANCELED",
  "ERR_NOT_SUPPORT",
  "ERR_INVALID_URL"
  // eslint-disable-next-line func-names
].forEach((e) => {
  it[e] = { value: e };
});
Object.defineProperties(g, it);
Object.defineProperty(ot, "isAxiosError", { value: !0 });
g.from = (e, t, n, r, s, i) => {
  const o = Object.create(ot);
  c.toFlatObject(e, o, function(u) {
    return u !== Error.prototype;
  }, (l) => l !== "isAxiosError");
  const a = e && e.message ? e.message : "Error", d = t == null && e ? e.code : t;
  return g.call(o, a, d, n, r, s), e && o.cause == null && Object.defineProperty(o, "cause", { value: e, configurable: !0 }), o.name = e && e.name || "Error", i && Object.assign(o, i), o;
};
const un = null;
function Ee(e) {
  return c.isPlainObject(e) || c.isArray(e);
}
function at(e) {
  return c.endsWith(e, "[]") ? e.slice(0, -2) : e;
}
function Fe(e, t, n) {
  return e ? e.concat(t).map(function(s, i) {
    return s = at(s), !n && i ? "[" + s + "]" : s;
  }).join(n ? "." : "") : t;
}
function fn(e) {
  return c.isArray(e) && !e.some(Ee);
}
const dn = c.toFlatObject(c, {}, null, function(t) {
  return /^is[A-Z]/.test(t);
});
function de(e, t, n) {
  if (!c.isObject(e))
    throw new TypeError("target must be an object");
  t = t || new FormData(), n = c.toFlatObject(n, {
    metaTokens: !0,
    dots: !1,
    indexes: !1
  }, !1, function(h, m) {
    return !c.isUndefined(m[h]);
  });
  const r = n.metaTokens, s = n.visitor || u, i = n.dots, o = n.indexes, d = (n.Blob || typeof Blob < "u" && Blob) && c.isSpecCompliantForm(t);
  if (!c.isFunction(s))
    throw new TypeError("visitor must be a function");
  function l(f) {
    if (f === null) return "";
    if (c.isDate(f))
      return f.toISOString();
    if (c.isBoolean(f))
      return f.toString();
    if (!d && c.isBlob(f))
      throw new g("Blob is not supported. Use a Buffer instead.");
    return c.isArrayBuffer(f) || c.isTypedArray(f) ? d && typeof Blob == "function" ? new Blob([f]) : Buffer.from(f) : f;
  }
  function u(f, h, m) {
    let E = f;
    if (f && !m && typeof f == "object") {
      if (c.endsWith(h, "{}"))
        h = r ? h : h.slice(0, -2), f = JSON.stringify(f);
      else if (c.isArray(f) && fn(f) || (c.isFileList(f) || c.endsWith(h, "[]")) && (E = c.toArray(f)))
        return h = at(h), E.forEach(function(S, O) {
          !(c.isUndefined(S) || S === null) && t.append(
            // eslint-disable-next-line no-nested-ternary
            o === !0 ? Fe([h], O, i) : o === null ? h : h + "[]",
            l(S)
          );
        }), !1;
    }
    return Ee(f) ? !0 : (t.append(Fe(m, h, i), l(f)), !1);
  }
  const p = [], w = Object.assign(dn, {
    defaultVisitor: u,
    convertValue: l,
    isVisitable: Ee
  });
  function b(f, h) {
    if (!c.isUndefined(f)) {
      if (p.indexOf(f) !== -1)
        throw Error("Circular reference detected in " + h.join("."));
      p.push(f), c.forEach(f, function(E, C) {
        (!(c.isUndefined(E) || E === null) && s.call(
          t,
          E,
          c.isString(C) ? C.trim() : C,
          h,
          w
        )) === !0 && b(E, h ? h.concat(C) : [C]);
      }), p.pop();
    }
  }
  if (!c.isObject(e))
    throw new TypeError("data must be an object");
  return b(e), t;
}
function Be(e) {
  const t = {
    "!": "%21",
    "'": "%27",
    "(": "%28",
    ")": "%29",
    "~": "%7E",
    "%20": "+",
    "%00": "\0"
  };
  return encodeURIComponent(e).replace(/[!'()~]|%20|%00/g, function(r) {
    return t[r];
  });
}
function Te(e, t) {
  this._pairs = [], e && de(e, this, t);
}
const ct = Te.prototype;
ct.append = function(t, n) {
  this._pairs.push([t, n]);
};
ct.toString = function(t) {
  const n = t ? function(r) {
    return t.call(this, r, Be);
  } : Be;
  return this._pairs.map(function(s) {
    return n(s[0]) + "=" + n(s[1]);
  }, "").join("&");
};
function pn(e) {
  return encodeURIComponent(e).replace(/%3A/gi, ":").replace(/%24/g, "$").replace(/%2C/gi, ",").replace(/%20/g, "+");
}
function lt(e, t, n) {
  if (!t)
    return e;
  const r = n && n.encode || pn;
  c.isFunction(n) && (n = {
    serialize: n
  });
  const s = n && n.serialize;
  let i;
  if (s ? i = s(t, n) : i = c.isURLSearchParams(t) ? t.toString() : new Te(t, n).toString(r), i) {
    const o = e.indexOf("#");
    o !== -1 && (e = e.slice(0, o)), e += (e.indexOf("?") === -1 ? "?" : "&") + i;
  }
  return e;
}
class De {
  constructor() {
    this.handlers = [];
  }
  /**
   * Add a new interceptor to the stack
   *
   * @param {Function} fulfilled The function to handle `then` for a `Promise`
   * @param {Function} rejected The function to handle `reject` for a `Promise`
   *
   * @return {Number} An ID used to remove interceptor later
   */
  use(t, n, r) {
    return this.handlers.push({
      fulfilled: t,
      rejected: n,
      synchronous: r ? r.synchronous : !1,
      runWhen: r ? r.runWhen : null
    }), this.handlers.length - 1;
  }
  /**
   * Remove an interceptor from the stack
   *
   * @param {Number} id The ID that was returned by `use`
   *
   * @returns {void}
   */
  eject(t) {
    this.handlers[t] && (this.handlers[t] = null);
  }
  /**
   * Clear all interceptors from the stack
   *
   * @returns {void}
   */
  clear() {
    this.handlers && (this.handlers = []);
  }
  /**
   * Iterate over all the registered interceptors
   *
   * This method is particularly useful for skipping over any
   * interceptors that may have become `null` calling `eject`.
   *
   * @param {Function} fn The function to call for each interceptor
   *
   * @returns {void}
   */
  forEach(t) {
    c.forEach(this.handlers, function(r) {
      r !== null && t(r);
    });
  }
}
const ut = {
  silentJSONParsing: !0,
  forcedJSONParsing: !0,
  clarifyTimeoutError: !1
}, mn = typeof URLSearchParams < "u" ? URLSearchParams : Te, hn = typeof FormData < "u" ? FormData : null, wn = typeof Blob < "u" ? Blob : null, gn = {
  isBrowser: !0,
  classes: {
    URLSearchParams: mn,
    FormData: hn,
    Blob: wn
  },
  protocols: ["http", "https", "file", "blob", "url", "data"]
}, Ae = typeof window < "u" && typeof document < "u", Se = typeof navigator == "object" && navigator || void 0, yn = Ae && (!Se || ["ReactNative", "NativeScript", "NS"].indexOf(Se.product) < 0), bn = typeof WorkerGlobalScope < "u" && // eslint-disable-next-line no-undef
self instanceof WorkerGlobalScope && typeof self.importScripts == "function", En = Ae && window.location.href || "http://localhost", Sn = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  hasBrowserEnv: Ae,
  hasStandardBrowserEnv: yn,
  hasStandardBrowserWebWorkerEnv: bn,
  navigator: Se,
  origin: En
}, Symbol.toStringTag, { value: "Module" })), R = {
  ...Sn,
  ...gn
};
function Rn(e, t) {
  return de(e, new R.classes.URLSearchParams(), {
    visitor: function(n, r, s, i) {
      return R.isNode && c.isBuffer(n) ? (this.append(r, n.toString("base64")), !1) : i.defaultVisitor.apply(this, arguments);
    },
    ...t
  });
}
function On(e) {
  return c.matchAll(/\w+|\[(\w*)]/g, e).map((t) => t[0] === "[]" ? "" : t[1] || t[0]);
}
function Tn(e) {
  const t = {}, n = Object.keys(e);
  let r;
  const s = n.length;
  let i;
  for (r = 0; r < s; r++)
    i = n[r], t[i] = e[i];
  return t;
}
function ft(e) {
  function t(n, r, s, i) {
    let o = n[i++];
    if (o === "__proto__") return !0;
    const a = Number.isFinite(+o), d = i >= n.length;
    return o = !o && c.isArray(s) ? s.length : o, d ? (c.hasOwnProp(s, o) ? s[o] = [s[o], r] : s[o] = r, !a) : ((!s[o] || !c.isObject(s[o])) && (s[o] = []), t(n, r, s[o], i) && c.isArray(s[o]) && (s[o] = Tn(s[o])), !a);
  }
  if (c.isFormData(e) && c.isFunction(e.entries)) {
    const n = {};
    return c.forEachEntry(e, (r, s) => {
      t(On(r), s, n, 0);
    }), n;
  }
  return null;
}
function An(e, t, n) {
  if (c.isString(e))
    try {
      return (t || JSON.parse)(e), c.trim(e);
    } catch (r) {
      if (r.name !== "SyntaxError")
        throw r;
    }
  return (n || JSON.stringify)(e);
}
const Z = {
  transitional: ut,
  adapter: ["xhr", "http", "fetch"],
  transformRequest: [function(t, n) {
    const r = n.getContentType() || "", s = r.indexOf("application/json") > -1, i = c.isObject(t);
    if (i && c.isHTMLForm(t) && (t = new FormData(t)), c.isFormData(t))
      return s ? JSON.stringify(ft(t)) : t;
    if (c.isArrayBuffer(t) || c.isBuffer(t) || c.isStream(t) || c.isFile(t) || c.isBlob(t) || c.isReadableStream(t))
      return t;
    if (c.isArrayBufferView(t))
      return t.buffer;
    if (c.isURLSearchParams(t))
      return n.setContentType("application/x-www-form-urlencoded;charset=utf-8", !1), t.toString();
    let a;
    if (i) {
      if (r.indexOf("application/x-www-form-urlencoded") > -1)
        return Rn(t, this.formSerializer).toString();
      if ((a = c.isFileList(t)) || r.indexOf("multipart/form-data") > -1) {
        const d = this.env && this.env.FormData;
        return de(
          a ? { "files[]": t } : t,
          d && new d(),
          this.formSerializer
        );
      }
    }
    return i || s ? (n.setContentType("application/json", !1), An(t)) : t;
  }],
  transformResponse: [function(t) {
    const n = this.transitional || Z.transitional, r = n && n.forcedJSONParsing, s = this.responseType === "json";
    if (c.isResponse(t) || c.isReadableStream(t))
      return t;
    if (t && c.isString(t) && (r && !this.responseType || s)) {
      const o = !(n && n.silentJSONParsing) && s;
      try {
        return JSON.parse(t, this.parseReviver);
      } catch (a) {
        if (o)
          throw a.name === "SyntaxError" ? g.from(a, g.ERR_BAD_RESPONSE, this, null, this.response) : a;
      }
    }
    return t;
  }],
  /**
   * A timeout in milliseconds to abort a request. If set to 0 (default) a
   * timeout is not created.
   */
  timeout: 0,
  xsrfCookieName: "XSRF-TOKEN",
  xsrfHeaderName: "X-XSRF-TOKEN",
  maxContentLength: -1,
  maxBodyLength: -1,
  env: {
    FormData: R.classes.FormData,
    Blob: R.classes.Blob
  },
  validateStatus: function(t) {
    return t >= 200 && t < 300;
  },
  headers: {
    common: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": void 0
    }
  }
};
c.forEach(["delete", "get", "head", "post", "put", "patch"], (e) => {
  Z.headers[e] = {};
});
const xn = c.toObjectSet([
  "age",
  "authorization",
  "content-length",
  "content-type",
  "etag",
  "expires",
  "from",
  "host",
  "if-modified-since",
  "if-unmodified-since",
  "last-modified",
  "location",
  "max-forwards",
  "proxy-authorization",
  "referer",
  "retry-after",
  "user-agent"
]), Cn = (e) => {
  const t = {};
  let n, r, s;
  return e && e.split(`
`).forEach(function(o) {
    s = o.indexOf(":"), n = o.substring(0, s).trim().toLowerCase(), r = o.substring(s + 1).trim(), !(!n || t[n] && xn[n]) && (n === "set-cookie" ? t[n] ? t[n].push(r) : t[n] = [r] : t[n] = t[n] ? t[n] + ", " + r : r);
  }), t;
}, je = Symbol("internals");
function K(e) {
  return e && String(e).trim().toLowerCase();
}
function ie(e) {
  return e === !1 || e == null ? e : c.isArray(e) ? e.map(ie) : String(e);
}
function Ln(e) {
  const t = /* @__PURE__ */ Object.create(null), n = /([^\s,;=]+)\s*(?:=\s*([^,;]+))?/g;
  let r;
  for (; r = n.exec(e); )
    t[r[1]] = r[2];
  return t;
}
const _n = (e) => /^[-_a-zA-Z0-9^`|~,!#$%&'*+.]+$/.test(e.trim());
function we(e, t, n, r, s) {
  if (c.isFunction(r))
    return r.call(this, t, n);
  if (s && (t = n), !!c.isString(t)) {
    if (c.isString(r))
      return t.indexOf(r) !== -1;
    if (c.isRegExp(r))
      return r.test(t);
  }
}
function Nn(e) {
  return e.trim().toLowerCase().replace(/([a-z\d])(\w*)/g, (t, n, r) => n.toUpperCase() + r);
}
function Pn(e, t) {
  const n = c.toCamelCase(" " + t);
  ["get", "set", "has"].forEach((r) => {
    Object.defineProperty(e, r + n, {
      value: function(s, i, o) {
        return this[r].call(this, t, s, i, o);
      },
      configurable: !0
    });
  });
}
let A = class {
  constructor(t) {
    t && this.set(t);
  }
  set(t, n, r) {
    const s = this;
    function i(a, d, l) {
      const u = K(d);
      if (!u)
        throw new Error("header name must be a non-empty string");
      const p = c.findKey(s, u);
      (!p || s[p] === void 0 || l === !0 || l === void 0 && s[p] !== !1) && (s[p || d] = ie(a));
    }
    const o = (a, d) => c.forEach(a, (l, u) => i(l, u, d));
    if (c.isPlainObject(t) || t instanceof this.constructor)
      o(t, n);
    else if (c.isString(t) && (t = t.trim()) && !_n(t))
      o(Cn(t), n);
    else if (c.isObject(t) && c.isIterable(t)) {
      let a = {}, d, l;
      for (const u of t) {
        if (!c.isArray(u))
          throw TypeError("Object iterator must return a key-value pair");
        a[l = u[0]] = (d = a[l]) ? c.isArray(d) ? [...d, u[1]] : [d, u[1]] : u[1];
      }
      o(a, n);
    } else
      t != null && i(n, t, r);
    return this;
  }
  get(t, n) {
    if (t = K(t), t) {
      const r = c.findKey(this, t);
      if (r) {
        const s = this[r];
        if (!n)
          return s;
        if (n === !0)
          return Ln(s);
        if (c.isFunction(n))
          return n.call(this, s, r);
        if (c.isRegExp(n))
          return n.exec(s);
        throw new TypeError("parser must be boolean|regexp|function");
      }
    }
  }
  has(t, n) {
    if (t = K(t), t) {
      const r = c.findKey(this, t);
      return !!(r && this[r] !== void 0 && (!n || we(this, this[r], r, n)));
    }
    return !1;
  }
  delete(t, n) {
    const r = this;
    let s = !1;
    function i(o) {
      if (o = K(o), o) {
        const a = c.findKey(r, o);
        a && (!n || we(r, r[a], a, n)) && (delete r[a], s = !0);
      }
    }
    return c.isArray(t) ? t.forEach(i) : i(t), s;
  }
  clear(t) {
    const n = Object.keys(this);
    let r = n.length, s = !1;
    for (; r--; ) {
      const i = n[r];
      (!t || we(this, this[i], i, t, !0)) && (delete this[i], s = !0);
    }
    return s;
  }
  normalize(t) {
    const n = this, r = {};
    return c.forEach(this, (s, i) => {
      const o = c.findKey(r, i);
      if (o) {
        n[o] = ie(s), delete n[i];
        return;
      }
      const a = t ? Nn(i) : String(i).trim();
      a !== i && delete n[i], n[a] = ie(s), r[a] = !0;
    }), this;
  }
  concat(...t) {
    return this.constructor.concat(this, ...t);
  }
  toJSON(t) {
    const n = /* @__PURE__ */ Object.create(null);
    return c.forEach(this, (r, s) => {
      r != null && r !== !1 && (n[s] = t && c.isArray(r) ? r.join(", ") : r);
    }), n;
  }
  [Symbol.iterator]() {
    return Object.entries(this.toJSON())[Symbol.iterator]();
  }
  toString() {
    return Object.entries(this.toJSON()).map(([t, n]) => t + ": " + n).join(`
`);
  }
  getSetCookie() {
    return this.get("set-cookie") || [];
  }
  get [Symbol.toStringTag]() {
    return "AxiosHeaders";
  }
  static from(t) {
    return t instanceof this ? t : new this(t);
  }
  static concat(t, ...n) {
    const r = new this(t);
    return n.forEach((s) => r.set(s)), r;
  }
  static accessor(t) {
    const r = (this[je] = this[je] = {
      accessors: {}
    }).accessors, s = this.prototype;
    function i(o) {
      const a = K(o);
      r[a] || (Pn(s, o), r[a] = !0);
    }
    return c.isArray(t) ? t.forEach(i) : i(t), this;
  }
};
A.accessor(["Content-Type", "Content-Length", "Accept", "Accept-Encoding", "User-Agent", "Authorization"]);
c.reduceDescriptors(A.prototype, ({ value: e }, t) => {
  let n = t[0].toUpperCase() + t.slice(1);
  return {
    get: () => e,
    set(r) {
      this[n] = r;
    }
  };
});
c.freezeMethods(A);
function ge(e, t) {
  const n = this || Z, r = t || n, s = A.from(r.headers);
  let i = r.data;
  return c.forEach(e, function(a) {
    i = a.call(n, i, s.normalize(), t ? t.status : void 0);
  }), s.normalize(), i;
}
function dt(e) {
  return !!(e && e.__CANCEL__);
}
function W(e, t, n) {
  g.call(this, e ?? "canceled", g.ERR_CANCELED, t, n), this.name = "CanceledError";
}
c.inherits(W, g, {
  __CANCEL__: !0
});
function pt(e, t, n) {
  const r = n.config.validateStatus;
  !n.status || !r || r(n.status) ? e(n) : t(new g(
    "Request failed with status code " + n.status,
    [g.ERR_BAD_REQUEST, g.ERR_BAD_RESPONSE][Math.floor(n.status / 100) - 4],
    n.config,
    n.request,
    n
  ));
}
function Un(e) {
  const t = /^([-+\w]{1,25})(:?\/\/|:)/.exec(e);
  return t && t[1] || "";
}
function kn(e, t) {
  e = e || 10;
  const n = new Array(e), r = new Array(e);
  let s = 0, i = 0, o;
  return t = t !== void 0 ? t : 1e3, function(d) {
    const l = Date.now(), u = r[i];
    o || (o = l), n[s] = d, r[s] = l;
    let p = i, w = 0;
    for (; p !== s; )
      w += n[p++], p = p % e;
    if (s = (s + 1) % e, s === i && (i = (i + 1) % e), l - o < t)
      return;
    const b = u && l - u;
    return b ? Math.round(w * 1e3 / b) : void 0;
  };
}
function Fn(e, t) {
  let n = 0, r = 1e3 / t, s, i;
  const o = (l, u = Date.now()) => {
    n = u, s = null, i && (clearTimeout(i), i = null), e(...l);
  };
  return [(...l) => {
    const u = Date.now(), p = u - n;
    p >= r ? o(l, u) : (s = l, i || (i = setTimeout(() => {
      i = null, o(s);
    }, r - p)));
  }, () => s && o(s)];
}
const ce = (e, t, n = 3) => {
  let r = 0;
  const s = kn(50, 250);
  return Fn((i) => {
    const o = i.loaded, a = i.lengthComputable ? i.total : void 0, d = o - r, l = s(d), u = o <= a;
    r = o;
    const p = {
      loaded: o,
      total: a,
      progress: a ? o / a : void 0,
      bytes: d,
      rate: l || void 0,
      estimated: l && a && u ? (a - o) / l : void 0,
      event: i,
      lengthComputable: a != null,
      [t ? "download" : "upload"]: !0
    };
    e(p);
  }, n);
}, Ie = (e, t) => {
  const n = e != null;
  return [(r) => t[0]({
    lengthComputable: n,
    total: e,
    loaded: r
  }), t[1]];
}, qe = (e) => (...t) => c.asap(() => e(...t)), Bn = R.hasStandardBrowserEnv ? /* @__PURE__ */ ((e, t) => (n) => (n = new URL(n, R.origin), e.protocol === n.protocol && e.host === n.host && (t || e.port === n.port)))(
  new URL(R.origin),
  R.navigator && /(msie|trident)/i.test(R.navigator.userAgent)
) : () => !0, Dn = R.hasStandardBrowserEnv ? (
  // Standard browser envs support document.cookie
  {
    write(e, t, n, r, s, i, o) {
      if (typeof document > "u") return;
      const a = [`${e}=${encodeURIComponent(t)}`];
      c.isNumber(n) && a.push(`expires=${new Date(n).toUTCString()}`), c.isString(r) && a.push(`path=${r}`), c.isString(s) && a.push(`domain=${s}`), i === !0 && a.push("secure"), c.isString(o) && a.push(`SameSite=${o}`), document.cookie = a.join("; ");
    },
    read(e) {
      if (typeof document > "u") return null;
      const t = document.cookie.match(new RegExp("(?:^|; )" + e + "=([^;]*)"));
      return t ? decodeURIComponent(t[1]) : null;
    },
    remove(e) {
      this.write(e, "", Date.now() - 864e5, "/");
    }
  }
) : (
  // Non-standard browser env (web workers, react-native) lack needed support.
  {
    write() {
    },
    read() {
      return null;
    },
    remove() {
    }
  }
);
function jn(e) {
  return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(e);
}
function In(e, t) {
  return t ? e.replace(/\/?\/$/, "") + "/" + t.replace(/^\/+/, "") : e;
}
function mt(e, t, n) {
  let r = !jn(t);
  return e && (r || n == !1) ? In(e, t) : t;
}
const He = (e) => e instanceof A ? { ...e } : e;
function $(e, t) {
  t = t || {};
  const n = {};
  function r(l, u, p, w) {
    return c.isPlainObject(l) && c.isPlainObject(u) ? c.merge.call({ caseless: w }, l, u) : c.isPlainObject(u) ? c.merge({}, u) : c.isArray(u) ? u.slice() : u;
  }
  function s(l, u, p, w) {
    if (c.isUndefined(u)) {
      if (!c.isUndefined(l))
        return r(void 0, l, p, w);
    } else return r(l, u, p, w);
  }
  function i(l, u) {
    if (!c.isUndefined(u))
      return r(void 0, u);
  }
  function o(l, u) {
    if (c.isUndefined(u)) {
      if (!c.isUndefined(l))
        return r(void 0, l);
    } else return r(void 0, u);
  }
  function a(l, u, p) {
    if (p in t)
      return r(l, u);
    if (p in e)
      return r(void 0, l);
  }
  const d = {
    url: i,
    method: i,
    data: i,
    baseURL: o,
    transformRequest: o,
    transformResponse: o,
    paramsSerializer: o,
    timeout: o,
    timeoutMessage: o,
    withCredentials: o,
    withXSRFToken: o,
    adapter: o,
    responseType: o,
    xsrfCookieName: o,
    xsrfHeaderName: o,
    onUploadProgress: o,
    onDownloadProgress: o,
    decompress: o,
    maxContentLength: o,
    maxBodyLength: o,
    beforeRedirect: o,
    transport: o,
    httpAgent: o,
    httpsAgent: o,
    cancelToken: o,
    socketPath: o,
    responseEncoding: o,
    validateStatus: a,
    headers: (l, u, p) => s(He(l), He(u), p, !0)
  };
  return c.forEach(Object.keys({ ...e, ...t }), function(u) {
    const p = d[u] || s, w = p(e[u], t[u], u);
    c.isUndefined(w) && p !== a || (n[u] = w);
  }), n;
}
const ht = (e) => {
  const t = $({}, e);
  let { data: n, withXSRFToken: r, xsrfHeaderName: s, xsrfCookieName: i, headers: o, auth: a } = t;
  if (t.headers = o = A.from(o), t.url = lt(mt(t.baseURL, t.url, t.allowAbsoluteUrls), e.params, e.paramsSerializer), a && o.set(
    "Authorization",
    "Basic " + btoa((a.username || "") + ":" + (a.password ? unescape(encodeURIComponent(a.password)) : ""))
  ), c.isFormData(n)) {
    if (R.hasStandardBrowserEnv || R.hasStandardBrowserWebWorkerEnv)
      o.setContentType(void 0);
    else if (c.isFunction(n.getHeaders)) {
      const d = n.getHeaders(), l = ["content-type", "content-length"];
      Object.entries(d).forEach(([u, p]) => {
        l.includes(u.toLowerCase()) && o.set(u, p);
      });
    }
  }
  if (R.hasStandardBrowserEnv && (r && c.isFunction(r) && (r = r(t)), r || r !== !1 && Bn(t.url))) {
    const d = s && i && Dn.read(i);
    d && o.set(s, d);
  }
  return t;
}, qn = typeof XMLHttpRequest < "u", Hn = qn && function(e) {
  return new Promise(function(n, r) {
    const s = ht(e);
    let i = s.data;
    const o = A.from(s.headers).normalize();
    let { responseType: a, onUploadProgress: d, onDownloadProgress: l } = s, u, p, w, b, f;
    function h() {
      b && b(), f && f(), s.cancelToken && s.cancelToken.unsubscribe(u), s.signal && s.signal.removeEventListener("abort", u);
    }
    let m = new XMLHttpRequest();
    m.open(s.method.toUpperCase(), s.url, !0), m.timeout = s.timeout;
    function E() {
      if (!m)
        return;
      const S = A.from(
        "getAllResponseHeaders" in m && m.getAllResponseHeaders()
      ), _ = {
        data: !a || a === "text" || a === "json" ? m.responseText : m.response,
        status: m.status,
        statusText: m.statusText,
        headers: S,
        config: e,
        request: m
      };
      pt(function(L) {
        n(L), h();
      }, function(L) {
        r(L), h();
      }, _), m = null;
    }
    "onloadend" in m ? m.onloadend = E : m.onreadystatechange = function() {
      !m || m.readyState !== 4 || m.status === 0 && !(m.responseURL && m.responseURL.indexOf("file:") === 0) || setTimeout(E);
    }, m.onabort = function() {
      m && (r(new g("Request aborted", g.ECONNABORTED, e, m)), m = null);
    }, m.onerror = function(O) {
      const _ = O && O.message ? O.message : "Network Error", j = new g(_, g.ERR_NETWORK, e, m);
      j.event = O || null, r(j), m = null;
    }, m.ontimeout = function() {
      let O = s.timeout ? "timeout of " + s.timeout + "ms exceeded" : "timeout exceeded";
      const _ = s.transitional || ut;
      s.timeoutErrorMessage && (O = s.timeoutErrorMessage), r(new g(
        O,
        _.clarifyTimeoutError ? g.ETIMEDOUT : g.ECONNABORTED,
        e,
        m
      )), m = null;
    }, i === void 0 && o.setContentType(null), "setRequestHeader" in m && c.forEach(o.toJSON(), function(O, _) {
      m.setRequestHeader(_, O);
    }), c.isUndefined(s.withCredentials) || (m.withCredentials = !!s.withCredentials), a && a !== "json" && (m.responseType = s.responseType), l && ([w, f] = ce(l, !0), m.addEventListener("progress", w)), d && m.upload && ([p, b] = ce(d), m.upload.addEventListener("progress", p), m.upload.addEventListener("loadend", b)), (s.cancelToken || s.signal) && (u = (S) => {
      m && (r(!S || S.type ? new W(null, e, m) : S), m.abort(), m = null);
    }, s.cancelToken && s.cancelToken.subscribe(u), s.signal && (s.signal.aborted ? u() : s.signal.addEventListener("abort", u)));
    const C = Un(s.url);
    if (C && R.protocols.indexOf(C) === -1) {
      r(new g("Unsupported protocol " + C + ":", g.ERR_BAD_REQUEST, e));
      return;
    }
    m.send(i || null);
  });
}, Mn = (e, t) => {
  const { length: n } = e = e ? e.filter(Boolean) : [];
  if (t || n) {
    let r = new AbortController(), s;
    const i = function(l) {
      if (!s) {
        s = !0, a();
        const u = l instanceof Error ? l : this.reason;
        r.abort(u instanceof g ? u : new W(u instanceof Error ? u.message : u));
      }
    };
    let o = t && setTimeout(() => {
      o = null, i(new g(`timeout ${t} of ms exceeded`, g.ETIMEDOUT));
    }, t);
    const a = () => {
      e && (o && clearTimeout(o), o = null, e.forEach((l) => {
        l.unsubscribe ? l.unsubscribe(i) : l.removeEventListener("abort", i);
      }), e = null);
    };
    e.forEach((l) => l.addEventListener("abort", i));
    const { signal: d } = r;
    return d.unsubscribe = () => c.asap(a), d;
  }
}, $n = function* (e, t) {
  let n = e.byteLength;
  if (n < t) {
    yield e;
    return;
  }
  let r = 0, s;
  for (; r < n; )
    s = r + t, yield e.slice(r, s), r = s;
}, vn = async function* (e, t) {
  for await (const n of zn(e))
    yield* $n(n, t);
}, zn = async function* (e) {
  if (e[Symbol.asyncIterator]) {
    yield* e;
    return;
  }
  const t = e.getReader();
  try {
    for (; ; ) {
      const { done: n, value: r } = await t.read();
      if (n)
        break;
      yield r;
    }
  } finally {
    await t.cancel();
  }
}, Me = (e, t, n, r) => {
  const s = vn(e, t);
  let i = 0, o, a = (d) => {
    o || (o = !0, r && r(d));
  };
  return new ReadableStream({
    async pull(d) {
      try {
        const { done: l, value: u } = await s.next();
        if (l) {
          a(), d.close();
          return;
        }
        let p = u.byteLength;
        if (n) {
          let w = i += p;
          n(w);
        }
        d.enqueue(new Uint8Array(u));
      } catch (l) {
        throw a(l), l;
      }
    },
    cancel(d) {
      return a(d), s.return();
    }
  }, {
    highWaterMark: 2
  });
}, $e = 64 * 1024, { isFunction: se } = c, Jn = (({ Request: e, Response: t }) => ({
  Request: e,
  Response: t
}))(c.global), {
  ReadableStream: ve,
  TextEncoder: ze
} = c.global, Je = (e, ...t) => {
  try {
    return !!e(...t);
  } catch {
    return !1;
  }
}, Wn = (e) => {
  e = c.merge.call({
    skipUndefined: !0
  }, Jn, e);
  const { fetch: t, Request: n, Response: r } = e, s = t ? se(t) : typeof fetch == "function", i = se(n), o = se(r);
  if (!s)
    return !1;
  const a = s && se(ve), d = s && (typeof ze == "function" ? /* @__PURE__ */ ((f) => (h) => f.encode(h))(new ze()) : async (f) => new Uint8Array(await new n(f).arrayBuffer())), l = i && a && Je(() => {
    let f = !1;
    const h = new n(R.origin, {
      body: new ve(),
      method: "POST",
      get duplex() {
        return f = !0, "half";
      }
    }).headers.has("Content-Type");
    return f && !h;
  }), u = o && a && Je(() => c.isReadableStream(new r("").body)), p = {
    stream: u && ((f) => f.body)
  };
  s && ["text", "arrayBuffer", "blob", "formData", "stream"].forEach((f) => {
    !p[f] && (p[f] = (h, m) => {
      let E = h && h[f];
      if (E)
        return E.call(h);
      throw new g(`Response type '${f}' is not supported`, g.ERR_NOT_SUPPORT, m);
    });
  });
  const w = async (f) => {
    if (f == null)
      return 0;
    if (c.isBlob(f))
      return f.size;
    if (c.isSpecCompliantForm(f))
      return (await new n(R.origin, {
        method: "POST",
        body: f
      }).arrayBuffer()).byteLength;
    if (c.isArrayBufferView(f) || c.isArrayBuffer(f))
      return f.byteLength;
    if (c.isURLSearchParams(f) && (f = f + ""), c.isString(f))
      return (await d(f)).byteLength;
  }, b = async (f, h) => {
    const m = c.toFiniteNumber(f.getContentLength());
    return m ?? w(h);
  };
  return async (f) => {
    let {
      url: h,
      method: m,
      data: E,
      signal: C,
      cancelToken: S,
      timeout: O,
      onDownloadProgress: _,
      onUploadProgress: j,
      responseType: L,
      headers: me,
      withCredentials: ee = "same-origin",
      fetchOptions: Ce
    } = ht(f), Le = t || fetch;
    L = L ? (L + "").toLowerCase() : "text";
    let te = Mn([C, S && S.toAbortSignal()], O), V = null;
    const I = te && te.unsubscribe && (() => {
      te.unsubscribe();
    });
    let _e;
    try {
      if (j && l && m !== "get" && m !== "head" && (_e = await b(me, E)) !== 0) {
        let F = new n(h, {
          method: "POST",
          body: E,
          duplex: "half"
        }), v;
        if (c.isFormData(E) && (v = F.headers.get("content-type")) && me.setContentType(v), F.body) {
          const [he, ne] = Ie(
            _e,
            ce(qe(j))
          );
          E = Me(F.body, $e, he, ne);
        }
      }
      c.isString(ee) || (ee = ee ? "include" : "omit");
      const P = i && "credentials" in n.prototype, Ne = {
        ...Ce,
        signal: te,
        method: m.toUpperCase(),
        headers: me.normalize().toJSON(),
        body: E,
        duplex: "half",
        credentials: P ? ee : void 0
      };
      V = i && new n(h, Ne);
      let k = await (i ? Le(V, Ce) : Le(h, Ne));
      const Pe = u && (L === "stream" || L === "response");
      if (u && (_ || Pe && I)) {
        const F = {};
        ["status", "statusText", "headers"].forEach((Ue) => {
          F[Ue] = k[Ue];
        });
        const v = c.toFiniteNumber(k.headers.get("content-length")), [he, ne] = _ && Ie(
          v,
          ce(qe(_), !0)
        ) || [];
        k = new r(
          Me(k.body, $e, he, () => {
            ne && ne(), I && I();
          }),
          F
        );
      }
      L = L || "text";
      let Rt = await p[c.findKey(p, L) || "text"](k, f);
      return !Pe && I && I(), await new Promise((F, v) => {
        pt(F, v, {
          data: Rt,
          headers: A.from(k.headers),
          status: k.status,
          statusText: k.statusText,
          config: f,
          request: V
        });
      });
    } catch (P) {
      throw I && I(), P && P.name === "TypeError" && /Load failed|fetch/i.test(P.message) ? Object.assign(
        new g("Network Error", g.ERR_NETWORK, f, V),
        {
          cause: P.cause || P
        }
      ) : g.from(P, P && P.code, f, V);
    }
  };
}, Vn = /* @__PURE__ */ new Map(), wt = (e) => {
  let t = e && e.env || {};
  const { fetch: n, Request: r, Response: s } = t, i = [
    r,
    s,
    n
  ];
  let o = i.length, a = o, d, l, u = Vn;
  for (; a--; )
    d = i[a], l = u.get(d), l === void 0 && u.set(d, l = a ? /* @__PURE__ */ new Map() : Wn(t)), u = l;
  return l;
};
wt();
const xe = {
  http: un,
  xhr: Hn,
  fetch: {
    get: wt
  }
};
c.forEach(xe, (e, t) => {
  if (e) {
    try {
      Object.defineProperty(e, "name", { value: t });
    } catch {
    }
    Object.defineProperty(e, "adapterName", { value: t });
  }
});
const We = (e) => `- ${e}`, Kn = (e) => c.isFunction(e) || e === null || e === !1;
function Xn(e, t) {
  e = c.isArray(e) ? e : [e];
  const { length: n } = e;
  let r, s;
  const i = {};
  for (let o = 0; o < n; o++) {
    r = e[o];
    let a;
    if (s = r, !Kn(r) && (s = xe[(a = String(r)).toLowerCase()], s === void 0))
      throw new g(`Unknown adapter '${a}'`);
    if (s && (c.isFunction(s) || (s = s.get(t))))
      break;
    i[a || "#" + o] = s;
  }
  if (!s) {
    const o = Object.entries(i).map(
      ([d, l]) => `adapter ${d} ` + (l === !1 ? "is not supported by the environment" : "is not available in the build")
    );
    let a = n ? o.length > 1 ? `since :
` + o.map(We).join(`
`) : " " + We(o[0]) : "as no adapter specified";
    throw new g(
      "There is no suitable adapter to dispatch the request " + a,
      "ERR_NOT_SUPPORT"
    );
  }
  return s;
}
const gt = {
  /**
   * Resolve an adapter from a list of adapter names or functions.
   * @type {Function}
   */
  getAdapter: Xn,
  /**
   * Exposes all known adapters
   * @type {Object<string, Function|Object>}
   */
  adapters: xe
};
function ye(e) {
  if (e.cancelToken && e.cancelToken.throwIfRequested(), e.signal && e.signal.aborted)
    throw new W(null, e);
}
function Ve(e) {
  return ye(e), e.headers = A.from(e.headers), e.data = ge.call(
    e,
    e.transformRequest
  ), ["post", "put", "patch"].indexOf(e.method) !== -1 && e.headers.setContentType("application/x-www-form-urlencoded", !1), gt.getAdapter(e.adapter || Z.adapter, e)(e).then(function(r) {
    return ye(e), r.data = ge.call(
      e,
      e.transformResponse,
      r
    ), r.headers = A.from(r.headers), r;
  }, function(r) {
    return dt(r) || (ye(e), r && r.response && (r.response.data = ge.call(
      e,
      e.transformResponse,
      r.response
    ), r.response.headers = A.from(r.response.headers))), Promise.reject(r);
  });
}
const yt = "1.13.2", pe = {};
["object", "boolean", "number", "function", "string", "symbol"].forEach((e, t) => {
  pe[e] = function(r) {
    return typeof r === e || "a" + (t < 1 ? "n " : " ") + e;
  };
});
const Ke = {};
pe.transitional = function(t, n, r) {
  function s(i, o) {
    return "[Axios v" + yt + "] Transitional option '" + i + "'" + o + (r ? ". " + r : "");
  }
  return (i, o, a) => {
    if (t === !1)
      throw new g(
        s(o, " has been removed" + (n ? " in " + n : "")),
        g.ERR_DEPRECATED
      );
    return n && !Ke[o] && (Ke[o] = !0, console.warn(
      s(
        o,
        " has been deprecated since v" + n + " and will be removed in the near future"
      )
    )), t ? t(i, o, a) : !0;
  };
};
pe.spelling = function(t) {
  return (n, r) => (console.warn(`${r} is likely a misspelling of ${t}`), !0);
};
function Gn(e, t, n) {
  if (typeof e != "object")
    throw new g("options must be an object", g.ERR_BAD_OPTION_VALUE);
  const r = Object.keys(e);
  let s = r.length;
  for (; s-- > 0; ) {
    const i = r[s], o = t[i];
    if (o) {
      const a = e[i], d = a === void 0 || o(a, i, e);
      if (d !== !0)
        throw new g("option " + i + " must be " + d, g.ERR_BAD_OPTION_VALUE);
      continue;
    }
    if (n !== !0)
      throw new g("Unknown option " + i, g.ERR_BAD_OPTION);
  }
}
const ae = {
  assertOptions: Gn,
  validators: pe
}, U = ae.validators;
let H = class {
  constructor(t) {
    this.defaults = t || {}, this.interceptors = {
      request: new De(),
      response: new De()
    };
  }
  /**
   * Dispatch a request
   *
   * @param {String|Object} configOrUrl The config specific for this request (merged with this.defaults)
   * @param {?Object} config
   *
   * @returns {Promise} The Promise to be fulfilled
   */
  async request(t, n) {
    try {
      return await this._request(t, n);
    } catch (r) {
      if (r instanceof Error) {
        let s = {};
        Error.captureStackTrace ? Error.captureStackTrace(s) : s = new Error();
        const i = s.stack ? s.stack.replace(/^.+\n/, "") : "";
        try {
          r.stack ? i && !String(r.stack).endsWith(i.replace(/^.+\n.+\n/, "")) && (r.stack += `
` + i) : r.stack = i;
        } catch {
        }
      }
      throw r;
    }
  }
  _request(t, n) {
    typeof t == "string" ? (n = n || {}, n.url = t) : n = t || {}, n = $(this.defaults, n);
    const { transitional: r, paramsSerializer: s, headers: i } = n;
    r !== void 0 && ae.assertOptions(r, {
      silentJSONParsing: U.transitional(U.boolean),
      forcedJSONParsing: U.transitional(U.boolean),
      clarifyTimeoutError: U.transitional(U.boolean)
    }, !1), s != null && (c.isFunction(s) ? n.paramsSerializer = {
      serialize: s
    } : ae.assertOptions(s, {
      encode: U.function,
      serialize: U.function
    }, !0)), n.allowAbsoluteUrls !== void 0 || (this.defaults.allowAbsoluteUrls !== void 0 ? n.allowAbsoluteUrls = this.defaults.allowAbsoluteUrls : n.allowAbsoluteUrls = !0), ae.assertOptions(n, {
      baseUrl: U.spelling("baseURL"),
      withXsrfToken: U.spelling("withXSRFToken")
    }, !0), n.method = (n.method || this.defaults.method || "get").toLowerCase();
    let o = i && c.merge(
      i.common,
      i[n.method]
    );
    i && c.forEach(
      ["delete", "get", "head", "post", "put", "patch", "common"],
      (f) => {
        delete i[f];
      }
    ), n.headers = A.concat(o, i);
    const a = [];
    let d = !0;
    this.interceptors.request.forEach(function(h) {
      typeof h.runWhen == "function" && h.runWhen(n) === !1 || (d = d && h.synchronous, a.unshift(h.fulfilled, h.rejected));
    });
    const l = [];
    this.interceptors.response.forEach(function(h) {
      l.push(h.fulfilled, h.rejected);
    });
    let u, p = 0, w;
    if (!d) {
      const f = [Ve.bind(this), void 0];
      for (f.unshift(...a), f.push(...l), w = f.length, u = Promise.resolve(n); p < w; )
        u = u.then(f[p++], f[p++]);
      return u;
    }
    w = a.length;
    let b = n;
    for (; p < w; ) {
      const f = a[p++], h = a[p++];
      try {
        b = f(b);
      } catch (m) {
        h.call(this, m);
        break;
      }
    }
    try {
      u = Ve.call(this, b);
    } catch (f) {
      return Promise.reject(f);
    }
    for (p = 0, w = l.length; p < w; )
      u = u.then(l[p++], l[p++]);
    return u;
  }
  getUri(t) {
    t = $(this.defaults, t);
    const n = mt(t.baseURL, t.url, t.allowAbsoluteUrls);
    return lt(n, t.params, t.paramsSerializer);
  }
};
c.forEach(["delete", "get", "head", "options"], function(t) {
  H.prototype[t] = function(n, r) {
    return this.request($(r || {}, {
      method: t,
      url: n,
      data: (r || {}).data
    }));
  };
});
c.forEach(["post", "put", "patch"], function(t) {
  function n(r) {
    return function(i, o, a) {
      return this.request($(a || {}, {
        method: t,
        headers: r ? {
          "Content-Type": "multipart/form-data"
        } : {},
        url: i,
        data: o
      }));
    };
  }
  H.prototype[t] = n(), H.prototype[t + "Form"] = n(!0);
});
let Qn = class bt {
  constructor(t) {
    if (typeof t != "function")
      throw new TypeError("executor must be a function.");
    let n;
    this.promise = new Promise(function(i) {
      n = i;
    });
    const r = this;
    this.promise.then((s) => {
      if (!r._listeners) return;
      let i = r._listeners.length;
      for (; i-- > 0; )
        r._listeners[i](s);
      r._listeners = null;
    }), this.promise.then = (s) => {
      let i;
      const o = new Promise((a) => {
        r.subscribe(a), i = a;
      }).then(s);
      return o.cancel = function() {
        r.unsubscribe(i);
      }, o;
    }, t(function(i, o, a) {
      r.reason || (r.reason = new W(i, o, a), n(r.reason));
    });
  }
  /**
   * Throws a `CanceledError` if cancellation has been requested.
   */
  throwIfRequested() {
    if (this.reason)
      throw this.reason;
  }
  /**
   * Subscribe to the cancel signal
   */
  subscribe(t) {
    if (this.reason) {
      t(this.reason);
      return;
    }
    this._listeners ? this._listeners.push(t) : this._listeners = [t];
  }
  /**
   * Unsubscribe from the cancel signal
   */
  unsubscribe(t) {
    if (!this._listeners)
      return;
    const n = this._listeners.indexOf(t);
    n !== -1 && this._listeners.splice(n, 1);
  }
  toAbortSignal() {
    const t = new AbortController(), n = (r) => {
      t.abort(r);
    };
    return this.subscribe(n), t.signal.unsubscribe = () => this.unsubscribe(n), t.signal;
  }
  /**
   * Returns an object that contains a new `CancelToken` and a function that, when called,
   * cancels the `CancelToken`.
   */
  static source() {
    let t;
    return {
      token: new bt(function(s) {
        t = s;
      }),
      cancel: t
    };
  }
};
function Zn(e) {
  return function(n) {
    return e.apply(null, n);
  };
}
function Yn(e) {
  return c.isObject(e) && e.isAxiosError === !0;
}
const Re = {
  Continue: 100,
  SwitchingProtocols: 101,
  Processing: 102,
  EarlyHints: 103,
  Ok: 200,
  Created: 201,
  Accepted: 202,
  NonAuthoritativeInformation: 203,
  NoContent: 204,
  ResetContent: 205,
  PartialContent: 206,
  MultiStatus: 207,
  AlreadyReported: 208,
  ImUsed: 226,
  MultipleChoices: 300,
  MovedPermanently: 301,
  Found: 302,
  SeeOther: 303,
  NotModified: 304,
  UseProxy: 305,
  Unused: 306,
  TemporaryRedirect: 307,
  PermanentRedirect: 308,
  BadRequest: 400,
  Unauthorized: 401,
  PaymentRequired: 402,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  NotAcceptable: 406,
  ProxyAuthenticationRequired: 407,
  RequestTimeout: 408,
  Conflict: 409,
  Gone: 410,
  LengthRequired: 411,
  PreconditionFailed: 412,
  PayloadTooLarge: 413,
  UriTooLong: 414,
  UnsupportedMediaType: 415,
  RangeNotSatisfiable: 416,
  ExpectationFailed: 417,
  ImATeapot: 418,
  MisdirectedRequest: 421,
  UnprocessableEntity: 422,
  Locked: 423,
  FailedDependency: 424,
  TooEarly: 425,
  UpgradeRequired: 426,
  PreconditionRequired: 428,
  TooManyRequests: 429,
  RequestHeaderFieldsTooLarge: 431,
  UnavailableForLegalReasons: 451,
  InternalServerError: 500,
  NotImplemented: 501,
  BadGateway: 502,
  ServiceUnavailable: 503,
  GatewayTimeout: 504,
  HttpVersionNotSupported: 505,
  VariantAlsoNegotiates: 506,
  InsufficientStorage: 507,
  LoopDetected: 508,
  NotExtended: 510,
  NetworkAuthenticationRequired: 511,
  WebServerIsDown: 521,
  ConnectionTimedOut: 522,
  OriginIsUnreachable: 523,
  TimeoutOccurred: 524,
  SslHandshakeFailed: 525,
  InvalidSslCertificate: 526
};
Object.entries(Re).forEach(([e, t]) => {
  Re[t] = e;
});
function Et(e) {
  const t = new H(e), n = Qe(H.prototype.request, t);
  return c.extend(n, H.prototype, t, { allOwnKeys: !0 }), c.extend(n, t, null, { allOwnKeys: !0 }), n.create = function(s) {
    return Et($(e, s));
  }, n;
}
const y = Et(Z);
y.Axios = H;
y.CanceledError = W;
y.CancelToken = Qn;
y.isCancel = dt;
y.VERSION = yt;
y.toFormData = de;
y.AxiosError = g;
y.Cancel = y.CanceledError;
y.all = function(t) {
  return Promise.all(t);
};
y.spread = Zn;
y.isAxiosError = Yn;
y.mergeConfig = $;
y.AxiosHeaders = A;
y.formToJSON = (e) => ft(c.isHTMLForm(e) ? new FormData(e) : e);
y.getAdapter = gt.getAdapter;
y.HttpStatusCode = Re;
y.default = y;
const {
  Axios: lr,
  AxiosError: ur,
  CanceledError: fr,
  isCancel: dr,
  CancelToken: pr,
  VERSION: mr,
  all: hr,
  Cancel: wr,
  isAxiosError: gr,
  spread: yr,
  toFormData: br,
  AxiosHeaders: Er,
  HttpStatusCode: Sr,
  formToJSON: Rr,
  getAdapter: Or,
  mergeConfig: Tr
} = y, er = {};
class x {
  static _baseUrl = er?.VITE_WALLETTWO_URL || "https://api.wallettwo.com";
  static _authUrl = `${x._baseUrl}/auth`;
  static #e = localStorage.getItem("wallettwo_token") || null;
  static headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${x.#e}`
  };
  static updateAccessToken(t) {
    x.#e = t, x.headers.Authorization = `Bearer ${t}`, localStorage.setItem("wallettwo_token", t);
  }
  static async userInfo(t) {
    const { data: n } = await y.get(`${x._authUrl}/userinfo`, {
      headers: {
        Authorization: `Bearer ${t}`
      }
    });
    return x.updateAccessToken(t), n;
  }
  static async exchangeConsentToken(t) {
    if (!t) throw new Error("Code is required to exchange consent token.");
    const { data: n } = await y.get(`${x._authUrl}/consent?code=${t}`);
    return n;
  }
}
const Xe = (e) => {
  let t;
  const n = /* @__PURE__ */ new Set(), r = (l, u) => {
    const p = typeof l == "function" ? l(t) : l;
    if (!Object.is(p, t)) {
      const w = t;
      t = u ?? (typeof p != "object" || p === null) ? p : Object.assign({}, t, p), n.forEach((b) => b(t, w));
    }
  }, s = () => t, a = { setState: r, getState: s, getInitialState: () => d, subscribe: (l) => (n.add(l), () => n.delete(l)) }, d = t = e(r, s, a);
  return a;
}, tr = ((e) => e ? Xe(e) : Xe), nr = (e) => e;
function rr(e, t = nr) {
  const n = re.useSyncExternalStore(
    e.subscribe,
    re.useCallback(() => t(e.getState()), [e, t]),
    re.useCallback(() => t(e.getInitialState()), [e, t])
  );
  return re.useDebugValue(n), n;
}
const Ge = (e) => {
  const t = tr(e), n = (r) => rr(t, r);
  return Object.assign(n, t), n;
}, St = ((e) => e ? Ge(e) : Ge), D = St((e) => ({
  loading: !0,
  setLoading: (t) => e({ loading: t }),
  user: null,
  setUser: (t) => e({ user: t }),
  token: null,
  setToken: (t) => e({ token: t })
}));
St((e, t) => ({
  modals: {},
  openModal: (n, r = {}) => e((s) => ({
    modals: {
      ...s.modals,
      [n]: { id: n, isOpen: !0, props: r }
    }
  })),
  closeModal: (n) => e((r) => {
    const s = r.modals[n];
    return s ? {
      modals: {
        ...r.modals,
        [n]: { ...s, isOpen: !1 }
      }
    } : {};
  }),
  toggleModal: (n) => e((r) => {
    const s = r.modals[n];
    return s ? {
      modals: {
        ...r.modals,
        [n]: { ...s, isOpen: !s.isOpen }
      }
    } : {};
  }),
  getModal: (n) => t().modals[n]
}));
function Y() {
  const { setLoading: e, setToken: t, setUser: n } = D(), r = async (a) => {
    if (a.origin !== "https://wallet.wallettwo.com") return;
    const { code: d, type: l } = a.data;
    if (l !== "wallet_login")
      return window.removeEventListener("message", r), e(!1);
    try {
      const { access_token: u } = await x.exchangeConsentToken(d);
      t(u);
    } catch (u) {
      console.error("Error exchanging consent token:", u);
    }
    window.removeEventListener("message", r), e(!1);
  }, s = async (a) => {
    if (a.origin !== "https://wallet.wallettwo.com") return;
    const { code: d, type: l } = a.data;
    if (l === "wallet_login") {
      try {
        const { access_token: u } = await x.exchangeConsentToken(d);
        t(u);
      } catch (u) {
        console.error("Error exchanging consent token:", u);
      }
      window.removeEventListener("message", s);
    }
  };
  return {
    headlessLogin: r,
    login: s,
    logout: async () => {
      const a = document.getElementById("wallettwo-headless-logout-iframe");
      return new Promise((d, l) => {
        const u = (w) => {
          w.origin === "https://wallet.wallettwo.com" && w.data.type === "wallet_logout" && (localStorage.removeItem("wallettwo_token"), n(null), t(null), window.removeEventListener("message", u), a && a.parentNode === document.body && document.body.removeChild(a), clearTimeout(p), d(w.data));
        }, p = setTimeout(() => {
          window.removeEventListener("message", u), a && a.parentNode === document.body && document.body.removeChild(a), l(new Error("Logout timed out"));
        }, 1e4);
        window.addEventListener("message", u);
      });
    },
    defaultHandler: (a) => {
      if (a.origin === "https://wallet.wallettwo.com" && [
        "login_required",
        "pin_required",
        "register_required",
        "email_verification_required",
        "wallet_required"
      ].includes(a.data.type)) {
        n(null), t(null);
        return;
      }
    }
  };
}
function sr() {
  const { setUser: e, user: t } = D(), n = Y();
  return {
    headlessLogin: () => {
      const o = document.createElement("iframe");
      o.style.display = "none", o.src = "https://wallet.wallettwo.com/auth/login?action=auth&iframe=true", o.id = "wallettwo-headless-login-iframe", document.body.appendChild(o), window.addEventListener("message", n.headlessLogin);
    },
    loadUserFromToken: async (o) => {
      const a = await x.userInfo(o);
      a && e(a);
    },
    logout: async () => {
      const o = document.createElement("iframe");
      return o.style.display = "none", o.src = "https://wallet.wallettwo.com/action/logout?iframe=true", o.id = "wallettwo-headless-logout-iframe", document.body.appendChild(o), n.logout();
    },
    user: t
  };
}
function Ar({
  onAuth: e
}) {
  const { user: t, setToken: n } = D(), r = new URL("https://wallet.wallettwo.com/auth/login");
  r.searchParams.append("action", "auth"), r.searchParams.append("iframe", "true");
  const s = async (i) => {
    if (i.origin !== "https://wallet.wallettwo.com") return;
    const o = document.getElementById("wallettwo-auth-iframe");
    if (!o || i.source !== o.contentWindow) return;
    const { code: a, type: d } = i.data;
    if (d === "wallet_login") {
      try {
        const { access_token: l } = await x.exchangeConsentToken(a);
        n(l), e && await e(l);
      } catch (l) {
        console.error("Error exchanging consent token:", l);
      }
      window.removeEventListener("message", s);
    }
  };
  return M(() => {
    if (!t)
      return window.addEventListener("message", s), () => {
        window.removeEventListener("message", s);
      };
  }, [t]), t ? null : /* @__PURE__ */ B(
    "iframe",
    {
      src: r.toString(),
      id: "wallettwo-auth-iframe",
      className: "w-full min-h-[650px] border-0",
      title: "WalletTwo Auth"
    }
  );
}
function xr({
  onSuccess: e,
  onFailure: t,
  onCancel: n,
  onExecuting: r,
  network: s,
  methods: i,
  params: o,
  addresses: a,
  waitTx: d = !0,
  abis: l
}) {
  const { defaultHandler: u } = Y(), { user: p } = D(), w = new URL("https://wallet.wallettwo.com/auth/login");
  w.searchParams.append("action", "transaction"), w.searchParams.append("iframe", "true"), w.searchParams.append("network", s || "137"), w.searchParams.append("methods", JSON.stringify(i || [])), w.searchParams.append("params", JSON.stringify(o || [])), w.searchParams.append("addresses", JSON.stringify(a || [])), w.searchParams.append("waitTx", d ? "true" : "false"), w.searchParams.append("abis", JSON.stringify(l || []));
  const b = async (f) => {
    if (await u(f), f.data.type === "transaction_complete") {
      const { tx: h } = f.data;
      e && await e(h);
    }
    if (f.data.type === "transaction_cancelled" && n && await n(), f.data.type === "transaction_failed") {
      const { error: h } = f.data;
      t && await t(h);
    }
    f.data.type === "transactions_executing" && r && await r();
  };
  return M(() => {
    if (p)
      return window.addEventListener("message", b), () => {
        window.removeEventListener("message", b);
      };
  }, [p]), p ? /* @__PURE__ */ B(
    "iframe",
    {
      src: w.toString(),
      id: "wallettwo-transaction-iframe",
      className: "w-full min-w-[600px] min-h-[650px] border-0",
      title: "WalletTwo Transaction"
    }
  ) : null;
}
function Cr({
  onRampSuccess: e,
  onRampFailure: t,
  onRampCancel: n
}) {
  const { defaultHandler: r } = Y(), { user: s } = D(), i = new URL("https://wallet.wallettwo.com/auth/login");
  i.searchParams.append("action", "ramp"), i.searchParams.append("iframe", "true");
  const o = async (a) => {
    await r(a);
    const d = document.getElementById("wallettwo-ramp-iframe");
    if (!(!d || a.source !== d.contentWindow)) {
      if (a.data.type === "ramp_complete") {
        const { session: l } = a.data;
        e && await e(l);
      }
      if (a.data.type === "ramp_cancelled" && n && await n(), a.data.type === "ramp_failed") {
        const { error: l } = a.data;
        t && await t(l);
      }
      window.removeEventListener("message", o);
    }
  };
  return M(() => {
    if (s)
      return window.addEventListener("message", o), () => {
        window.removeEventListener("message", o);
      };
  }, [s]), s ? /* @__PURE__ */ B(
    "iframe",
    {
      src: i.toString(),
      id: "wallettwo-ramp-iframe",
      className: "w-full min-h-[650px] border-0",
      title: "WalletTwo Ramp"
    }
  ) : null;
}
function Lr({
  message: e = "",
  onSignature: t
}) {
  const { defaultHandler: n } = Y(), { user: r } = D(), s = new URL("https://wallet.wallettwo.com/auth/login");
  s.searchParams.append("action", "signature"), s.searchParams.append("message", e), s.searchParams.append("iframe", "true");
  const i = async (o) => {
    await n(o);
    const a = document.getElementById("wallettwo-signature-iframe");
    if (!a || o.source !== a.contentWindow || o.data.type !== "message_signed") return;
    const { signature: d } = o.data;
    t && await t(d), window.removeEventListener("message", i);
  };
  return M(() => {
    if (!(!r || !e || e == ""))
      return window.addEventListener("message", i), () => {
        window.removeEventListener("message", i);
      };
  }, [r]), !r || !e || e == "" ? null : /* @__PURE__ */ B(
    "iframe",
    {
      src: s.toString(),
      id: "wallettwo-signature-iframe",
      className: "w-full min-h-[650px] border-0",
      title: "WalletTwo Signature"
    }
  );
}
function _r({
  children: e,
  loader: t,
  disableLoader: n
}) {
  const { loading: r, token: s, setToken: i, setUser: o } = D(), { headlessLogin: a } = sr();
  return M(() => {
    a();
  }, []), M(() => {
    s && x.userInfo(s).then((d) => {
      d ? o(d) : i(null);
      const l = document.getElementById("wallettwo-headless-login-iframe");
      l && l.parentNode && document.body.removeChild(l);
    });
  }, [s]), r && !n ? t ? /* @__PURE__ */ B(Ot, { children: t }) : /* @__PURE__ */ B("div", { children: "Loading WalletTwo..." }) : /* @__PURE__ */ B("div", { className: "wallettwo-provider-container-root", children: e });
}
function Nr({
  onLogout: e
}) {
  const { defaultHandler: t } = Y(), { user: n, setToken: r, setUser: s } = D(), i = new URL("https://wallet.wallettwo.com/auth/login");
  i.searchParams.append("action", "logout"), i.searchParams.append("iframe", "true");
  const o = async (a) => {
    await t(a);
    const d = document.getElementById("wallettwo-auth-iframe");
    !d || a.source !== d.contentWindow || a.data.type === "wallet_logout" && (e && await e(), r(null), s(null), window.removeEventListener("message", o));
  };
  return M(() => {
    if (n)
      return window.addEventListener("message", o), () => {
        window.removeEventListener("message", o);
      };
  }, [n]), n ? /* @__PURE__ */ B(
    "iframe",
    {
      src: i.toString(),
      id: "wallettwo-logout-iframe",
      className: "w-full min-h-[650px] border-0",
      title: "WalletTwo Logout"
    }
  ) : null;
}
export {
  Ar as AuthAction,
  Nr as LogoutAction,
  Cr as RampAction,
  Lr as SignatureAction,
  xr as TransactionAction,
  _r as WalletTwoProvider,
  sr as useWalletTwo
};
