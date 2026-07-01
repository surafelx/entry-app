// DoH DNS workaround — patches dns.lookup + dns.resolve4 for Cloudflare DoH
import dns from "node:dns";
import https from "node:https";

const DOH = "https://1.1.1.1/dns-query";
const cache = new Map();

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { accept: "application/dns-json" }, timeout: 5000 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function dohResolve(hostname) {
  if (cache.has(hostname)) return cache.get(hostname);
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return [hostname];
  try {
    const data = await httpsGet(`${DOH}?name=${hostname}&type=A`);
    const addrs = data.Answer?.filter((a) => a.type === 1).map((a) => a.data);
    if (addrs?.length) cache.set(hostname, addrs);
    return addrs;
  } catch { return null; }
}

// Patch dns.lookup — this is what undici/fetch ultimately calls for TCP connections
const _origLookup = dns.lookup.bind(dns);
dns.lookup = (hostname, opts, cb) => {
  if (typeof opts === "function") { cb = opts; opts = {}; }
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return _origLookup(hostname, opts, cb);
  dohResolve(hostname).then((addrs) => {
    if (!addrs?.length) return _origLookup(hostname, opts, cb);
    if (opts?.all) return cb(null, addrs.map((a) => ({ address: a, family: 4 })));
    cb(null, addrs[0], 4);
  }).catch(() => _origLookup(hostname, opts, cb));
};

const _origResolve4 = dns.resolve4.bind(dns);
dns.resolve4 = (h, o, cb) => {
  if (typeof o === "function") { cb = o; o = {}; }
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return _origResolve4(h, o, cb);
  dohResolve(h).then((a) => a?.length ? cb(null, a) : _origResolve4(h, o, cb)).catch(() => _origResolve4(h, o, cb));
};

console.log("[dns-fix] DoH DNS resolver installed");
