import { io } from "socket.io-client";

let socket = null;

export function getSocket(auth) {
  if (!socket) {
    socket = io("/", {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      transports: ["websocket", "polling"],
      auth: auth || {},
    });
  }
  return socket;
}
