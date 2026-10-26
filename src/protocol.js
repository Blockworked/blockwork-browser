// The handshake both ends share with Blockwork's bridge (blockwork-core's
// browser module): each side answers the other's nonce with
// HMAC-SHA256(pairing key, "client:" or "server:" + nonce), in hex.
(() => {
  const PROTOCOL = 1;
  const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

  async function hmacHex(key, message) {
    const enc = new TextEncoder();
    const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return hex(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  }

  function randomHex(n) {
    return hex(crypto.getRandomValues(new Uint8Array(n)));
  }

  globalThis.BlockworkProtocol = { PROTOCOL, hmacHex, randomHex };
})();
