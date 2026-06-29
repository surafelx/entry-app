import { useEffect, useRef } from "react";
import { getSocket } from "../socket.js";

export function useSocket(authPayload) {
  const socketRef = useRef(null);

  useEffect(() => {
    const s = getSocket(authPayload);
    socketRef.current = s;
    if (!s.connected) s.connect();
    return () => {};
  }, [JSON.stringify(authPayload)]);

  return socketRef.current;
}
