import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { createLiveKitToken } from "./api.js";
import StreamChat from "./StreamChat.jsx";

export default function LivestreamRoom({ roomName, mode = "viewer", userName = "User", onEnd }) {
  const [token, setToken] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!roomName) return;
    createLiveKitToken(roomName, `${mode}-${userName}-${Date.now()}`)
      .then((data) => setToken(data.token))
      .catch((e) => setError(e.message));
  }, [roomName, mode, userName]);

  if (error) return <div className="livestream-error">Error: {error}</div>;
  if (!token) return <div className="livestream-loading">Connecting to stream...</div>;

  return (
    <div className="livestream-layout">
      <LiveKitRoom
        token={token}
        serverUrl={import.meta.env.VITE_LIVEKIT_URL || undefined}
        connect={true}
        onDisconnected={onEnd}
        data-lk-theme="default"
        style={{ flex: 1 }}
      >
        <VideoConference />
        <RoomAudioRenderer />
      </LiveKitRoom>

      <div className="livestream-chat">
        <StreamChat roomId={`stream-${roomName}`} userName={userName} />
        {mode === "streamer" && (
          <button className="btn accent" onClick={onEnd}>
            End Stream
          </button>
        )}
      </div>
    </div>
  );
}
