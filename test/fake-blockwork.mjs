// A stand-in for Blockwork's browser bridge (blockwork-core/src/browser.rs):
// the same upgrade, origin check, pairing handshake and request shape.
import http from "node:http";
import crypto from "node:crypto";

const hmac = (key, msg) => crypto.createHmac("sha256", key).update(msg).digest("hex");

export function fakeBlockwork({ port = 0, key }) {
  const clients = new Set();
  let nextId = 1;
  const server = http.createServer((_, res) => res.writeHead(426).end());
  server.on("upgrade", (req, socket) => {
    const origin = req.headers.origin || "";
    if (!/^(chrome-extension|moz-extension):\/\//.test(origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const client = { socket, pending: new Map(), trusted: false, browser: "" };
    const nonce = crypto.randomBytes(16).toString("hex");
    const send = (obj) => {
      const payload = Buffer.from(JSON.stringify(obj));
      const head = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
      socket.write(Buffer.concat([head, payload]));
    };
    client.send = send;
    send({ type: "hello", nonce, protocol: 1, version: "test" });
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 2) return;
        let len = buffer[1] & 127;
        let offset = 2;
        if (len === 126) {
          if (buffer.length < 4) return;
          len = buffer.readUInt16BE(2);
          offset = 4;
        }
        if (buffer.length < offset + 4 + len) return;
        const mask = buffer.subarray(offset, offset + 4);
        const data = Buffer.from(buffer.subarray(offset + 4, offset + 4 + len)).map((b, i) => b ^ mask[i % 4]);
        const opcode = buffer[0] & 15;
        buffer = buffer.subarray(offset + 4 + len);
        if (opcode === 8) return socket.end();
        if (opcode !== 1) continue;
        const msg = JSON.parse(data.toString());
        if (!client.trusted) {
          if (msg.type !== "auth" || msg.mac !== hmac(key, "client:" + nonce)) {
            send({ type: "denied", reason: "wrong key" });
            return socket.end();
          }
          client.trusted = true;
          client.browser = msg.browser;
          clients.add(client);
          send({ type: "welcome", mac: hmac(key, "server:" + msg.nonce), version: "test" });
        } else if (msg.type === "response") {
          const done = client.pending.get(msg.id);
          client.pending.delete(msg.id);
          done?.(msg);
        }
      }
    });
    socket.on("close", () => clients.delete(client));
    socket.on("error", () => {});
  });
  return {
    listen: () => new Promise((r) => server.listen(port, "127.0.0.1", () => r(server.address().port))),
    close: () => {
      for (const c of clients) c.socket.destroy();
      return new Promise((r) => server.close(r));
    },
    connected: () => clients.size,
    request(cmd, args = {}) {
      const [client] = clients;
      if (!client) return Promise.reject(new Error("no browser"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        client.pending.set(id, (msg) => (msg.ok ? resolve(msg.result) : reject(new Error(msg.error))));
        client.send({ type: "request", id, cmd, args });
      });
    },
  };
}
